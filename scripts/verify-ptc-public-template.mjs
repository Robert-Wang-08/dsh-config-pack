#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = join(root, 'templates', 'ptc-public-companion');
const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(path, 'utf8');
const json = (path, label) => { try { return JSON.parse(read(path)); } catch (error) { fail(label + ' is not valid JSON: ' + error.message); return null; } };
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
const required = [
  'delegated-contract.json', 'answers.example.json', 'answers.schema.json', 'consumption-map.json',
  'AI-QUESTIONNAIRE.md', 'README.md', 'companion.patch.yml.example', 'never-sync.gitignore',
  'dsh-bundle/cordis.patch.yml', 'dsh-bundle/package.json',
  'ptc-multi-agent-control/SKILL.md', 'ptc-multi-agent-control/skill.json',
  'ptc-multi-agent-control/scripts/ptc_route.py', 'ptc-multi-agent-control/scripts/ptc_task_control.py',
  'ptc-multi-agent-control/scripts/check-model.py', 'ptc-multi-agent-control/scripts/test_ptc_route.py',
  'ptc-multi-agent-control/scripts/test_ptc_task_control.py', 'ptc-multi-agent-control/scripts/acp_smoke.py',
  'ptc-multi-agent-control/scripts/test_acp_smoke.py',
  'ptc-multi-agent-control/assets/public-runtime-config.json',
  'ptc-multi-agent-control/assets/task-contract.template.json',
  'ptc-multi-agent-control/assets/worker-receipt.schema.json',
  'ptc-multi-agent-control/assets/dsh-bundle/cordis.patch.yml',
  'ptc-multi-agent-control/assets/dsh-bundle/package.json',
  'ptc-multi-agent-control/references/USAGE.md', 'ptc-multi-agent-control/evals/evals.json'
];
for (const name of required) if (!existsSync(join(templateRoot, name))) fail('missing template file: ' + name);
const contract = json(join(templateRoot, 'delegated-contract.json'), 'delegated contract');
const answers = json(join(templateRoot, 'answers.example.json'), 'answers example');
const schema = json(join(templateRoot, 'answers.schema.json'), 'answers schema');
const consumption = json(join(templateRoot, 'consumption-map.json'), 'consumption map');
const skillJson = json(join(templateRoot, 'ptc-multi-agent-control', 'skill.json'), 'skill.json');
const runtime = json(join(templateRoot, 'ptc-multi-agent-control', 'assets', 'public-runtime-config.json'), 'public runtime config');
const bundlePackage = json(join(templateRoot, 'dsh-bundle', 'package.json'), 'bundle package');
const skillBundlePackage = json(join(templateRoot, 'ptc-multi-agent-control', 'assets', 'dsh-bundle', 'package.json'), 'skill bundle package');
const expectedIds = ['preset-ptc-multi-agent', 'subagent-acp-opencode-dsv41', 'subagent-acp-kimi-docs', 'subagent-acp-cursor-grok', 'subagent-claude-opus5-plan', 'subagent-claude-opus48-plan', 'tool-subagent-opencode-dsv41', 'tool-subagent-kimi-docs', 'tool-subagent-cursor-grok', 'tool-subagent-claude-opus5-plan', 'tool-subagent-claude-opus48-plan', 'tool-presentation', 'ptc-agent-preset-registry'];
if (contract) {
  if (contract.schema_version !== 'ptc-delegated-contract/v1') fail('unexpected delegated contract schema');
  const rows = contract.rows || [];
  const ids = rows.map((row) => row.id);
  if (rows.length !== expectedIds.length) fail('delegated contract must contain exactly 13 rows');
  if (new Set(ids).size !== ids.length) fail('delegated contract contains duplicate ids');
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) fail('delegated contract ids/order do not match public PTC interface');
  for (const row of rows) for (const key of ['id', 'role', 'provider', 'consumer', 'validation']) if (typeof row[key] !== 'string' || !row[key].trim()) fail('contract row missing ' + key + ': ' + row.id);
}
function schemaLeaves(node, prefix = '') {
  if (!node || typeof node !== 'object') return [];
  if (node.properties) return Object.entries(node.properties).flatMap(([key, value]) => schemaLeaves(value, prefix ? prefix + '.' + key : key));
  return [prefix];
}
if (schema && answers && consumption) {
  if (answers.schema_version !== 'ptc-public-answers/v1') fail('unexpected answers schema version');
  if (schema.type !== 'object' || schema.additionalProperties !== false) fail('answers schema root must reject unknown fields');
  const expectedSections = ['schema_version', 'provider', 'cli', 'proxy', 'features'];
  if (JSON.stringify(schema.required) !== JSON.stringify(expectedSections)) fail('answers schema sections differ from supported questionnaire');
  for (const removed of ['credentials', 'sharedSource', 'timeouts']) if (schema.properties[removed] || answers[removed]) fail('unsupported fake configuration remains: ' + removed);
  const leaves = schemaLeaves(schema).sort();
  const mapped = Object.keys(consumption.fields || {}).sort();
  if (JSON.stringify(leaves) !== JSON.stringify(mapped)) fail('consumption map must cover every schema leaf exactly once');
  for (const field of mapped) {
    const item = consumption.fields[field];
    if (!item || !Array.isArray(item.consumers) || item.consumers.length === 0 || item.consumers.some((value) => typeof value !== 'string' || !value.trim())) fail('field has no concrete consumer: ' + field);
  }
}
const skillMdPath = join(templateRoot, 'ptc-multi-agent-control', 'SKILL.md');
if (existsSync(skillMdPath) && skillJson) {
  const skillMd = read(skillMdPath);
  const version = skillMd.match(/^version:\s*([^\s]+)$/m)?.[1];
  const managed = skillMd.match(/^managed-by:\s*([^\s]+)$/m)?.[1];
  const source = skillMd.match(/^source:\s*([^\s]+)$/m)?.[1];
  if (!version || version !== skillJson.version) fail('SKILL.md and skill.json versions differ');
  if (managed !== 'git' || source !== 'dsh-config-pack') fail('public SKILL.md must be managed by git from dsh-config-pack');
  if (skillJson.managed_by !== 'git' || skillJson.source !== 'dsh-config-pack') fail('public skill.json source metadata is incorrect');
  for (const pkg of [bundlePackage, skillBundlePackage]) if (!pkg || pkg.version !== version || pkg.metadata?.version !== version || pkg.metadata?.managedBy !== 'git' || pkg.metadata?.source !== 'dsh-config-pack') fail('bundle package version/source metadata differs from public skill');
}
if (runtime && runtime.schema_version !== 'ptc-public-runtime/v1') fail('unexpected public runtime config schema');
const bundlePath = join(templateRoot, 'dsh-bundle', 'cordis.patch.yml');
const skillBundlePath = join(templateRoot, 'ptc-multi-agent-control', 'assets', 'dsh-bundle', 'cordis.patch.yml');
const patchPath = join(templateRoot, 'companion.patch.yml.example');
const bundle = existsSync(bundlePath) ? read(bundlePath) : '';
const skillBundle = existsSync(skillBundlePath) ? read(skillBundlePath) : '';
const patch = existsSync(patchPath) ? read(patchPath) : '';
if (bundle !== skillBundle) fail('top-level and skill DSH bundle templates must be identical');
for (const id of expectedIds) {
  const count = bundle.split(/\r?\n/).filter((line) => line.trim() === '- id: ' + id).length;
  if (count !== 1) fail('public DSH bundle must declare delegated id ' + id + ' exactly once');
}
for (const id of ['subagent-acp-opencode-dsv41', 'subagent-acp-kimi-docs', 'subagent-acp-cursor-grok', 'subagent-claude-opus5-plan', 'subagent-claude-opus48-plan']) {
  const count = patch.split(/\r?\n/).filter((line) => line.trim() === '- id: ' + id).length;
  if (count !== 1) fail('example patch must declare local override ' + id + ' exactly once');
}
if (/若不存在，使用本预设内嵌/.test(bundle)) fail('bundle persona falsely claims full embedded PTC without the skill');
if (!/若 skill 未安装或加载失败，必须明确降级为手工协调/.test(bundle)) fail('bundle persona must state degraded behavior when skill loading fails');
if (!/public-runtime-config\.json/.test(read(join(templateRoot, 'ptc-multi-agent-control', 'scripts', 'ptc_route.py')))) fail('route script must consume public runtime config');
for (const text of [patch, bundle]) {
  if (/process\.env\./.test(text)) fail('public YAML must use bracketed environment access');
  for (const line of text.split(/\r?\n/)) if (!line.trimStart().startsWith('#') && line.includes('!!js')) {
    const expression = line.split('!!js', 2)[1].trim();
    if (/:\s/.test(expression)) fail('patch !!js expression contains colon-space');
    if (/^["'{[]/.test(expression) || expression.startsWith('!')) fail('patch !!js expression has unsafe leading token');
  }
}
const scanFiles = files(templateRoot);
if (scanFiles.some((path) => /__pycache__|\.pyc$/i.test(path))) fail('public template must not contain Python cache files');
const personalPath = /[A-Za-z]:\\Users\\[^<\s"']+|\/(?:Users|home)\/[^<\s"']+/i;
const credential = /BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY|(?:^|[^A-Za-z])sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{10,}|password\s*[:=]\s*[^<\s]|secret\s*[:=]\s*[^<\s]/im;
for (const path of scanFiles) {
  const content = read(path);
  const name = relative(templateRoot, path).replaceAll('\\', '/');
  if (personalPath.test(content)) fail('personal absolute path found in ' + name);
  if (credential.test(content)) fail('credential-like literal found in ' + name);
  if (name.startsWith('ptc-multi-agent-control/') && /managed-by:\s*skillhub|"managedBy"\s*:\s*"skillhub"|author:\s*wang|"author"\s*:\s*"wang"/i.test(content)) fail('private source metadata found in ' + name);
}
const ignore = read(join(templateRoot, 'never-sync.gitignore'));
if (!ignore.includes('*') || !ignore.includes('!.gitignore')) fail('never-sync template must deny by default');
const sourceIgnore = read(join(templateRoot, '.gitignore'));
for (const allow of ['!consumption-map.json', '!never-sync.gitignore', '!ptc-multi-agent-control/**']) if (!sourceIgnore.includes(allow)) fail('template source ignore must allow package asset: ' + allow);
if (errors.length) { for (const error of errors) console.error('FAIL: ' + error); process.exit(1); }
console.log('verify-ptc-public-template: OK - complete skill and bundle, 13 unique rows, exact field consumption, version parity, privacy scan');
