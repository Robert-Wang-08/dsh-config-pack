# Public PTC companion delivery

The public companion is a complete Git-delivered package. It does not require SkillHub. The template contains the full DSH bundle and a de-privatized ptc-multi-agent-control skill with route, ledger, model observation, ACP diagnostics, offline tests, schemas, and references.

## Generate

1. Copy templates/ptc-public-companion/answers.example.json to a local file outside Git, or run the generator with --interactive.
2. Preview with node scripts/generate-ptc-companion.mjs --answers <answers.json> --out <local-companion> --dry-run.
3. Generate with the same command without --dry-run.
4. Use --overwrite to regenerate. The previous complete artifact set, including both directories, is saved under .ptc-rollback/; use --rollback to restore it.

The output contains local settings, a local patch, a blank-value environment-name example, a field consumption manifest, the complete dsh-bundle/, and the complete ptc-multi-agent-control/ skill.

## Install

Copy or link <local-companion>/ptc-multi-agent-control to ~/.agents/skills/ptc-multi-agent-control. Install the generated DSH bundle and its profile-root dependencies:

~~~powershell
dsh plugin --profile <name> add <local-companion>/dsh-bundle   '@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2'   '@deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2'
~~~

Prerequisites measured on 2026-10-14 (see the acceptance report for evidence and repros):

1. The target profile needs a bundle that provides the `agentPresets` service. `@deepseek-ai/dsh-web-app` supplies
   it through its `agent-preset-registry` row; `@deepseek-ai/dsh-base` and the shipped `headless` template do not.
   A profile without it can supply the service from this companion by setting `PTC_PROVIDE_PRESET_REGISTRY=on`
   before startup, which activates the bundled `ptc-agent-preset-registry` row (`default: ptc-multi-agent`). Leave
   that switch off in a profile that already ships `dsh-web-app` to avoid a duplicate provider. Without either
   provider the companion's `preset-ptc-multi-agent` row stays pending and **all** PTC tools are absent while the
   session still boots normally.
2. The service alone is not enough: a preset is composed only for a session that selects it. Select
   “PTC 主多智能体主控（通用）” in the mode selector, or set `selectedDefault`. The one-shot headless runner
   refuses preset sessions altogether (`dsh-headless/lib/index.js`: "which the one-shot runner does not compose"),
   so a one-shot headless run keeps the base tool set even when the service is present. Exercise the PTC tool
   surface from a preset-selecting client session (web/tui).

Inspect whether the registry row is present in the composed profile with
`dsh --profile <profile> --dump-config | Select-String "dsh-agent-preset-registry"` (presence only; the dump does
not evaluate `!!js` and does not report activation failures).

Apply ptc.local.patch.yml as the final local profile layer and restart DSH. Defect D1 from the acceptance report is
fixed: the generated patch no longer wraps the executable name in quotes, and a real ACP subagent call through that
patch now returns normally (it previously exited at `initialize` with `'"opencode"' is not recognized`).

Confirming activation requires a real boot, not `--dump-config`: the dump neither evaluates `!!js` nor reports
`did not activate`. The preset persona requires the installed skill for full R1-R9 routing and ledger behavior.
If skill loading fails, the persona explicitly degrades to manual coordination and must not claim full PTC capability.

## Field support boundary

Every schema leaf has an entry in consumption-map.json, and the verifier requires exact coverage. Retained fields affect the generated bundle, runtime route configuration, local patch, or environment-name example.

The questionnaire intentionally omits credential names and values, shared-source paths and hashes, codex/Claude/node executable overrides, ACP task timeouts, and retry counts. Authentication remains in DSH providers and CLI stores; shared archives are verified and extracted manually; the adapters do not expose the omitted portable settings; retry policy is fixed to one retry for classified transport failures only. Unknown or removed fields are rejected rather than silently stored.

`acpPlugin` is the one field that decides which plugin the three ACP provider rows load. `upstream`
(`@deepseek-ai/dsh-subagent-acp`, the default) declares no timeout field at all; `resilient`
(`@local/dsh-subagent-acp-resilient`, currently a private Git repository) adds the graded timeout ladder, emitted
as `PTC_ACP_<UPPER_SNAKE_FIELD_NAME>` environment overrides with the plugin's documented defaults. The name and
the ladder are always emitted together, because DSH's plugin config schema passes unknown keys through and the
ladder under the upstream plugin is silently inert — no error, no effect. The public default therefore stays on
`upstream`, no timeout value is ever collected as an answer, and no public artifact hard-depends on the private
repository. See `../templates/ptc-public-companion/README.md` for the ladder's coherence rules.

## Other delivery channels

An organization may distribute a separately approved archive after independent SHA256 verification. Internal users may also use an independently managed private channel, but that channel is optional and is not the source of the public Git template. No credential stores, CLI auth state, sessions, local ledgers, or personal paths may be copied into this repository.

## Verification and limitation

Run npm test and npm run verify for offline behavior and static privacy/contract checks.

A clean-profile end-to-end acceptance was executed on 2026-10-14 in an isolated `ptc-clean-test` profile
(shipped `headless` template, no web-profile plugins). Result: **not passed.** Generation, skill installation,
bundle registration, and `--dump-config` all succeeded, and two of the three ACP routes (`kimi-docs`,
`opencode-dsv41`) completed real ACP sessions; but applying the generated `ptc.local.patch.yml` as the final
layer breaks the ACP spawn on Windows, and that run predates the opt-in `ptc-agent-preset-registry` row, so its
`headless` profile (no bundle providing `agentPresets`) never activated the PTC preset and none of the PTC tools
appeared. The companion bundle can now supply that service by setting `PTC_PROVIDE_PRESET_REGISTRY=on`. Full
evidence, minimal reproductions, and recommended fixes:
[`ptc-public-companion-acceptance-20261014.md`](ptc-public-companion-acceptance-20261014.md).

Two acceptance-procedure corrections from the same run: `dsh --dump-config` does **not** evaluate `!!js`
scalars (it prints the composed patch tree) and does **not** report activation failures, so "run a dump and look
for `did not activate`" is not a valid activation check — only a real boot is. Also note that selecting the PTC
preset requires an interactive profile (the registry default is `standard`); unattended/headless profiles cannot
select it.
