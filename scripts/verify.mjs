#!/usr/bin/env node
// Read-only checks. Never writes anything, never touches a live profile.
//
//   1. every id in pack.manifest.yaml -> owns appears exactly once in cordis.patch.yml
//   2. every !!js scalar obeys the YAML constraints (no ": ", no leading quote/{/[ /!)
//   3. (optional) the target profile's own cordis.patch.yml declares none of the owned ids
//   4. every id in pack.manifest.yaml -> delegated is absent from cordis.patch.yml
//   A. no providerName: value in cordis.patch.yml is declared twice
//   C. (--composed <path>) every provider: consumed by a dsh-tool-subagent row is registered
//
// Usage:
//   node scripts/verify.mjs
//   node scripts/verify.mjs --profile web
//   node scripts/verify.mjs --composed composed.yml
//   node scripts/verify.mjs --help
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { officialModelProblems } from './model-config.mjs';

const USAGE = `verify.mjs — read-only checks on this pack. It never writes any file.

  node scripts/verify.mjs
  node scripts/verify.mjs --profile <name>
  node scripts/verify.mjs --composed <path>

  --profile <name>    also check that the profile's own cordis.patch.yml declares none of the
                      row ids this pack owns (the profile patch is the LAST layer and wins,
                      so an inline block there shadows the pack).
  --composed <path>   also check a composed config dump from:
                        dsh --profile <name> --dump-config > composed.yml
                      CAVEAT: --dump-config echoes UNEVALUATED patch source.
  --help, -h          print this text.

Exit code 0 = all checks passed, 1 = at least one problem (each printed as "FAIL: ").`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(USAGE);
  process.exit(0);
}
const profileArg = args.indexOf('--profile');
const profile = profileArg >= 0 ? args[profileArg + 1] : undefined;
const composedArg = args.indexOf('--composed');
const composed = composedArg >= 0 ? args[composedArg + 1] : undefined;

const errors = [];
const warns = [];
if (composedArg >= 0 && composed === undefined) {
  errors.push('--composed requires a path, e.g. --composed composed.yml');
}

