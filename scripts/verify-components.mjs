#!/usr/bin/env node
// Fail-closed component verifier for the dsh-config-pack release train.
//
// The pack is an umbrella: every runtime component is a separate public repository with its own
// immutable annotated tag, and this pack pins each one in pack.manifest.yaml (components:) and in
// package.json. This verifier is the enforcement point. It fails non-zero whenever the declared
// combo and the published reality disagree.
//
// What it proves, per component:
//   1. the repository is readable ANONYMOUSLY (private or missing repos break every public install);
//   2. the pinned tag actually exists;
//   3. the tag resolves to EXACTLY the recorded commit SHA.
//
// Check 3 is the important one. A git tag name is mutable: an upstream can move or delete it, and
// pnpm resolves git specs at install time, so a moved tag silently ships different code to every
// user. Recording and re-checking the dereferenced commit is the only thing that turns "we pinned a
// version" into an enforced invariant.
//
// Usage:
//   node scripts/verify-components.mjs            # full check (needs network)
//   node scripts/verify-components.mjs --offline  # lock/package.json cross-check only, no network
//   node scripts/verify-components.mjs --json

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const offline = argv.includes('--offline');
const asJson = argv.includes('--json');

const problems = [];
const notes = [];
function fail(message) { problems.push(message); }

// --- parse pack.manifest.yaml's components block ------------------------------
// Dependency-free, line-based parse. The block is a flat list of 6-key records; anything that does
// not match that shape is reported rather than silently ignored.
function parseComponents(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^components:\s*$/.test(l));
  if (start < 0) return null;
  const items = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== '') break;      // next top-level key
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const m = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
    if (m) { cur = { id: m[1] }; items.push(cur); continue; }
    const kv = line.match(/^\s+([A-Za-z_]+):\s*(.*?)\s*$/);
    if (kv && cur) {
      let v = kv[2];
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      if (v === 'true') v = true; else if (v === 'false') v = false;
      cur[kv[1]] = v;
      continue;
    }
    fail('pack.manifest.yaml: unrecognized line inside components: ' + line.trim());
  }
  return items;
}

const manifestText = readFileSync(join(root, 'pack.manifest.yaml'), 'utf8');
const components = parseComponents(manifestText);
if (!components || components.length === 0) {
  console.error('verify-components: FAIL - pack.manifest.yaml has no parseable components: block');
  process.exit(1);
}

// --- shape of each lock entry -------------------------------------------------
for (const c of components) {
  for (const key of ['id', 'package', 'repo', 'tag', 'commit', 'installable']) {
    if (c[key] === undefined || c[key] === '') fail('component "' + (c.id || '?') + '" is missing "' + key + '"');
  }
  if (typeof c.commit === 'string' && !/^[0-9a-f]{40}$/.test(c.commit)) {
    fail('component "' + c.id + '" commit must be a full 40-char lowercase SHA, got "' + c.commit + '"');
  }
  if (typeof c.repo === 'string' && !/^https:\/\/github\.com\//.test(c.repo)) {
    fail('component "' + c.id + '" repo must be an https GitHub URL, got "' + c.repo + '"');
  }
  if (c.installable === false && !c.why) {
    fail('component "' + c.id + '" is marked installable: false but does not say why');
  }
}
const seenIds = new Set();
for (const c of components) {
  if (seenIds.has(c.id)) fail('duplicate component id "' + c.id + '" in the lock');
  seenIds.add(c.id);
}

// --- cross-check against package.json ----------------------------------------
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = pkg.dependencies || {};
const lockedByPackage = new Map(components.map((c) => [c.package, c]));

