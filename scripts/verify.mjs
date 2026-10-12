#!/usr/bin/env node
// Read-only checks. Never writes anything, never touches a live profile.
//
//   1. every id in pack.manifest.yaml -> owns appears exactly once in cordis.patch.yml
//   2. every !!js scalar obeys the YAML constraints (no ": ", no leading quote/{/[ /!)
//   3. (optional) the target profile's own cordis.patch.yml declares none of the owned ids
//      -- if it does, that inline block shadows this pack, because the profile patch is
//      the LAST layer and wins by id.
//
// Usage:
//   node scripts/verify.mjs
//   node scripts/verify.mjs --profile web
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const profileArg = args.indexOf('--profile');
const profile = profileArg >= 0 ? args[profileArg + 1] : undefined;

const errors = [];
const warns = [];

const manifest = readFileSync(join(root, 'pack.manifest.yaml'), 'utf8');
const ownsBlock = /^owns:\s*\n((?:[ \t]+-\s*.+\n?)+)/m.exec(manifest);
if (!ownsBlock) {
  console.error('verify: pack.manifest.yaml has no "owns:" list');
  process.exit(1);
}
const owns = ownsBlock[1]
  .split('\n')
  .map((l) => l.replace(/^[ \t]*-\s*/, '').trim())
  .filter(Boolean);

const patchPath = join(root, 'cordis.patch.yml');
if (!existsSync(patchPath)) {
  console.error('verify: cordis.patch.yml missing — run "npm run build" first');
  process.exit(1);
}
const patch = readFileSync(patchPath, 'utf8');
const patchLines = patch.split('\n');

// 1. ownership coverage
for (const id of owns) {
  const re = new RegExp('^\\s*- id:\\s*' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');
  const hits = patchLines.filter((l) => re.test(l)).length;
  if (hits === 1) continue;
  if (hits === 0) errors.push(`owns lists "${id}" but cordis.patch.yml never declares it`);
  else errors.push(`cordis.patch.yml declares "${id}" ${hits} times (expected 1)`);
}

// 2. !!js scalar constraints
patchLines.forEach((line, i) => {
  const m = /!!js\s+(.*)$/.exec(line);
  if (!m) return;
  const expr = m[1].trim();
  if (/:\s/.test(expr)) errors.push(`line ${i + 1}: !!js expression contains ": " — YAML ends the plain scalar there. Most common cause is a ternary; rewrite (cond && 'a') || 'b'.`);
  if (/^["'{[]/.test(expr)) errors.push(`line ${i + 1}: !!js expression starts with a quote/{/[ — YAML will mis-parse it`);
  if (expr.startsWith('!')) errors.push(`line ${i + 1}: !!js expression starts with "!" — YAML will read it as another tag`);
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
    owns.forEach((id, idx) => {
      const re = new RegExp('^\\s*- id:\\s*' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');
      targetLines.forEach((l, i) => {
        if (re.test(l)) shadows.push(`  ${id}  (profile line ${i + 1})`);
      });
    });
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

for (const w of warns) console.warn('warn: ' + w);
if (errors.length > 0) {
  for (const e of errors) console.error('FAIL: ' + e);
  console.error(`verify: ${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`verify: OK — ${owns.length} owned id(s) declared exactly once, !!js scalars well-formed` + (profile ? `, no shadow in profile "${profile}"` : ''));
