#!/usr/bin/env node
// Device provider inputs are data, never executable YAML. Does not read credential values.
import { readFileSync, existsSync, writeFileSync, copyFileSync, renameSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, isSeq, visit } from 'yaml';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routes = { CODEX_RELAY: 'codex-relay', AIS: 'ais-2dsglm', ANTHROPIC_RELAY: 'anthropic-relay', KIMI: 'kimi-coding', OPENCODE: 'opencode-go' };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const SECRET_SHAPE = /^sk[_-]|^ghp_|^gho_|^AKIA|^xox[bap]_|^eyJ|BEGIN [A-Z ]*PRIVATE KEY/i;
function merge(a, b) {
  if (!object(a) || !object(b)) return structuredClone(b);
  const result = structuredClone(a);
  for (const [k, v] of Object.entries(b)) {
    if (['__proto__', 'prototype', 'constructor'].includes(k)) throw Error('Unsafe configuration key');
    result[k] = k in result ? merge(result[k], v) : structuredClone(v);
  }
  return result;
}
// Replay only GUI/user edits since the last generated output onto the user layer.
function rebase(base, previous, actual) {
  if (isDeepStrictEqual(previous, actual)) return structuredClone(base);
  if (!object(previous) || !object(actual)) return structuredClone(actual);
  const out = object(base) ? structuredClone(base) : {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(actual)])) {
    if (!Object.hasOwn(actual, key)) delete out[key];
    else if (!isDeepStrictEqual(previous[key], actual[key])) out[key] = rebase(out[key], previous[key], actual[key]);
  }
  return out;
}
function document(text, source) {
  const d = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: s => s }], uniqueKeys: true });
  if (d.errors.length) throw Error('Invalid YAML: ' + source);
  return d;
}
function data(node) {
  if (!node) return undefined;
  const copy = node.clone();
  visit(copy, { Scalar(_key, n) { if (n.tag === 'tag:yaml.org,2002:js') throw Error('Provider configuration must contain literals; migrate known legacy expressions first'); } });
  return copy.toJSON();
}
function rows(d) { if (!isSeq(d.contents)) throw Error('Profile patch must be a YAML sequence'); return d.contents.items; }
function providerRow(d) {
  const found = rows(d).filter(n => n?.get?.('id') === 'llm-pi-ai');
  if (found.length > 1) throw Error('Duplicate llm-pi-ai profile rows; consolidate before migration');
  if (found[0]?.has('name') && found[0].get('name') !== '@deepseek-ai/dsh-llm-pi-ai') throw Error('llm-pi-ai row names an unexpected plugin');
  if (found[0]?.has('disabled') || found[0]?.has('insert')) throw Error('Unsupported llm-pi-ai entry options');
  return found[0];
}
export function readDeviceEnv(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 1) throw Error('Invalid device.env line');
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return map;
}
function legacyInputs(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    const match = /^DSHPACK_(BASE|KEY)_(.+)$/.exec(key);
    if (!match || !value || /^<.*>$/.test(value)) continue;
    const route = routes[match[2]];
    if (!route) throw Error('Unknown legacy provider variable: ' + key + '; use device-answers.json providers');
    (out[route] ??= {})[match[1] === 'BASE' ? 'baseURL' : 'apiKeyEnv'] = value;
  }
  return { providers: out };
}
function resolveLegacy(row, env) {
  const cfg = row?.get('config', true)?.clone(); if (!cfg) return {};
  visit(cfg, { Scalar(_key, n) {
    if (n.tag !== 'tag:yaml.org,2002:js') return;
    const m = /^process\['env'\]\.(DSHPACK_(?:BASE|KEY)_[A-Z_]+)\s*\|\|\s*'([^']*)'$/.exec(n.value);
    if (!m) throw Error('Unsupported provider expression; replace it with a literal before migration');
    n.value = env[m[1]] && !/^<.*>$/.test(env[m[1]]) ? env[m[1]] : m[2]; delete n.tag;
  } });
  return data(cfg);
}
function validate(config) {
  if (!object(config) || !object(config.providers)) throw Error('Expected providers mapping');
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    for (const [k, c] of Object.entries(v)) {
      if (['__proto__','prototype','constructor','__jsExpr'].includes(k) || /^(apiKey|token|password|secret|authorization)$/i.test(k)) throw Error('Forbidden provider field: ' + k);
      walk(c);
    }
  }
  walk(config);
  for (const [id, p] of Object.entries(config.providers)) {
    if (!/^[a-z0-9][a-z0-9_.-]*$/.test(id) || !object(p)) throw Error('Invalid provider declaration');
    if (p.apiKeyEnv !== undefined) {
      if (typeof p.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.apiKeyEnv)) throw Error('apiKeyEnv must be an environment variable NAME: ' + id);
      // Same secret shapes setup.ps1 refuses: a real key here would be persisted into the profile patch.
      if (SECRET_SHAPE.test(p.apiKeyEnv)) throw Error('apiKeyEnv looks like a secret value, not a variable name: ' + id);
    }
    if (p.baseURL !== undefined) {
      if (typeof p.baseURL !== 'string') throw Error('baseURL must be literal: ' + id);
      const u = new URL(p.baseURL);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('baseURL must be an HTTP endpoint without embedded credentials/query: ' + id);
    }
    if (p.models !== undefined && (!Array.isArray(p.models) || p.models.some(m => !object(m) || typeof m.id !== 'string'))) throw Error('Invalid models: ' + id);
  }
}
function atomic(path, text) {
  const tmp = path + '.provider-tmp-' + process.pid;
  try { writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' }); renameSync(tmp, path); }
  finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
function migrateUnlocked({ profileDir, deviceDir, inputDir, env = {}, dryRun = false, check = false, packRoot = ROOT }) {
  const patchPath = join(profileDir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) throw Error('Profile patch does not exist: ' + patchPath);
  const before = readFileSync(patchPath, 'utf8'), doc = document(before, patchPath);
  const statePath = join(profileDir, '.provider-migration.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  if (state && state.schema !== 1) throw Error('Unsupported provider migration state');
  inputDir ??= state?.inputDir ?? deviceDir;
  if (resolve(inputDir) !== resolve(deviceDir) && !existsSync(inputDir)) throw Error('Provider input directory is unavailable; restore shared drive or explicitly select a local input directory');
  const envPath = join(inputDir, 'device.env');
  const map = { ...env, ...(existsSync(envPath) ? readDeviceEnv(readFileSync(envPath, 'utf8')) : {}) };
  const pack = document(readFileSync(join(packRoot, 'config', '40-models.yml'), 'utf8'), 'pack');
  const base = data(providerRow(pack).get('config', true)); validate(base);
  const row = providerRow(doc), existing = resolveLegacy(row, map);
  const user = state ? rebase(state.user, state.output, existing) : existing;
  let output = merge(merge(base, user), legacyInputs(map));
  const answersPath = join(inputDir, 'device-answers.json');
  if (existsSync(answersPath)) {
    const answers = JSON.parse(readFileSync(answersPath, 'utf8'));
    if (!object(answers)) throw Error('device-answers.json must be an object');
    if (answers.providers !== undefined && !Array.isArray(answers.providers)) throw Error('providers must be an array');
    const providers = {}; const seen = new Set();
    for (const p of answers.providers ?? []) {
      if (!object(p)) throw Error('Invalid provider in device answers');
      const { id, ...fields } = p;
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_.-]*$/.test(id) || ['__proto__','constructor','prototype'].includes(id) || seen.has(id)) throw Error('Invalid/duplicate provider id in device answers');
      seen.add(id);
      providers[id] = { ...fields, ...(fields.models ? { models: fields.models.map(m => typeof m === 'string' ? { id: m } : m) } : {}) };
    }
    output = merge(output, { providers });
  }
  const localPath = join(inputDir, 'cordis.local.yml');
  if (existsSync(localPath)) {
    const local = document(readFileSync(localPath, 'utf8'), localPath);
    if (rows(local).some(n => n?.get?.('id') !== 'llm-pi-ai')) throw Error('cordis.local.yml accepts only llm-pi-ai provider overrides');
    const localRow = providerRow(local);
    const cfg = data(localRow?.get('config', true)) ?? {};
    if (Object.keys(cfg).some(k => k !== 'providers')) throw Error('cordis.local.yml accepts only config.providers');
    output = merge(output, cfg);
  }
  validate(output);
  for (const [id, profile] of Object.entries(output.providers)) {
    if (!Object.hasOwn(base.providers, id) && !(profile.api && profile.baseURL && profile.models?.length)) throw Error('New custom provider requires api, baseURL and models: ' + id);
  }
  if (Object.keys(user).length) validate(merge(base, user));
  const changed = !isDeepStrictEqual(existing, output) || Boolean(row && row.get('config', true)?.toString().includes('!!js'));
  if (check && changed && (row || !isDeepStrictEqual(output, base))) throw Error('Provider migration required; run migrate-providers.ps1 for this profile');
  if (dryRun || check) return { changed, dryRun, providers: Object.keys(output.providers) };
  // No profile row needed when the entire result is inherited unchanged.
  const shouldWrite = changed && (row || !isDeepStrictEqual(output, base));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (shouldWrite) {
    if (row) row.set('config', doc.createNode(output));
    else doc.contents.add(doc.createNode({ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: output }));
    copyFileSync(patchPath, patchPath + '.bak-before-provider-migration-' + stamp);
    atomic(patchPath, String(doc));
  }
  const nextState = { schema: 1, inputDir: resolve(inputDir), user, output: row || shouldWrite ? output : {} };
  if (!isDeepStrictEqual(state, nextState)) {
    if (existsSync(statePath)) copyFileSync(statePath, statePath + '.bak-before-provider-migration-' + stamp);
    try { atomic(statePath, JSON.stringify(nextState, null, 2) + '\n'); }
    catch (e) { if (shouldWrite) atomic(patchPath, before); throw e; }
  }
  return { changed: Boolean(shouldWrite), providers: Object.keys(output.providers) };
}
export function migrate(options) {
  if (options.check || options.dryRun) return migrateUnlocked(options);
  const lock = join(options.profileDir, '.provider-migration.lock');
  let fd;
  try {
    fd = openSync(lock, 'wx', 0o600);
    return migrateUnlocked(options);
  } finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const val = f => args[args.indexOf(f) + 1];
  try {
    if (!args.includes('--profile-dir') || !args.includes('--device-dir')) throw Error('Required: --profile-dir PATH --device-dir PATH');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^DSHPACK_(BASE|KEY)_/.test(k)));
    console.log(JSON.stringify(migrate({ profileDir: val('--profile-dir'), deviceDir: val('--device-dir'), inputDir: args.includes('--input-dir') ? val('--input-dir') : undefined, env, dryRun: args.includes('--dry-run'), check: args.includes('--check') })));
  } catch (e) { console.error('provider migration: ' + e.message); process.exitCode = 1; }
}