for (const c of components) {
  if (c.installable !== true) continue;
  const spec = deps[c.package];
  if (!spec) {
    fail('component "' + c.id + '" (' + c.package + ') is locked but not declared in package.json dependencies');
    continue;
  }
  const m = String(spec).match(/#([^#]+)$/);
  if (!m) {
    fail('dependency "' + c.package + '" is not pinned to a tag: "' + spec + '"');
    continue;
  }
  if (m[1] !== c.tag) {
    fail('dependency "' + c.package + '" pins #' + m[1] + ' but the lock says #' + c.tag);
  }
}

for (const [name, spec] of Object.entries(deps)) {
  if (!/^github:/.test(String(spec))) continue;
  const locked = lockedByPackage.get(name);
  if (!locked) {
    fail('git dependency "' + name + '" is not listed in the components lock');
    continue;
  }
  const m = String(spec).match(/^github:([^#]+)(?:#(.+))?$/);
  const specRepo = m ? 'https://github.com/' + m[1] + '.git' : null;
  if (specRepo && locked.repo && specRepo.toLowerCase() !== String(locked.repo).toLowerCase()) {
    fail('dependency "' + name + '" points at ' + specRepo + ' but the lock says ' + locked.repo);
  }
}

// --- online: anonymous readability + tag -> commit ----------------------------
// A transient network failure must not read as "the tag moved", and must not read as success
// either. Retry transport-level failures a bounded number of times, then report firmly.
function lsRemoteTags(repo) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync('git', [
    '-c', 'credential.helper=',
    '-c', 'credential.interactive=false',
      'ls-remote', '--tags', repo,
    ], {
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
      timeout: 120000,
    });
    last = r;
    if (r.status === 0 && r.stdout) return r;
    const err = String(r.stderr || '');
    // Credential prompts and 404s are definitive: the repo is private or absent. Do not retry.
    if (/could not read Username|unable to get password|not found|Repository not found/i.test(err)) return r;
    if (attempt < 3) continue;
  }
  return last;
}

if (offline) {
  notes.push('offline mode: skipped anonymous readability and tag->commit resolution');
} else {
  for (const c of components) {
    const r = lsRemoteTags(c.repo);
    if (r.status !== 0 || !r.stdout) {
      fail('component "' + c.id + '": repository is not readable anonymously (' + c.repo + ')' +
        (r.stderr ? ' - ' + String(r.stderr).trim().split('\n')[0] : ''));
      continue;
    }
    const lines = String(r.stdout).split(/\r?\n/).filter(Boolean);
    const wantTag = 'refs/tags/' + c.tag;
    const tagLine = lines.find((l) => l.endsWith('\t' + wantTag));
    const derefLine = lines.find((l) => l.endsWith('\t' + wantTag + '^{}'));
    if (!tagLine) {
      fail('component "' + c.id + '": tag ' + c.tag + ' does not exist on ' + c.repo +
        (c.tag === 'main' ? '' : ''));
      continue;
    }
    const tagObject = tagLine.split(/\s+/)[0];
    const resolved = derefLine ? derefLine.split(/\s+/)[0] : tagObject;
    if (!derefLine) {
      notes.push('component "' + c.id + '": ' + c.tag + ' is a lightweight tag (no ^{} object)');
    }
    if (resolved !== c.commit) {
      fail('component "' + c.id + '": tag ' + c.tag + ' now resolves to ' + resolved +
        ' but the lock records ' + c.commit + ' - the tag was moved or deleted and recreated');
    } else {
      notes.push('component "' + c.id + '": ' + c.repo.split('/').pop().replace(/\.git$/, '') +
        '#' + c.tag + ' -> ' + resolved.slice(0, 12) + ' verified');
    }
  }
}

// --- report -------------------------------------------------------------------
const summary = {
  ok: problems.length === 0,
  mode: offline ? 'offline' : 'online',
  components: components.length,
  installable: components.filter((c) => c.installable === true).length,
  problems,
  notes,
};
if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const n of notes) console.log('  ' + n);
  if (problems.length === 0) {
    console.log('verify-components: OK - ' + components.length + ' component(s) consistent' +
      (offline ? ' (offline cross-check only)' : ', tags resolve to the locked commits'));
  } else {
    console.error('verify-components: FAIL - ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  - ' + p);
  }
}
process.exit(problems.length === 0 ? 0 : 1);
