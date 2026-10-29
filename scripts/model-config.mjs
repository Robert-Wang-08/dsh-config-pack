// Only inspect the official provider block; no credentials are read or evaluated.
export function officialModelProblems(text) {
  const row = text.match(/^- id: llm-pi-ai\s*$[\s\S]*?(?=^- (?:id|insert):|$(?![\s\S]))/m)?.[0] || '';
  const official = row.match(/^      openai-codex:\s*$[\s\S]*?(?=^      [A-Za-z0-9_-]+:|$(?![\s\S]))/m)?.[0] || '';
  const model = official.match(/^          - id: gpt-6\.1-sol\s*$[\s\S]*?(?=^          - id:|$(?![\s\S]))/m)?.[0] || '';
  const problems = [];
  if (!model) problems.push('openai-codex must explicitly declare gpt-6.1-sol; host catalogs differ across devices');
  else for (const field of ['contextWindow','maxTokens','input','reasoningEfforts']) {
    if (!new RegExp('^            '+field+':','m').test(model)) problems.push('openai-codex/gpt-6.1-sol missing metadata: '+field);
  }
  if (/^        (api|baseURL|apiKeyEnv):/m.test(official)) problems.push('openai-codex must retain built-in OAuth transport without api/baseURL/apiKeyEnv overrides');
  return problems;
}
export function installConfigProblems(shadow,dump,composed) {
  const problems=[];
  if (shadow.code !== 0) problems.push('profile shadows pack rows or failed validation; inspect verify.mjs --profile');
  if (dump.code !== 0) problems.push('dsh --dump-config failed');
  if (/did not activate|patch: entry .* not found/.test(dump.err||'')) problems.push('DSH reported inactive entries or missing patch targets');
  if (composed.code !== 0 || composed.dangling === null || composed.dangling > 0) problems.push('composed config validation failed or reported dangling providers');
  problems.push(...officialModelProblems(dump.out||''));
  return problems;
}
