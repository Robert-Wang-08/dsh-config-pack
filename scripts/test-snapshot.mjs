#!/usr/bin/env node
// Regression tests for scripts/snapshot.mjs against synthetic fixtures only.
// Never touches a real DSH home; never reads real secrets.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'snapshot.mjs');
const WORK = join(ROOT, '.release-tmp', 'snapshot-test-' + Date.now());
const HOME = join(WORK, 'dsh-home');

function put(rel, text) {
  const p = join(HOME, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
function run(args, env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...(env || {}), USERPROFILE: HOME } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
function reset() {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  const patch = [
    'providers:',
    '      alpha:',
    '        displayName: Alpha',
    '        api: openai-responses',
    "        baseURL: !!js process['env'].DSHPACK_BASE_ALPHA || 'https://alpha.invalid/v1'",
    "        apiKeyEnv: !!js process['env'].DSHPACK_KEY_ALPHA || 'ALPHA_KEY'",
    '        models:',
    '          - id: m-one',
    '            contextWindow: 128000',
    '            maxTokens: 8192',
    '            input: [text, image]',
    '            reasoningEfforts: { low: low, high: high }',
    '          - id: m-two'
  ].join('\n');
  put('profiles/test/cordis.yml', '- id: base\n');
  put('profiles/test/cordis.patch.yml', patch + '\n');
  put('profiles/test/package.json', JSON.stringify({
    dependencies: {
      'pinned-plugin': '1.2.3',
      'sha-plugin': 'github:owner/repo#0123456789abcdef0123456789abcdef01234567',
      'dsh-deepseek-keypool': 'github:owner/keypool#89abcdef0123456789abcdef0123456789abcdef'
    },
    dsh: { profile: { bundles: ['pinned-plugin', 'sha-plugin', 'dsh-deepseek-keypool'] } }
  }, null, 2));
  put('profiles/test/pnpm-lock.yaml', 'lockfileVersion: 9\n');
  put('profiles/test/pnpm-workspace.yaml', 'blockExoticSubdeps: false\n');
  put('profiles/test/compatibility.json', '{}');
  put('profiles/test/patches/one.patch', '--- a/x.js\n');
  put('device/device.env', 'DSHPACK_DEFAULT_MODEL=gpt-6.1-sol\n');
  put('device/route-config.json', '{"enabled":true}\n');
  put('.agent-presets/custom/preset.yml', 'name: custom\n');
  put('plugins/provider-failover/route-config.json', '{"tier":1,"color":"#123456"}\n');
  put('plugins/provider-failover/settings.json', '{"enabled":true}\n');
  put('plugins/provider-failover/notices.jsonl', 'runtime log line\n');
  put('.credentials.yaml', 'FAKE_KEY: not-a-real-secret\n');
}
const OK_REBUILD = 'node -e "process.exit(0)"';

// A: no rehearsal -> partial
reset();
let r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapA')]);
assert.equal(r.json.status, 'partial');
assert.equal(r.json.gates.staging_rehearsal, 'skipped');
assert.equal(r.code, 3);

// B: all four gates pass -> complete
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapB'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
assert.equal(r.json.status, 'complete', 'expected complete: ' + JSON.stringify(r.json));
assert.equal(r.code, 0);
for (const g of ['readback', 'digest_pinning', 'staging_rehearsal', 'settings_coverage']) assert.equal(r.json.gates[g], 'pass', 'gate ' + g);

// C: adapter-matched plugin exported; runtime log excluded
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapC'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
assert.ok(r.json.plugin_settings.includes('dsh-deepseek-keypool:exported'), 'adapter should export keypool settings');
const mC = JSON.parse(readFileSync(join(WORK, 'snapC', 'manifest.json'), 'utf8'));
const kp = mC.plugin_settings.find(s => s.plugin === 'dsh-deepseek-keypool');
assert.equal(kp.items.length, 2);
assert.ok(kp.items.every(i => i.sha256));
assert.ok(!existsSync(join(WORK, 'snapC', 'files', 'plugins', 'provider-failover', 'notices.jsonl')), 'runtime log must not be collected');

// D: no adapter and no settings -> unsupported -> partial; flag downgrades to not_applicable
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapD'), '--rehearse-rebuild', OK_REBUILD]);
assert.equal(r.json.gates.settings_coverage, 'fail');
assert.equal(r.json.status, 'partial');
assert.ok(r.json.reasons.some(x => x.includes('settings coverage')));
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapD2'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
assert.equal(r.json.gates.settings_coverage, 'pass');

// E: unpinned dependency -> digest gate fails
reset();
put('profiles/test/package.json', JSON.stringify({ dependencies: { 'tag-plugin': 'github:owner/repo#v1.2.3' }, dsh: { profile: { bundles: ['tag-plugin'] } } }, null, 2));
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapE'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
assert.equal(r.json.gates.digest_pinning, 'fail');
assert.equal(r.json.status, 'partial');

// F: failed rehearsal -> partial
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapF'), '--rehearse-rebuild', 'node -e "process.exit(3)"', '--assume-no-settings']);
assert.equal(r.json.gates.staging_rehearsal, 'fail');
assert.equal(r.json.status, 'partial');

// G: structured provider/model export
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapG'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
const mG = JSON.parse(readFileSync(join(WORK, 'snapG', 'manifest.json'), 'utf8'));
const alpha = mG.providers.find(p => p.id === 'alpha');
assert.equal(alpha.api, 'openai-responses');
assert.equal(alpha.baseURL.default, 'https://alpha.invalid/v1');
assert.equal(alpha.apiKeyEnv.default, 'ALPHA_KEY');
assert.equal(alpha.models.length, 2);
const m1 = alpha.models.find(x => x.id === 'm-one');
assert.equal(m1.contextWindow, 128000);
assert.equal(m1.maxTokens, 8192);
assert.deepEqual(m1.input, ['text', 'image']);
assert.equal(m1.reasoningEfforts.low, 'low');

// G2: provider-declared credential pointers are inventoried with unknown presence, no value
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapG2'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
const mG2 = JSON.parse(readFileSync(join(WORK, 'snapG2', 'manifest.json'), 'utf8'));
const cred = mG2.credentials.inventory.find(c => c.credential_ref === 'provider:alpha');
assert.ok(cred, 'provider-declared credential must be inventoried');
assert.equal(cred.presence, 'unknown', 'must not claim presence for a non-DSHPACK secret var');
assert.equal(cred.provider_ref, 'alpha');
assert.ok(!JSON.stringify(mG2).includes('ALPHA_KEY_VALUE_PLACEHOLDER'));

// H: secrets never collected; pointer name recorded only
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapH'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings'],
  { MY_REAL_SECRET: 'super-secret-value-123', DSHPACK_KEY_ALPHA: 'MY_REAL_SECRET' });
