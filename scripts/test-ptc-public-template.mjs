#!/usr/bin/env node
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeAnswers, renderPatch, renderBundle, renderSkillBundle, renderRuntimeConfig, acpEnvName, ACP_LADDER_DEFAULTS, DEFAULTS, skillVersion } from './generate-ptc-companion.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const generator = join(root, 'scripts', 'generate-ptc-companion.mjs');
const verifier = join(root, 'scripts', 'verify-ptc-public-template.mjs');
// The canonical PTC skill body. The generator, the skill-bundle copy it renders and the tests below
// all read this one tree; templates/ptc-public-companion/ no longer carries a second copy of it.
const skillTemplate = join(root, 'packages', 'dsh-ptc-multi-agent-mode');
const skillVersionSource = join(skillTemplate, 'skill.json');
const checks = [];
function check(name, condition, detail = '') { checks.push(name); if (!condition) throw new Error('FAIL: ' + name + (detail ? '\n' + detail : '')); }
function run(command, args, cwd = root) { return spawnSync(command, args, { cwd, encoding: 'utf8' }); }
function node(args) { return run(process.execPath, args); }
function read(path) { return readFileSync(path, 'utf8'); }
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]); }
const verify = node([verifier]);
check('template verifier exits zero', verify.status === 0, verify.stdout + verify.stderr);
check('default answers normalize', normalizeAnswers({}).schema_version === 'ptc-public-answers/v1');
for (const invalid of [{ credentials: {} }, { sharedSource: {} }, { timeouts: {} }, { cli: { node: { pathEnv: 'NODE', defaultCommand: 'node' } } }]) {
  let rejected = false; try { normalizeAnswers(invalid); } catch { rejected = true; }
  check('unsupported answer field rejected: ' + Object.keys(invalid)[0], rejected);
}
const custom = normalizeAnswers({
  provider: { controller: 'controller-test', controllerModel: 'controller-model-test', controllerEffort: 'max', fallbackProvider: 'fallback-test', fallbackModel: 'fallback-model-test', executeProvider: 'execute-test', executeModel: 'execute-model-test', docsProvider: 'docs-test', docsModel: 'docs-model-test', designAstraProvider: 'astra-provider-test', designAstraModel: 'astra-model-test', designModel: 'design-model-test' },
  cli: { opencode: { pathEnv: 'CUSTOM_OPENCODE', defaultCommand: 'open-code' }, cursor: { pathEnv: 'CUSTOM_CURSOR', defaultCommand: 'cursor-test' }, kimi: { pathEnv: 'CUSTOM_KIMI', defaultCommand: 'kimi-test' } },
  proxy: { enabled: true, urlEnv: 'CUSTOM_PROXY', noProxyEnv: 'CUSTOM_NO_PROXY', keepCursorProxy: true },
  features: { opencode: false, kimiDocs: false, cursor: true, claudePlan: false, presentation: false }
});
const patch = renderPatch(custom);
for (const token of ['CUSTOM_OPENCODE', 'open-code', 'CUSTOM_CURSOR', 'cursor-test', 'CUSTOM_KIMI', 'kimi-test', 'CUSTOM_PROXY', 'CUSTOM_NO_PROXY', 'execute-model-test', 'docs-model-test', 'design-model-test']) check('custom patch consumes ' + token, patch.includes(token));
check('local patch no longer declares a top-level tool-presentation override', !/- id: tool-presentation/.test(patch));
const bundleTemplate = read(join(root, 'templates', 'ptc-public-companion', 'dsh-bundle', 'cordis.patch.yml'));
check('presentation toggle lives on the bundle preset inner row', /- id: tool-presentation[\s\S]{0,200}disabled: !!js process\['env'\]\.PTC_FEATURE_PRESENTATION === 'off'/.test(bundleTemplate));
const upstreamBundle = renderBundle({ acpPlugin: 'upstream' });
const resilientBundle = renderBundle({});
const countLines = (text, line) => text.split(/\r?\n/).filter((entry) => entry.trim() === line).length;
check('default bundle keeps the upstream ACP plugin on all three rows', (upstreamBundle.match(/name: '@deepseek-ai\/dsh-subagent-acp'/g) || []).length === 3);
check('default bundle emits no ACP timeout ladder key', Object.keys(ACP_LADDER_DEFAULTS).every((field) => countLines(upstreamBundle, field + ':') === 0 && !new RegExp('^\\s*' + field + ':', 'm').test(upstreamBundle)) && !/^\s*guardWorkspaceReuse:/m.test(upstreamBundle));
check('resilient bundle points all three ACP rows at the resilient plugin', (resilientBundle.match(/name: '@local\/dsh-subagent-acp-resilient'/g) || []).length === 3);
const missingLadder = Object.entries(ACP_LADDER_DEFAULTS)
  .map(([field, fallback]) => [field, countLines(resilientBundle, field + ': !!js Number(' + "process['env']." + acpEnvName(field) + ' || ' + fallback + ')')])
  .filter(([, hits]) => hits !== 3)
  .map(([field, hits]) => field + ': ' + hits + ' row(s)');
