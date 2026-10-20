#!/usr/bin/env node
// Post-install acceptance: compare an installed profile against the pack's expected
// plugin set (core dependencies + optional third-party group) and against the config
// layers (pack patch vs profile patch, composed dump). Optionally diff against a
// captured baseline JSON (schema dsh-cross-device-observed/v1), including sampled-file
// SHA256 checks. Read-only: nothing is installed, written (except a temp composed file)
// or modified.
//
// Usage:
//   node scripts/verify-install.mjs --profile packed
//   node scripts/verify-install.mjs --profile packed --baseline <observed.json>
//   node scripts/verify-install.mjs --profile packed --json
//
// Exit codes: 0 = no blocking deviation; 1 = deviations found; 2 = usage/environment error.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const profileName = argOf('--profile') || 'packed';
const baselinePath = argOf('--baseline');
const asJson = argv.includes('--json');
const problems = [];
const warnings = [];
const notes = [];

const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
const profileDir = join(dshHome, 'profiles', profileName);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push(label + ' is not readable as JSON: ' + e.message);
    return null;
  }
}
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();

// ---------------- expected set: core dependencies + optional group ----------------
const packPkg = readJson(join(root, 'package.json'), 'pack package.json');
if (!packPkg) { console.error('verify-install: FAIL - pack package.json unreadable'); process.exit(2); }
const expected = Object.entries(packPkg.dependencies || {})
  .map(([name, spec]) => ({ name, spec, optional: false }));

let optionalCount = 0;
try {
  const opt = JSON.parse(readFileSync(join(root, 'assets', 'optional-components.json'), 'utf8'));
  for (const o of opt.components || []) {
    expected.push({ name: o.package, spec: o.spec, optional: true });
    optionalCount++;
  }
  notes.push('optional group: ' + optionalCount + ' component(s) expected by default (-SkipOptional skips)');
} catch (e) {
  warnings.push('assets/optional-components.json unreadable - optional group not checked: ' + e.message);
}

// ---------------- installed reality ----------------
const profilePkg = readJson(join(profileDir, 'package.json'), 'profile package.json');
if (!profilePkg) { console.error('verify-install: FAIL - profile "' + profileName + '" not found under ' + dshHome); process.exit(2); }
const deps = profilePkg.dependencies || {};
const bundleList = Array.isArray(profilePkg.dsh?.profile?.bundles) ? profilePkg.dsh.profile.bundles : [];

const installed = new Map();
for (const [key, spec] of Object.entries(deps)) {
  const nm = join(profileDir, 'node_modules', key);
  const row = { key, spec, declared: true, version: null, actualName: null, expectsBundle: false, registered: bundleList.includes(key), entry: null };
  try {
    const pj = JSON.parse(readFileSync(join(nm, 'package.json'), 'utf8'));
    row.actualName = pj.name || null;
    row.version = pj.version || null;
    row.expectsBundle = Boolean(pj['dsh.bundle'] || (pj.dsh && pj.dsh.bundle));
    if (pj.main) row.entry = exists(join(nm, pj.main)) ? 'ok' : 'MISSING:' + pj.main;
  } catch { row.version = null; }
  installed.set(key, row);
}
function exists(p) { try { readFileSync(p); return true; } catch { return false; } }

function findInstalled(name) {
  if (installed.has(name)) return installed.get(name);
  for (const row of installed.values()) {
    if (row.actualName === name) return row;
  }
  // Alias tolerance: a dev profile may declare the same package under a scoped key
  // (e.g. dsh-archived-sessions as @jiangdaoli/dsh-archived-sessions). Same package
  // when the dep key ends with "/<expected name>".
  for (const [key, row] of installed.entries()) {
    if (key.endsWith('/' + name)) return row;
  }
  return null;
}

