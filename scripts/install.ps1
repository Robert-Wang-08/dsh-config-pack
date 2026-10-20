<#
.SYNOPSIS
  一条命令把 dsh-config-pack 装进一个 DSH profile。

.DESCRIPTION
  这一步之前需要人工做的事，本脚本全部代做：
    1) profile 不存在时，从发行模板建一个；
    2) 在 profile 的 pnpm-workspace.yaml 里写好装本包必需的前置
       （blockExoticSubdeps: false、nodeLinker: hoisted、allowBuilds）；
    3) 只调一次 dsh plugin --profile <p> add <spec> —— 装包与注册 bundle 由 DSH 自己完成；
    4) 失败时按 pnpm 的错误码做**有界**自愈后重试（最多 3 次），而不是让你手工改配置再来一遍；
    5) 跑 `scripts/verify-install.mjs` —— 插件清单（核心+可选组）与配置的**偏差比较**：
       bundle 登记、shadowing、composed dangling、patch 对照一次完成；

  为什么必须先把前置写好：本包带 git 宿主依赖，pnpm 默认拒绝（ERR_PNPM_EXOTIC_SUBDEP），
  且在被显式允许前不跑其构建脚本（ERR_PNPM_IGNORED_BUILDS）。更关键的是：
  一旦第一次 add 失败，依赖其实已经落盘，再重试时 DSH 不会为新依赖登记 bundle，
  于是"装上了但整包不生效"——本脚本用一次成功的 add 规避这条路径。

  脚本只改 pnpm 配置，不改写 cordis.patch.yml。

.PARAMETER ProfileName
  目标 profile 名，默认 packed。

.PARAMETER Source
  包的来源 spec，默认本包已发布的不可变 tag。

.PARAMETER FromDefaultProfile
  profile 不存在时使用的发行模板，默认 web（PTC 工具面位于 preset 内，需要客户端预设选择能力）。

.PARAMETER Uninstall
  走 dsh plugin remove。

.EXAMPLE
  pwsh scripts/install.ps1
  pwsh scripts/install.ps1 -ProfileName mypack -Source github:Robert-Wang-08/dsh-config-pack#v0.6.0
#>
[CmdletBinding()]
param(
  [string]$ProfileName = 'packed',
  [string]$Source = 'github:Robert-Wang-08/dsh-config-pack#v0.9.2',
  [string]$FromDefaultProfile = 'web',
  [switch]$Uninstall,
  [switch]$NoVerify,
  [switch]$SkipOptional
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Fail([string]$m) { Write-Host ('FAIL  ' + $m) -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host ('ok    ' + $m) -ForegroundColor Green }
function Info([string]$m) { Write-Host ('      ' + $m) }
function Warn([string]$m) { Write-Host ('warn  ' + $m) -ForegroundColor Yellow }
function Step([string]$m) { Write-Host ('== ' + $m) -ForegroundColor Cyan }

if (-not (Get-Command dsh -ErrorAction SilentlyContinue))  { Fail 'dsh is not on PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node is not on PATH (needed to prepare the profile and to verify)' }

$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path (Join-Path $dshHome 'profiles') $ProfileName

Step 'dsh-config-pack'
Info ('profile    : ' + $ProfileName)
Info ('source     : ' + $Source)
Info ('profile dir: ' + $profileDir)
Write-Host ''

if ($Uninstall) {
  & dsh plugin --profile $ProfileName remove dsh-config-pack
  if ($LASTEXITCODE -ne 0) { Fail ('dsh plugin remove exited ' + $LASTEXITCODE) }
  Ok 'removed'
  Write-Host 'Note: rows this pack overrode now fall back to the next layer that declares them.'
  exit 0
}

# ---- 1. profile -------------------------------------------------------------
if (-not (Test-Path $profileDir)) {
  Step ('creating profile from shipped template "' + $FromDefaultProfile + '"')
  & dsh --profile $ProfileName --from-default-profile $FromDefaultProfile --dump-config | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail ('could not create profile ' + $ProfileName) }
  Ok 'profile created'
} else {
  Ok 'profile already exists'
}

# ---- 2. pnpm prerequisites --------------------------------------------------
Step 'preparing pnpm settings inside the profile'
& node (Join-Path $root 'scripts/prepare-profile.mjs') $profileDir
if ($LASTEXITCODE -ne 0) { Fail 'prepare-profile.mjs failed' }

