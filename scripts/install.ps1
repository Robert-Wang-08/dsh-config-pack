<#
.SYNOPSIS
  一条命令把 dsh-config-pack 连同可选三方组装进一个 DSH profile。

.DESCRIPTION
  这一步之前需要人工做的事，本脚本全部代做：
    1) profile 不存在时，从发行模板建一个；
    2) 在 profile 的 pnpm-workspace.yaml 里写好装本包必需的前置
       （blockExoticSubdeps: false、nodeLinker: hoisted、allowBuilds——
       含全部第一方 git 组件的构建许可，缺了它们 lib/ 不会被构建）；
    3) 只调**一次** `dsh plugin --profile <p> add <本包> <可选三方件...>` ——
       装包与 bundle 登记由 DSH 自己完成；多 spec 合并成一次 add 是刻意的：
       连续多次 add 的 reconcile 会把先前登记的依赖 bundle 挤掉（实测）；
    4) 失败时按 pnpm 的错误码做**有界**自愈后重试（最多 3 次），而不是让人工改配置再来一遍；
    5) 跑 `scripts/verify-install.mjs` —— 插件清单（核心+可选组）与配置的**偏差比较**：
       bundle 登记、shadowing、composed dangling、patch 对照一次完成。

  可选三方组件来自 assets/optional-components.json（recent-sessions / dshmarket /
  director / palette），默认安装；加 -SkipOptional 整组跳过——注意升级时跳过会让
  已装件被依赖变更移除。

  脚本只改 pnpm 配置，不改写 cordis.patch.yml。

.PARAMETER ProfileName
  目标 profile 名，默认 packed。

.PARAMETER Source
  包的来源 spec。留空则自动解析远端最新 v* 发布 tag（git ls-remote，按语义版本取最大）；
  离线或需要钉版本时显式传入 github:Robert-Wang-08/dsh-config-pack#vX.Y.Z。

.PARAMETER FromDefaultProfile
  profile 不存在时使用的发行模板，默认 web（PTC 工具面位于 preset 内，需要客户端预设选择能力）。

.PARAMETER Uninstall
  走 dsh plugin remove。

.PARAMETER SkipOptional
  跳过可选三方插件组（升级时跳过会把已装件从 node_modules 移除）。

.EXAMPLE
  pwsh scripts/install.ps1
  pwsh scripts/install.ps1 -ProfileName mypack -Source github:Robert-Wang-08/dsh-config-pack#vX.Y.Z
