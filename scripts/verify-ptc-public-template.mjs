#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = join(root, 'templates', 'ptc-public-companion');
// The canonical PTC skill body. The public template used to carry a second copy of this tree; it
// drifted (SKILL.md, skill.json and the bundle were each a release behind) and was retired, so the
// generator, the verifier and the tests now point at exactly one body: this directory.
const skillRoot = join(root, 'packages', 'dsh-ptc-multi-agent-mode');
const skillBundleRoot = join(skillRoot, 'assets', 'dsh-bundle');
const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(path, 'utf8');
const json = (path, label) => { try { return JSON.parse(read(path)); } catch (error) { fail(label + ' is not valid JSON: ' + error.message); return null; } };
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
const required = [
  'delegated-contract.json', 'answers.example.json', 'answers.schema.json', 'consumption-map.json',
  'AI-QUESTIONNAIRE.md', 'README.md', 'companion.patch.yml.example', 'never-sync.gitignore',
  'dsh-bundle/cordis.patch.yml', 'dsh-bundle/package.json'
];
for (const name of required) if (!existsSync(join(templateRoot, name))) fail('missing template file: ' + name);
// Everything that used to be listed above as ptc-multi-agent-control/... is now required under the
// canonical body, at the same relative position. A missing file there is a broken public delivery.
const requiredSkill = [
  'SKILL.md', 'skill.json',
  'scripts/ptc_route.py', 'scripts/ptc_task_control.py',
  'scripts/check-model.py', 'scripts/test_ptc_route.py',
  'scripts/test_ptc_task_control.py', 'scripts/acp_smoke.py',
  'scripts/test_acp_smoke.py',
  'assets/public-runtime-config.json',
  'assets/task-contract.template.json',
  'assets/worker-receipt.schema.json',
  'assets/dsh-bundle/cordis.patch.yml',
  'assets/dsh-bundle/package.json',
  'references/USAGE.md', 'evals/evals.json'
];
for (const name of requiredSkill) if (!existsSync(join(skillRoot, name))) fail('missing canonical skill file: packages/dsh-ptc-multi-agent-mode/' + name);
const contract = json(join(templateRoot, 'delegated-contract.json'), 'delegated contract');
const answers = json(join(templateRoot, 'answers.example.json'), 'answers example');
const schema = json(join(templateRoot, 'answers.schema.json'), 'answers schema');
const consumption = json(join(templateRoot, 'consumption-map.json'), 'consumption map');
const skillJson = json(join(skillRoot, 'skill.json'), 'canonical skill.json');
const runtime = json(join(skillRoot, 'assets', 'public-runtime-config.json'), 'public runtime config');
const bundlePackage = json(join(templateRoot, 'dsh-bundle', 'package.json'), 'bundle package');
const skillBundlePackage = json(join(skillBundleRoot, 'package.json'), 'skill bundle package');
const expectedIds = ['preset-ptc-multi-agent', 'subagent-acp-opencode-dsv41', 'subagent-acp-kimi-docs', 'subagent-acp-cursor-grok', 'subagent-claude-opus55-plan', 'subagent-claude-opus5-plan', 'tool-subagent-opencode-dsv41', 'tool-subagent-kimi-docs', 'tool-subagent-cursor-grok', 'tool-subagent-claude-opus55-plan', 'tool-subagent-claude-opus5-plan', 'tool-presentation', 'ptc-agent-preset-registry'];
if (contract) {
  if (contract.schema_version !== 'ptc-delegated-contract/v1') fail('unexpected delegated contract schema');
  const rows = contract.rows || [];
  const ids = rows.map((row) => row.id);
  if (rows.length !== expectedIds.length) fail('delegated contract must contain exactly ' + expectedIds.length + ' rows');
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
  const expectedSections = ['schema_version', 'provider', 'cli', 'proxy', 'features', 'acpPlugin'];
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
const skillMdPath = join(skillRoot, 'SKILL.md');
if (existsSync(skillMdPath) && skillJson) {
  const skillMd = read(skillMdPath);
  // Scoped to the YAML frontmatter: a nested metadata: block must not be able to satisfy these
  // three keys, or a stale nested copy would silently pass as the published version.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skillMd)?.[1] ?? '';
  const version = frontmatter.match(/^version:\s*(\S+)\s*$/m)?.[1];
  const managed = frontmatter.match(/^managed-by:\s*(\S+)\s*$/m)?.[1];
  const source = frontmatter.match(/^source:\s*(\S+)\s*$/m)?.[1];
  if (!version || version !== skillJson.version) fail('SKILL.md and skill.json versions differ (SKILL.md: ' + (version || 'none') + ', skill.json: ' + (skillJson.version || 'none') + ')');
  if (managed !== 'git' || source !== 'dsh-config-pack') fail('public SKILL.md must be managed by git from dsh-config-pack');
  // The canonical body's own skill.json carries its identity and provenance (origin: self); the
  // frontmatter above carries the full managed-by/source pair, because PUBLISHING metadata belongs
  // to the published artifact and the source repository's skill.json must not be rewritten to carry
  // it. The negative side -- no private-source metadata anywhere in the delivered skill tree -- is
  // enforced by the privacy scan below.
  if (skillJson.id !== 'ptc-multi-agent-control' || skillJson.origin !== 'self') fail('public skill.json identity/provenance is incorrect (id=' + (skillJson.id || 'none') + ', origin=' + (skillJson.origin || 'none') + ')');
  if (!skillBundlePackage || skillBundlePackage.version !== version || skillBundlePackage.metadata?.version !== version || skillBundlePackage.metadata?.managedBy !== 'git' || skillBundlePackage.metadata?.source !== 'dsh-config-pack') fail('canonical skill bundle package version/source metadata differs from public skill');
  // The companion's own bundle keeps its own name (@local/dsh-ptc-public-companion); what must not
  // drift is the version it advertises, because it is generated from the canonical body and the
  // published public_companion.skill_version is compared against that body by verify-components.mjs.
  if (!bundlePackage || bundlePackage.version !== version || bundlePackage.metadata?.version !== version || bundlePackage.metadata?.managedBy !== 'git' || bundlePackage.metadata?.source !== 'dsh-config-pack') fail('companion bundle package metadata or version differs from the canonical skill version ' + version);
}
if (runtime && runtime.schema_version !== 'ptc-public-runtime/v1') fail('unexpected public runtime config schema');
const bundlePath = join(templateRoot, 'dsh-bundle', 'cordis.patch.yml');
const skillBundlePath = join(skillBundleRoot, 'cordis.patch.yml');
const patchPath = join(templateRoot, 'companion.patch.yml.example');
const bundle = existsSync(bundlePath) ? read(bundlePath) : '';
const skillBundle = existsSync(skillBundlePath) ? read(skillBundlePath) : '';
const patch = existsSync(patchPath) ? read(patchPath) : '';
// Both bundles ship, and both are rendered from the canonical one by generate-ptc-companion.mjs, so
// their row interfaces must agree even though the pinned template copy may lag in prose. A pinned
// copy that loses a row is a broken delivery; a copy that only differs in comments is not.
const bundleIds = new Map();
const skillBundleIds = new Map();
for (const line of bundle.split(/\r?\n/)) {
  const m = /^\s*- id:\s*(\S+)\s*$/.exec(line);
  if (m) bundleIds.set(m[1], (bundleIds.get(m[1]) || 0) + 1);
}
for (const line of skillBundle.split(/\r?\n/)) {
  const m = /^\s*- id:\s*(\S+)\s*$/.exec(line);
  if (m) skillBundleIds.set(m[1], (skillBundleIds.get(m[1]) || 0) + 1);
}
for (const id of new Set([...bundleIds.keys(), ...skillBundleIds.keys()])) {
  const inTemplate = bundleIds.get(id) || 0;
  const inSkill = skillBundleIds.get(id) || 0;
  if (inTemplate !== inSkill) fail('bundles disagree on row "' + id + '" (' + inTemplate + ' in dsh-bundle, ' + inSkill + ' in the canonical skill bundle)');
}
if (bundleIds.size === 0) fail('public DSH bundle template declares no rows');

for (const id of expectedIds) {
  const count = bundle.split(/\r?\n/).filter((line) => line.trim() === '- id: ' + id).length;
  if (count !== 1) fail('public DSH bundle must declare delegated id ' + id + ' exactly once');
  const canonical = skillBundle.split(/\r?\n/).filter((line) => line.trim() === '- id: ' + id).length;
  if (canonical !== 1) fail('canonical skill bundle must declare delegated id ' + id + ' exactly once, found ' + canonical);
}
for (const id of ['subagent-acp-opencode-dsv41', 'subagent-acp-kimi-docs', 'subagent-acp-cursor-grok', 'subagent-claude-opus55-plan', 'subagent-claude-opus5-plan']) {
  const count = patch.split(/\r?\n/).filter((line) => line.trim() === '- id: ' + id).length;
  if (count !== 1) fail('example patch must declare local override ' + id + ' exactly once');
}
if (/若不存在，使用本预设内嵌/.test(bundle)) fail('bundle persona falsely claims full embedded PTC without the skill');
if (!/若 skill 未安装或加载失败，必须明确降级为手工协调/.test(bundle)) fail('bundle persona must state degraded behavior when skill loading fails');
if (!/public-runtime-config\.json/.test(read(join(skillRoot, 'scripts', 'ptc_route.py')))) fail('route script must consume public runtime config');
for (const text of [patch, bundle]) {
  if (/process\.env\./.test(text)) fail('public YAML must use bracketed environment access');
  for (const line of text.split(/\r?\n/)) if (!line.trimStart().startsWith('#') && line.includes('!!js')) {
    const expression = line.split('!!js', 2)[1].trim();
    if (/:\s/.test(expression)) fail('patch !!js expression contains colon-space');
    if (/^["'{[]/.test(expression) || expression.startsWith('!')) fail('patch !!js expression has unsafe leading token');
  }
}
// Scope note: this scans the TEMPLATE only. The canonical body under packages/ still carries its
// own local registry metadata (author, changelog, private source notes), which this verifier is not
// allowed to rewrite; the privacy contract for what actually ships is enforced on generated output
// by test-ptc-public-template.mjs, which scans every file the generator writes.
const scanFiles = files(templateRoot);
if (scanFiles.some((path) => /__pycache__|\.pyc$/i.test(path))) fail('public template must not contain Python cache files');
const privateMetadata = /managed-by:\s*skillhub|"managedBy"\s*:\s*"skillhub"|author:\s*wang|"author"\s*:\s*"wang"/i;
const personalPath = /[A-Za-z]:\\Users\\[^<\s"']+|\/(?:Users|home)\/[^<\s"']+/i;
const credential = /BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY|(?:^|[^A-Za-z])sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{10,}|password\s*[:=]\s*[^<\s]|secret\s*[:=]\s*[^<\s]/im;
for (const path of scanFiles) {
  const content = read(path);
  const name = relative(templateRoot, path).replaceAll('\\', '/');
  if (personalPath.test(content)) fail('personal absolute path found in ' + name);
  if (credential.test(content)) fail('credential-like literal found in ' + name);
  if (privateMetadata.test(content)) fail('private source metadata found in ' + name);
}
const ignore = read(join(templateRoot, 'never-sync.gitignore'));
if (!ignore.includes('*') || !ignore.includes('!.gitignore')) fail('never-sync template must deny by default');
const sourceIgnore = read(join(templateRoot, '.gitignore'));
for (const allow of ['!consumption-map.json', '!never-sync.gitignore', '!README.md']) if (!sourceIgnore.includes(allow)) fail('template source ignore must allow package asset: ' + allow);
if (errors.length) { for (const error of errors) console.error('FAIL: ' + error); process.exit(1); }
console.log('verify-ptc-public-template: OK - complete skill and bundle, 13 unique rows, exact field consumption, version parity, privacy scan');
