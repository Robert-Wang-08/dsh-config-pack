# PTC companion privacy audit

Audit basis: the public template was derived from the read-only PTC skill interface and then stripped of private distribution metadata, personal author data, local paths, caches, credentials, sessions, and machine-specific state. The public source of truth is Git dsh-config-pack.

## Public assets

The template includes a complete skill and DSH bundle. delegated-contract.json freezes one preset id, five provider rows, five tool bindings, and one presentation row. Verification requires exactly 12 unique ids in contract order and asserts that the top-level bundle and the skill bundled copy are identical.

The skill frontmatter, skill.json, and both bundle package files use version 1.0.0; management/source metadata is git / dsh-config-pack. SkillHub-only source metadata, personal author metadata, and __pycache__ are forbidden.

## Field consumption

The answer schema retains only fields with a concrete consumer. consumption-map.json maps every schema leaf to one or more generated targets, and the verifier requires an exact set match. Controller/fallback/execute/docs/design routing values feed the skill runtime config; controller settings also feed the bundle; ACP CLI, proxy, model, and feature settings feed the local patch; selected environment-variable names feed the blank env example.

Removed fields are rejected:

| Removed surface | Reason |
| --- | --- |
| Credential environment-variable names and values | Authentication is owned by DSH providers and CLI stores; accepting names created a false configuration surface. |
| Shared source path/hash | Archive verification and extraction are manual; the generator does not consume or attest an archive. |
| codex/Claude/node executable paths | No portable consumer exists in the corresponding adapters. |
| ACP startup/idle/absolute task timeouts | The supported ACP adapter has no portable task-timeout fields. |
| Configurable transport retry | Retry is a fixed policy: classified transport failures only, once. |

## Automated controls

Templates and generated output are scanned for personal absolute paths, credential-shaped literals, private source metadata, and Python caches. Unknown fields are rejected. Overwrite backs up and rollback restores both directory artifacts, with a relative backup id rather than an absolute local path. Tests execute route, ledger, and ACP diagnostic offline suites, assert version parity and complete scripts, exercise customized route consumption, and check the 12 delegated ids for uniqueness.

## Residual limits

Pattern scanning cannot prove arbitrary free text is non-sensitive. Review custom provider/model and command names before publication. The scripts never read or validate real credentials. A clean-profile end-to-end install of this public companion is not yet verified; plugin activation and evaluated !!js behavior still require that acceptance test.
