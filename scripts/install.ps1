<#
.SYNOPSIS
  把 dsh-config-pack 一键装进一个 DSH profile。

.DESCRIPTION
  本脚本刻意只做两件事：
    1) 调 DSH 自己的 dsh plugin --profile <p> add <spec>。它负责 pnpm 安装 + 把 bundle 注册进
       dsh.profile.bundles（见 @deepseek-ai/dsh-plugin-manager operations.js:504 的 reconcile）；
    2) 跑只读校验 verify.mjs --profile <p>，并打印本机待办清单（环境变量 / CLI 登录态）。

  它【不编辑任何 profile 文件】。这是刻意的：运行时插件会并发改写 cordis.patch.yml，
  任何读-改-写都可能踩掉别人的改动。DSH 自己的安装路径没有这个问题。

.PARAMETER ProfileName
  目标 profile 名，默认 packed。若该 profile 不存在，DSH 会用 DEFAULT_PROFILE_BUNDLES
  （只有 @deepseek-ai/dsh-base）建它。注意：web app 与 git 宿主插件必须另外显式 add，
  且本包要排在 dsh.profile.bundles 末位；否则覆盖不生效（详见 docs/device-setup.md §2.1）。

.PARAMETER Source
  包的来源 spec，默认本仓库目录的绝对路径。分发场景请用 git spec，例如
  github:Robert-Wang-08/dsh-config-pack#v0.2.0

.PARAMETER Uninstall
  走 dsh plugin remove。注意：卸载不会恢复被本包覆盖的行。

.EXAMPLE
  pwsh scripts/install.ps1
  pwsh scripts/install.ps1 -ProfileName web -Source github:Robert-Wang-08/dsh-config-pack#v0.2.0
#>
[CmdletBinding()]
param(
  [string]$ProfileName = 'packed',
  [string]$Source,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = $root }

function Fail([string]$m) { Write-Host ('FAIL  ' + $m) -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host ('ok    ' + $m) -ForegroundColor Green }
function Info([string]$m) { Write-Host ('      ' + $m) }

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) { Fail 'dsh is not on PATH' }

Write-Host '== dsh-config-pack ==' -ForegroundColor Cyan
Info ('profile : ' + $ProfileName)
Info ('source  : ' + $Source)
Write-Host ''

if ($Uninstall) {
  & dsh plugin --profile $ProfileName remove dsh-config-pack
  if ($LASTEXITCODE -ne 0) { Fail ('dsh plugin remove exited ' + $LASTEXITCODE) }
  Ok 'removed'
  Write-Host 'Note: rows this pack overrode now fall back to the next layer that declares them.'
  exit 0
}

# ---- 1. install (this is what registers the bundle) -------------------------
& dsh plugin --profile $ProfileName add $Source
if ($LASTEXITCODE -ne 0) {
  Fail ('dsh plugin add exited ' + $LASTEXITCODE + ' — profile left as it was; nothing else was changed')
}
Ok 'dsh plugin add succeeded (bundle registered in dsh.profile.bundles)'

# ---- 2. read-only verification ---------------------------------------------
if (Get-Command node -ErrorAction SilentlyContinue) {
  & node (Join-Path $root 'scripts/verify.mjs') --profile $ProfileName
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Fail 'verify reported problems (see above). The pack is installed but may be shadowed.'
  }
} else {
  Write-Host 'warn  node not on PATH — skipped verify' -ForegroundColor Yellow
}

# ---- 3. L3 checklist: things no pack can ship -------------------------------
Write-Host ''
Write-Host '== 本机待办（装不了的部分）==' -ForegroundColor Cyan

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
    if ($userSet) {
      $state = 'UserSet'
      if (-not $procSet) { $state = 'UserSet / NOT in this process — 重启 DSH' }
    } elseif ($procSet) { $state = 'ProcessOnly' }
    else { $state = 'MISSING'; if ($required) { $missing += $name } }
    Write-Host ('  ' + $name.PadRight(28) + ' ' + $state)
  }
  if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host ('  必需但未设置：' + ($missing -join ', ')) -ForegroundColor Yellow
    Write-Host '  设置方式（User 作用域，不要写进仓库）：' -ForegroundColor Yellow
    foreach ($n in $missing) {
      Write-Host ("    [Environment]::SetEnvironmentVariable('" + $n + "', '<value>', 'User')")
    }
  }
}

Write-Host ''
Write-Host '== 下一步 ==' -ForegroundColor Cyan
Info '设置好环境变量后，重启 DSH 再启动该 profile：'
Info ('    dsh ' + $ProfileName)
Info '开关说明见 README.md 的「开关」表。'