// ---------------- compare ----------------
const rows = [];
for (const e of expected) {
  const got = findInstalled(e.name);
  if (!got) {
    rows.push({ name: e.name, expected: e.spec, optional: e.optional, status: 'missing', version: null, registered: false });
    (e.optional ? warnings : problems).push(
      (e.optional ? 'optional' : 'core') + ' plugin "' + e.name + '" is not installed in profile "' + profileName + '"'
    );
    continue;
  }
  const specVer = String(e.spec).match(/#v?([0-9][^]*)$/)?.[1] || String(e.spec).replace(/^[~^<>=\s]+/, '');
  const drift = got.version && specVer && !String(e.spec).startsWith('github:') && got.version !== specVer
    ? 'version-drift' : null;
  if (drift) problems.push('plugin "' + e.name + '" installed ' + got.version + ' but expected ' + e.spec);
  // Only packages that themselves declare a dsh.bundle must appear in dsh.profile.bundles;
  // plain runtime deps (e.g. @deepseek-ai/dsh-mcp-client, dsh-subagent-acp) legitimately do not.
  if (got.expectsBundle && !got.registered) problems.push('plugin "' + e.name + '" declares a bundle but is not registered in dsh.profile.bundles');
  if (got.entry && got.entry !== 'ok') problems.push('plugin "' + e.name + '" entry ' + got.entry);
  rows.push({
    name: e.name, expected: e.spec, optional: e.optional,
    status: drift ? 'version-drift' : 'ok',
    version: got.version, declaredAs: got.key, registered: got.registered, entry: got.entry,
  });
}
const matchedKeys = new Set(rows.filter((r) => r.declaredAs).map((r) => r.declaredAs));
const extras = [...installed.entries()]
  .filter(([key]) => !matchedKeys.has(key))
  .map(([key, r]) => ({ key, spec: r.spec, version: r.version, registered: r.registered, actualName: r.actualName }));
if (extras.length) {
  notes.push(extras.length + ' installed package(s) outside the pack expected set (dev aliases or manual adds): '
    + extras.map((x) => x.key).join(', '));
}

// ---------------- optional baseline diff ----------------
let baseline = null;
if (baselinePath) {
  const b = readJson(baselinePath, 'baseline');
  if (b) {
    baseline = { file: baselinePath, capturedAt: b.capturedAt || null, profile: b.profile || null, rows: [], hashMatch: 0, hashTotal: 0, hashMissing: 0 };
    for (const bp of b.packages || []) {
      const got = findInstalled(bp.name) || [...installed.values()].find((r) => r.actualName === bp.name);
      const row = { name: bp.name, baselineVersion: bp.version || null, status: got ? 'present' : 'absent-here', version: got?.version || null, hashMiss: [] };
      if (got && bp.version && got.version && bp.version !== got.version) row.status = 'version-differs';
      if (got) {
        const nmDir = join(profileDir, 'node_modules', got.key);
        for (const a of bp.sampledArtifacts || []) {
          baseline.hashTotal++;
          const f = join(nmDir, a.file);
          try {
            if (sha256(f) !== String(a.sha256).toUpperCase()) row.hashMiss.push(a.file);
          } catch { row.hashMiss.push(a.file + ' (missing)'); }
        }
        baseline.hashMatch += (bp.sampledArtifacts?.length || 0) - row.hashMiss.length;
        baseline.hashMissing += row.hashMiss.length;
        if (row.hashMiss.length) warnings.push('baseline "' + bp.name + '": sampled files differ: ' + row.hashMiss.join(', '));
      }
      baseline.rows.push(row);
    }
    notes.push('baseline diff: ' + baseline.hashMatch + '/' + baseline.hashTotal + ' sampled hashes match');
  }
}

// ---------------- config checks (read-only subprocesses) ----------------
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}
const config = {};
if (!asJson || argv.includes('--with-config')) {
  const v = run('node', [join(root, 'scripts', 'verify.mjs'), '--profile', profileName]);
  config.shadowCheck = { exit: v.code, tail: (v.out + v.err).trim().split(/\r?\n/).slice(-1)[0] || '' };
  if (v.code !== 0) warnings.push('verify.mjs --profile reported problems (shadowing or errors) - see its output');

  const composedPath = join(tmpdir(), 'verify-install-composed-' + process.pid + '.yml');
  const dump = run('dsh', ['--profile', profileName, '--dump-config'], { captureFile: composedPath });
  config.dump = { exit: dump.code };
  try {
    writeFileSync(composedPath, dump.out, 'utf8');
    const c = run('node', [join(root, 'scripts', 'verify.mjs'), '--composed', composedPath]);
    const m = (c.out + c.err).match(/(\d+) tool row\(s\), (\d+) registered provider name\(s\), (\d+) dangling/);
    config.composed = { exit: c.code, toolRows: m ? +m[1] : null, providers: m ? +m[2] : null, dangling: m ? +m[3] : null };
    if (config.composed.dangling === null || config.composed.dangling > 0) {
      problems.push('composed config check failed or reported dangling providers');
    }
  } catch (e) {
    problems.push('composed check could not run: ' + e.message);
  } finally {
    try { rmSync(composedPath, { force: true }); } catch {}
  }

  const cp = run('node', [join(root, 'scripts', 'compare-profile.mjs'), join(profileDir, 'cordis.patch.yml')]);
  try {
    const j = JSON.parse(cp.out);
    config.patchCompare = {
      exit: cp.code, sameIdCount: j.sameIdCount,
      packOnlyCount: (j.packOnly || []).length, profileOnlyCount: (j.profileOnly || []).length,
      natures: (j.natures || []).reduce((acc, n) => { acc[n.nature] = (acc[n.nature] || 0) + 1; return acc; }, {}),
    };
    notes.push('patch compare: ' + config.patchCompare.sameIdCount + ' shared row id(s); profile-only '
      + config.patchCompare.profileOnlyCount + ', pack-only ' + config.patchCompare.packOnlyCount
      + ' (device literals/preferences are expected device differences)');
  } catch {
    config.patchCompare = { exit: cp.code, parseError: true };
  }
}

