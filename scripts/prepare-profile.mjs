#!/usr/bin/env node
// Prepare a DSH profile's pnpm settings so a single "dsh plugin add" of this pack can succeed.
//
// Why this exists: the pack carries git-hosted plugin dependencies. pnpm blocks those by default
// (blockExoticSubdeps) and refuses to run their build scripts until each is explicitly allowed
// (allowBuilds). Without these keys the install aborts with ERR_PNPM_EXOTIC_SUBDEP or
// ERR_PNPM_IGNORED_BUILDS - and a retry after such a failure no longer registers the bundle,
// because the dependency is by then already present.
//
// This script only edits pnpm config. It never touches cordis.patch.yml or package.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// First-party git-hosted components build their lib/ output at install time (tsc/tsdown).
// Without allowBuilds the build is skipped and the package's main entry (lib/index.js)
// never appears - the plugin cannot activate.
const REQUIRED_BUILDS = [
  '@deepseek-ai/dsh-subprocess-local',
  '@google/genai',
  'koffi',
  'node-pty',
  'protobufjs',
  'dsh-archived-sessions',
  'dsh-plugin-sidebar-visibility',
  'dsh-plugin-subagent-monitor',
  'dsh-plugin-provider-badge',
  'dsh-deepseek-keypool',
  '@local/dsh-subagent-acp-resilient',
];

const argv = process.argv.slice(2);
const profileDir = argv[0];
const extraIdx = argv.indexOf('--extra-builds');
if (extraIdx >= 0 && argv[extraIdx + 1]) {
  for (const raw of argv[extraIdx + 1].split(',')) {
    const name = raw.trim().replace(/\s+/g, '').replace(/@[^@/]+$/, '');
    if (name && !REQUIRED_BUILDS.includes(name)) REQUIRED_BUILDS.push(name);
  }
}

if (!profileDir) {
  console.error('usage: node prepare-profile.mjs <profile-directory> [--extra-builds a@1,b@2]');
  process.exit(2);
}
if (!existsSync(profileDir)) {
  console.error('profile directory does not exist: ' + profileDir);
  process.exit(2);
}