#>
[CmdletBinding()]
param(
  [string]$ProfileName = 'packed',
  [string]$Source = '',
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

# 解析远端最新 v* tag。刻意用 ls-remote 而不是 fetch --tags：历史 tag 本地/远端可能分歧，
# fetch 会整体拒绝；而写死默认 tag 会让 install.ps1 每次都落后于发布（v0.9.6 曾落后 4 版）。
function Resolve-LatestSourceTag {
  $gitDir = Join-Path $root '.git'
  if (-not (Test-Path $gitDir)) {
    Fail 'config-pack 目录不是 git clone，无法自动解析最新 tag；请传入 -Source github:Robert-Wang-08/dsh-config-pack#vX.Y.Z'
  }
  $lines = & git -C $root ls-remote --tags origin 'refs/tags/v*'
  if ($LASTEXITCODE -ne 0 -or -not $lines) {
    Fail 'git ls-remote failed (network?) - 可传 -Source 手动指定'
  }
  $vers = foreach ($l in $lines) {
    if ($l -match 'refs/tags/v(\d+\.\d+\.\d+)(\^\{\})?$') { [version]$matches[1] }
  }
  $latest = $vers | Sort-Object | Select-Object -Last 1
  if (-not $latest) { Fail '远端没有任何 v* tag' }
  return ('github:Robert-Wang-08/dsh-config-pack#v' + $latest)
}

# 找一个**真能执行**的 Python。仅用 Get-Command 会被 Microsoft Store 的
# python.exe 别名骗过：命令存在、exit 9009、输出 'Python was not found'，
# 结果 Claude 预置步骤静默空转并被误判为「缺凭据」。
function Resolve-PythonCommand {
  $candidates = @()
  foreach ($envName in @('DSHPACK_PYTHON', 'PTC_PYTHON')) {
    foreach ($scope in @('Process', 'User', 'Machine')) {
      $value = [Environment]::GetEnvironmentVariable($envName, $scope)
      if ($value) { $candidates += , @($value); break }
    }
  }
  $candidates += , @('py', '-3')
  $candidates += , @('python')
  $candidates += , @('python3')
  foreach ($glob in @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe'),
    'C:\Python3*\python.exe',
    (Join-Path $env:USERPROFILE 'anaconda3\python.exe'),
    (Join-Path $env:USERPROFILE 'miniconda3\python.exe'),
    'C:\ProgramData\anaconda3\python.exe'
  )) {
    foreach ($hit in @(Get-ChildItem -Path $glob -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)) {
      $candidates += , @($hit)
    }
  }

  foreach ($candidate in $candidates) {
    $exe = $candidate[0]
    $prefix = @()
    if ($candidate.Count -gt 1) { $prefix = @($candidate[1..($candidate.Count - 1)]) }
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    $probe = (& $exe @($prefix + @('-V')) 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { continue }
    if ($probe -match 'was not found') { continue }
    if ($probe -notmatch '^Python\s+3\.') { continue }
    return @{ Exe = $exe; Prefix = $prefix; Version = $probe.Trim() }
  }
  return $null
}

if (-not (Get-Command dsh -ErrorAction SilentlyContinue))  { Fail 'dsh is not on PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node is not on PATH (needed to prepare the profile and to verify)' }

$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path (Join-Path $dshHome 'profiles') $ProfileName

if ($Uninstall) {
  Step 'uninstall'
  & dsh plugin --profile $ProfileName remove dsh-config-pack
  if ($LASTEXITCODE -ne 0) { Fail ('dsh plugin remove exited ' + $LASTEXITCODE) }
  Ok 'removed'
  Write-Host 'Note: rows this pack overrode now fall back to the next layer that declares them.'
  exit 0
}

# ---- 0. source spec ---------------------------------------------------------
if (-not $Source) {
  Step 'resolving latest release tag'
  $Source = Resolve-LatestSourceTag
}
Info ('install source: ' + $Source)

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

# ---- 2.5 Opus 执行档的 Claude Code 配置目录 ---------------------------------
# 两个 Opus 档各自绑一个独立 CLAUDE_CONFIG_DIR；目录由本包脚本按凭据库预置。
# 幂等：已存在的目录不覆盖；缺凭据时只报告、不失败（该档在配置好之前不可用）。
Step 'preparing Opus Claude Code config profiles (device-local credentials)'
$profilesScript = Join-Path $root 'packages\dsh-ptc-multi-agent-mode\scripts\claude_config_profiles.py'
$python = Resolve-PythonCommand
if (-not $python) {
  Info '未找到可执行的 Python 3，跳过 Opus 配置目录预置'
  Info '  可设置 DSHPACK_PYTHON=<python.exe> 或手工运行 packages\dsh-ptc-multi-agent-mode\scripts\claude_config_profiles.py'
} elseif (-not (Test-Path -LiteralPath $profilesScript)) {
  Info ('未找到 ' + $profilesScript + '，跳过预置')
} else {
  Info ('python: ' + $python.Exe + ' (' + $python.Version + ')')
  & $python.Exe @($python.Prefix + @('-B', $profilesScript)) 2>&1 | ForEach-Object { Info $_ }
  if ($LASTEXITCODE -ne 0) {
    Info 'Opus 配置目录预置未完全成功（缺凭据时属预期）；补齐后重跑该脚本即可，不影响其余安装'
  } else {
    Ok 'Opus config profiles prepared'
  }
}

# ---- 3. ONE add: pack + optional third-party group --------------------------
# 连续多次 `dsh plugin add` 的 reconcile 会把先前登记的依赖 bundle 挤掉（实测），
# 所以 pack 与可选三方件必须合并在**同一次** add 里。
$optionalSpecs = @()
$optPath = Join-Path $root 'assets\optional-components.json'
if ($SkipOptional) {
  Info '可选三方插件组：-SkipOptional 跳过（升级时跳过会把已装件从 node_modules 移除）'
} elseif (Test-Path $optPath) {
  try {
    $optional = Get-Content $optPath -Raw | ConvertFrom-Json
    $optionalSpecs = @($optional.components | ForEach-Object { $_.spec })
    Info ('optional group: ' + ($optionalSpecs -join ', '))
  } catch {
    Warn ('optional-components.json unreadable - proceeding without optional group: ' + $_.Exception.Message)
  }
} else {
  Warn 'assets/optional-components.json 缺失 - 本包依赖照常安装，可选三方组不装'
}

$maxAttempts = 10
$installed = $false
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  Step ('installing (attempt ' + $attempt + ' of ' + $maxAttempts + ')')
  $specArgs = @($Source) + $optionalSpecs
  $out  = & dsh plugin --profile $ProfileName add @specArgs 2>&1
  $code = $LASTEXITCODE
  $text = ($out | Out-String)
  $out | Select-Object -Last 12 | ForEach-Object { Info $_ }
  if ($code -eq 0) { $installed = $true; break }
  if ($attempt -eq $maxAttempts) { break }

  # pnpm stops at the FIRST fenced git dependency per attempt; every retry reveals its
  # exact allowBuilds key (name@<tarball-url>, possibly wrapped across help lines) and the
  # next unfenced one. Budget must cover the number of git deps, not just flaky networks.
  $flat = ($text -replace '\r?\n', ' ')
  if ($flat -match 'ERR_PNPM_IGNORED_BUILDS' -or $flat -match 'needs to execute build scripts|allowBuilds"? allowlist') {
    # pnpm prints the exact allowBuilds key it wants (name@<tarball-url>), wrapped across
    # lines in its help block. Remove line breaks AND the following indent so wrapped URLs
    # are captured whole.
    $joined = ($text -replace '\r?\n\s*', '')
    $urlKeys = [regex]::Matches($joined, '[A-Za-z0-9_@.-]+@https?://[A-Za-z0-9_@./-]+') |
      ForEach-Object { $_.Value } | Sort-Object -Unique
    $tokens = [regex]::Matches($text, '[A-Za-z0-9_@./-]+@[0-9][A-Za-z0-9_.-]*') |
      ForEach-Object { $_.Value } | Sort-Object -Unique
    $allowKeys = @($urlKeys) + @($tokens | Where-Object { $_ -notin $urlKeys })
    if ($allowKeys.Count -eq 0) { Fail 'pnpm blocked build scripts but no package names could be parsed' }
    Warn ('pnpm blocked build scripts; allowing: ' + ($allowKeys -join ', '))
    & node (Join-Path $root 'scripts/prepare-profile.mjs') $profileDir --extra-builds ($allowKeys -join ',')
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

# ---- 3.4 register component bundles explicitly ------------------------------
# `dsh plugin add <pack>` does NOT register the pack's dependency bundles (verified fresh
# install). Each component must be its own direct dependency with a registered bundle.
# Idempotent: components already in dsh.profile.bundles are skipped.
Step 'registering component bundles (explicit, idempotent)'
$profPack = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$profPkg = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
$knownBundles = @($profPkg.dsh.profile.bundles)
foreach ($p in $profPack.dependencies.PSObject.Properties) {
  if ($p.Name -eq 'fzstd') { continue }
  if ($knownBundles -contains $p.Name) { continue }
  # npm-style specs need name@version (a bare "0.25.2" would be treated as a package name);
  # git-hosted specs are already complete ("github:owner/repo#tag").
  $spec = if ($p.Value -like 'github:*') { $p.Value } else { "$($p.Name)@$($p.Value)" }
  Info ('registering ' + $p.Name)
  & dsh plugin --profile $ProfileName add $spec 2>&1 | Select-Object -Last 2 | ForEach-Object { Info $_ }
  if ($LASTEXITCODE -ne 0) { Warn ('failed registering ' + $p.Name) }
}

# ---- 3.5 build lib outputs for first-party git components -------------------
# git tag tarballs ship source only; pnpm may skip their build scripts and a missing
# main entry (lib/index.js) means the plugin cannot activate. Run the package's own
# build/bundle script when the entry is still missing. First-party/trusted only.
Step 'building lib outputs (entries missing after install)'
$profPack = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
foreach ($p in $profPack.dependencies.PSObject.Properties) {
  $dir = Join-Path $profileDir (Join-Path 'node_modules' $p.Name)
  if (-not (Test-Path $dir)) { continue }
  $pj = Get-Content (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json
  $entry = $pj.main
  if (-not $entry -or (Test-Path (Join-Path $dir $entry))) { continue }
  foreach ($script in @('build', 'bundle')) {
    if ($pj.scripts.$script) {
      Info ('  building ' + $p.Name + ' (pnpm run ' + $script + ')')
      & pnpm --dir $dir run $script 2>&1 | Select-Object -Last 2 | ForEach-Object { Info $_ }
      if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $dir $entry))) { break }
    }
  }
  if (-not (Test-Path (Join-Path $dir $entry))) {
    Warn ('  entry still missing for ' + $p.Name + ' (' + $entry + ')')
  }
}