check('resilient bundle declares every ladder key with its documented default on all three rows', missingLadder.length === 0, missingLadder.join('\n'));
check('resilient bundle declares the workspace guard on all three rows', countLines(resilientBundle, "guardWorkspaceReuse: !!js (process['env'].PTC_ACP_GUARD_WORKSPACE_REUSE ?? '1') !== '0'") === 3);
const unsafeJs = resilientBundle.split(/\r?\n/).filter((line) => line.includes('!!js') && !line.trimStart().startsWith('#')).filter((line) => {
  const expression = line.split('!!js', 2)[1].trim();
  return /:\s/.test(expression) || /^["'{[]/.test(expression) || expression.startsWith('!');
});
check('resilient bundle !!js scalars stay YAML-safe', unsafeJs.length === 0, unsafeJs.join('\n'));
check('skill bundle copy follows the same plugin choice', renderSkillBundle({}).includes("name: '@local/dsh-subagent-acp-resilient'") && renderSkillBundle({ acpPlugin: 'upstream' }).includes("name: '@deepseek-ai/dsh-subagent-acp'"));
check('resilient local patch repeats the plugin name and ladder', (renderPatch({}).match(/name: '@local\/dsh-subagent-acp-resilient'/g) || []).length === 3 && (renderPatch({}).match(/guardWorkspaceReuse/g) || []).length === 3 && !/guardWorkspaceReuse/.test(renderPatch({ acpPlugin: 'upstream' })));
let rejectedPlugin = false; try { normalizeAnswers({ acpPlugin: 'unknown-plugin' }); } catch { rejectedPlugin = true; }
check('unknown acpPlugin is rejected', rejectedPlugin);
const runtime = renderRuntimeConfig(custom);
check('runtime consumes controller and fallback', runtime.controller.provider === 'controller-test' && runtime.controller.fallbackModel === 'fallback-model-test');
check('runtime consumes execute and docs providers', runtime.execute.provider === 'execute-test' && runtime.docs.provider === 'docs-test');
check('runtime consumes Astra design provider and model', runtime.design.astraProvider === 'astra-provider-test' && runtime.design.astraModel === 'astra-model-test' && runtime.design.opusModel === 'design-model-test');
const temp = mkdtempSync(join(tmpdir(), 'ptc-public-template-'));
try {
  const answers = join(temp, 'answers.json');
  writeFileSync(answers, JSON.stringify(custom), 'utf8');
  const out = join(temp, 'companion');
  let result = node([generator, '--answers', answers, '--out', out, '--dry-run']);
  check('dry-run exits zero', result.status === 0, result.stdout + result.stderr);
  check('dry-run writes no output', !existsSync(out));
  result = node([generator, '--answers', answers, '--out', out]);
  check('initial generation exits zero', result.status === 0, result.stdout + result.stderr);
  const required = ['ptc.local.json', 'ptc.local.patch.yml', 'ptc.env.example', 'companion.manifest.json', 'README.md', '.gitignore', '.ptc-generation.json', 'dsh-bundle', 'ptc-multi-agent-control'];
  for (const name of required) check('generated artifact exists: ' + name, existsSync(join(out, name)));
  for (const path of ['dsh-bundle/cordis.patch.yml', 'dsh-bundle/package.json', 'ptc-multi-agent-control/SKILL.md', 'ptc-multi-agent-control/skill.json', 'ptc-multi-agent-control/scripts/ptc_route.py', 'ptc-multi-agent-control/scripts/ptc_task_control.py', 'ptc-multi-agent-control/assets/worker-receipt.schema.json']) check('generated directory contains ' + path, existsSync(join(out, ...path.split('/'))));
  const generated = JSON.parse(read(join(out, 'ptc.local.json')));
  check('generated schema and skill version are correct', generated.schema_version === 'ptc-public-companion/v1' && generated.skill_version === skillVersion());
  check('generated skill version is the canonical skill.json version', generated.skill_version === JSON.parse(read(skillVersionSource)).version, generated.skill_version);
  const generatedRuntime = JSON.parse(read(join(out, 'ptc-multi-agent-control', 'assets', 'public-runtime-config.json')));
  check('generated skill runtime uses custom routes', generatedRuntime.controller.provider === 'controller-test' && generatedRuntime.execute.provider === 'execute-test' && generatedRuntime.docs.provider === 'docs-test');
  const bundle = read(join(out, 'dsh-bundle', 'cordis.patch.yml'));
  check('generated bundle uses custom controller', /provider: controller-test\s+model: controller-model-test\s+reasoningEffort: max/.test(bundle));
  check('generated bundle declares the optional preset registry row', /- id: ptc-agent-preset-registry[\s\S]{0,160}disabled: !!js process\['env'\]\.PTC_PROVIDE_PRESET_REGISTRY !== 'on'[\s\S]{0,80}default: ptc-multi-agent/.test(bundle));
  const manifest = JSON.parse(read(join(out, 'companion.manifest.json')));
  const schema = JSON.parse(read(join(root, 'templates', 'ptc-public-companion', 'answers.schema.json')));
  const leafCount = (node) => node.properties ? Object.values(node.properties).reduce((sum, child) => sum + leafCount(child), 0) : 1;
  check('generated manifest maps every schema leaf', Object.keys(manifest.field_consumption).length === leafCount(schema));
  check('clean profile limitation remains explicit', manifest.clean_profile_verified === false);
  check('generated manifest records agentPresets prerequisites', Array.isArray(manifest.prerequisites?.profileServices) && manifest.prerequisites.profileServices.includes('agentPresets') && manifest.prerequisites?.optionalSelfProvider === 'ptc-agent-preset-registry' && manifest.prerequisites?.enableEnv === 'PTC_PROVIDE_PRESET_REGISTRY' && typeof manifest.prerequisites?.verifyCommand === 'string' && manifest.prerequisites.verifyCommand.includes('dsh-agent-preset-registry'));
  check('generated env example lists the optional registry switch', read(join(out, 'ptc.env.example')).includes('PTC_PROVIDE_PRESET_REGISTRY='));
  check('generated README documents the prerequisite switch', read(join(out, 'README.md')).includes('PTC_PROVIDE_PRESET_REGISTRY=on'));
  const routeInput = JSON.stringify({ writes_files: true, file_count: 12, uncertainty: 'medium', adjudication: false, validation_burden: 'high', context_lines: 10000, cross_directory: true, failure_cost: 'high', work_kind: 'code', prefers_acp: false, background: false });
  result = run('python', ['-B', join(out, 'ptc-multi-agent-control', 'scripts', 'ptc_route.py'), '--input-json', routeInput]);
  check('generated route script executes', result.status === 0, result.stdout + result.stderr);
  const route = JSON.parse(result.stdout);
  check('generated route consumes custom controller model/provider', route.provider === 'controller-test' && route.model === 'controller-model-test' && route.effort === 'max', JSON.stringify(route, null, 2));
  result = run('python', ['-B', join(out, 'ptc-multi-agent-control', 'scripts', 'test_ptc_route.py')]);
  check('generated customized route tests pass', result.status === 0, result.stdout + result.stderr);
  const privacyFiles = walk(out).filter((path) => !path.includes(join(out, '.ptc-rollback')));
  const personalPathPattern = /[A-Za-z]:\\Users\\[^<\s"']+|\/(?:Users|home)\/[^<\s"']+/i;
  // Documentation legitimately quotes the shapes it warns against -- the canonical README says not to
  // write a D:\\nutstore\\... or /Users/... path. Code spans and fenced blocks are examples, not leaked
  // machine paths, so they are removed before the pattern runs; prose naming a real path is still caught.
  const withoutCode = (text) => text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
  const pathOffenders = privacyFiles.filter((path) => personalPathPattern.test(withoutCode(read(path))));
  check('generated output has no personal absolute path', pathOffenders.length === 0, pathOffenders.join('\n'));
  // Scope note: a literal scan of every shipped file is NOT a valid privacy test here. The canonical
  // body keeps its own local registry metadata (its bundle metadata carries author: wang and its
  // changelog narrates SkillHub), and the completed privacy review cleared those exact files as
  // publishable; the frontmatter identity check for the delivered copy lives in
  // verify-ptc-public-template.mjs, which reads the SKILL.md of the body being published.
  result = node([generator, '--answers', answers, '--out', out]);
  check('overwrite is required', result.status !== 0);
  writeFileSync(join(out, 'ptc-multi-agent-control', 'rollback-marker.txt'), 'directory backup marker\n', 'utf8');
  const defaultsPath = join(temp, 'defaults.json'); writeFileSync(defaultsPath, JSON.stringify({ schema_version: 'ptc-public-answers/v1', ...DEFAULTS }), 'utf8');
  result = node([generator, '--answers', defaultsPath, '--out', out, '--overwrite']);
  check('overwrite exits zero', result.status === 0, result.stdout + result.stderr);
  check('overwrite replaces skill directory', !existsSync(join(out, 'ptc-multi-agent-control', 'rollback-marker.txt')));
  check('overwrite replaces bundle directory', read(join(out, 'dsh-bundle', 'cordis.patch.yml')).includes('provider: codex-relay'));
  result = node([generator, '--out', out, '--rollback']);
  check('rollback exits zero', result.status === 0, result.stdout + result.stderr);
  check('rollback restores skill directory tree', existsSync(join(out, 'ptc-multi-agent-control', 'rollback-marker.txt')));
  check('rollback restores custom runtime config', JSON.parse(read(join(out, 'ptc-multi-agent-control', 'assets', 'public-runtime-config.json'))).controller.provider === 'controller-test');
  check('rollback restores custom bundle', read(join(out, 'dsh-bundle', 'cordis.patch.yml')).includes('provider: controller-test'));
  const latest = JSON.parse(read(join(out, '.ptc-rollback', 'latest.json')));
  check('rollback metadata stores relative id, not absolute path', typeof latest.id === 'string' && !latest.path && !/[A-Za-z]:\\/.test(JSON.stringify(latest)));
  const invalid = join(temp, 'invalid.json'); writeFileSync(invalid, JSON.stringify({ credentials: { apiKey: 'do-not-accept' } }), 'utf8');
  result = node([generator, '--answers', invalid, '--out', join(temp, 'invalid-out'), '--dry-run']);
  check('credential fields are rejected', result.status !== 0);
} finally { rmSync(temp, { recursive: true, force: true }); }
for (const testName of ['test_ptc_route.py', 'test_ptc_task_control.py', 'test_acp_smoke.py']) {
  const result = run('python', ['-B', join(skillTemplate, 'scripts', testName)]);
  check('public skill offline test passes: ' + testName, result.status === 0, result.stdout + result.stderr);
}
console.log('test-ptc-public-template: OK - ' + checks.length + ' assertions');
