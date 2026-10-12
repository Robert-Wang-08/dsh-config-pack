<#
.SYNOPSIS
  在本机打一个新版本：升版本号、重建补丁、校验、写 CHANGELOG、打 tag。

.DESCRIPTION
  默认只准备，不提交。加 -Commit 才 git commit，再加 -Push 才推送。
  （工作区规则要求不自动提交 Git，所以这两步必须显式给。）

  顺序刻意如此：先 build+verify，任何一步失败就地中止，
  绝不留下「版本号已升但补丁是坏的」状态。

.PARAMETER Bump
  patch / minor / major，对 package.json 的 version 生效。

.PARAMETER Note
  写进 CHANGELOG 与 commit message 的一句话说明。必填。

.PARAMETER Commit
  执行 git commit 并打 tag。

.PARAMETER Push
  执行 git push --follow-tags（隐含 Commit）。

.PARAMETER DryRun
  只打印将要发生什么，不写任何文件。

.EXAMPLE
  pwsh scripts/release.ps1 -Bump minor -Note 'add cursor ACP route'
  pwsh scripts/release.ps1 -Bump patch -Note 'fix no_proxy' -Push
#>
[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')][string]$Bump = 'patch',
  [Parameter(Mandatory = $true)][string]$Note,
  [switch]$Commit,
  [switch]$Push,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Fail([string]$m) { Write-Host ('FAIL  ' + $m) -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host ('ok    ' + $m) -ForegroundColor Green }

if ($Push) { $Commit = $true }
if ($DryRun) { Write-Host 'DRY RUN — no file will be written' -ForegroundColor Yellow }

# ---- 1. build + verify BEFORE touching the version --------------------------
Write-Host '== build ==' -ForegroundColor Cyan
& node (Join-Path $root 'scripts/build.mjs');  if ($LASTEXITCODE -ne 0) { Fail 'build failed' }
Write-Host '== verify ==' -ForegroundColor Cyan
& node (Join-Path $root 'scripts/verify.mjs'); if ($LASTEXITCODE -ne 0) { Fail 'verify failed — refusing to bump' }

# ---- 2. version ------------------------------------------------------------
$pkgPath = Join-Path $root 'package.json'
$pkg = Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json
$old = $pkg.version
$parts = $old.Split('.')
$maj = [int]$parts[0]; $min = [int]$parts[1]; $pat = [int]$parts[2]
switch ($Bump) {
  'major' { $maj++; $min = 0; $pat = 0 }
  'minor' { $min++; $pat = 0 }
  'patch' { $pat++ }
}
$new = $maj.ToString() + '.' + $min.ToString() + '.' + $pat.ToString()
Write-Host ('version ' + $old + ' -> ' + $new) -ForegroundColor Cyan

if (-not $DryRun) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)

  # package.json — 只在版本字段上做定点替换，保持其余格式不动
  $raw = Get-Content -Raw -LiteralPath $pkgPath
  $raw = $raw -replace ('"version":\s*"' + [regex]::Escape($old) + '"'), ('"version": "' + $new + '"')
  [IO.File]::WriteAllText($pkgPath, $raw, $utf8)

  # pack.manifest.yaml
  $manPath = Join-Path $root 'pack.manifest.yaml'
  $man = Get-Content -Raw -LiteralPath $manPath
  $man = $man -replace ('(?m)^version:\s*' + [regex]::Escape($old) + '\s*$'), ('version: ' + $new)
  [IO.File]::WriteAllText($manPath, $man, $utf8)

  # 补丁头里嵌了版本号，必须重建，然后重新校验
  & node (Join-Path $root 'scripts/build.mjs') | Out-Null
  & node (Join-Path $root 'scripts/verify.mjs'); if ($LASTEXITCODE -ne 0) { Fail 'verify failed after version bump' }

  # ---- 3. changelog -------------------------------------------------------
  $clPath = Join-Path $root 'CHANGELOG.md'
  $cl = Get-Content -Raw -LiteralPath $clPath
  $idx = $cl.IndexOf('## ')
  if ($idx -lt 0) { Fail 'CHANGELOG.md has no "## " section' }
  $nl = [char]10
  $entry = '## ' + $new + $nl + $nl + $Note + $nl + $nl
  $cl = $cl.Substring(0, $idx) + $entry + $cl.Substring($idx)
  [IO.File]::WriteAllText($clPath, $cl, $utf8)
  Ok 'CHANGELOG updated'
}

# ---- 4. git ----------------------------------------------------------------
if ($Commit) {
  Push-Location $root
  try {
    git add -A
    git commit -m ('release: v' + $new + ' — ' + $Note) | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail 'git commit failed' }
    # 必须用 annotated tag：git push --follow-tags 只推送 annotated tag，
    # lightweight tag 不会上传，于是 github:...#vX.Y.Z 这种安装 spec 在远端解析不到。
    git tag -a ('v' + $new) -m ('dsh-config-pack v' + $new + ' — ' + $Note)
    if ($LASTEXITCODE -ne 0) { Fail ('git tag v' + $new + ' failed') }
    Ok ('committed and tagged v' + $new)
    if ($Push) {
      git push --follow-tags
      if ($LASTEXITCODE -ne 0) { Fail 'git push failed' }
      Ok 'pushed'
    }
  } finally { Pop-Location }
} else {
  Write-Host ''
  Write-Host '准备完成。确认无误后执行：' -ForegroundColor Cyan
  Write-Host ('    git add -A; git commit; git tag -a v' + $new + ' -m <note>; git push --follow-tags')
}
