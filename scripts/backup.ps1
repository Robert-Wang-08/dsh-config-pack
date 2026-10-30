<#
.SYNOPSIS
  配置备份（不含凭据、宿主依赖和会话）；部分完成退出 2，失败退出 1。
#>
[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*$')][string]$Profile = 'web',
  [string]$Out,
  [switch]$NoZip
)
$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome ('profiles/' + $Profile)
if (-not (Test-Path $profileDir)) { throw "profile not found: $profileDir" }
if (-not $Out) { $Out = Join-Path $env:USERPROFILE ('dsh-backups/' + $Profile + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')) }
$Out = [IO.Path]::GetFullPath($Out)
if ((Test-Path $Out) -and @(Get-ChildItem -LiteralPath $Out -Force).Count) { throw 'backup output must be empty; use a new directory' }
if ((Test-Path ($Out + '.zip')) -and -not $NoZip) { throw 'backup zip already exists' }
New-Item -ItemType Directory -Force $Out | Out-Null
$allow = [Collections.Generic.List[object]]::new()
foreach ($name in @('cordis.yml','cordis.patch.yml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','compatibility.json')) {
  $allow.Add(@{ Src=(Join-Path $profileDir $name); Rel=('profile/' + $name) })
}
$allow.Add(@{ Src=(Join-Path $dshHome 'settings.yaml'); Rel='settings.yaml' })
foreach ($name in @('device.env','device-answers.json','route-config.json','provider-model-catalog.snapshot.json','provider-resource-manifest.json','cordis.local.yml','ptc.local.patch.yml','ptc-settings.json')) {
  $allow.Add(@{ Src=(Join-Path $dshHome ('device/' + $name)); Rel=('device/' + $name) })
}
$excluded=@(); $rejected=@()
# Traverse only configuration roots, without following links or copying arbitrary plugin data.
$roots=@(
  @{ Src=(Join-Path $profileDir 'patches'); Rel='profile/patches'; Kind='patches' },
  @{ Src=(Join-Path $dshHome '.agent-presets'); Rel='.agent-presets'; Kind='presets' },
  @{ Src=(Join-Path $dshHome 'plugins'); Rel='plugins'; Kind='plugins' }
)
foreach ($root in $roots) {
  if (-not (Test-Path $root.Src)) { continue }
  if ((Get-Item -LiteralPath $root.Src -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { $rejected += ($root.Rel+' -> symbolic-link'); continue }
  $queue=[Collections.Generic.Queue[string]]::new(); $queue.Enqueue($root.Src)
  while ($queue.Count) {
    foreach ($file in Get-ChildItem -LiteralPath $queue.Dequeue() -Force) {
      $rel=$root.Rel + '/' + [IO.Path]::GetRelativePath($root.Src,$file.FullName).Replace('\','/')
      if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { $rejected += ($rel+' -> symbolic-link'); continue }
      if ($file.PSIsContainer) {
        if ($file.Name -in @('node_modules','logs','cache','sessions','attachments','backups')) { $excluded += $rel } else { $queue.Enqueue($file.FullName) }
        continue
      }
      $selected=($root.Kind -eq 'patches' -and $file.Extension -eq '.patch') -or ($root.Kind -eq 'presets' -and $file.Extension -in @('.yml','.yaml','.json','.md')) -or ($root.Kind -eq 'plugins' -and $file.Name -in @('settings.json','config.json','route-config.json','settings.yaml','settings.yml','config.yaml','config.yml'))
      if ($selected) { $allow.Add(@{Src=$file.FullName;Rel=$rel}) } else { $excluded += $rel }
    }
  }
}
$pathRe=[regex]'[A-Za-z]:(?:\\{1,2}|/)Users(?:\\{1,2}|/)[^<\s"'']+|/(Users|home)/[^<\s"'']+'
$credRe=[regex]'(?i)BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY|(?:^|[^A-Za-z])sk-[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._~-]{8,}|["'']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)["'']?\s*[:=]\s*["'']?[^<\s"''\[\{,}]'
# Exactly an environment reference, optionally with an empty fallback; never evaluate it.
$safeEnvRef=[regex]'(?m)^\s*(?:Authorization|apiKey|accessToken|refreshToken|password|secret):\s*!!js process(?:\[''env''\]|\.env)\.[A-Za-z_][A-Za-z0-9_]*(?: (?:\|\||\?\?) '''')?\s*$'
$copied=@(); $absent=@(); $hashes=[ordered]@{}
foreach ($item in $allow) {
  if (-not (Test-Path -LiteralPath $item.Src -PathType Leaf)) { $absent += $item.Rel; continue }
  if ((Get-Item -LiteralPath $item.Src).Attributes -band [IO.FileAttributes]::ReparsePoint) { $rejected += ($item.Rel+' -> symbolic-link'); continue }
  $text=[IO.File]::ReadAllText($item.Src)
  $hit=@()
  if ($pathRe.IsMatch($text)) { $hit += 'personal-path' }
  if ($credRe.IsMatch($safeEnvRef.Replace($text,''))) { $hit += 'credential-shaped' }
  if ($hit.Count) { $rejected += ($item.Rel+' -> '+($hit -join ',')); continue }
  $dst=Join-Path $Out $item.Rel
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item -LiteralPath $item.Src -Destination $dst
  $copied += $item.Rel
  $hashes[$item.Rel]=(Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
}
$pkg=if (Test-Path (Join-Path $profileDir 'package.json')) { Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json } else { $null }
$links=@()
if ($pkg -and $pkg.dependencies) { foreach($prop in $pkg.dependencies.PSObject.Properties) { if ($prop.Value -like 'link:*') { $links += $prop.Name } } }
$dshVersion='unknown'
try { $dshVersion=(& dsh --version 2>$null | Select-Object -First 1) } catch {}
$manifest=[ordered]@{
  schema_version='dsh-backup/v2'; created_at=(Get-Date).ToString('o'); profile=$Profile; dsh_version=$dshVersion
  status=$(if ($rejected.Count) {'partial'} else {'complete'}); scope='configuration-only; not a full local snapshot'
  copied=$copied; absent=$absent; rejected=$rejected; excluded=$excluded; sha256=$hashes
  bundles=@(if($pkg -and $pkg.dsh.profile.bundles){$pkg.dsh.profile.bundles}); link_dependencies=$links
  requires_reinstall=$true
  note='No credentials, runtime dependencies or environment values. Reinstall DSH/plugins and authenticate on target device. Link dependencies need target-local paths.'
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Out 'manifest.json') -Encoding utf8
$report=@('# 配置备份报告','',('- 状态：'+$manifest.status),('- 已复制：'+$copied.Count),('- 不存在：'+$absent.Count),('- 拒绝：'+$rejected.Count),'','## 拒绝项（不含原文）')
$report += $rejected | ForEach-Object {'- '+$_}
$report += @('','## 恢复','新设备先用 Git 包 scripts/setup.ps1 安装；本包设备答案在 device/。','本机回滚先用 dsh-backup-restore 创建安全快照，核对 SHA256；profile/ 对应 profiles/<profile>/，其余保持相对路径。','修正 link 依赖路径后 pnpm install，重启 DSH 并新开会话。','模型目录属于 node_modules，不随配置备份；官网模型由配置包显式声明。','凭据、CLI/OAuth 登录态、用户环境变量值、会话、插件日志和未知数据库不在此配置备份内。','需要这些本机私密配置/插件数据时使用 dsh-backup-restore 的本机快照，不得公开上传。','partial 不能当作完整恢复点。详见配置包 docs/backup-restore-audit.md。')
$report -join [Environment]::NewLine | Set-Content -LiteralPath (Join-Path $Out 'PRIVACY.md') -Encoding utf8
if (-not $NoZip) { [IO.Compression.ZipFile]::CreateFromDirectory($Out,($Out+'.zip')) }
Write-Host ('backup '+$manifest.status+': '+$Out)
Write-Host ('copied='+$copied.Count+' absent='+$absent.Count+' rejected='+$rejected.Count)
if ($rejected.Count) { Write-Warning 'Partial backup: see PRIVACY.md; rejected files were NOT copied'; exit 2 }
