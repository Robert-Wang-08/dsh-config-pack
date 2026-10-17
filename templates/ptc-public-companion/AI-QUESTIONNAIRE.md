# AI questionnaire for a public PTC companion

Ask exactly one question at a time. Accept `default`, an empty answer, or `skip` to use the documented default. Before final output, show a redacted summary and offer generate, revise one answer, or restart all questions.

Hard rules: never ask for or output credential names or values, tokens, passwords, private keys, login cookies, CLI auth files, shared-drive paths, or personal absolute paths. Authentication remains in DSH providers and CLI login stores. Shared archives are verified and extracted manually outside this generator. Output one `ptc-public-answers/v1` JSON object only after confirmation.

Question order:

1. Controller provider/model/effort: `codex-relay`, `gpt-5.6-sol`, `high`.
2. Fallback provider/model: `openai-codex`, `gpt-5.6-sol`.
3. Execution provider/model: `ais-2dsglm`, `deepseek-v4.1-flash`. Continuous-edit (R7) provider/model: `ais-2dsglm`, `glm-5.3-flash`; this tier runs as an in-process `subagent` route and no longer uses the Cursor/Grok ACP row.
4. Docs provider/model: `kimi-coding`, `kimi-code/k3-256k`.
5. Design routes: design provider/model `codex-relay`, `gpt-5.6-sol` (reasoning effort xhigh); Opus review ladder provider/model for the 5.5 tier `tokeniss`, `claude-opus-5-5`; the 5 tier `anthropic-relay`, `claude-opus-5`; the 4.8 tier `anthropic-relay`, `claude-opus-4-8`.
6. For opencode, cursor-agent, and kimi only, ask for an executable-path environment-variable name plus a safe command-name fallback. Never accept a path as the fallback.
7. Ask whether ACP child processes use a proxy, then proxy/no-proxy environment-variable names (`HTTPS_PROXY`, `NO_PROXY`) and whether Cursor keeps the proxy. Never ask for a proxy URL.
8. Ask which subagent plugin backs the three ACP provider rows: `resilient` (default, public Git dependency) or `upstream`. Never ask for timeout values: the resilient plugin's graded ladder is emitted as `PTC_ACP_<UPPER_SNAKE_FIELD>` environment overrides with the documented defaults, and upstream rows carry no ladder keys at all.
9. Ask toggles: OpenCode on, Kimi docs on, Cursor off, Claude plan reviews on, presentation on.
10. Validate and show only non-secret settings and environment-variable names, then offer generate, revise, or restart.

Do not add fields for credentials, shared sources, codex/claude/node executable paths, ACP task timeouts, or retry counts. Those surfaces are intentionally unsupported: provider/CLI authentication stays external; shared archives are manual; the adapters do not expose portable executable overrides or task timeouts here; retry policy is fixed to one retry for transport failures only. The `acpPlugin` answer is a plugin identity choice rather than a timeout field, and it only decides whether the three ACP rows use the upstream plugin (no timeout support) or the resilient plugin with its environment-driven ladder.

Pass the confirmed JSON to `node scripts/generate-ptc-companion.mjs --answers <answers.json> --out <local-companion>`.