const rawH = readFileSync(join(WORK, 'snapH', 'manifest.json'), 'utf8');
assert.ok(!rawH.includes('super-secret-value-123'), 'secret leaked');
assert.ok(!rawH.includes('not-a-real-secret'), 'credentials content leaked');
const mH = JSON.parse(rawH);
const ptr = mH.env.keyPointers.find(k => k.name === 'DSHPACK_KEY_ALPHA');
assert.equal(ptr.pointer, 'MY_REAL_SECRET');
assert.equal(ptr.present, true);
assert.ok(!mH.env.collected.some(c => c.name === 'MY_REAL_SECRET'));
assert.ok(!existsSync(join(WORK, 'snapH', 'files', '.credentials.yaml')));

// I: verify detects tampering (including plugin settings)
writeFileSync(join(WORK, 'snapH', 'files', 'profile', 'cordis.yml'), '- id: tampered\n');
r = run(['verify', '--snapshot', join(WORK, 'snapH')]);
assert.equal(r.code, 1);
assert.ok(r.json.problems.some(p => p.includes('hash mismatch')));

// J: restore blocks partial; dry-run writes nothing
r = run(['restore', '--snapshot', join(WORK, 'snapA'), '--dsh-home', join(WORK, 'target'), '--profile', 'restored', '--dry-run']);
assert.equal(r.code, 1);
assert.equal(r.json.blocked, true);
assert.ok(!existsSync(join(WORK, 'target', 'profiles', 'restored')));
r = run(['restore', '--snapshot', join(WORK, 'snapA'), '--dsh-home', join(WORK, 'target'), '--profile', 'restored', '--dry-run', '--allow-partial']);
assert.equal(r.json.dry_run, true);
assert.ok(r.json.writes.some(w => w.to.includes('profiles') && w.to.includes('restored')));

