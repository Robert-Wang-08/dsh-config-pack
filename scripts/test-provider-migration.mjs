import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { migrate } from './migrate-provider-config.mjs';
const root = new URL('../', import.meta.url);
const work = mkdtempSync(join(tmpdir(), 'dsh-provider-test-'));
const profileDir = join(work,'profiles','test'), deviceDir=join(work,'device'), shared=join(work,'shared'), packRoot=join(work,'pack');
for(const d of [profileDir,deviceDir,shared,join(packRoot,'config')]) mkdirSync(d,{recursive:true});
const patch=join(profileDir,'cordis.patch.yml'), input=join(deviceDir,'device.env');
const source=readFileSync(new URL('config/40-models.yml',root),'utf8');
writeFileSync(join(packRoot,'config','40-models.yml'),source);
const other = '# preserve this comment\n- id: untouched\n  config:\n    expr: !!js process.env.KEEP || "yes"\n';
const get=()=>parseDocument(readFileSync(patch,'utf8'),{customTags:[{tag:'tag:yaml.org,2002:js',resolve:s=>s}]}).toJS().find(r=>r.id==='llm-pi-ai').config;
const run=(opts={})=>migrate({profileDir,deviceDir,packRoot,...opts});
try {
  writeFileSync(patch,other); writeFileSync(input,'DSHPACK_BASE_AIS=https://custom.invalid/v1\nDSHPACK_KEY_AIS=CUSTOM_KEY\n');
  const before=readFileSync(patch,'utf8'); assert.equal(run({dryRun:true}).changed,true); assert.equal(readFileSync(patch,'utf8'),before); assert.equal(readdirSync(profileDir).length,1);
  assert.throws(()=>run({check:true}),/migration required/);
  run({env:{DSHPACK_BASE_AIS:'https://process.invalid'}});
  const cfg=get(); assert.equal(cfg.providers['ais-2dsglm'].baseURL,'https://custom.invalid/v1'); assert.equal(cfg.providers['ais-2dsglm'].apiKeyEnv,'CUSTOM_KEY');
  for(const id of ['codex-relay','openai-codex','kimi-coding','opencode-go']) assert.ok(cfg.providers[id]);
  assert.match(readFileSync(patch,'utf8'),/!!js process.env.KEEP/); assert.match(readFileSync(patch,'utf8'),/# preserve this comment/);
  assert.ok(readdirSync(profileDir).some(f=>f.includes('.bak-before-provider-migration')));
  const stable=readFileSync(patch,'utf8'), state=readFileSync(join(profileDir,'.provider-migration.json'),'utf8');
  assert.equal(run().changed,false); assert.equal(readFileSync(patch,'utf8'),stable); assert.equal(readFileSync(join(profileDir,'.provider-migration.json'),'utf8'),state);
  run({check:true});
  // Shared partial input preserves the complete route set; updates/removals are reapplied.
  writeFileSync(join(shared,'device.env'),'DSHPACK_KEY_AIS=SHARED_KEY\n');
  writeFileSync(join(shared,'device-answers.json'),JSON.stringify({providers:[{id:'ais-2dsglm',baseURL:'https://answers.invalid'}]}));
  writeFileSync(join(shared,'cordis.local.yml'),'- id: llm-pi-ai\n  config:\n    providers:\n      ais-2dsglm:\n        baseURL: https://shared.invalid\n');
  run({inputDir:shared}); assert.equal(get().providers['ais-2dsglm'].baseURL,'https://shared.invalid');
  assert.equal(get().providers['ais-2dsglm'].apiKeyEnv,'SHARED_KEY');
  // User GUI edits survive pack upgrades; untouched pack model catalogs update.
  writeFileSync(patch,readFileSync(patch,'utf8').replace('displayName: Codex Relay','displayName: GUI Custom'));
  writeFileSync(join(packRoot,'config','40-models.yml'),source.replace('- id: qwen3.8-max','- id: qwen3.8-max\n          - id: future-model'));
  run(); assert.equal(get().providers['codex-relay'].displayName,'GUI Custom'); assert.ok(get().providers['opencode-go'].models.some(m=>m.id==='future-model'));
  rmSync(join(shared,'cordis.local.yml')); rmSync(join(shared,'device-answers.json')); writeFileSync(join(shared,'device.env'),'');
  run(); assert.equal(get().providers['ais-2dsglm'].baseURL,'http://47.101.159.7:29988/v1');
  // Rejections must leave the profile untouched.
  const safe=readFileSync(patch,'utf8');
  for(const bad of ['DSHPACK_KEY_AIS=sk-real-secret','DSHPACK_KEY_AIS=sk_live_abc123','DSHPACK_BASE_AIS=https://u:p@host.invalid','DSHPACK_KEY_UNKNOWN=ANY_KEY']) {
    writeFileSync(join(shared,'device.env'),bad); assert.throws(()=>run()); assert.equal(readFileSync(patch,'utf8'),safe);
  }
  writeFileSync(join(shared,'device.env'),'');
  writeFileSync(join(shared,'cordis.local.yml'),'- id: other-plugin\n  config: {}\n'); assert.throws(()=>run(),/only llm-pi-ai/); rmSync(join(shared,'cordis.local.yml'));
  writeFileSync(patch,other+"- id: llm-pi-ai\n  config:\n    providers:\n      ais-2dsglm:\n        apiKeyEnv: !!js process['env'].DSHPACK_KEY_AIS || 'OLD_KEY'\n");
  rmSync(join(profileDir,'.provider-migration.json')); writeFileSync(input,''); run(); assert.equal(get().providers['ais-2dsglm'].apiKeyEnv,'OLD_KEY'); assert.ok(!readFileSync(patch,'utf8').includes('apiKeyEnv: !!js'));
  // Real verifier uses the installed pack, so align the synthetic pack version first.
  writeFileSync(join(packRoot,'config','40-models.yml'),source); run();
  // Real verifier accepts only a validated managed override.
  const v=spawnSync(process.execPath,[new URL('scripts/verify.mjs',root).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--profile','test'],{env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^DSHPACK_(BASE|KEY)_/.test(k))),DSH_HOME:work},encoding:'utf8'});
  assert.equal(v.status,0,v.stdout+v.stderr);
  // Catalog apply with a complete synthetic catalog reuses scalar settings.
  const catalog=join(work,'catalog'); mkdirSync(catalog);
  const cfgFile=join(work,'catalog-config.yml'); writeFileSync(cfgFile,source.replace('apiKeyEnv: OPENCODE_API_KEY','apiKeyEnv: SPECIAL_GO_KEY'));
  const lines=source.split(/\r?\n/); const start=lines.findIndex(l=>l.trim()==='opencode-go:');
  const models=lines.slice(start+1).slice(0,lines.slice(start+1).findIndex(l=>l.startsWith('# ──'))).flatMap(l=>/^          - id: (\S+)/.exec(l)?.[1]??[]);
  writeFileSync(join(catalog,'opencode-go.json'),JSON.stringify({provider:Object.fromEntries(models.map(m=>[m,{}]))}));
  const c=spawnSync(process.execPath,[new URL('scripts/refresh-model-catalog.mjs',root).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--pi-ai-data',catalog,'--config',cfgFile,'--snapshot',join(work,'snapshot.json'),'--apply'],{encoding:'utf8'});
  assert.equal(c.status,0,c.stdout+c.stderr); const generated=readFileSync(cfgFile,'utf8'); assert.match(generated,/apiKeyEnv: SPECIAL_GO_KEY/); assert.ok(!generated.includes('apiKeyEnv: !!js')); assert.match(generated,/- id: subagent-model-selection-settings/);
  // Fresh install with no device directory is valid, but unavailable shared sources fail closed.
  const emptyProfile=join(work,'profiles','fresh'); mkdirSync(emptyProfile); writeFileSync(join(emptyProfile,'cordis.patch.yml'),'[]\n');
  migrate({profileDir:emptyProfile,deviceDir:join(work,'missing-device'),packRoot});
  assert.throws(()=>run({inputDir:join(work,'unmounted-share')}),/unavailable/);
  // Exercise the actual PowerShell wrapper against a disposable profile, never a real DSH home.
  writeFileSync(input,'DSHPACK_BASE_AIS=https://wrapper.invalid/v1\nDSHPACK_KEY_AIS=WRAPPER_KEY\n');
  const wrapper=spawnSync('pwsh',['-NoProfile','-File',new URL('scripts/migrate-providers.ps1',root).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'-ProfileName','test','-InputDir',deviceDir],{env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^DSHPACK_(BASE|KEY)_/.test(k))),DSH_HOME:work},encoding:'utf8'});
  assert.equal(wrapper.status,0,wrapper.stdout+wrapper.stderr); assert.equal(get().providers['ais-2dsglm'].baseURL,'https://wrapper.invalid/v1'); assert.equal(get().providers['ais-2dsglm'].apiKeyEnv,'WRAPPER_KEY');
  console.log('PASS: legacy pointers, complete providers, shared overrides, dry-run, backups, idempotence, GUI preservation, pack upgrade, rejected inputs, managed verification, catalog regeneration');
} finally { rmSync(work,{recursive:true,force:true}); }
