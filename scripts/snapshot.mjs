#!/usr/bin/env node
// DSH snapshot v1: inventory / backup / verify / restore.
// Contract: docs/storage-boundaries-v3.md (v3.1) | Schema: schemas/snapshot-manifest.v1.json
// Safety: only DSHPACK_-prefixed environment variables are ever read. Secret values are never collected.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_ID = 'dsh-snapshot/v1';
const TOOL = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const PROFILE_FILES = ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'compatibility.json'];
const DEVICE_FILES = ['device.env', 'device-answers.json', 'route-config.json', 'cordis.local.yml', 'ptc.local.patch.yml', 'ptc-settings.json'];
const DEVICE_BOUND = new Set(['device/device.env', 'device/route-config.json', 'device/cordis.local.yml', 'device/ptc.local.patch.yml']);
const SECRET_NAMES = new Set(['.credentials.yaml']);

let sqliteMod = null;
try { sqliteMod = await import('node:sqlite'); } catch { sqliteMod = null; }
const sha256File = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const has = n => process.argv.includes(n);
const fail = m => { console.error('snapshot: ' + m); process.exit(2); };

// ---- environment ----------------------------------------------------------
function collectEnv() {
  const collected = [], keyPointers = [];
  for (const name of Object.keys(process.env).sort()) {
    if (!name.startsWith('DSHPACK_')) continue;
    const value = process.env[name];
    if (typeof value !== 'string') continue;
    if (name.startsWith('DSHPACK_KEY_')) {
      const pointer = value.trim();
      if (!pointer) { keyPointers.push({ name, pointer: '', present: false }); continue; }
      const present = typeof process.env[pointer] === 'string' && process.env[pointer].length > 0;
      keyPointers.push({ name, pointer, present });
    } else collected.push({ name, value });
  }
  return { policy: 'only-DSHPACK-prefixed-read; secrets-never-collected', collected, keyPointers };
}

// ---- plugins --------------------------------------------------------------
// link: 依赖原来一律算未钉定，因为它的 spec 只是本机路径。但开发态的 link 目标几乎都是
// 一个可共享的 git 检出：把它的 origin URL 与实际 HEAD 记录下来，目标设备就能 clone + checkout 重建，
// 这才叫可重建而不是不可迁移。没有 remote 的纯本地目录仍然算未钉定。
function gitPinFor(dir) {
  try {
    const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (head.status !== 0) return null;
    const url = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (url.status !== 0) return null;
    const sha = head.stdout.trim();
    const m = url.stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!m || !/^[0-9a-f]{40}$/.test(sha)) return null;
    return 'git+https://github.com/' + m[1] + '#' + sha;
  } catch { return null; }
}
// 范围版本（^ / ~ / latest）本身不能重建出确定内容；读安装后的精确版本，按版本号钉定。
function installedVersion(profileDir, name) {
  const pkg = readJson(join(profileDir, 'node_modules', name, 'package.json'));
  const version = pkg && typeof pkg.version === 'string' ? pkg.version.trim() : '';
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : null;
}
function collectPlugins(profileDir) {
  const pkg = readJson(join(profileDir, 'package.json')) || {};
  const bundles = new Set(((pkg.dsh || {}).profile || {}).bundles || []);
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const out = [];
  for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
    const s = String(spec);
    const shaRef = /#([0-9a-f]{40})$/.exec(s) || /(?:tar\.gz|tarball|commit)\/([0-9a-f]{40})/.exec(s);
    const idHint = name.replace(/^@[^/]+\//, '');
    let digest = shaRef ? shaRef[1] : null;
    let pin = null;
    if (!digest && s.startsWith('link:')) {
      const target = s.slice(5).trim();
      pin = gitPinFor(target) || (existsSync(resolve(dirname(profileDir), '..', target)) ? gitPinFor(resolve(dirname(profileDir), '..', target)) : null);
      if (pin) digest = pin.split('#')[1];
    }
    if (!digest && !s.startsWith('link:') && !s.startsWith('file:')) {
      const version = installedVersion(profileDir, name);
      if (version) { digest = version; pin = 'npm:' + version; }
    }
    out.push({ name, spec: s, digest, pin, registered: bundles.has(name), mounted: patch.includes(name) || patch.includes(idHint), active: false });
  }
  return out;
}
function pinningOf(plugins, collectedArtifacts) {
  const artifacts = collectedArtifacts || new Set();
  const unpinned = [];
  for (const p of plugins) {
    if (p.pin) continue;   // link 到 git 检出、或读到安装精确版本的，都可重建
    if (p.spec.startsWith('link:')) { unpinned.push(p.name + ' (link: local path, no git remote)'); continue; }
    if (p.spec.startsWith('file:')) {
      if (artifacts.has(p.name)) continue;   // artifact carried inside the snapshot: reconstructible
      unpinned.push(p.name + ' (local artifact; not included in snapshot)');
      continue;
    }
    if (p.digest) continue;
    if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(p.spec)) continue;
    unpinned.push(p.name + ' (' + p.spec + ')');
  }
  return unpinned;
}