// K: complete restore plan includes plugin settings
r = run(['restore', '--snapshot', join(WORK, 'snapB'), '--dsh-home', join(WORK, 'target2'), '--profile', 'restored', '--dry-run']);
assert.equal(r.code, 0);
assert.ok(r.json.writes.some(w => w.to.endsWith('cordis.yml') && w.to.includes('restored')));
assert.ok(r.json.writes.some(w => w.to.includes('plugins') && w.to.includes('provider-failover')));

// L: complete claimed with a skipped gate is rejected
const mB = JSON.parse(readFileSync(join(WORK, 'snapB', 'manifest.json'), 'utf8'));
mB.completeness.gates.settings_coverage.status = 'skipped';
writeFileSync(join(WORK, 'snapB', 'manifest.json'), JSON.stringify(mB, null, 2));
r = run(['verify', '--snapshot', join(WORK, 'snapB')]);
assert.equal(r.code, 1);
assert.ok(r.json.problems.some(p => p.includes('complete claimed while gate settings_coverage')));

// M: prerelease exact version and tarball-URL commit are treated as pinned; file: artifact is not
reset();
put('profiles/test/package.json', JSON.stringify({ dependencies: {
  'rc-plugin': '0.2.0-rc.2',
  'tarball-plugin': 'https://codeload.github.com/o/r/tar.gz/0123456789abcdef0123456789abcdef01234567'
}, dsh: { profile: { bundles: ['rc-plugin'] } } }, null, 2));
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapM'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
assert.equal(r.json.gates.digest_pinning, 'pass', 'prerelease + tarball commit must count as pinned: ' + JSON.stringify(r.json));
reset();
put('profiles/test/package.json', JSON.stringify({ dependencies: { 'file-plugin': 'file:vendor/x.tgz' }, dsh: { profile: { bundles: [] } } }, null, 2));
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapM2'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
assert.equal(r.json.gates.digest_pinning, 'fail', 'local file: artifact must be flagged');
assert.ok(r.json.reasons.some(x => x.includes('local artifact')));