// ---------------- report ----------------
const ok = problems.length === 0;
const summary = {
  ok,
  profile: profileName,
  dshHome,
  expected: expected.length,
  optionalCount,
  rows,
  extras,
  baseline,
  config,
  problems,
  warnings,
  notes,
};
if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const n of notes) console.log('  note  ' + n);
  console.log('');
  console.log('plugin set (' + profileName + '):');
  for (const r of rows) {
    const flag = r.status === 'ok' ? 'ok    ' : r.status === 'missing' ? 'MISSING' : 'DRIFT ';
    console.log('  [' + flag + '] ' + r.name.padEnd(40) + (r.version || '-') + (r.optional ? '  (optional)' : ''));
  }
  for (const x of extras) console.log('  [extra ] ' + x.key.padEnd(40) + (x.version || '-'));
  if (baseline) {
    console.log('baseline diff (' + (baseline.capturedAt || 'undated') + '): hash ' + baseline.hashMatch + '/' + baseline.hashTotal + ' match');
    for (const r of baseline.rows) if (r.status !== 'present' || r.hashMiss.length) {
      console.log('  [' + r.status + '] ' + r.name + (r.hashMiss.length ? ' hashDiff: ' + r.hashMiss.join(', ') : ''));
    }
  }
  if (config.composed) console.log('composed: ' + config.composed.toolRows + ' tool rows, ' + config.composed.providers + ' providers, ' + config.composed.dangling + ' dangling');
  if (problems.length) {
    console.error('verify-install: FAIL - ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  - ' + p);
  } else {
    console.log('verify-install: OK - no blocking deviation' + (warnings.length ? ' (' + warnings.length + ' warning(s))' : ''));
  }
  for (const w of warnings) console.log('  warn  ' + w);
}
process.exit(ok ? 0 : 1);
