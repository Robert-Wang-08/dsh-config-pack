#!/usr/bin/env node
// Read-only structural compare: pack cordis.patch.yml vs a profile patch.
// Writes nothing. Prints a JSON summary to stdout.
// Usage: node scripts/compare-profile.mjs [profilePatchPath]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profilePath =
  process.argv[2] ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml');

function extractRows(text, source) {
  const lines = text.split(/\r?\n/);
  const rows = new Map();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^-\s+insert:\s*$/.test(line)) {
      i++;
      while (i < lines.length) {
        if (/^-\s/.test(lines[i]) && !/^\s/.test(lines[i])) break;
        const mid = /^(\s+)-\s+id:\s+(\S+)\s*$/.exec(lines[i]);
        if (mid) {
          const idIndent = mid[1].length;
          const id = mid[2];
          const start = i;
          i++;
          while (i < lines.length) {
            const l = lines[i];
            const next = /^(\s+)-\s+id:\s+\S+\s*$/.exec(l);
            if (next && next[1].length === idIndent) break;
            if (/^-\s/.test(l) && !/^\s/.test(l)) break;
            i++;
          }
          const block = lines.slice(start, i).join('\n');
          rows.set(id, { kind: 'insert', source, block, fields: pickFields(block) });
          continue;
        }
        i++;
      }
      continue;
    }
    const topId = /^-\s+id:\s+(\S+)\s*$/.exec(line);
    if (topId) {
      const id = topId[1];
      const start = i;
      i++;
      while (i < lines.length) {
        if (/^-\s/.test(lines[i]) && !/^\s/.test(lines[i])) break;
        i++;
      }
      const block = lines.slice(start, i).join('\n');
      const prev = rows.get(id);
      const fields = pickFields(block);
      if (prev) {
        rows.set(id, {
          kind: prev.kind + '+patch',
          source,
          block: prev.block + '\n---\n' + block,
          fields: { ...prev.fields, ...fields, _multi: true },
        });
      } else {
        rows.set(id, { kind: 'patch', source, block, fields });
      }
      continue;
    }
    i++;
  }
  return rows;
}

function pickFields(block) {
  const out = {};
  const keys = [
    'name',
    'disabled',
    'permissionMode',
    'provider',
    'model',
    'selectedDefault',
    'default',
    'welcomeNoticeVersion',
    'providerName',
    'command',
    'serverName',
    'transport',
    'url',
    'apiKeyEnv',
    'baseURL',
    'displayName',
    'policyMode',
    'keyResetAt',
  ];
  for (const k of keys) {
    const re = new RegExp('^\\s*' + k + ':\\s*(.+?)\\s*$', 'm');
    const m = re.exec(block);
    if (m) out[k] = m[1].replace(/^['"]|['"]$/g, '');
  }
  const routes = [...block.matchAll(/^\s+route:\s*(.+?)\s*$/gm)].map((m) => m[1]);
  if (routes.length) out._routes = routes;
  const prov = [...block.matchAll(/^\s{6}([a-z0-9-]+):\s*$/gm)].map((m) => m[1]);
  if (prov.length) out._providers = prov;
  out._hasAbsPath = /[A-Za-z]:\\|\\[A-Za-z0-9._-]+\\/.test(block);
  out._hasJs = /!!js/.test(block);
  out._hasEnv =
    /process\[['"]env['"]\]|process\.env|DSHPACK_|TENCENT_DOCS|CRS_OAI|AIS_2DSGLM|CLAUDE_RELAY|LLMKEY_|OPENCODE_API/.test(
      block
    );
  return out;
}

function classifyValue(packVal, profileVal, field) {
  const p = String(packVal ?? '');
  const r = String(profileVal ?? '');
  if (p === r) return 'same';
  if (/!!js/.test(p) && !/!!js/.test(r)) {
    if (r && p.includes(r)) return 'pack-template-covers-profile-literal';
    return 'pack-templated-profile-literal';
  }
  if (/!!js/.test(r) && !/!!js/.test(p)) return 'profile-js-pack-literal';
  if (field === 'command' || field === 'disabled') {
    if (/DSHPACK_|process\[/.test(p)) return 'device-via-env-in-pack';
  }
  if (/[A-Za-z]:\\/.test(r) && !/[A-Za-z]:\\/.test(p)) return 'profile-device-specific';
  if (['provider', 'model', 'selectedDefault', 'welcomeNoticeVersion'].includes(field)) {
    return 'device-or-preference';
  }
  return 'generic-or-structural';
}

const pack = extractRows(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), 'pack');
const profile = extractRows(readFileSync(profilePath, 'utf8'), 'profile');
const same = [...pack.keys()].filter((id) => profile.has(id)).sort();
const packOnly = [...pack.keys()].filter((id) => !profile.has(id)).sort();
const profileOnly = [...profile.keys()].filter((id) => !pack.has(id)).sort();

const comparisons = same.map((id) => {
  const a = pack.get(id);
  const b = profile.get(id);
  const diffs = [];
  const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  for (const k of keys) {
    if (k.startsWith('_')) continue;
    const pv = a.fields[k];
    const rv = b.fields[k];
    if (pv !== rv) {
      diffs.push({
        field: k,
        pack: pv ?? null,
        profile: rv ?? null,
        class: classifyValue(pv, rv, k),
      });
    }
  }
  if (JSON.stringify(a.fields._providers || []) !== JSON.stringify(b.fields._providers || [])) {
    diffs.push({
      field: '_providers',
      pack: a.fields._providers || [],
      profile: b.fields._providers || [],
      class: 'generic-or-structural',
    });
  }
  if (JSON.stringify(a.fields._routes || []) !== JSON.stringify(b.fields._routes || [])) {
    diffs.push({
      field: '_routes',
      pack: a.fields._routes || [],
      profile: b.fields._routes || [],
      class: a.fields._routes?.some((r) => /!!js|DSHPACK_ROUTE/.test(r))
        ? 'pack-templated-profile-literal'
        : 'generic-or-structural',
    });
  }
  let nature = 'identical-scalars';
  if (diffs.length === 0) nature = 'identical-scalars';
  else if (diffs.every((d) => d.class.startsWith('pack-template') || d.class === 'device-via-env-in-pack'))
    nature = 'pack-already-template-safe';
  else if (diffs.some((d) => d.class === 'profile-device-specific')) nature = 'profile-has-device-literals';
  else if (diffs.some((d) => d.class === 'device-or-preference')) nature = 'preference-diff';
  else nature = 'structural-diff';
  return {
    id,
    packKind: a.kind,
    profileKind: b.kind,
    nature,
    diffs,
    hints: {
      pack: { js: !!a.fields._hasJs, env: !!a.fields._hasEnv, abs: !!a.fields._hasAbsPath },
      profile: { js: !!b.fields._hasJs, env: !!b.fields._hasEnv, abs: !!b.fields._hasAbsPath },
    },
  };
});

console.log(
  JSON.stringify(
    {
      profilePath: '<profile>/cordis.patch.yml',
      sameIdCount: same.length,
      packOnly,
      profileOnly,
      natures: comparisons.map((c) => ({
        id: c.id,
        nature: c.nature,
        diffFields: c.diffs.map((d) => `${d.field}:${d.class}`),
      })),
    },
    null,
    2
  )
);