// N: sqlite source is exported via VACUUM INTO (WAL-safe) and restorable
reset();
put('plugins/provider-failover/route-config.json', '{"tier":1}\n');
const dbScript = 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("PRAGMA journal_mode=WAL");d.exec("CREATE TABLE IF NOT EXISTS s(k TEXT PRIMARY KEY,v TEXT)");d.exec("INSERT INTO s VALUES(\'color\',\'#abcdef\')");d.close();';
const dbPath = join(HOME, 'plugins', 'provider-failover', 'data.db');
const dbGen = spawnSync(process.execPath, ['-e', dbScript, dbPath], { encoding: 'utf8' });
assert.equal(dbGen.status, 0, 'fixture sqlite create failed: ' + dbGen.stderr);
const adaptersPath = join(ROOT, 'assets', 'plugin-settings-adapters.json');
const adaptersOrig = readFileSync(adaptersPath, 'utf8');
const adaptersMod = JSON.parse(adaptersOrig);
adaptersMod.adapters.find(a => a.plugin === 'provider-failover').sources.push({ kind: 'sqlite', path: 'plugins/provider-failover/data.db', class: 'portable', optional: false });
writeFileSync(adaptersPath, JSON.stringify(adaptersMod, null, 2));
try {
  r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapN'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
  const exported = join(WORK, 'snapN', 'files', 'plugins', 'provider-failover', 'data.db');
  assert.ok(existsSync(exported), 'sqlite export missing');
  const check = spawnSync(process.execPath, ['-e', 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare("SELECT v FROM s WHERE k=?").get("color").v);d.close();', exported], { encoding: 'utf8' });
  assert.equal(check.stdout.trim(), '#abcdef', 'exported sqlite must contain the row: ' + check.stderr);
  r = run(['verify', '--snapshot', join(WORK, 'snapN')]);
  assert.equal(r.code, 0, 'sqlite export must verify: ' + JSON.stringify(r.json));
} finally {
  writeFileSync(adaptersPath, adaptersOrig);
}

// O: mirror mode reports extra target files and quarantines them only with --confirm-removals
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapO'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
const TGT = join(WORK, 'mirror-target');
mkdirSync(join(TGT, 'profiles', 'test'), { recursive: true });
writeFileSync(join(TGT, 'profiles', 'test', 'cordis.yml'), '- id: old\n');
writeFileSync(join(TGT, 'profiles', 'test', 'stale-extra.yml'), '- id: extra\n');
r = run(['restore', '--snapshot', join(WORK, 'snapO'), '--dsh-home', TGT, '--profile', 'test', '--mode', 'mirror', '--dry-run']);
assert.ok(r.json.removals.includes('profile/stale-extra.yml'), 'mirror must detect extra file: ' + JSON.stringify(r.json.removals));
r = run(['restore', '--snapshot', join(WORK, 'snapO'), '--dsh-home', TGT, '--profile', 'test', '--mode', 'mirror']);
assert.equal(r.code, 1);
assert.equal(r.json.blocked, true);
assert.ok(existsSync(join(TGT, 'profiles', 'test', 'stale-extra.yml')), 'must not delete without confirmation');
r = run(['restore', '--snapshot', join(WORK, 'snapO'), '--dsh-home', TGT, '--profile', 'test', '--mode', 'mirror', '--confirm-removals']);
assert.equal(r.code, 0, JSON.stringify(r.json));
assert.ok(!existsSync(join(TGT, 'profiles', 'test', 'stale-extra.yml')), 'extra file must be removed from profile');
assert.ok(r.json.quarantine_dir && existsSync(join(r.json.quarantine_dir, 'profile', 'stale-extra.yml')), 'removed file must be quarantined');

// P: merge mode keeps existing target files and reports conflicts
reset();
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapP'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
const TGT2 = join(WORK, 'merge-target');
mkdirSync(join(TGT2, 'profiles', 'test'), { recursive: true });
writeFileSync(join(TGT2, 'profiles', 'test', 'cordis.yml'), '- id: keep-me\n');
r = run(['restore', '--snapshot', join(WORK, 'snapP'), '--dsh-home', TGT2, '--profile', 'test', '--mode', 'merge']);
assert.equal(r.code, 0);
assert.ok(r.json.conflicts.some(c => c.includes('cordis.yml')), 'merge must report conflicts');
assert.equal(readFileSync(join(TGT2, 'profiles', 'test', 'cordis.yml'), 'utf8').trim(), '- id: keep-me', 'merge must not overwrite');

// Q: cordis-config extracts the plugin row for coverage; restore treats it as reference-only
reset();
put('profiles/test/package.json', JSON.stringify({ dependencies: { '@deepseek-ai/dsh-subagent-acp': '0.2.0-rc.2' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-subagent-acp'] } } }, null, 2));
put('profiles/test/cordis.patch.yml', ['providers:',
  '      alpha:',
  '        displayName: Alpha',
  '        api: openai-responses',
  '        models:',
  '          - id: m-one',
  '    - id: subagent-acp-opencode',
  '      name: "@deepseek-ai/dsh-subagent-acp"',
  '      config:',
  '        providerName: opencode',
  '        args: [acp]'].join('\n') + '\n');
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapQ'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
const mQ = JSON.parse(readFileSync(join(WORK, 'snapQ', 'manifest.json'), 'utf8'));
const acp = mQ.plugin_settings.find(s => s.plugin === '@deepseek-ai/dsh-subagent-acp');
assert.ok(acp, 'acp plugin row must be reported');
assert.equal(acp.status, 'exported');
const acpItem = acp.items.find(i => i.sourceKind === 'cordis-config');
assert.ok(acpItem && acpItem.sha256, 'cordis-config item must carry a hash');
assert.equal(acpItem.restore, 'reference');
assert.ok(readFileSync(join(WORK, 'snapQ', 'files', acpItem.path), 'utf8').includes('providerName: opencode'));
r = run(['restore', '--snapshot', join(WORK, 'snapQ'), '--dsh-home', join(WORK, 'qtarget'), '--profile', 'test', '--dry-run']);
assert.ok(r.json.reference_items.some(i => i.path.includes('subagent-acp-opencode')), 'reference item must be listed');
assert.ok(!r.json.writes.some(w => w.to.includes('plugin-config')), 'reference item must not be copied');

// Q2: optional cordis-config row absent is not a gap (pack-managed row)
reset();
put('profiles/test/package.json', JSON.stringify({ dependencies: { '@deepseek-ai/dsh-subagent-acp': '0.2.0-rc.2' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-subagent-acp'] } } }, null, 2));
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapQ2'), '--rehearse-rebuild', OK_REBUILD]);
const mQ2 = JSON.parse(readFileSync(join(WORK, 'snapQ2', 'manifest.json'), 'utf8'));
const acpQ2 = mQ2.plugin_settings.find(s => s.plugin === '@deepseek-ai/dsh-subagent-acp');
assert.equal(acpQ2.status, 'not_applicable', 'optional missing cordis row must not be a gap: ' + JSON.stringify(acpQ2));
assert.equal(r.json.gates.settings_coverage, 'pass', 'optional missing cordis row must not fail coverage');

// Q3: bundle-only plugins with no independent settings export are not_applicable, not unsupported
reset();
put('profiles/test/package.json', JSON.stringify({ dependencies: { 'dsh-config-pack': '0.11.7', '@local/dsh-preset-failover-tiers': '0.1.0', 'dsh-codex-cred-sync': '1.0.0', '@deepseek-ai/dsh-web-app': '0.2.1-rc.5' }, dsh: { profile: { bundles: ['dsh-config-pack', '@local/dsh-preset-failover-tiers', 'dsh-codex-cred-sync', '@deepseek-ai/dsh-web-app'] } } }, null, 2));
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapQ3'), '--rehearse-rebuild', OK_REBUILD]);
const mQ3 = JSON.parse(readFileSync(join(WORK, 'snapQ3', 'manifest.json'), 'utf8'));
for (const name of ['dsh-config-pack', '@local/dsh-preset-failover-tiers', 'dsh-codex-cred-sync', '@deepseek-ai/dsh-web-app']) {
  const row = mQ3.plugin_settings.find(s => s.plugin === name);
  assert.equal(row.status, 'not_applicable', name + ' must be not_applicable: ' + JSON.stringify(row));
}
assert.equal(r.json.gates.settings_coverage, 'pass', 'bundle-only plugins must not fail coverage');

// C2: optional missing settings file is not a gap (plugin never wrote user overrides)
reset();
rmSync(join(HOME, 'plugins', 'provider-failover', 'settings.json'), { force: true });
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapC2'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
const mC2 = JSON.parse(readFileSync(join(WORK, 'snapC2', 'manifest.json'), 'utf8'));
const kpC2 = mC2.plugin_settings.find(s => s.plugin === 'dsh-deepseek-keypool');
assert.equal(kpC2.status, 'exported', 'missing optional settings file must not be partial: ' + JSON.stringify(kpC2));
assert.equal(kpC2.items.length, 1);
assert.equal(r.json.gates.settings_coverage, 'pass');

// G3: literal provider endpoint and pointer export without __jsExpr
reset();
put('profiles/test/cordis.patch.yml', ['providers:',
  '      literal-relay:',
  '        displayName: Literal Relay',
  '        api: openai-responses',
  '        baseURL: https://literal.invalid/v1',
  '        apiKeyEnv: LITERAL_KEY',
  '        models:',
  '          - id: m-literal'].join('\n') + '\n');
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapG3'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
const mG3 = JSON.parse(readFileSync(join(WORK, 'snapG3', 'manifest.json'), 'utf8'));
const literal = mG3.providers.find(p => p.id === 'literal-relay');
assert.equal(literal.baseURL.default, 'https://literal.invalid/v1');
assert.equal(literal.apiKeyEnv.default, 'LITERAL_KEY');
assert.ok(!JSON.stringify(literal).includes('__jsExpr'), 'literal provider must not expose __jsExpr');

// R: invalid browser export artifact is rejected; valid one is consumed; secret-looking keys are refused
reset();
mkdirSync(join(HOME, 'device', 'browser-exports'), { recursive: true });
writeFileSync(join(HOME, 'device', 'browser-exports', 'provider-badge.json'), JSON.stringify({ schema: 'wrong', plugin: 'x', values: {} }));
const adaptersPath2 = join(ROOT, 'assets', 'plugin-settings-adapters.json');
const adaptersOrig2 = readFileSync(adaptersPath2, 'utf8');
const mod2 = JSON.parse(adaptersOrig2);
mod2.adapters.push({ match: 'badge-test', plugin: 'badge-test', sources: [{ kind: 'export-json', path: 'device/browser-exports/provider-badge.json', class: 'portable', optional: false }] });
writeFileSync(adaptersPath2, JSON.stringify(mod2, null, 2));
try {
  put('profiles/test/package.json', JSON.stringify({ dependencies: { 'badge-test': '1.0.0' }, dsh: { profile: { bundles: [] } } }, null, 2));
  r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapR1'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
  const mR1 = JSON.parse(readFileSync(join(WORK, 'snapR1', 'manifest.json'), 'utf8'));
  const s1 = mR1.plugin_settings.find(x => x.plugin === 'badge-test');
  assert.equal(s1.status, 'partial', 'invalid export artifact must be a gap');
  writeFileSync(join(HOME, 'device', 'browser-exports', 'provider-badge.json'), JSON.stringify({ schema: 'dsh-browser-export/v1', plugin: 'badge-test', exported_at: '2026-11-01T00:00:00Z', values: { accent: '#ff0000', density: 'compact' } }));
  r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapR2'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
  const mR2 = JSON.parse(readFileSync(join(WORK, 'snapR2', 'manifest.json'), 'utf8'));
  const s2 = mR2.plugin_settings.find(x => x.plugin === 'badge-test');
  assert.equal(s2.status, 'exported', 'valid export artifact must be consumed');
  writeFileSync(join(HOME, 'device', 'browser-exports', 'provider-badge.json'), JSON.stringify({ schema: 'dsh-browser-export/v1', plugin: 'badge-test', exported_at: '2026-11-01T00:00:00Z', values: { apiToken: 'x' } }));
  r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapR3'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
  const mR3 = JSON.parse(readFileSync(join(WORK, 'snapR3', 'manifest.json'), 'utf8'));
  const s3 = mR3.plugin_settings.find(x => x.plugin === 'badge-test');
  assert.equal(s3.status, 'partial', 'secret-looking export keys must be refused');
  assert.ok(s3.reason.includes('secret-looking'));
} finally { writeFileSync(adaptersPath2, adaptersOrig2); }

// S: a local file: artifact that is carried inside the snapshot counts as reconstructible
reset();
mkdirSync(join(HOME, 'profiles', 'test', 'vendor'), { recursive: true });
writeFileSync(join(HOME, 'profiles', 'test', 'vendor', 'x.tgz'), 'fake-tarball-bytes');
put('profiles/test/package.json', JSON.stringify({ dependencies: { 'file-plugin': 'file:vendor/x.tgz' }, dsh: { profile: { bundles: [] } } }, null, 2));
r = run(['backup', '--dsh-home', HOME, '--profile', 'test', '--out', join(WORK, 'snapS'), '--rehearse-rebuild', OK_REBUILD, '--assume-no-settings']);
assert.equal(r.json.gates.digest_pinning, 'pass', 'carried file: artifact must count as reconstructible: ' + JSON.stringify(r.json.reasons));
const mS = JSON.parse(readFileSync(join(WORK, 'snapS', 'manifest.json'), 'utf8'));
assert.ok(mS.files.some(f => f.path === 'profile/vendor/x.tgz'), 'artifact must be carried in files');

console.log('PASS: 4 gates (readback/pinning/rehearsal/settings-coverage), structured provider export, adapter export, secret exclusion, tamper detection, restore blocking');