function plainScalar(raw) {
  let v = String(raw).trim();
  const quoted = /^(['"])(.*)\1$/.exec(v);
  if (quoted) return quoted[2];
  const hash = v.search(/\s#/);
  if (hash >= 0) v = v.slice(0, hash).trim();
  return v;
}

function collectScalars(lines, key) {
  const re = new RegExp('^\\s*' + key + ':\\s*(.+?)\\s*$');
  const out = [];
  lines.forEach((line, i) => {
    if (line.trim().startsWith('#')) return;
    const m = re.exec(line);
    if (!m) return;
    out.push({ raw: m[1], value: plainScalar(m[1]), line: i + 1 });
  });
  return out;
}

function parseRowBlocks(lines) {
  const rows = [];
  let cur = null;
  lines.forEach((rawLine, i) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const item = /^(\s*)-\s+(.*)$/.exec(line);
    if (item) {
      cur = { indent: item[1].length, lines: [[i + 1, item[2]]] };
      rows.push(cur);
      return;
    }
    if (cur) cur.lines.push([i + 1, line]);
  });
  return rows;
}

function scalarOf(row, key) {
  const blockRe = new RegExp('^\\s*' + key + ':\\s*(.*?)\\s*$');
  const flowRe = new RegExp('[{,]\\s*' + key + ':\\s*([^,}]+)');
  for (const [num, text] of row.lines) {
    const m = blockRe.exec(text);
    if (m && m[1] !== '') return { value: plainScalar(m[1]), line: num };
    const f = flowRe.exec(text);
    if (f) return { value: plainScalar(f[1]), line: num };
  }
  return null;
}

function listIds(manifest, key) {
  const block = new RegExp('^' + key + ':\\s*\\n((?:[ \\t]+-\\s*.+\\n?)+)', 'm').exec(manifest);
  if (!block) return [];
  return block[1]
    .split('\n')
    .map((l) => {
      const flow = /^\s*-\s*\{[^}]*\bid\s*:\s*([^,}\s]+)/.exec(l);
      if (flow) return plainScalar(flow[1]);
      return l.replace(/^[ \t]*-\s*/, '').trim();
    })
    .filter(Boolean);
}

const manifest = readFileSync(join(root, 'pack.manifest.yaml'), 'utf8');
const owns = listIds(manifest, 'owns');
if (owns.length === 0) {
  console.error('verify: pack.manifest.yaml has no "owns:" list');
  process.exit(1);
}
const delegated = listIds(manifest, 'delegated');

const patchPath = join(root, 'cordis.patch.yml');
if (!existsSync(patchPath)) {
  console.error('verify: cordis.patch.yml missing — run "npm run build" first');
  process.exit(1);
}
const patch = readFileSync(patchPath, 'utf8');
const patchLines = patch.split('\n');

function countId(lines, id) {
  const re = new RegExp('^\\s*- id:\\s*' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');
  return lines.filter((l) => re.test(l)).length;
}

// 1. ownership coverage
for (const id of owns) {
  const hits = countId(patchLines, id);
  if (hits === 1) continue;
  if (hits === 0) errors.push(`owns lists "${id}" but cordis.patch.yml never declares it`);
  else errors.push(`cordis.patch.yml declares "${id}" ${hits} times (expected 1)`);
}

// 4. delegated ids must not appear in this pack
for (const id of delegated) {
  const hits = countId(patchLines, id);
  if (hits > 0) {
    errors.push(
      `delegated id "${id}" is declared ${hits} time(s) in cordis.patch.yml — ` +
        `ownership boundary violated; remove it from the pack or from delegated`
    );
  }
}

errors.push(...officialModelProblems(patchLines.join('\n')));

// 2. !!js scalar constraints
patchLines.forEach((line, i) => {
  const m = /!!js\s+(.*)$/.exec(line);
  if (!m) return;
  const expr = m[1].trim();
  if (/:\s/.test(expr))
    errors.push(
      `line ${i + 1}: !!js expression contains ": " — YAML ends the plain scalar there. Most common cause is a ternary; rewrite (cond && 'a') || 'b'.`
    );
  if (/^["'{[]/.test(expr))
    errors.push(`line ${i + 1}: !!js expression starts with a quote/{/[ — YAML will mis-parse it`);
  if (expr.startsWith('!'))
    errors.push(`line ${i + 1}: !!js expression starts with "!" — YAML will read it as another tag`);
});

// 3. shadow check against a real profile
if (profile) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const target = join(dshHome, 'profiles', profile, 'cordis.patch.yml');
  if (!existsSync(target)) {
    warns.push(`profile "${profile}" not found at ${target} — skipped shadow check`);
  } else {
    const targetLines = readFileSync(target, 'utf8').split('\n');
    const shadows = [];
    for (const id of owns) {
      targetLines.forEach((l, i) => {
        const re = new RegExp(
          '^\\s*- id:\\s*' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'
        );
        if (re.test(l)) shadows.push(`  ${id}  (profile line ${i + 1})`);
      });
    }
    if (shadows.length > 0) {
      errors.push(
        `profile "${profile}" declares ${shadows.length} row id(s) this pack owns.\n` +
          `  The profile patch is the LAST layer, so these inline blocks SHADOW the pack.\n` +
          `  Remove them from the profile before/after installing, or move them into the pack.\n` +
          shadows.join('\n')
      );
    }
  }
}

// A. providerName uniqueness inside the pack
const providerNames = collectScalars(patchLines, 'providerName');
const providerByName = new Map();
for (const p of providerNames) {
  if (!providerByName.has(p.value)) providerByName.set(p.value, []);
  providerByName.get(p.value).push(p);
}
for (const [value, hits] of providerByName) {
  if (hits.length > 1) {
    errors.push(
      `providerName "${value}" is declared ${hits.length} times in cordis.patch.yml ` +
        `(lines ${hits.map((h) => h.line).join(', ')}) — a provider name must be registered exactly once`
    );
  }
}

// C. composed-config provider integrity
let composedSummary;
if (composed) {
  const composedPath = resolve(composed);
  if (!existsSync(composedPath)) {
    errors.push(`--composed file not found: ${composedPath}`);
  } else {
    const cLines = readFileSync(composedPath, 'utf8').split(/\r?\n/);
    const registered = new Set(['spawn', 'fork', 'acp']);
    for (const p of collectScalars(cLines, 'providerName')) registered.add(p.value);
    const SUBAGENT_NAME_PREFIX = '@deepseek-ai/dsh-subagent-';
    const toolRows = [];
    for (const row of parseRowBlocks(cLines)) {
      const name = scalarOf(row, 'name');
      if (!name) continue;
      if (name.value.startsWith(SUBAGENT_NAME_PREFIX)) {
        const suffix = name.value.slice(SUBAGENT_NAME_PREFIX.length);
        if (suffix) registered.add(suffix);
      }
      const ownProviderName = scalarOf(row, 'providerName');
      if (ownProviderName) registered.add(ownProviderName.value);
      if (name.value !== '@deepseek-ai/dsh-tool-subagent') continue;
      const provider = scalarOf(row, 'provider');
      if (!provider) {
        warns.push(
          `composed config: '@deepseek-ai/dsh-tool-subagent' row at line ${row.lines[0][0]} has no provider: — skipped`
        );
        continue;
      }
      toolRows.push({ provider, toolName: scalarOf(row, 'toolName'), rowLine: row.lines[0][0] });
    }
    let dangling = 0;
    for (const r of toolRows) {
      if (registered.has(r.provider.value)) continue;
      dangling++;
      errors.push(
        `composed config line ${r.provider.line}: tool row (row at line ${r.rowLine}` +
          `${r.toolName ? `, toolName: ${r.toolName.value}` : ', no toolName:'}) consumes provider "${r.provider.value}", ` +
          `but no providerName: "${r.provider.value}" is registered in ${composedPath} (built-ins spawn/fork/acp excepted) — ` +
          `the tool would silently never appear`
      );
    }
    composedSummary = `composed: ${toolRows.length} tool row(s), ${registered.size} registered provider name(s), ${dangling} dangling`;
  }
}

for (const w of warns) console.warn('warn: ' + w);
if (composedSummary) console.log(composedSummary);
if (errors.length > 0) {
  for (const e of errors) console.error('FAIL: ' + e);
  console.error(`verify: ${errors.length} problem(s)`);
  process.exit(1);
}
const okParts = [
  `${owns.length} owned id(s) declared exactly once`,
  `${delegated.length} delegated id(s) absent from pack`,
  '!!js scalars well-formed',
  `${providerNames.length} providerName(s) unique`,
];
if (profile) okParts.push(`no shadow in profile "${profile}"`);
if (composed) okParts.push('no dangling provider in composed config');
console.log('verify: OK — ' + okParts.join(', '));