# ---- 4. bundle registration check ------------------------------------------
Step 'checking bundle registration'
$profilePkg = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
$registered = @($profilePkg.dsh.profile.bundles) -contains 'dsh-config-pack'
if ($registered) {
  Ok 'dsh-config-pack is registered in dsh.profile.bundles'
} else {
  Warn 'dsh-config-pack is NOT in dsh.profile.bundles - the pack is installed but its layer will not apply.'
  Warn 'Fix: remove it and re-run this script so a single add registers the bundle:'
  Warn ('  dsh plugin --profile ' + $ProfileName + ' remove dsh-config-pack')
  Warn ('  pwsh scripts/install.ps1 -ProfileName ' + $ProfileName + ' -Source ' + $Source)
}

# ---- 4.6 post-install deviation check (plugins + config) --------------------
if (-not $NoVerify) {
  Step 'post-install deviation check (plugins + config)'
  & node (Join-Path $root 'scripts/verify-install.mjs') --profile $ProfileName
  if ($LASTEXITCODE -ne 0) {
    Warn '安装完成但存在插件/配置偏差 —— 见上方报告：missing(核心件) 必须处理；optional missing 若因 -SkipOptional 属预期；shadowing/设备字面量属已知设备差异'
  } else {
    Ok 'verify-install: 无偏差'
  }
}

# ---- 5. per-device checklist (cannot be shipped by any pack) ----------------
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
