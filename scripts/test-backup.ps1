# Synthetic data only. WorkRoot must not be a live DSH home.
param([string]$WorkRoot=(Join-Path (Split-Path $PSScriptRoot -Parent) '.release-tmp'))
$ErrorActionPreference='Stop'
$caseRoot=Join-Path $WorkRoot ('backup-test-'+[guid]::NewGuid().ToString('N'))
$fixture=Join-Path $caseRoot 'home'
$backup=Join-Path $PSScriptRoot 'backup.ps1'
function Put([string]$Rel,[string]$Text) {
  $target=Join-Path $fixture $Rel
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  [IO.File]::WriteAllText($target,$Text)
}
function Check([bool]$Condition,[string]$Message) { if(-not $Condition){throw $Message} }
Put 'profiles/test/cordis.yml' '- id: base'
Put 'profiles/test/cordis.patch.yml' "Authorization: !!js process.env.TEST_POINTER ?? ''"
Put 'profiles/test/package.json' '{"dependencies":{"local-plugin":"link:D:/src/plugin"},"dsh":{"profile":{"bundles":["local-plugin"]}}}'
Put 'profiles/test/pnpm-lock.yaml' 'lockfileVersion: 9'
Put 'profiles/test/pnpm-workspace.yaml' 'blockExoticSubdeps: false'
Put 'profiles/test/compatibility.json' '{}'
Put 'profiles/test/patches/plugin.patch' '--- a/file.js'
Put 'device/device.env' 'DSHPACK_KEY_KIMI=MY_KIMI_KEY'
Put 'device/device-answers.json' '{"defaults":{"model":"gpt-6.1-sol"}}'
Put '.agent-presets/custom.yml' 'name: custom'
Put 'plugins/other/settings.json' '{"enabled":true}'
Put 'plugins/provider-failover/route-config.json' '{"enabled":true}'
Put 'plugins/other/auth.json' '{"token":"fixture-not-real"}'
Put 'plugins/other/history.jsonl' 'fixture'
Put 'profiles/test/node_modules/ignored.json' '{}'
Put '.credentials.yaml' 'fixture: never-copy'
$oldDshHome=$env:DSH_HOME
try {
  $env:DSH_HOME=$fixture
  $outDir=Join-Path $caseRoot 'complete'
  & pwsh -NoProfile -File $backup -Profile test -Out $outDir
  Check ($LASTEXITCODE -eq 0) 'complete backup failed'
  $manifest=Get-Content (Join-Path $outDir 'manifest.json') -Raw | ConvertFrom-Json
  Check ($manifest.status -eq 'complete') 'wrong status'
  foreach($rel in @('profile/cordis.yml','profile/pnpm-lock.yaml','profile/compatibility.json','profile/patches/plugin.patch','device/device.env','device/device-answers.json','.agent-presets/custom.yml','plugins/other/settings.json')) {
    Check ($manifest.copied -contains $rel) ('missing: '+$rel)
    Check ((Get-FileHash (Join-Path $outDir $rel)).Hash -eq $manifest.sha256.$rel) ('hash mismatch: '+$rel)
  }
  Check (-not (Test-Path (Join-Path $outDir 'plugins/other/auth.json'))) 'auth copied'
  Check (-not (Test-Path (Join-Path $outDir '.credentials.yaml'))) 'credentials copied'
  $archive=[IO.Compression.ZipFile]::OpenRead($outDir+'.zip')
  try { Check (@($archive.Entries.FullName) -contains '.agent-presets/custom.yml') 'hidden preset missing from zip' } finally {$archive.Dispose()}
  # Round-trip every manifest item to a synthetic destination and verify bytes.
  foreach($rel in $manifest.copied) {
    $dest=Join-Path (Join-Path $caseRoot 'restored') $rel
    New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
    Copy-Item -LiteralPath (Join-Path $outDir $rel) $dest
    Check ((Get-FileHash $dest).Hash -eq $manifest.sha256.$rel) ('round-trip mismatch: '+$rel)
  }
  & pwsh -NoProfile -File $backup -Profile test -Out $outDir 2>&1 | Out-Null
  Check ($LASTEXITCODE -ne 0) 'existing output silently reused'
  Put 'plugins/other/settings.json' '{"accessToken":"fixture-not-real","api_key":"fixture-not-real"}'
  Put 'profiles/test/cordis.patch.yml' 'path: C:\Users\Fixture\private'
  $partial=Join-Path $caseRoot 'partial'
  & pwsh -NoProfile -File $backup -Profile test -Out $partial -NoZip
  Check ($LASTEXITCODE -eq 2) 'privacy rejection must return exit 2'
  $manifest=Get-Content (Join-Path $partial 'manifest.json') -Raw | ConvertFrom-Json
  Check ($manifest.status -eq 'partial') 'partial called complete'
  Check (-not (Test-Path (Join-Path $partial 'plugins/other/settings.json'))) 'secret copied'
  Check (-not (Test-Path (Join-Path $partial 'profile/cordis.patch.yml'))) 'personal path copied'
  Check ($manifest.rejected.Count -eq 2) 'missing rejection details'
  # A JS expression with an inline token fallback is not a pure env reference.
  Put 'profiles/test/cordis.patch.yml' "Authorization: !!js process.env.TEST_POINTER ?? 'fixture-inline-token'"
  & pwsh -NoProfile -File $backup -Profile test -Out (Join-Path $caseRoot 'inline-rejected') -NoZip
  Check ($LASTEXITCODE -eq 2) 'inline fallback bypassed privacy scan'
  Write-Host 'PASS: configuration/patch coverage, SHA256 round-trip, hidden ZIP entries, pure env refs, credential exclusion, partial status, output reuse refusal'
} finally {$env:DSH_HOME=$oldDshHome}
