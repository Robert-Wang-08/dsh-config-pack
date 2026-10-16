<#
.SYNOPSIS
  一键备份本机 DSH 插件与配置（profile 层 + 本机路由策略 + 清单）。

.DESCRIPTION
  只复制**配置与清单**，不复制任何凭据值：
    - profiles/<p>/cordis.patch.yml、package.json、pnpm-workspace.yaml
    - plugins/provider-failover/route-config.json（本机路由偏好）
    - manifest.json：DSH 版本、bundle 列表、link: 依赖路径、requires_env 变量名
  凭据文件（auth.json / .env / *.key / credentials*）在**允许清单之外**，永不复制。
  复制前对每个文件做凭据形状与个人路径扫描，命中即拒绝该项并在隐私报告中列出。

.PARAMETER Profile
  目标 profile 名，默认 web。

.PARAMETER Out
  输出目录，默认 %USERPROFILE%\dsh-backups\<profile>-<yyyyMMdd-HHmmss>。

.PARAMETER NoZip
  不生成 zip，只留目录。

.EXAMPLE
  pwsh scripts/backup.ps1 -Profile web
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$Out,
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome (Join-Path 'profiles' $Profile)
if (-not (Test-Path $profileDir)) { throw "profile not found: $profileDir" }
if (-not $Out) { $Out = Join-Path $env:USERPROFILE ('dsh-backups\' + $Profile + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
New-Item -ItemType Directory -Force $Out | Out-Null

# 允许清单：只有这些会被复制。凭据文件一律不在其中。
$allow = @(
  @{ Src = (Join-Path $profileDir 'cordis.patch.yml');   Rel = 'profile/cordis.patch.yml' },
  @{ Src = (Join-Path $profileDir 'package.json');        Rel = 'profile/package.json' },
  @{ Src = (Join-Path $profileDir 'pnpm-workspace.yaml'); Rel = 'profile/pnpm-workspace.yaml' },
  @{ Src = (Join-Path $dshHome 'plugins/provider-failover/route-config.json'); Rel = 'plugins/provider-failover/route-config.json' }
)

$denyNames = 'auth.json', '.env', 'credentials', '.credentials', 'id_rsa', 'id_ed25519'
$pathRe = [regex]'[A-Za-z]:\\Users\\[^<\s"'']+|/(Users|home)/[^<\s"'']+'
$credRe = [regex]'(?i)BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY|(?:^|[^A-Za-z])sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{10,}|password\s*[:=]\s*[^<\s]|secret\s*[:=]\s*[^<\s]'

$copied = @(); $skipped = @(); $findings = @()
foreach ($item in $allow) {
  if (-not (Test-Path $item.Src)) { $skipped += ($item.Rel + ' (absent)'); continue }
  $name = Split-Path $item.Src -Leaf
  if ($denyNames -contains $name.ToLower()) { $skipped += ($item.Rel + ' (deny list)'); continue }
  $text = Get-Content -LiteralPath $item.Src -Raw
  $hit = @()
  if ($pathRe.IsMatch($text)) { $hit += 'personal-path' }
  if ($credRe.IsMatch($text)) { $hit += 'credential-shaped' }
  if ($hit.Count -gt 0) { $findings += ($item.Rel + ' -> ' + ($hit -join ',')); $skipped += ($item.Rel + ' (privacy hit, NOT copied)'); continue }
  $dst = Join-Path $Out $item.Rel
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item -LiteralPath $item.Src -Destination $dst -Force
  $copied += $item.Rel
}

# manifest：只登记变量名与路径，绝不登记值
$pkg = if (Test-Path (Join-Path $profileDir 'package.json')) { Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json } else { $null }
$links = @()
if ($pkg -and $pkg.dependencies) {
  foreach ($prop in $pkg.dependencies.PSObject.Properties) {
    if ($prop.Value -like 'link:*') { $links += ($prop.Name + ' -> ' + $prop.Value.Substring(5)) }
  }
}
$dshVersion = 'unknown'
try { $dshVersion = (& dsh --version 2>$null | Select-Object -First 1) } catch { }

$manifest = [ordered]@{
  schema_version    = 'dsh-backup/v1'
  created_at        = (Get-Date).ToString('o')
  profile           = $Profile
  dsh_version       = $dshVersion
  copied            = $copied
  skipped           = $skipped
  privacy_findings  = $findings
  bundles           = @(if ($pkg -and $pkg.dsh.profile.bundles) { $pkg.dsh.profile.bundles } else { @() })
  link_dependencies = $links
  note              = 'Only configuration and manifests are captured. Credential values are never copied; restore requires re-providing env vars on the target device.'
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Out 'manifest.json') -Encoding UTF8

$privacy = @('# 备份隐私报告', '', ('- 时间：' + $manifest.created_at), ('- profile：' + $Profile), ('- 复制项：' + $copied.Count), ('- 跳过项：' + $skipped.Count), '', '## 跳过明细', '')
if ($skipped.Count -eq 0) { $privacy += '- （无）' } else { $skipped | ForEach-Object { $privacy += ('- ' + $_) } }
$privacy += @('', '## 隐私命中', '')
if ($findings.Count -eq 0) { $privacy += '- （无）' } else { $findings | ForEach-Object { $privacy += ('- ' + $_) } }
$privacy += @('', '## 绝不备份的面', '- 凭据值：auth.json / .env / *.key / credentials* / 私钥', '- 环境变量值：只登记变量名（见 manifest.json 的 link_dependencies 与包内 requires_env）', '', '## 恢复', '- 把 profile/ 下的文件放回 $DSH_HOME/profiles/<profile>/', '- 把 plugins/ 下的文件放回 $DSH_HOME/plugins/', '- 在新设备上重新提供凭据（env 或 CLI 登录），备份里没有可泄露的凭据')
$privacy -join "`n" | Set-Content -LiteralPath (Join-Path $Out 'PRIVACY.md') -Encoding UTF8

$zip = $null
if (-not $NoZip) {
  $zip = $Out + '.zip'
  if (Test-Path $zip) { Remove-Item -Force $zip }
  Compress-Archive -Path (Join-Path $Out '*') -DestinationPath $zip -Force
}

Write-Host ('backup ok: ' + $Out)
if ($zip) { Write-Host ('zip: ' + $zip) }
Write-Host ('copied=' + $copied.Count + ' skipped=' + $skipped.Count + ' privacy_findings=' + $findings.Count)
if ($findings.Count -gt 0) { Write-Warning 'privacy findings: see PRIVACY.md — offending files were NOT copied' }
