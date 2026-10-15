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

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_BUILDS = [
  '@deepseek-ai/dsh-subprocess-local',
  '@google/genai',
  'koffi',
  'node-pty',
  'protobufjs',
];

const argv = process.argv.slice(2);
const profileDir = argv[0];
const extraIdx = argv.indexOf('--extra-builds');
if (extraIdx >= 0 && argv[extraIdx + 1]) {
  for (const raw of argv[extraIdx + 1].split(',')) {
    const name = raw.trim().replace(/@[^@/]+$/, '');
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
