#!/usr/bin/env node
/** Generate a complete local, non-secret PTC companion. */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';

export const ANSWERS_SCHEMA = 'ptc-public-answers/v1';
export const COMPANION_SCHEMA = 'ptc-public-companion/v1';
export const RUNTIME_SCHEMA = 'ptc-public-runtime/v1';
export const SKILL_VERSION = '1.0.0';
export const DEFAULTS = {
  provider: {
    controller: 'codex-relay', controllerModel: 'gpt-5.6-sol', controllerEffort: 'high',
    fallbackProvider: 'openai-codex', fallbackModel: 'gpt-5.6-sol',
    executeProvider: 'ais-2dsglm', executeModel: 'deepseek-v4.1-flash',
    docsProvider: 'kimi-coding', docsModel: 'kimi-code/k3-256k',
    designModel: 'claude-opus-5', designFallbackModel: 'claude-opus-4-8'
  },
  cli: {
    opencode: { pathEnv: 'PTC_CLI_OPENCODE', defaultCommand: 'opencode' },
    cursor: { pathEnv: 'PTC_CLI_CURSOR', defaultCommand: 'cursor-agent' },
    kimi: { pathEnv: 'PTC_CLI_KIMI', defaultCommand: 'kimi' }
  },
  proxy: { enabled: false, urlEnv: 'HTTPS_PROXY', noProxyEnv: 'NO_PROXY', keepCursorProxy: false },
  features: { opencode: true, kimiDocs: true, cursor: false, claudePlan: true, presentation: true }
};
const PROVIDER_KEYS = Object.keys(DEFAULTS.provider);
const CLI_KEYS = Object.keys(DEFAULTS.cli);
const FEATURE_KEYS = Object.keys(DEFAULTS.features);
const TOP_LEVEL_KEYS = ['schema_version', 'provider', 'cli', 'proxy', 'features'];
const PROXY_KEYS = Object.keys(DEFAULTS.proxy);
const GENERATED_ARTIFACTS = [
  'ptc.local.json', 'ptc.local.patch.yml', 'ptc.env.example', 'companion.manifest.json',
  'README.md', '.gitignore', 'dsh-bundle', 'ptc-multi-agent-control'
];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const templateRoot = join(scriptDir, '..', 'templates', 'ptc-public-companion');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assertKnownKeys(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(field + ' must be an object');
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(field + ' contains unsupported fields: ' + unknown.join(', '));
}
function merge(base, extra) {
  const out = clone(base);
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object') out[key] = merge(out[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}
function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(field + ' must be a non-empty string');
  return value.trim();
}
function envName(value, field) {
  const result = text(value, field);
  if (!/^[A-Z][A-Z0-9_]*$/.test(result)) throw new Error(field + ' must be an environment variable name');
  return result;
}
function safeName(value, field) {
  const result = text(value, field);
  if (/\r|\n/.test(result)) throw new Error(field + ' cannot contain newlines');
  if (/(?:BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY|api[_-]?key\s*[:=]|secret\s*[:=]|password\s*[:=]|token\s*[:=])/i.test(result)) throw new Error(field + ' looks like a credential value');
  return result;
}
function commandName(value, field) {
  const result = safeName(value, field);
  if (!/^[A-Za-z0-9._-]+$/.test(result)) throw new Error(field + ' must be a command name, not a path or command string');
  return result;
}
function assertNoSecretKeys(value, path = 'answers') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:secret|password|token|credential|authorization|private[_-]?key|api[_-]?key)$/i.test(key)) throw new Error(path + '.' + key + ' is unsupported; configure authentication in the provider or CLI');
    if (child && typeof child === 'object') assertNoSecretKeys(child, path + '.' + key);
  }
}
export function normalizeAnswers(inputAnswers = {}) {
  if (!inputAnswers || typeof inputAnswers !== 'object' || Array.isArray(inputAnswers)) throw new Error('answers must be a JSON object');
  assertKnownKeys(inputAnswers, TOP_LEVEL_KEYS, 'answers');
  assertNoSecretKeys(inputAnswers);
  if (inputAnswers.provider) assertKnownKeys(inputAnswers.provider, PROVIDER_KEYS, 'provider');
  if (inputAnswers.cli) {
    assertKnownKeys(inputAnswers.cli, CLI_KEYS, 'cli');
    for (const key of Object.keys(inputAnswers.cli)) assertKnownKeys(inputAnswers.cli[key], ['pathEnv', 'defaultCommand'], 'cli.' + key);
  }
  if (inputAnswers.proxy) assertKnownKeys(inputAnswers.proxy, PROXY_KEYS, 'proxy');
  if (inputAnswers.features) assertKnownKeys(inputAnswers.features, FEATURE_KEYS, 'features');
  const answers = merge(DEFAULTS, inputAnswers);
  if (answers.schema_version && answers.schema_version !== ANSWERS_SCHEMA) throw new Error('unsupported answers schema: ' + answers.schema_version);
  answers.schema_version = ANSWERS_SCHEMA;
  for (const key of PROVIDER_KEYS) answers.provider[key] = safeName(answers.provider[key], 'provider.' + key);
  if (!['low', 'high', 'max'].includes(answers.provider.controllerEffort)) throw new Error('provider.controllerEffort must be low, high, or max');
  for (const key of CLI_KEYS) {
    answers.cli[key].pathEnv = envName(answers.cli[key].pathEnv, 'cli.' + key + '.pathEnv');
    answers.cli[key].defaultCommand = commandName(answers.cli[key].defaultCommand, 'cli.' + key + '.defaultCommand');
  }
  answers.proxy.enabled = Boolean(answers.proxy.enabled);
  answers.proxy.keepCursorProxy = Boolean(answers.proxy.keepCursorProxy);
  answers.proxy.urlEnv = envName(answers.proxy.urlEnv, 'proxy.urlEnv');
  answers.proxy.noProxyEnv = envName(answers.proxy.noProxyEnv, 'proxy.noProxyEnv');
  for (const key of FEATURE_KEYS) answers.features[key] = Boolean(answers.features[key]);
  return answers;
}
function loadAnswers(answerArg) {
  if (!answerArg) return normalizeAnswers({});
  const value = answerArg.trim();
  return normalizeAnswers(JSON.parse(value.startsWith('{') ? value : readFileSync(resolve(value), 'utf8')));
}
function envLookup(name) { return "process['env'][" + JSON.stringify(name) + ']'; }
function jsEnv(name, fallback) { return '!!js ' + envLookup(name) + ' || ' + JSON.stringify(fallback); }
function featureDisabled(env, enabled) { return enabled ? "!!js process['env']." + env + " === 'off'" : "!!js process['env']." + env + " !== 'on'"; }
function shellCommand(item, suffix) {
  const executable = '(' + envLookup(item.pathEnv) + ' || ' + JSON.stringify(item.defaultCommand) + ')';
  return "!!js (process.platform === 'win32' && (" + executable + " + ' " + suffix + "')) || ('exec ' + " + executable + " + ' " + suffix + "')";
}
export function renderPatch(inputAnswers) {
  const a = normalizeAnswers(inputAnswers);
  const shell = "!!js (process.platform === 'win32' && 'cmd') || 'sh'";
  const flag = "!!js (process.platform === 'win32' && '/c') || '-c'";
  const opencodeDefault = shellCommand(a.cli.opencode, 'acp').replace('!!js ', '');
  const opencode = "!!js process['env'].PTC_OPENCODE_ACP || (" + opencodeDefault + ')';
  const cursorDefault = shellCommand(a.cli.cursor, '--model auto acp').replace('!!js ', '');
  const cursor = "!!js process['env'].PTC_CURSOR_ACP || (" + cursorDefault + ')';
  const kimiCommand = jsEnv(a.cli.kimi.pathEnv, a.cli.kimi.defaultCommand);
  const noProxySource = envLookup(a.proxy.noProxyEnv);
  const noProxy = a.proxy.keepCursorProxy
    ? '!!js ' + noProxySource + " || 'localhost,127.0.0.1,::1'"
    : '!!js (' + noProxySource + " || '').split(',').concat('cursor.sh').filter(Boolean).join(',')";
  const proxyEnv = a.proxy.enabled ? [
    '      HTTPS_PROXY: !!js ' + envLookup(a.proxy.urlEnv) + " || ''",
    '      https_proxy: !!js ' + envLookup(a.proxy.urlEnv) + " || ''"
  ] : [];
  return [
    '# Generated by generate-ptc-companion.mjs. Keep this file in a local never-sync directory.',
    '# Apply after the generated dsh-bundle. Values are defaults plus environment-variable references.', '',
    '- id: subagent-acp-opencode-dsv41', "  name: '@deepseek-ai/dsh-subagent-acp'", '  disabled: ' + featureDisabled('PTC_FEATURE_OPENCODE', a.features.opencode),
    '  config:', '    providerName: opencode-dsv41', '    command: ' + shell, '    args:', '      - ' + flag, '      - ' + opencode,
    '    permission: allow', '    env:', '      OPENCODE_CONFIG_CONTENT: ' + jsEnv('PTC_OPENCODE_CONFIG_CONTENT', JSON.stringify({ model: 'ais1dsglm/' + a.provider.executeModel })), ...proxyEnv, '',
    '- id: subagent-acp-kimi-docs', "  name: '@deepseek-ai/dsh-subagent-acp'", '  disabled: ' + featureDisabled('PTC_FEATURE_KIMI_DOCS', a.features.kimiDocs),
    '  config:', '    providerName: kimi-docs', '    command: ' + kimiCommand, '    args:', "      - '--model'", '      - ' + jsEnv('PTC_KIMI_DOCS_MODEL', a.provider.docsModel), '      - acp',
    '    permission: allow', ...(a.proxy.enabled ? ['    env:', ...proxyEnv] : []), '',
    '- id: subagent-acp-cursor-grok', "  name: '@deepseek-ai/dsh-subagent-acp'", '  disabled: ' + featureDisabled('PTC_FEATURE_CURSOR', a.features.cursor),
    '  config:', '    providerName: cursor-grok', '    command: ' + shell, '    args:', '      - ' + flag, '      - ' + cursor,
    '    permission: allow', '    env:', '      no_proxy: ' + noProxy, ...proxyEnv, '',
    '- id: subagent-claude-opus5-plan', "  name: '@deepseek-ai/dsh-subagent-claude-code'", '  disabled: ' + featureDisabled('PTC_FEATURE_CLAUDE_PLAN', a.features.claudePlan),
    '  config:', '    providerName: claude-opus5-plan', '    model: ' + jsEnv('PTC_CLAUDE_DESIGN_MODEL', a.provider.designModel), '    permissionMode: plan', '',
    '- id: subagent-claude-opus48-plan', "  name: '@deepseek-ai/dsh-subagent-claude-code'", '  disabled: ' + featureDisabled('PTC_FEATURE_CLAUDE_PLAN', a.features.claudePlan),
    '  config:', '    providerName: claude-opus48-plan', '    model: ' + jsEnv('PTC_CLAUDE_FALLBACK_MODEL', a.provider.designFallbackModel), '    permissionMode: plan', ''
  ].join('\n');
}
export function renderRuntimeConfig(inputAnswers) {
  const a = normalizeAnswers(inputAnswers);
  return {
    schema_version: RUNTIME_SCHEMA,
    controller: { provider: a.provider.controller, model: a.provider.controllerModel, effort: a.provider.controllerEffort, fallbackProvider: a.provider.fallbackProvider, fallbackModel: a.provider.fallbackModel },
    execute: { provider: a.provider.executeProvider, model: a.provider.executeModel },
    docs: { provider: a.provider.docsProvider, model: a.provider.docsModel },
    design: { model: a.provider.designModel, fallbackModel: a.provider.designFallbackModel }
  };
}
export function renderBundle(inputAnswers) {
  const a = normalizeAnswers(inputAnswers);
  const source = readFileSync(join(templateRoot, 'dsh-bundle', 'cordis.patch.yml'), 'utf8');
  const marker = /provider: codex-relay\r?\n\s+model: gpt-5\.6-sol\r?\n\s+reasoningEffort: high/;
  if (!marker.test(source)) throw new Error('public DSH bundle controller marker is missing');
  return source.replace(marker, 'provider: ' + a.provider.controller + '\n                    model: ' + a.provider.controllerModel + '\n                    reasoningEffort: ' + a.provider.controllerEffort);
}
function renderConfig(inputAnswers) {
  const a = normalizeAnswers(inputAnswers);
  return { schema_version: COMPANION_SCHEMA, generated_by: 'dsh-config-pack/scripts/generate-ptc-companion.mjs', skill_version: SKILL_VERSION, privacy: { credentials: 'not-collected', paths: 'environment-variable-names-only', never_sync: true }, providers: a.provider, cli: a.cli, proxy: a.proxy, features: a.features };
}
function renderEnvExample(inputAnswers) {
  const a = normalizeAnswers(inputAnswers);
  const lines = ['# Variable names selected by the public PTC questionnaire. Values stay local.', '# Executable paths are optional; command-name fallbacks are used when blank.'];
  for (const key of CLI_KEYS) lines.push(a.cli[key].pathEnv + '=');
  lines.push('', '# Proxy source variables. The generator never asks for or writes proxy URL values.', a.proxy.urlEnv + '=', a.proxy.noProxyEnv + '=', '', '# Optional runtime overrides supported by the DSH bundle.', 'PTC_OPENCODE_CONFIG_CONTENT=', 'PTC_CURSOR_ACP=', 'PTC_KIMI_DOCS_MODEL=', 'PTC_CLAUDE_DESIGN_MODEL=', 'PTC_CLAUDE_FALLBACK_MODEL=', 'PTC_FEATURE_OPENCODE=', 'PTC_FEATURE_KIMI_DOCS=', 'PTC_FEATURE_CURSOR=', 'PTC_FEATURE_CLAUDE_PLAN=', 'PTC_FEATURE_PRESENTATION=', '# Optional self-provider switch; set to on only when the target profile lacks a bundle that provides agentPresets.', 'PTC_PROVIDE_PRESET_REGISTRY=', '');
  return [...new Set(lines)].join('\n');
}
function renderReadme() {
  return [
    '# Local PTC companion', '',
    'This complete public companion is generated for one machine and is deny-listed from Git by default.', '',
    '- Install dsh-bundle/ into the target DSH profile with the documented ACP and Claude packages.',
    '- Copy or link ptc-multi-agent-control/ to ~/.agents/skills/ptc-multi-agent-control.',
    '- Apply ptc.local.patch.yml after the generated bundle.',
    '- ptc.local.json records non-secret settings; ptc.env.example contains variable names with blank values.',
    '- companion.manifest.json maps every questionnaire field to a consuming artifact.', '',
    '## Prerequisites', '',
    'The PTC preset needs the agentPresets service. If the target profile has no bundle that provides it',
    '(for example a headless profile without dsh-web-app), set PTC_PROVIDE_PRESET_REGISTRY=on before starting',
    'DSH so the companion bundle supplies its own ptc-agent-preset-registry row. Do not enable it in a profile',
    'that already ships dsh-web-app, to avoid a duplicate provider.', '',
    'The service alone does not deliver the tool surface. A preset is composed only for a session that selects it,',
    'and the one-shot headless runner refuses preset sessions (dsh-headless: "which the one-shot runner does not',
    'compose"), so a one-shot headless run keeps the base tool set. Exercise the PTC tools from a',
    'preset-selecting client session (web/tui).', '',
    'Check the composed profile with:', '',
    '~~~powershell',
    'dsh --profile <profile> --dump-config | Select-String "dsh-agent-preset-registry"',
    '~~~', '',
    'Authentication stays in DSH providers or CLI login stores. Shared archives are a separate manual workflow. The generator does not collect either.', ''
  ].join('\n');
}
function renderManifest(inputAnswers) {
  normalizeAnswers(inputAnswers);
  const fieldConsumption = JSON.parse(readFileSync(join(templateRoot, 'consumption-map.json'), 'utf8'));
  return {
    schema_version: 'ptc-public-companion-manifest/v1', skill_version: SKILL_VERSION,
    artifacts: [...GENERATED_ARTIFACTS, '.ptc-generation.json'],
    field_consumption: fieldConsumption.fields,
    prerequisites: {
      profileServices: ['agentPresets'],
      optionalSelfProvider: 'ptc-agent-preset-registry',
      enableEnv: 'PTC_PROVIDE_PRESET_REGISTRY',
      verifyCommand: 'dsh --profile <profile> --dump-config | Select-String "dsh-agent-preset-registry"'
    },
    unsupported: [
      'credential names or values: configure authentication in DSH providers and CLI login stores',
      'shared-source paths or hashes: verify and extract shared archives manually before generation',
      'codex/claude/node executable overrides: their DSH adapters do not expose a portable command setting here',
      'ACP task timeouts: the supported DSH ACP configuration has no portable task-timeout field',
      'retry count: policy is fixed to one retry for transport failures only'
    ],
    clean_profile_verified: false
  };
}
function generatedFiles(answers) {
  return {
    'ptc.local.json': JSON.stringify(renderConfig(answers), null, 2) + '\n',
    'ptc.local.patch.yml': renderPatch(answers),
    'ptc.env.example': renderEnvExample(answers),
    'companion.manifest.json': JSON.stringify(renderManifest(answers), null, 2) + '\n',
    'README.md': renderReadme(),
    '.gitignore': '# Generated PTC companion; never sync local output.\n*\n!.gitignore\n!README.md\n'
  };
}
function copyArtifact(source, target) { mkdirSync(dirname(target), { recursive: true }); cpSync(source, target, { recursive: true, force: true }); }
function writeSet(outDir, answers) {
  mkdirSync(outDir, { recursive: true });
  for (const name of GENERATED_ARTIFACTS) rmSync(join(outDir, name), { recursive: true, force: true });
  for (const [name, content] of Object.entries(generatedFiles(answers))) writeFileSync(join(outDir, name), content, 'utf8');
  copyArtifact(join(templateRoot, 'dsh-bundle'), join(outDir, 'dsh-bundle'));
  writeFileSync(join(outDir, 'dsh-bundle', 'cordis.patch.yml'), renderBundle(answers), 'utf8');
  copyArtifact(join(templateRoot, 'ptc-multi-agent-control'), join(outDir, 'ptc-multi-agent-control'));
  writeFileSync(join(outDir, 'ptc-multi-agent-control', 'assets', 'public-runtime-config.json'), JSON.stringify(renderRuntimeConfig(answers), null, 2) + '\n', 'utf8');
  const metadata = { schema_version: COMPANION_SCHEMA, skill_version: SKILL_VERSION, artifacts: [...GENERATED_ARTIFACTS, '.ptc-generation.json'] };
  writeFileSync(join(outDir, '.ptc-generation.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
}
function existingArtifacts(outDir) {
  const metadataPath = join(outDir, '.ptc-generation.json');
  if (existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      if (Array.isArray(metadata.artifacts)) return metadata.artifacts.filter((name) => typeof name === 'string' && basename(name) === name);
    } catch {}
  }
  return [...GENERATED_ARTIFACTS, '.ptc-generation.json'].filter((name) => existsSync(join(outDir, name)));
}
function backupExisting(outDir) {
  const artifacts = existingArtifacts(outDir);
  if (!artifacts.length) return null;
  const rollbackDir = join(outDir, '.ptc-rollback');
  mkdirSync(rollbackDir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(rollbackDir, id);
  mkdirSync(target, { recursive: true });
  const copied = [];
  for (const name of artifacts) {
    const source = join(outDir, name);
    if (existsSync(source)) { copyArtifact(source, join(target, name)); copied.push(name); }
  }
  writeFileSync(join(rollbackDir, 'latest.json'), JSON.stringify({ id, artifacts: copied }, null, 2) + '\n', 'utf8');
  return id;
}
export function rollback(outDir) {
  const rollbackDir = join(outDir, '.ptc-rollback');
  const latestPath = join(rollbackDir, 'latest.json');
  if (!existsSync(latestPath)) throw new Error('no generated backup exists for rollback');
  const latest = JSON.parse(readFileSync(latestPath, 'utf8'));
  if (typeof latest.id !== 'string' || basename(latest.id) !== latest.id || !/^[A-Za-z0-9._-]+$/.test(latest.id)) throw new Error('rollback metadata contains an unsafe backup id');
  const sourceRoot = resolve(rollbackDir, latest.id);
  if (resolve(dirname(sourceRoot)) !== resolve(rollbackDir) || !existsSync(sourceRoot)) throw new Error('rollback backup directory is missing or outside output directory');
  for (const name of [...GENERATED_ARTIFACTS, '.ptc-generation.json']) rmSync(join(outDir, name), { recursive: true, force: true });
  for (const name of latest.artifacts || []) {
    if (typeof name !== 'string' || basename(name) !== name) throw new Error('rollback metadata contains an unsafe artifact name');
    const source = join(sourceRoot, name);
    if (existsSync(source)) copyArtifact(source, join(outDir, name));
  }
  return latest.id;
}
async function promptAnswers() {
  const rl = createInterface({ input, output });
  const ask = async (label, fallback) => { const answer = await rl.question(label + ' [' + fallback + '] (Enter=default, skip=default): '); return answer.trim() === '' || answer.trim().toLowerCase() === 'skip' ? fallback : answer.trim(); };
  const bool = async (label, fallback) => (await ask(label, fallback ? 'on' : 'off')).toLowerCase() === 'on';
  try {
    const result = { provider: {}, cli: {}, proxy: {}, features: {} };
    for (const key of PROVIDER_KEYS) result.provider[key] = await ask('Provider ' + key, DEFAULTS.provider[key]);
    for (const key of CLI_KEYS) result.cli[key] = { pathEnv: await ask('CLI ' + key + ' executable path environment variable name', DEFAULTS.cli[key].pathEnv), defaultCommand: await ask('CLI ' + key + ' command-name fallback', DEFAULTS.cli[key].defaultCommand) };
    result.proxy.enabled = await bool('Use a proxy for ACP child processes', DEFAULTS.proxy.enabled);
    result.proxy.urlEnv = await ask('Proxy URL environment variable name', DEFAULTS.proxy.urlEnv);
    result.proxy.noProxyEnv = await ask('No-proxy environment variable name', DEFAULTS.proxy.noProxyEnv);
    result.proxy.keepCursorProxy = await bool('Keep Cursor on the proxy', DEFAULTS.proxy.keepCursorProxy);
    for (const key of FEATURE_KEYS) result.features[key] = await bool('Enable feature ' + key, DEFAULTS.features[key]);
    const regenerate = await rl.question('Generate with these answers? [Y/n]: ');
    if (regenerate.trim().toLowerCase() === 'n') throw new Error('interactive generation cancelled');
    return result;
  } finally { rl.close(); }
}
function parseArgs(argv) {
  const out = { overwrite: false, dryRun: false, interactive: false, rollback: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') out.out = argv[++i]; else if (arg === '--answers') out.answers = argv[++i]; else if (arg === '--interactive' || arg === '-i') out.interactive = true;
    else if (arg === '--overwrite') out.overwrite = true; else if (arg === '--dry-run') out.dryRun = true; else if (arg === '--rollback') out.rollback = true;
    else if (arg === '--help' || arg === '-h') out.help = true; else throw new Error('unknown argument: ' + arg);
  }
  return out;
}
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log('Usage: node scripts/generate-ptc-companion.mjs [--answers file.json|inline-json] [--interactive] [--out dir] [--dry-run] [--overwrite] [--rollback]'); return 0; }
  const outDir = resolve(args.out || process.env.PTC_COMPANION_DIR || join(homedir(), '.dsh', 'ptc-companion'));
  if (args.rollback) { const restored = rollback(outDir); console.log(JSON.stringify({ action: 'rollback', output: outDir, restored }, null, 2)); return 0; }
  const answers = args.interactive ? await promptAnswers() : loadAnswers(args.answers);
  const normalized = normalizeAnswers(answers);
  const summary = { action: args.dryRun ? 'dry-run' : 'generate', output: outDir, artifacts: [...GENERATED_ARTIFACTS, '.ptc-generation.json'], schema_version: COMPANION_SCHEMA, skill_version: SKILL_VERSION, secrets_written: false, credential_names_collected: false, clean_profile_verified: false };
  if (args.dryRun) { console.log(JSON.stringify(summary, null, 2)); return 0; }
  if (existingArtifacts(outDir).length && !args.overwrite) throw new Error('output already exists; pass --overwrite or use --rollback');
  summary.backup = args.overwrite ? backupExisting(outDir) : null;
  writeSet(outDir, normalized);
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main().catch((error) => { console.error('generate-ptc-companion: ' + error.message); process.exitCode = 1; });
