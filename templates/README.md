# Device-Specific Templates

Git publishes the portable DSH package and its public PTC companion. This directory contains only templates and non-secret defaults.

## Public PTC companion

ptc-public-companion/ is the complete SkillHub-independent path. Its questionnaire produces supported non-secret answers; the generator writes local settings, a local patch, an env-name example, a consumption manifest, the full DSH bundle, and the full PTC skill to a user-selected directory with a deny-by-default .gitignore.

Copy or link the generated skill to ~/.agents/skills/ptc-multi-agent-control, install the generated bundle with its profile-root ACP/Claude dependencies, and apply the local patch last. The generator never asks for credential fields or shared paths.

## Device environment template

1. Copy device-config.env.example to a personal file outside this repository.
2. Replace placeholders with this device paths, route ids, and non-secret preferences.
3. Export those values into the User environment, then restart DSH.

The template records key pointers such as CRS_OAI_KEY, not raw key values. Raw credentials remain in the OS environment or the local DSH credential store and must not be committed.