// --- seed fence keys from the components lock --------------------------------
// pnpm fences git-hosted deps by their exact tarball id (name@https://codeload.../tar.gz/<commit>).
// The lock (pack.manifest.yaml) records repo + resolved commit per component, so all
// fence keys can be pre-seeded offline - a fresh profile then needs no discovery rounds.
try {
  const manifest = readFileSync(join(root, 'pack.manifest.yaml'), 'utf8');
  const comps = [];
  let cur = null;
  let inBlock = false;
  for (const line of manifest.split(/\r?\n/)) {
    if (/^components:\s*$/.test(line)) { inBlock = true; continue; }
    if (inBlock && /^\S/.test(line)) break;
    if (!inBlock) continue;
    const rec = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
    if (rec) { cur = { id: rec[1] }; comps.push(cur); continue; }
    const kv = line.match(/^\s+([A-Za-z_]+):\s*(.+?)\s*$/);
    if (kv && cur) cur[kv[1]] = kv[2].replace(/^[\'\"]|[\'\"]$/g, '');
  }
  for (const c of comps) {
    if (c.installable !== 'true' || !c.package || !c.repo || !c.commit) continue;
    const m = String(c.repo).match(/^https:\/\/github\.com\/(.+)\.git$/);
    if (!m) continue;
    const tarballBase = 'https://codeload.github.com/' + m[1] + '/tar.gz/' + c.commit;
    REQUIRED_BUILDS.push(c.package);
    REQUIRED_BUILDS.push(c.package + '@' + tarballBase);
    // The fence id uses the component's INNER package name (e.g. @local/dsh-plugin-sidebar-visibility),
    // which differs from the declared dependency name. In an umbrella checkout the component's
    // own checkout sits as a sibling directory with the repo basename - read its real name.
    try {
      const base = String(m[1]).split('/').pop();
      const innerPath = join(root, '..', base, 'package.json');
      if (existsSync(innerPath)) {
        const inner = JSON.parse(readFileSync(innerPath, 'utf8'));
        if (inner.name && inner.name !== c.package) {
          REQUIRED_BUILDS.push(inner.name);
          REQUIRED_BUILDS.push(inner.name + '@' + tarballBase);
        }
      }
    } catch {}
  }
} catch (e) {
  console.error('prepare-profile: could not seed lock fence keys (' + e.message + ') - relying on self-heal');
}

const file = join(profileDir, 'pnpm-workspace.yaml');
const DEFAULT_TEXT = 'packages:' + '\n' + '  - .' + '\n';
const original = existsSync(file) ? readFileSync(file, 'utf8') : DEFAULT_TEXT;
const notes = [];

// --- allowBuilds: a YAML map of package name -> boolean -----------------------
const existingBuilds = new Map();
const blockRe = /^allowBuilds:[ \t]*\r?\n((?:[ \t]+.*\r?\n?)*)/m;
const block = original.match(blockRe);
if (block) {
  for (const line of block[1].split(/\r?\n/)) {
    const m = line.match(/^[ \t]+'?([^':]+)'?:[ \t]*(true|false)\s*$/);
    if (m) existingBuilds.set(m[1], m[2] === 'true');
  }
}
let changed = false;
for (const name of REQUIRED_BUILDS) {
  if (!existingBuilds.has(name)) {
    existingBuilds.set(name, true);
    changed = true;
  }
}
const allowBuildsBlock = 'allowBuilds:' + '\n' +
  [...existingBuilds.entries()].map(([n, v]) => '  \'' + n + '\': ' + v).join('\n') + '\n';

let out = original;
if (block) {
  if (changed) {
    out = out.replace(blockRe, allowBuildsBlock).replace(/\n{3,}/g, '\n\n');
    notes.push('added missing allowBuilds entries');
  }
} else {
  out = out.replace(/\s*$/, '\n') + allowBuildsBlock;
  notes.push('added allowBuilds (' + [...existingBuilds.keys()].join(', ') + ')');
}

// --- patchedDependencies: static patches shipped with this pack ----------------
// Some upstream packages need a local correction (for example carrying the
// upstream failure reason into the subagent diagnostic). pnpm applies
// patchedDependencies on every install, so the correction survives reinstalls
// and new devices instead of being re-applied by hand.
const patchesSrc = join(root, 'packages', 'dsh-ptc-multi-agent-mode', 'assets', 'patches');
if (existsSync(patchesSrc)) {
  const patchesDest = join(profileDir, 'patches');
  mkdirSync(patchesDest, { recursive: true });
  const wanted = new Map();
  for (const name of readdirSync(patchesSrc)) {
    if (!name.endsWith('.patch')) continue;
    copyFileSync(join(patchesSrc, name), join(patchesDest, name));
    // pnpm names patches "<scope>__<name>@<version>.patch".
    const m = name.match(/^(.+?)__(.+?)@([^@]+)\.patch$/);
    if (m) wanted.set(m[1] + '/' + m[2] + '@' + m[3], 'patches/' + name);
  }
  if (wanted.size > 0) {
    const patchedRe = /^patchedDependencies:[ \t]*\r?\n((?:[ \t]+.*\r?\n?)*)/m;
    const existing = new Map();
    const blockMatch = out.match(patchedRe);
    if (blockMatch) {
      for (const line of blockMatch[1].split(/\r?\n/)) {
        const kv = line.match(/^[ \t]+'?([^':]+)'?:[ \t]*(.+?)\s*$/);
        if (kv) existing.set(kv[1], kv[2]);
      }
    }
    let patchedChanged = false;
    for (const [key, value] of wanted) {
      if (existing.get(key) !== value) {
        existing.set(key, value);
        patchedChanged = true;
      }
    }
    if (patchedChanged) {
      const patchedBlock = 'patchedDependencies:' + '\n' +
        [...existing.entries()].map(([k, v]) => "  '" + k + "': " + v).join('\n') + '\n';
      out = blockMatch
        ? out.replace(patchedRe, patchedBlock).replace(/\n{3,}/g, '\n\n')
        : out.replace(/\s*$/, '\n') + patchedBlock;
      notes.push('patchedDependencies -> ' + [...wanted.keys()].join(', '));
    }
  }
}

// --- scalars ------------------------------------------------------------------
if (!/^blockExoticSubdeps:/m.test(out)) {
  out = out.replace(/\s*$/, '\n') + 'blockExoticSubdeps: false' + '\n';
  notes.push('set blockExoticSubdeps: false');
}
if (!/^nodeLinker:/m.test(out)) {
  out = out.replace(/\s*$/, '\n') + 'nodeLinker: hoisted' + '\n';
  notes.push('set nodeLinker: hoisted');
}

if (out !== original) {
  writeFileSync(file, out, 'utf8');
  console.log('prepare-profile: updated ' + file);
  for (const n of notes) console.log('  - ' + n);
} else {
  console.log('prepare-profile: ' + file + ' already prepared');
}
console.log('prepare-profile: effective settings');
for (const line of out.split(/\r?\n/)) {
  if (/^(nodeLinker|autoInstallPeers|blockExoticSubdeps|allowBuilds):/.test(line) || /^ {2}'/.test(line)) {
    console.log('  ' + line);
  }
}
