// Only inspect the official provider block; no credentials are read or evaluated.
export function officialModelProblems(text) {
  const row = text.match(/^- id: llm-pi-ai\s*$[\s\S]*?(?=^- (?:id|insert):|$(?![\s\S]))/m)?.[0] || '';
  const official = row.match(/^      openai-codex:\s*$[\s\S]*?(?=^      [A-Za-z0-9_-]+:|$(?![\s\S]))/m)?.[0] || '';
  const model = official.match(/^          - id: gpt-6\.1-sol\s*$[\s\S]*?(?=^          - id:|$(?![\s\S]))/m)?.[0] || '';
  const problems = [];
  if (!model) problems.push('openai-codex must explicitly declare gpt-6.1-sol; host catalogs differ across devices');
  else {
    for (const field of ['contextWindow','maxTokens','input','reasoningEfforts']) {
      if (!new RegExp('^            '+field+':','m').test(model)) problems.push('openai-codex/gpt-6.1-sol missing metadata: '+field);
    }
    // An `off` level is what makes DSH drop the key from thinkingLevelMap, after which pi-ai's
    // responses adapter falls back to `effort: "none"` for a request that names no level. The
    // ChatGPT backend behind gpt-6.1-sol only accepts low/medium/high/xhigh/max, so that request
    // fails the whole turn with `Unsupported value: 'none'`. Omit the key: DSH then pins off to
    // null and dispatch sends no reasoning field at all.
    if (/^            reasoningEfforts:.*\boff\s*:/m.test(model))
      problems.push('openai-codex/gpt-6.1-sol must not declare an off reasoning level — DSH drops it and pi-ai sends effort "none", which the model rejects (omit the key so dispatch sends no reasoning field)');
  }
  if (/^        (api|baseURL|apiKeyEnv):/m.test(official)) problems.push('openai-codex must retain built-in OAuth transport without api/baseURL/apiKeyEnv overrides');
  return problems;
}
// Every exact provider/model route in the subagent selection whitelist must appear once: the Host
// validates the recorded policy on each Session composition and throws on a repeat, so a duplicated
// entry fails every *new* Session while already-composed ones keep working.
export function selectionProblems(text) {
  const row = text.match(/^- id: subagent-model-selection-settings\s*$[\s\S]*?(?=^- (?:id|insert):|$(?![\s\S]))/m)?.[0] || '';
  if (!row) return [];
  const seen = new Map();
  const dups = [];
  let provider;
  for (const line of row.split('\n')) {
    const p = /^\s*-\s*provider:\s*(\S+)\s*$/.exec(line);
    if (p) { provider = p[1]; continue; }
    const m = /^\s*model:\s*(\S+)\s*$/.exec(line);
    if (!m) continue;
    if (provider === undefined) continue;
    const route = provider + '/' + m[1];
    if (seen.has(route)) dups.push(route);
    else seen.set(route, true);
  }
  return [...new Set(dups)].map(
    (route) => `subagent-model-selection-settings.allowedModels repeats route "${route}" — the Host rejects the policy and every new Session fails to compose; keep one entry per exact route`
  );
}
export function installConfigProblems(shadow,dump,composed) {
  const problems=[];
  if (shadow.code !== 0) problems.push('profile shadows pack rows or failed validation; inspect verify.mjs --profile');
  if (dump.code !== 0) problems.push('dsh --dump-config failed');
  if (/did not activate|patch: entry .* not found/.test(dump.err||'')) problems.push('DSH reported inactive entries or missing patch targets');
  if (composed.code !== 0 || composed.dangling === null || composed.dangling > 0) problems.push('composed config validation failed or reported dangling providers');
  problems.push(...officialModelProblems(dump.out||''));
  problems.push(...selectionProblems(dump.out||''));
  return problems;
}
