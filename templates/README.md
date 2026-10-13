# Device-Specific Template

Git publishes the portable DSH package. This directory contains only templates for values that vary by device.

1. Copy `device-config.env.example` to a personal file outside this repository.
2. Store that personal file through the private SkillHub channel used for directory mappings, key pointers, and environment-variable declarations.
3. Replace placeholders with this device's paths, route ids, and non-secret preferences.
4. Export those values into the User environment, then restart DSH.

PowerShell example for one value:

```powershell
[Environment]::SetEnvironmentVariable('DSHPACK_ROUTE_OPENCODE', 'opencodego', 'User')
```

The template records key **pointers** such as `CRS_OAI_KEY`, not raw key values. Raw credentials remain in the OS environment or `%USERPROFILE%/.dsh/.credentials.yaml` and must not be committed or placed in the public Git package.