// ---- providers (structured, line-based; no YAML dependency) --------------
function templateOf(raw) {
  const s = String(raw).trim();
  const js = /^!!js\s+(.*)$/.exec(s);
  if (!js) return { template: s, default: s };
  const expr = js[1];
  const d = /\|\|\s*'([^']*)'\s*$/.exec(expr);
  return { template: expr, default: d ? d[1] : null };
}
function inlineValue(raw) {
  const s = String(raw).trim();
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
  if (/^\{.*\}$/.test(s)) {
    const o = {};
    for (const part of s.slice(1, -1).split(',')) {
      const m = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(part);
      if (m) o[m[1]] = m[2] === 'null' ? null : m[2];
    }
    return o;
  }
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}
function providersFrom(text, source) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === 'providers:');
  if (start < 0) return [];
  const out = [];
  let cur = null, model = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    if (/^ {0,5}\S/.test(line)) break;
    let m = /^ {6}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (m) { cur = { id: m[1], source, models: [] }; out.push(cur); model = null; continue; }
    m = /^ {8}([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (m && cur) {
      const key = m[1], raw = m[2];
      if (key === 'baseURL' || key === 'apiKeyEnv') cur[key] = templateOf(raw);
      else if (key === 'api' || key === 'displayName') cur[key] = String(raw).trim();
      model = null;
      continue;
    }
    m = /^ {10}- id:\s*([^\s#]+)\s*$/.exec(line);
    if (m && cur) { model = { id: m[1] }; cur.models.push(model); continue; }
    m = /^ {12}([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (m && model) { model[m[1]] = inlineValue(m[2]); continue; }
  }
  return out;
}
function collectProviders(profileDir) {
  const p = join(profileDir, 'cordis.patch.yml');
  if (existsSync(p)) { const f = providersFrom(readFileSync(p, 'utf8'), 'profile'); if (f.length) return f; }
  const pack = join(ROOT, 'config', '40-models.yml');
  if (existsSync(pack)) return providersFrom(readFileSync(pack, 'utf8'), 'pack');
  return [];
}

// ---- files ----------------------------------------------------------------
function collectFiles(dshHome, profileDir) {
  const out = [];
  const add = (src, rel, cls) => {
    if (!existsSync(src) || !statSync(src).isFile()) return;
    if (SECRET_NAMES.has(rel.split('/').pop())) return;
    out.push({ path: rel, src, sha256: sha256File(src), bytes: statSync(src).size, class: cls || (DEVICE_BOUND.has(rel) ? 'device_bound' : 'portable'), last_persisted_at: new Date(statSync(src).mtimeMs).toISOString() });
  };
  for (const n of PROFILE_FILES) add(join(profileDir, n), 'profile/' + n);
  for (const n of DEVICE_FILES) add(join(dshHome, 'device', n), 'device/' + n);
  const patches = join(profileDir, 'patches');
  if (existsSync(patches)) for (const f of readdirSync(patches)) if (f.endsWith('.patch')) add(join(patches, f), 'profile/patches/' + f);
  const presets = join(dshHome, '.agent-presets');
  if (existsSync(presets)) for (const d of readdirSync(presets)) {
    const dir = join(presets, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (/\.(yml|yaml|json|md)$/.test(f)) add(join(dir, f), '.agent-presets/' + d + '/' + f);
  }
  return out;
}

// ---- plugin settings (adapter driven) -------------------------------------
function extractCordisRow(profileDir, rowId) {
  for (const file of ['cordis.patch.yml', 'cordis.yml']) {
    const p = join(profileDir, file);
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    const start = lines.findIndex(l => new RegExp('^-\\s+id:\\s*' + rowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$').test(l.trim()));
    if (start < 0) continue;
    const indent = lines[start].match(/^\s*/)[0].length;
    const out = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') { out.push(l); continue; }
      const ind = l.match(/^\s*/)[0].length;
      if (ind <= indent && /^-\s/.test(l.trim())) break;
      if (ind <= indent && l.trim() !== '') break;
      out.push(l);
    }
    return out.join('\n');
  }
  return null;
}
function loadAdapters() {
  const p = join(ROOT, 'assets', 'plugin-settings-adapters.json');
  const j = existsSync(p) ? readJson(p) : null;
  return j && j.schema === 'dsh-plugin-settings-adapters/v1' ? j : { generic: { settingsFiles: [], class: 'portable' }, adapters: [] };
}
function pluginDirName(name) { return name.replace(/^@[^/]+\//, ''); }
function collectPluginSettings(dshHome, profileDir, plugins, adapters, opts) {
  const out = [];
  for (const p of plugins) {
    const short = pluginDirName(p.name);
    const adapter = (adapters.adapters || []).find(a => a.match === p.name || a.match === short);
    const items = [];
    if (adapter) {
      const missing = [];
      for (const s of adapter.sources || []) {
        if (s.kind === 'cordis-config') {
          const row = s.pluginRow || s.path;
          const block = extractCordisRow(profileDir, row);
          if (!block) { items.push({ path: 'plugin-config/' + row + '.yaml', class: s.class, reason: 'plugin row not found in profile layer', sourceKind: 'cordis-config' }); continue; }
          items.push({ path: 'plugin-config/' + row + '.yaml', class: s.class, inlineText: block, sourceKind: 'cordis-config', restore: 'reference', restoredVia: 'profile/cordis.patch.yml' });
          continue;
        }
        const src = join(dshHome, s.path);
        if (!existsSync(src)) {
          if (s.optional) continue;                       // expected-if-present; absence is not a gap
          missing.push(s.path);
          items.push({ path: s.path, class: s.class, reason: 'required source missing', sourceKind: s.kind || 'file' });
          continue;
        }
        if (s.kind === 'export-json') {
          const doc = readJson(src);
          if (!doc || doc.schema !== 'dsh-browser-export/v1') { items.push({ path: s.path, class: s.class, reason: 'export artifact failed dsh-browser-export/v1 validation', sourceKind: 'export-json' }); continue; }
          const leaked = Object.keys(doc.values || {}).filter(k => /token|secret|password|cookie|key/i.test(k));
          if (leaked.length) { items.push({ path: s.path, class: 'secret', reason: 'export artifact contains secret-looking keys: ' + leaked.join(','), sourceKind: 'export-json' }); continue; }
          items.push({ path: s.path, class: s.class, src, sha256: sha256File(src), bytes: statSync(src).size, sourceKind: 'export-json', restore: 'copy' });
          continue;
        }
        if (s.kind === 'sqlite') {
          if (!sqliteMod) { items.push({ path: s.path, class: s.class, reason: 'sqlite source requires node:sqlite' }); continue; }
          items.push({ path: s.path, class: s.class, sqliteSrc: src, bytes: statSync(src).size });
          continue;
        }
        items.push({ path: s.path, class: s.class, src, sha256: sha256File(src), bytes: statSync(src).size });
      }
      const gaps = items.filter(i => i.reason);
      if (missing.length || gaps.length) out.push({ plugin: p.name, adapter: adapter.plugin || short, status: 'partial', reason: gaps.map(i => i.path + ': ' + i.reason).join('; '), items });
      else if (!items.length) out.push({ plugin: p.name, adapter: adapter.plugin || short, status: 'not_applicable', reason: 'adapter found but no settings present on this device', items: [] });
      else out.push({ plugin: p.name, adapter: adapter.plugin || short, status: 'exported', items });
      continue;
    }
    // generic fallback: known settings filenames under the plugin's data dir
    const dirs = [join(dshHome, 'plugins', short)];
    if (adapter === undefined && short !== p.name) dirs.push(join(dshHome, 'plugins', pluginDirName(p.name)));
    let found = false;
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const f of adapters.generic.settingsFiles || []) {
        const src = join(dir, f);
        if (!existsSync(src)) continue;
        found = true;
        const rel = 'plugins/' + dir.split(/[\\/]/).pop() + '/' + f;
        items.push({ path: rel, class: adapters.generic.class || 'portable', sha256: sha256File(src), bytes: statSync(src).size });
      }
    }
    if (!found) {
      // cordis-config 通用回退：没有 adapter、也没有已知 settings 文件的插件，只要在 profile 补丁层
      // 有自己的配置行，就把那一行导出并按 reference 还原。否则这些插件只能记 unsupported，
      // 而它们的可迁移配置其实一直在 cordis.patch.yml 里（2026-11-03 复核发现 20/26 被误判 unsupported）。
      for (const row of [short, short.replace(/^dsh-plugin-/, ''), short.replace(/^dsh-/, ''), p.name]) {
        if (!row) continue;
        const block = extractCordisRow(profileDir, row);
        if (!block) continue;
        found = true;
        items.push({ path: 'plugin-config/' + row + '.yaml', class: 'portable', inlineText: block, sourceKind: 'cordis-config', restore: 'reference', restoredVia: 'profile/cordis.patch.yml' });
        break;
      }
    }
    if (found) out.push({ plugin: p.name, adapter: null, status: 'exported', items });
    else if (opts.assumeNoSettings) out.push({ plugin: p.name, adapter: null, status: 'not_applicable', reason: 'no adapter and no settings file found; assumed no settings', items: [] });
    else out.push({ plugin: p.name, adapter: null, status: 'unsupported', reason: 'no adapter and no settings file found; settings location unknown', items: [] });
  }
  return out;
}
function gateSettingsCoverage(settings) {
  const bad = settings.filter(s => s.status === 'unsupported' || s.status === 'partial');
  return bad.length
    ? { status: 'fail', detail: bad.length + ' plugin(s) not fully exported: ' + bad.map(s => s.plugin + '(' + s.status + ')').join(', ') }
    : { status: 'pass', detail: 'all ' + settings.length + ' plugin(s) exported or not applicable' };
}

// ---- gates ----------------------------------------------------------------
function gateReadback(outDir, files) {
  const bad = [];
  for (const f of files) {
    const dest = join(outDir, 'files', f.path);
    if (!existsSync(dest)) { bad.push(f.path + ' (missing)'); continue; }
    if (sha256File(dest) !== f.sha256) { bad.push(f.path + ' (hash mismatch)'); continue; }
    if (/\.json$/.test(f.path)) { try { JSON.parse(readFileSync(dest, 'utf8')); } catch { bad.push(f.path + ' (invalid JSON)'); } }
  }
  return bad.length ? { status: 'fail', detail: 'source readback mismatch: ' + bad.join('; ') } : { status: 'pass', detail: 'all ' + files.length + ' file(s) matched source' };
}
function gateDigest(plugins, collectedArtifacts) {
  const unpinned = pinningOf(plugins, collectedArtifacts);
  return unpinned.length ? { status: 'fail', detail: 'dependencies not pinned to commit SHA or exact version', unpinned } : { status: 'pass', detail: 'all ' + plugins.length + ' dependenc(ies) pinned', unpinned: [] };
}
function gateRehearsal(outDir, cmd, cwd) {
  if (!cmd) return { status: 'skipped', detail: 'no rebuild rehearsal requested; complete status withheld' };
  const r = spawnSync(cmd, { shell: true, cwd: cwd || outDir, encoding: 'utf8' });
  if (r.status !== 0) return { status: 'fail', detail: 'staging rebuild failed (exit ' + r.status + '): ' + String(r.stderr || '').slice(0, 300) };
  return { status: 'pass', detail: 'staging rebuild command exited 0' };
}

// ---- manifest -------------------------------------------------------------
function buildManifest(dshHome, profileId, opts) {
  const profileDir = join(dshHome, 'profiles', profileId);
  if (!existsSync(profileDir)) fail('profile not found: ' + profileDir);
  const plugins = collectPlugins(profileDir);
  const env = collectEnv();
  const files = collectFiles(dshHome, profileDir);
  // local file: artifacts are part of the rebuild material; carry them or the rehearsal cannot run
  const collectedArtifacts = new Set();
  for (const p of plugins) {
    if (!p.spec.startsWith('file:')) continue;
    const rel = p.spec.slice(5);
    const src = join(profileDir, rel);
    if (!existsSync(src) || !statSync(src).isFile()) continue;
    files.push({ path: 'profile/' + rel.split(/[\\/]/).join('/'), src, sha256: sha256File(src), bytes: statSync(src).size, class: 'portable', last_persisted_at: new Date(statSync(src).mtimeMs).toISOString() });
    collectedArtifacts.add(p.name);
  }
  const providers = collectProviders(profileDir);
  const adapters = loadAdapters();
  const pluginSettings = collectPluginSettings(dshHome, profileDir, plugins, adapters, opts);
  const dshVersion = (() => { const r = spawnSync('dsh --version', { encoding: 'utf8', shell: true }); return r.status === 0 ? String(r.stdout).trim().split(/\r?\n/)[0] : 'unknown'; })();
  const manifest = {
    schema: SCHEMA_ID,
    snapshot_id: 'snap-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 8),
    created_at: new Date().toISOString(),
    tool: { name: 'dsh-config-pack', version: TOOL.version, schema: SCHEMA_ID, min_restore_tool_version: TOOL.version },
    source: { device_id: opts.deviceId, profile_id: profileId, platform: process.platform + '-' + process.arch, node: process.version, dsh_version: dshVersion },
    scope: { included: ['profile', 'device', 'agent-presets', 'plugin-settings'], excluded: ['credentials', 'sessions', 'logs', 'node_modules', 'browser-profile', 'plugin-runtime-logs'] },
    completeness: { status: 'failed', reasons: [], gates: {
      readback: { status: 'skipped', detail: '' },
      digest_pinning: { status: 'skipped', detail: '', unpinned: [] },
      staging_rehearsal: { status: 'skipped', detail: '' },
      settings_coverage: { status: 'skipped', detail: '' } } },
    plugins,
    providers,
    plugin_settings: pluginSettings,
    env,
    credentials: { note: 'no-secret-values; presence-only', inventory: [
      // provider-declared credential pointers: presence stays unknown because the hard policy
      // reads only DSHPACK_-prefixed variables. The secret itself is never read.
      ...providers.filter(pr => pr.apiKeyEnv && pr.apiKeyEnv.default).map(pr => ({
        credential_ref: 'provider:' + pr.id,
        provider_ref: pr.id,
        device_id: opts.deviceId, profile_id: profileId,
        source_kind: 'unknown', presence: 'unknown',
        checked_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
      })),
      ...env.keyPointers.map(k => ({
      credential_ref: k.name,
      provider_ref: k.name.replace(/^DSHPACK_KEY_/, '').toLowerCase().replace(/_/g, '-'),
      device_id: opts.deviceId, profile_id: profileId,
      source_kind: k.pointer ? 'user-env' : 'unknown',
      presence: k.pointer ? (k.present ? 'present' : 'missing') : 'unknown',
      checked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }))] },
    files,
    retention: { keep_count: opts.keepCount, keep_days: opts.keepDays }
  };
  return { manifest, files, pluginSettings, collectedArtifacts };
}

function cmdInventory() {
  const dshHome = resolve(arg('--dsh-home', join(process.env.USERPROFILE || '', '.dsh')));
  const profileId = arg('--profile', 'web');
  const { manifest: m } = buildManifest(dshHome, profileId, { deviceId: arg('--device-id', 'local'), keepCount: 10, keepDays: 30, assumeNoSettings: has('--assume-no-settings') });
  console.log(JSON.stringify({
    profile_id: profileId, files: m.files.length, plugins: m.plugins.length,
    providers: m.providers.map(p => ({ id: p.id, source: p.source, api: p.api || null, models: p.models.length })),
    plugin_settings: m.plugin_settings.map(s => ({ plugin: s.plugin, status: s.status, items: s.items.length })),
    env_collected: m.env.collected.length,
    key_pointers: m.env.keyPointers.map(k => ({ name: k.name, presence: k.pointer ? (k.present ? 'present' : 'missing') : 'unknown' })),
    unpinned: pinningOf(m.plugins)
  }, null, 2));
}

function cmdBackup() {
  const dshHome = resolve(arg('--dsh-home', join(process.env.USERPROFILE || '', '.dsh')));
  const profileId = arg('--profile', 'web');
  const out = arg('--out');
  if (!out) fail('--out <dir> is required');
  const outDir = resolve(out);
  if (existsSync(outDir) && readdirSync(outDir).length) fail('output directory must be empty: ' + outDir);
  const opts = { deviceId: arg('--device-id', 'local'), keepCount: Number(arg('--keep-count', '10')), keepDays: Number(arg('--keep-days', '30')), assumeNoSettings: has('--assume-no-settings') };
  const { manifest: m, files: srcFiles, collectedArtifacts } = buildManifest(dshHome, profileId, opts);

  mkdirSync(join(outDir, 'files'), { recursive: true });
  for (const f of srcFiles) {
    const dest = join(outDir, 'files', f.path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(f.src, dest);
  }
  for (const s of m.plugin_settings) for (const it of s.items) {
    const dest = join(outDir, 'files', it.path);
    if (it.sqliteSrc) {
      // VACUUM INTO produces a transactionally consistent copy, including WAL content,
      // so we never copy a raw db + -wal pair and risk a torn state.
      mkdirSync(dirname(dest), { recursive: true });
      if (existsSync(dest)) rmSync(dest, { force: true });
      const db = new sqliteMod.DatabaseSync(it.sqliteSrc, { readOnly: true });
      try { db.exec("VACUUM INTO '" + dest.replace(/'/g, "''") + "'"); } finally { db.close(); }
      it.sha256 = sha256File(dest);
      it.bytes = statSync(dest).size;
      it.export = 'sqlite-vacuum-into';
      continue;
    }
    if (it.inlineText !== undefined) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, it.inlineText, 'utf8');
      it.sha256 = sha256File(dest);
      it.bytes = statSync(dest).size;
      delete it.inlineText;
      continue;
    }
    if (!it.src) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(it.src, dest);
  }

  const g = m.completeness.gates;
  g.readback = gateReadback(outDir, m.files);
  g.digest_pinning = gateDigest(m.plugins, collectedArtifacts);
  // Any rehearsal runs against a materialised copy of the profile layer, so that a
  // dependency install sees package.json + lockfile + workspace + patches.
  let rebuildCmd = arg('--rehearse-rebuild', null);
  const stage = join(outDir, 'stage', 'profile');
  if (rebuildCmd || has('--rehearse-install')) {
    mkdirSync(stage, { recursive: true });
    const srcProfile = join(dshHome, 'profiles', profileId);
    for (const n of PROFILE_FILES) {
      const s = join(srcProfile, n);
      if (existsSync(s)) copyFileSync(s, join(stage, n));
    }
    const srcPatches = join(srcProfile, 'patches');
    if (existsSync(srcPatches)) {
      mkdirSync(join(stage, 'patches'), { recursive: true });
      for (const f of readdirSync(srcPatches)) if (f.endsWith('.patch')) copyFileSync(join(srcPatches, f), join(stage, 'patches', f));
    }
    for (const f of m.files) {
      if (!f.path.startsWith('profile/')) continue;
      const rel = f.path.slice(8);
      if (PROFILE_FILES.includes(rel) || rel.startsWith('patches/')) continue;   // already copied
      const dest = join(stage, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(dshHome, f.path.startsWith('profile/') ? join('profiles', profileId, rel) : f.path), dest);
    }
  }
  if (!rebuildCmd && has('--rehearse-install')) {
    // offline by default: a rehearsal must not silently hit the network.
    // Use --rehearse-rebuild "pnpm install --frozen-lockfile" for an explicit online install.
    rebuildCmd = 'pnpm install --frozen-lockfile --ignore-scripts --offline';
  }
  g.staging_rehearsal = gateRehearsal(outDir, rebuildCmd, stage);
  g.settings_coverage = gateSettingsCoverage(m.plugin_settings);

  const reasons = [];
  if (g.readback.status !== 'pass') reasons.push('readback gate: ' + g.readback.detail);
  if (g.digest_pinning.status !== 'pass') reasons.push('digest pinning: ' + g.digest_pinning.detail + (g.digest_pinning.unpinned.length ? ' [' + g.digest_pinning.unpinned.join(', ') + ']' : ''));
  if (g.staging_rehearsal.status !== 'pass') reasons.push('staging rehearsal: ' + g.staging_rehearsal.detail);
  if (g.settings_coverage.status !== 'pass') reasons.push('settings coverage: ' + g.settings_coverage.detail);
  m.completeness.reasons = reasons;
  m.completeness.status = reasons.length ? 'partial' : 'complete';

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    snapshot_id: m.snapshot_id, status: m.completeness.status, files: m.files.length, plugins: m.plugins.length,
    plugin_settings: m.plugin_settings.map(s => s.plugin + ':' + s.status),
    gates: { readback: g.readback.status, digest_pinning: g.digest_pinning.status, staging_rehearsal: g.staging_rehearsal.status, settings_coverage: g.settings_coverage.status },
    reasons
  }, null, 2));
  if (m.completeness.status !== 'complete') process.exitCode = 3;
}

function loadManifest(dir) {
  const p = join(resolve(dir), 'manifest.json');
  if (!existsSync(p)) fail('manifest.json not found in ' + dir);
  const m = readJson(p);
  if (!m || m.schema !== SCHEMA_ID) fail('unsupported manifest schema');
  return { m, dir: resolve(dir) };
}
function validateManifest(m, dir) {
  const problems = [];
  for (const k of ['schema', 'snapshot_id', 'created_at', 'tool', 'source', 'scope', 'completeness', 'plugins', 'providers', 'plugin_settings', 'env', 'credentials', 'files', 'retention']) {
    if (!(k in m)) problems.push('missing field: ' + k);
  }
  if (m.completeness && !['complete', 'partial', 'failed'].includes(m.completeness.status)) problems.push('bad completeness.status');
  const gates = ['readback', 'digest_pinning', 'staging_rehearsal', 'settings_coverage'];
  for (const g of gates) {
    const st = m.completeness?.gates?.[g]?.status;
    if (!['pass', 'fail', 'skipped'].includes(st)) problems.push('bad gate status: ' + g);
  }
  if (m.completeness?.status === 'complete') {
    for (const g of gates) if (m.completeness.gates[g].status !== 'pass') problems.push('complete claimed while gate ' + g + ' is ' + m.completeness.gates[g].status);
  }
  for (const f of m.files || []) {
    const p = join(dir, 'files', f.path);
    if (!existsSync(p)) { problems.push('missing file: ' + f.path); continue; }
    if (sha256File(p) !== f.sha256) problems.push('hash mismatch: ' + f.path);
  }
  for (const s of m.plugin_settings || []) for (const it of s.items || []) {
    if (!it.sha256) continue;
    const p = join(dir, 'files', it.path);
    if (!existsSync(p)) { problems.push('missing plugin setting: ' + it.path); continue; }
    if (sha256File(p) !== it.sha256) problems.push('plugin setting hash mismatch: ' + it.path);
  }
  return problems;
}
function cmdVerify() {
  const { m, dir } = loadManifest(arg('--snapshot'));
  const problems = validateManifest(m, dir);
  console.log(JSON.stringify({ snapshot_id: m.snapshot_id, status: m.completeness.status, files: (m.files || []).length, plugin_settings: (m.plugin_settings || []).length, problems }, null, 2));
  if (problems.length) process.exitCode = 1;
}

function listTargetScope(dshHome, profileId) {
  // files that belong to the restorable scope on the target, used for mirror/merge diffing
  const out = [];
  const profileDir = join(dshHome, 'profiles', profileId);
  const skip = n => SECRET_NAMES.has(n) || /\.bak/.test(n) || n === 'node_modules';
  if (existsSync(profileDir)) {
    // mirror must see every restorable file, not just the known names, otherwise extra
    // files would never be reported as removals
    for (const n of readdirSync(profileDir)) {
      if (skip(n)) continue;
      const p = join(profileDir, n);
      if (statSync(p).isFile()) out.push('profile/' + n);
    }
    const patches = join(profileDir, 'patches');
    if (existsSync(patches)) for (const f of readdirSync(patches)) if (f.endsWith('.patch')) out.push('profile/patches/' + f);
  }
  return out;
}

function cmdRestore() {
  const { m, dir } = loadManifest(arg('--snapshot'));
  const dshHome = resolve(arg('--dsh-home', join(process.env.USERPROFILE || '', '.dsh')));
  const profileId = arg('--profile', m.source.profile_id);
  const mode = arg('--mode', 'isolate');
  if (!['isolate', 'mirror', 'merge'].includes(mode)) fail('--mode must be isolate|mirror|merge');
  const problems = validateManifest(m, dir);
  if (problems.length) { console.log(JSON.stringify({ blocked: true, reasons: problems }, null, 2)); process.exitCode = 1; return; }
  if (m.completeness.status !== 'complete' && !has('--allow-partial')) {
    console.log(JSON.stringify({ blocked: true, reasons: ['snapshot status is ' + m.completeness.status + '; pass --allow-partial to restore a subset'], completeness_reasons: m.completeness.reasons }, null, 2));
    process.exitCode = 1; return;
  }

  const writes = [];
  for (const f of m.files || []) writes.push({ from: 'files/' + f.path, to: f.path.startsWith('profile/') ? join('profiles', profileId, f.path.slice(8)) : f.path, class: f.class, source: 'profile-layer' });
  const referenceItems = [];
  for (const s of m.plugin_settings || []) for (const it of s.items || []) {
    if (!it.sha256) continue;
    if (it.restore === 'reference') { referenceItems.push({ path: it.path, restoredVia: it.restoredVia || null, source: 'plugin:' + s.plugin }); continue; }
    writes.push({ from: 'files/' + it.path, to: it.path, class: it.class, source: 'plugin:' + s.plugin });
  }

  const targetFiles = listTargetScope(dshHome, profileId);
  const snapshotSet = new Set(writes.filter(w => w.to.startsWith(join('profiles', profileId))).map(w => 'profile/' + w.to.split(sep).slice(2).join('/')));
  const removals = mode === 'mirror' ? targetFiles.filter(f => !snapshotSet.has(f)) : [];
  const conflicts = mode === 'merge' ? writes.filter(w => existsSync(join(dshHome, w.to))).map(w => w.to) : [];

  const plan = {
    snapshot_id: m.snapshot_id, status: m.completeness.status, mode,
    target: { dsh_home: dshHome, profile_id: profileId },
    writes,
    removals,
    conflicts,
    needs_credentials: (m.credentials?.inventory || []).filter(c => c.presence !== 'present').map(c => c.credential_ref),
    needs_manual: (m.env?.collected || []).map(e => ({ name: e.name, note: 'verify target value matches snapshot' })),
    reference_items: referenceItems,
    unsupported_plugins: (m.plugin_settings || []).filter(s => s.status === 'unsupported').map(s => s.plugin),
    unpinned_dependencies: m.completeness.gates.digest_pinning.unpinned || [],
    notes: [
      'device_bound files require path mapping on the target device',
      'runtime activation is not verified by this plan',
      'secrets are never included in the snapshot',
      'mirror removals are quarantined, never deleted in place'
    ]
  };
  if (has('--dry-run')) { console.log(JSON.stringify({ dry_run: true, ...plan }, null, 2)); return; }

  if (mode === 'mirror' && removals.length && !has('--confirm-removals')) {
    console.log(JSON.stringify({ blocked: true, mode, removals, reasons: ['mirror mode found ' + removals.length + ' extra file(s) in scope; pass --confirm-removals to quarantine them'] }, null, 2));
    process.exitCode = 1; return;
  }

  const quarantine = join(dshHome, '.snapshot-quarantine', new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
  const quarantined = [];
  for (const rel of removals) {
    const src = join(dshHome, rel.startsWith('profile/') ? join('profiles', profileId, rel.slice(8)) : rel);
    if (!existsSync(src)) continue;
    const dest = join(quarantine, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    rmSync(src, { force: true });
    quarantined.push(rel);
  }

  const written = [], skipped = [];
  for (const w of writes) {
    const dest = join(dshHome, w.to);
    if (mode === 'merge' && existsSync(dest)) { skipped.push(w.to); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(dir, w.from), dest);
    written.push(w.to);
  }
  console.log(JSON.stringify({ restored: true, ...plan, written, skipped, quarantined, quarantine_dir: quarantined.length ? quarantine : null }, null, 2));
}

const cmd = process.argv[2];
if (cmd === 'inventory') cmdInventory();
else if (cmd === 'backup') cmdBackup();
else if (cmd === 'verify') cmdVerify();
else if (cmd === 'restore') cmdRestore();
else { console.error('usage: snapshot.mjs <inventory|backup|verify|restore> [options]'); process.exit(2); }