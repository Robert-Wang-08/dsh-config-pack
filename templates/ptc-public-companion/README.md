# Public PTC companion template

This Git template is a complete, SkillHub-independent public delivery. It contains a de-privatized `ptc-multi-agent-control/` skill, its route and ledger scripts, tests/assets/references, and the full `dsh-bundle/`. No credentials, CLI login state, personal absolute paths, session history, or private source metadata are included.

Copy `answers.example.json` to a local file outside Git, edit only supported non-secret settings, then run:

```powershell
node scripts/generate-ptc-companion.mjs --answers <answers.json> --out <local-companion>
```

The generated directory contains local settings, a local patch, an environment-name example, a field consumption manifest, the complete DSH bundle, and the complete PTC skill. Copy or link `<local-companion>/ptc-multi-agent-control` to `~/.agents/skills/ptc-multi-agent-control`; install `<local-companion>/dsh-bundle` with the required ACP and Claude packages; then apply `ptc.local.patch.yml` as the final profile layer. Public PTC does not require SkillHub.

The generator intentionally does not collect credential fields, shared-source fields, codex/claude/node executable overrides, ACP task timeouts, or retry counts. Authentication stays in providers/CLI stores, shared archives remain manual, unsupported adapter settings are not promised, and transport retry is a fixed skill policy.

A clean-profile end-to-end acceptance of this public companion was executed on 2026-10-14. It found and fixed two
blocking defects (the generated `ptc.local.patch.yml` Windows ACP quoting, and the missing `agentPresets`
provider); after the fixes the generated patch drives a real ACP subagent call successfully and `--dump-config`
with that patch reports no unresolved patch targets. See
`../../docs/ptc-public-companion-acceptance-20261014.md` for evidence, the remaining limitations, and the
one-shot headless constraint below.

The PTC preset also needs the `agentPresets` service. A profile without a bundle that provides it (for example a
headless profile without `@deepseek-ai/dsh-web-app`) can supply it from this companion by setting
`PTC_PROVIDE_PRESET_REGISTRY=on` before startup, which activates the bundled `ptc-agent-preset-registry` row
(`default: ptc-multi-agent`). Do not enable that switch in a profile that already ships `dsh-web-app`, to avoid a
duplicate provider. Inspect the composed profile for the row with
`dsh --profile <profile> --dump-config | Select-String "dsh-agent-preset-registry"`.

The service alone does not deliver the tool surface: a preset is only composed for a session that selects it, and the
one-shot headless runner refuses preset sessions outright (`dsh-headless`: "which the one-shot runner does not
compose"). Use a preset-selecting client session (web/tui) to exercise the PTC tools; a one-shot headless run keeps
the base tool set even with the service present.
See `../../docs/ptc-public-companion-acceptance-20261014.md` before using this template.
