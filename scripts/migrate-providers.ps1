# Explicit migration entry, used by setup/install/update. No credential values are read.
[CmdletBinding()]
param([string]$ProfileName = 'packed', [string]$InputDir = '', [switch]$DryRun, [switch]$Check)
$ErrorActionPreference = 'Stop'
if ($ProfileName -notmatch '^[A-Za-z0-9_.-]+$' -or $ProfileName -in @('.', '..')) { throw 'Invalid profile name' }
$userDir = $env:USERPROFILE
if (-not $userDir) { $userDir = [Environment]::GetFolderPath('UserProfile') }
$dshDir = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $userDir '.dsh' }
$profileDir = Join-Path (Join-Path $dshDir 'profiles') $ProfileName
$deviceDir = Join-Path $dshDir 'device'
$script = Join-Path $PSScriptRoot 'migrate-provider-config.mjs'
# User < Process < device.env < device-answers.json < cordis.local.yml.
$saved = @{}
try {
    foreach ($suffix in @('CODEX_RELAY','AIS','ANTHROPIC_RELAY','KIMI','OPENCODE')) {
        foreach ($kind in @('BASE','KEY')) {
            $key = 'DSHPACK_' + $kind + '_' + $suffix
            $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            if (-not $saved[$key]) {
                $value = [Environment]::GetEnvironmentVariable($key, 'User')
                if ($value) { [Environment]::SetEnvironmentVariable($key, $value, 'Process') }
            }
        }
    }
    $migrationArgs = @($script, '--profile-dir', $profileDir, '--device-dir', $deviceDir)
    if ($InputDir) { $migrationArgs += @('--input-dir', $InputDir) }
    if ($DryRun) { $migrationArgs += '--dry-run' }
    if ($Check) { $migrationArgs += '--check' }
    & node @migrationArgs
    if ($LASTEXITCODE -ne 0) { throw 'Provider migration failed; no silent fallback is allowed. Install package dependencies (including yaml) and inspect the error above.' }
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
