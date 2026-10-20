<#
.SYNOPSIS
  已安装设备一键更新：把插件与配置层同步到远端最新发布版本（tag）。

.DESCRIPTION
  面向已经通过 setup.ps1 / install.ps1 装好的设备。做三件事：

    1) 解析远端最新的 v* 发布 tag（git ls-remote，按语义版本排序取最大）；
    2) 与本 profile 当前安装的 dsh-config-pack 版本比较——已是最新则直接退出
       （-Force 可强制重跑同版本安装）；
    3) 复用 install.ps1 完整更新：pnpm 前置 + pack 与可选三方组一次多 spec add +
       组件 bundle 显式登记 + lib 构建 + verify-install 偏差比较验收。

  不做的事：
    - 不动设备个人答案与密钥（云盘 device.env 只存引用名，密钥在用户环境变量）；
    - 云盘上的 route-config.json / 个人答案变更后，用 setup.ps1 -UpdateRoutes 重拉路由；
    - 不改 cordis.patch.yml；不重启 DSH（更新后需重启并新开会话，工具表才会刷新）。

.PARAMETER ProfileName
  目标 profile，默认 packed。

.PARAMETER Source
  指定安装源（github:Robert-Wang-08/dsh-config-pack#vX.Y.Z）；默认自动取远端最新 tag。

.PARAMETER SkipOptional
  跳过可选三方插件组（升级时跳过会把已装件从 node_modules 移除）。

.PARAMETER Force
  远端版本与当前一致时也强制重跑安装。

.PARAMETER NoVerify
  跳过安装后的偏差比较验收。

.EXAMPLE
  pwsh scripts/update.ps1                          # packed profile，自动取最新 tag
  pwsh scripts/update.ps1 -ProfileName mypack      # 指定 profile
  pwsh scripts/update.ps1 -SkipOptional            # 不动可选三方组
#>
[CmdletBinding()]
param(
  [string]$ProfileName = 'packed',
  [string]$Source = '',
  [switch]$SkipOptional,
  [switch]$Force,
  [switch]$NoVerify
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Fail([string]$m) { Write-Host ('FAIL  ' + $m) -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host ('ok    ' + $m) -ForegroundColor Green }
function Info([string]$m) { Write-Host ('      ' + $m) }
function Warn([string]$m) { Write-Host ('warn  ' + $m) -ForegroundColor Yellow }
function Step([string]$m) { Write-Host ('== ' + $m) -ForegroundColor Cyan }

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) { Fail 'dsh is not on PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node is not on PATH' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git is not on PATH' }

$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path (Join-Path $dshHome 'profiles') $ProfileName
if (-not (Test-Path $profileDir)) {
  Fail ("profile '$ProfileName' 不存在——新设备请先跑 scripts/setup.ps1（一键恢复式安装），再回来更新")
}

# ---- 1. resolve latest release tag ------------------------------------------
Step 'resolving latest release tag'
if (-not $Source) {
  if (-not (Test-Path (Join-Path $root '.git'))) {
    Fail 'config-pack 目录不是 git clone；请传入 -Source github:Robert-Wang-08/dsh-config-pack#vX.Y.Z'
  }
  # ls-remote 而非 fetch --tags：历史 tag 本地/远端可能分歧，fetch 会整体拒绝
  $lines = & git -C $root ls-remote --tags origin 'refs/tags/v*'
  if ($LASTEXITCODE -ne 0 -or -not $lines) { Fail 'git ls-remote failed (network?) - 可传 -Source 手动指定' }
  $vers = foreach ($l in $lines) {
    if ($l -match 'refs/tags/v(\d+\.\d+\.\d+)(\^\{\})?$') { [version]$matches[1] }
  }
  $latestVer = $vers | Sort-Object | Select-Object -Last 1
  if (-not $latestVer) { Fail '远端没有任何 v* tag' }
  $Source = 'github:Robert-Wang-08/dsh-config-pack#v' + $latestVer
}
Info ('install source: ' + $Source)

# ---- 2. compare with the installed version ----------------------------------
$profilePkg = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
$currentSpec = $profilePkg.dependencies.'dsh-config-pack'
$currentVer = if ($currentSpec) { [regex]::Match($currentSpec, '#v([\d.]+)').Groups[1].Value } else { '' }
$latestVer = [regex]::Match($Source, '#v([\d.]+)').Groups[1].Value
Info ('installed: ' + $(if ($currentVer) { 'v' + $currentVer } else { '(unknown)' }) + '  latest: v' + $latestVer)

if (-not $Force -and $currentVer -eq $latestVer) {
  Ok ('已是最新（v' + $latestVer + '）——无需更新。要强制重跑加 -Force')
  Write-Host '提示：云盘上的 route-config.json / 个人答案若有变更，用 setup.ps1 -UpdateRoutes 同步。'
  exit 0
}

# ---- 3. reuse install.ps1 (prereqs + one multi-spec add + deviation check) ---
Step ('updating to ' + $Source)
$installArgs = @{ ProfileName = $ProfileName; Source = $Source }
if ($SkipOptional) { $installArgs.SkipOptional = $true }
if ($NoVerify)     { $installArgs.NoVerify = $true }
& (Join-Path $PSScriptRoot 'install.ps1') @installArgs
$code = $LASTEXITCODE
if ($code -ne 0) { Fail ('install.ps1 exited ' + $code) }

Ok ('更新完成：' + $(if ($currentVer) { 'v' + $currentVer + ' -> ' }) + 'v' + $latestVer)
Write-Host '下一步：关掉正在跑的 DSH，重新打开，并新开一个会话（工具表随会话冻结）。'
Write-Host '云盘 route-config.json / 个人答案有变更时：pwsh scripts/setup.ps1 -UpdateRoutes'