# ---- 3. one add, with bounded self-repair -----------------------------------
$maxAttempts = 3
$installed = $false
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  Step ('installing (attempt ' + $attempt + ' of ' + $maxAttempts + ')')
  $out  = & dsh plugin --profile $ProfileName add $Source 2>&1
  $code = $LASTEXITCODE
  $text = ($out | Out-String)
  $out | Select-Object -Last 12 | ForEach-Object { Info $_ }
  if ($code -eq 0) { $installed = $true; break }
  if ($attempt -eq $maxAttempts) { break }

  if ($text -match 'ERR_PNPM_IGNORED_BUILDS') {
    $tokens = [regex]::Matches($text, '[A-Za-z0-9_@./-]+@[0-9][A-Za-z0-9_.-]*') |
      ForEach-Object { $_.Value } | Sort-Object -Unique
    if ($tokens.Count -eq 0) { Fail 'pnpm blocked build scripts but no package names could be parsed' }
    Warn ('pnpm blocked build scripts; allowing: ' + ($tokens -join ', '))
    & node (Join-Path $root 'scripts/prepare-profile.mjs') $profileDir --extra-builds ($tokens -join ',')
    if ($LASTEXITCODE -ne 0) { Fail 'prepare-profile.mjs failed while allowing builds' }
    continue
  }
  if ($text -match 'ERR_PNPM_EXOTIC_SUBDEP') {
    Warn 'pnpm rejected git-hosted subdependencies; re-applying prerequisites and retrying'
    & node (Join-Path $root 'scripts/prepare-profile.mjs') $profileDir
    if ($LASTEXITCODE -ne 0) { Fail 'prepare-profile.mjs failed' }
    continue
  }
  break
}
if (-not $installed) {
  Write-Host ''
  Fail ('dsh plugin add did not succeed. Logs: ' + (Join-Path $profileDir '.plugin-manager\logs'))
}
Ok 'dsh plugin add succeeded'

# ---- 4. verify --------------------------------------------------------------
Step 'checking bundle registration'
$profilePkg = Join-Path $profileDir 'package.json'
$registered = $false
if (Test-Path $profilePkg) {
  try {
    $j = Get-Content $profilePkg -Raw | ConvertFrom-Json
    $registered = @($j.dsh.profile.bundles) -contains 'dsh-config-pack'
  } catch { Warn ('could not parse ' + $profilePkg) }
}
if ($registered) {
  Ok 'dsh-config-pack is registered in dsh.profile.bundles'
} else {
  Warn 'dsh-config-pack is NOT in dsh.profile.bundles - the pack is installed but its layer will not apply.'
  Warn 'Fix: remove it and re-run this script so a single add registers the bundle:'
  Warn ('  dsh plugin --profile ' + $ProfileName + ' remove dsh-config-pack')
  Warn ('  pwsh scripts/install.ps1 -ProfileName ' + $ProfileName + ' -Source ' + $Source)
}

# ---- 4.5 optional third-party plugins (default: install; -SkipOptional skips) --
Step 'optional third-party plugins'
$optPath = Join-Path $root 'assets\optional-components.json'
if ($SkipOptional) {
  Warn '跳过可选三方插件组（-SkipOptional）。注意：若此前已装，本次包依赖变更可能已把它们从 node_modules 移除。'
} elseif (-not (Test-Path $optPath)) {
  Warn 'assets/optional-components.json 缺失，跳过可选三方插件组'
} else {
  $optional = Get-Content $optPath -Raw | ConvertFrom-Json
  foreach ($o in $optional.components) {
    Info ('adding ' + $o.package + ' @ ' + $o.spec)
    & dsh plugin --profile $ProfileName add $o.spec 2>&1 | Select-Object -Last 3 | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -ne 0) {
      Warn ('optional plugin "' + $o.package + '" add failed - continuing (non-fatal；重跑 install.ps1 可重试)')
    }
  }
}

# ---- 4.6 post-install deviation check (plugins + config) ----------------------
if (-not $NoVerify) {
  Step 'post-install deviation check (plugins + config)'
  & node (Join-Path $root 'scripts/verify-install.mjs') --profile $ProfileName
  if ($LASTEXITCODE -ne 0) {
    Warn '安装完成但存在插件/配置偏差 —— 见上方报告：missing(核心件) 必须处理；optional missing 若因 -SkipOptional 属预期；shadowing/设备字面量属已知设备差异'
  } else {
    Ok 'verify-install: 无偏差'
  }
}

# ---- 5. what no pack can ship ----------------------------------------------
Step 'per-device checklist (cannot be shipped by any pack)'
$manifestPath = Join-Path $root 'pack.manifest.yaml'
if (Test-Path $manifestPath) {
  $missing = @()
  foreach ($line in (Get-Content -LiteralPath $manifestPath)) {
    $m = [regex]::Match($line, '^\s*- \{ name: ([A-Za-z0-9_]+), scope: \S+, required: (true|false),')
    if (-not $m.Success) { continue }
    $name = $m.Groups[1].Value
    $required = $m.Groups[2].Value -eq 'true'
    $userSet = [Environment]::GetEnvironmentVariable($name, 'User')
    $procSet = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($userSet)      { $state = 'UserSet' }
    elseif ($procSet)  { $state = 'ProcessOnly' }
    else { $state = 'MISSING'; if ($required) { $missing += $name } }
    Info ($name.PadRight(30) + ' ' + $state)
  }
  if ($missing.Count -gt 0) {
    Warn ('required but not set: ' + ($missing -join ', '))
    foreach ($n in $missing) {
      Info ("  [Environment]::SetEnvironmentVariable('" + $n + "', '<value>', 'User')")
    }
  }
}

Write-Host ''
Step 'next'
Info 'Environment variables only reach a new process - restart DSH before booting this profile:'
Info ('    dsh ' + $ProfileName)
Info 'Switch reference: README.md ("switches" table).'
