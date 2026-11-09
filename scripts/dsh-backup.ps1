<#
.SYNOPSIS
  配置包内的一键备份与恢复。备份写本机快照；恢复默认只打印计划。

.DESCRIPTION
  调用同目录 snapshot.mjs。快照只读 DSHPACK_ 前缀环境变量，不收录凭据值、会话、日志和 node_modules。

  backup
    在 %USERPROFILE%\.dsh\backups（或 -Dest）下新建 dsh-backup-<时间戳>。
    未加 -Rehearse 时快照通常是 partial：文件已复制，但未做隔离安装演练，不能当成跨设备完整恢复点。
    -Rehearse 走离线演练（pnpm install --frozen-lockfile --ignore-scripts --offline）；
    -RehearseOnline 走在线演练（pnpm install --frozen-lockfile），用于 store 缺 git-hosted tarball 的 profile。

  restore
    默认 -DryRun，只打印计划，不写 profile。
    -Apply 会先写一份 pre-restore-<时间戳> 安全快照，再按快照写回。
    partial 快照真正写回时必须再加 -AllowPartial。

.EXAMPLE
  pwsh -NoProfile -File scripts/dsh-backup.ps1 backup

.EXAMPLE
  pwsh -NoProfile -File scripts/dsh-backup.ps1 restore -Snapshot $env:USERPROFILE\.dsh\backups\dsh-backup-20261103-180000

.EXAMPLE
  pwsh -NoProfile -File scripts/dsh-backup.ps1 restore -Snapshot <dir> -Apply -AllowPartial
#>
[CmdletBinding()]
param(
	[Parameter(Position = 0)]
	[ValidateSet('backup', 'restore')]
	[string]$Command = 'backup',
	[string]$Profile = 'web',
	[string]$Dest = '',
	[string]$Snapshot = '',
	[ValidateSet('isolate', 'mirror', 'merge')]
	[string]$Mode = 'isolate',
	# 多 profile 打包/恢复：backup/restore 一起处理 DSH_HOME/profiles 下的全部 profile。
	# 默认启动 profile 仍由启动命令决定（默认打包时记 web）。
	[switch]$AllProfiles,
	[string[]]$Profiles = @(),
	[switch]$DryRun,
	[switch]$Apply,
	[switch]$AllowPartial,
	[switch]$AcceptEngineDrift,
	[switch]$Rehearse,
	[switch]$RehearseOnline,
	[switch]$ConfirmRemovals,
	[switch]$AllowPrivateToDest,
	[string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

# DSH 根：-DshHome → DSH_HOME → %USERPROFILE%\.dsh（与 Get-BackupRoot 同源）
$DshRoot = if (-not [string]::IsNullOrWhiteSpace($DshHome)) { [IO.Path]::GetFullPath($DshHome) }
	elseif ($env:DSH_HOME) { [IO.Path]::GetFullPath($env:DSH_HOME) }
	else { Join-Path $env:USERPROFILE '.dsh' }


# ── 引擎一致性门槛 ──────────────────────────────────────────────────────────
# 读 local-git-sync 预检落下的设备状态（<DSH_HOME>/device/engine-preflight.json）：
#   conflict → 引擎冲突无法支持，按既定策略不进行一键恢复（硬阻断，不提供豁免开关）
#   drift    → 引擎不一致，必须人工决策；确认采用 skill 引擎后加 -AcceptEngineDrift
#   其他/缺失 → 不阻断（保持历史行为）
function Get-EngineGovernance {
	$dsh = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
	$p = Join-Path $dsh 'device\engine-preflight.json'
	if (-not (Test-Path -LiteralPath $p)) { return [pscustomobject]@{ state = 'unknown'; path = $p; reason = ''; ageDays = $null } }
	try { $o = Get-Content -LiteralPath $p -Raw -Encoding utf8 | ConvertFrom-Json } catch { return [pscustomobject]@{ state = 'unknown'; path = $p; reason = 'unreadable'; ageDays = $null } }
	$age = $null
	try { $age = ((Get-Date) - [datetime]::Parse([string]$o.checkedAt)).TotalDays } catch { }
	return [pscustomobject]@{ state = [string]$o.state; path = $p; reason = [string]$o.reason; ageDays = $age }
}

function Assert-EngineGovernance {
	param([switch]$AcceptDrift)
	$gov = Get-EngineGovernance
	if ($gov.state -eq 'conflict') {
		throw ('引擎预检为 conflict，无法支持：' + $gov.reason + "`n按既定策略，本次不进行一键恢复。先处理引擎差异后重试：" + $gov.path)
	}
	if ($gov.state -eq 'drift' -and -not $AcceptDrift) {
		throw ('引擎预检为 drift（设备引擎与 skill 引擎不一致），需要人工决策：' + "`n确认采用 skill 引擎后加 -AcceptEngineDrift 重跑；否则先手工合并差异。详情：" + $gov.path)
	}
	if ($gov.state -eq 'drift' -and $AcceptDrift) {
		Write-Host '[restore] 引擎漂移已由 -AcceptEngineDrift 人工确认，继续（风险由操作者承担）。'
	}
	return $gov
}

$SnapshotJs = Join-Path $PSScriptRoot 'snapshot.mjs'
if (-not (Test-Path -LiteralPath $SnapshotJs)) { throw "找不到 snapshot.mjs：$SnapshotJs" }

function Get-BackupRoot {
	if (-not [string]::IsNullOrWhiteSpace($Dest)) {
		$full = [IO.Path]::GetFullPath($Dest)
		# 注意：$HOME 是 PowerShell 只读自动变量，不能赋值——旧代码用 $home 会让整条 -Dest 分支抛错。
		$userHome = [IO.Path]::GetFullPath($env:USERPROFILE)
		$dsh = if ($env:DSH_HOME) { [IO.Path]::GetFullPath($env:DSH_HOME) } else { Join-Path $userHome '.dsh' }
		function Test-Under([string]$Child, [string]$Parent) {
			$prefix = $Parent.TrimEnd('\') + '\'
			$probe = $Child.TrimEnd('\') + '\'
			return $probe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
		}
		$under = (Test-Under $full $userHome) -or (Test-Under $full $dsh)
		if (-not $under -and -not $AllowPrivateToDest) {
			throw "备份目录在用户目录之外：$full 。确认后加 -AllowPrivateToDest。"
		}
		return $full
	}
	$base = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
	return Join-Path $base 'backups'
}

# ── 多 profile bundle（dsh-backup-bundle/v1）─────────────────────────────────
# 目录布局：
#   dsh-backup-<ts>/
#     bundle.json                 # 清单：schema、default_profile、逐 profile 状态
#     profiles/<profile>/…        # 每个 profile 各自一份完整的 dsh-snapshot/v1
# 子目录仍是标准 snapshot/v1，所以单 profile 入口（restore -Snapshot <子目录>）、既有校验与
# digest 钉定行为完全不变；bundle 只是把它们装进一个目录并加清单。
function Get-ProfileIds {
	param([string[]]$Only)
	# pwsh -File 传数组时 PowerShell 只给到一个元素（"web,plugtest"），这里按逗号/分号再切一次。
	$explicit = @($Only | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
		ForEach-Object { $_ -split '[,;]' } |
		ForEach-Object { $_.Trim() } |
		Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
	if ($explicit.Count -gt 0) { return $explicit }
	$pdir = Join-Path $DshRoot 'profiles'
	if (-not (Test-Path -LiteralPath $pdir)) { throw ('找不到 profiles 目录：' + $pdir) }
	# 只认带 package.json 的目录：node_modules 之类的非 profile 目录自动排除。
	$ids = @(Get-ChildItem -LiteralPath $pdir -Directory |
		Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') } |
		Select-Object -ExpandProperty Name | Sort-Object)
	if ($ids.Count -eq 0) { throw ('profiles 目录下没有可用 profile：' + $pdir) }
	return $ids
}

function New-ProfileSnapshot {
	param([string]$ProfileId, [string]$OutDir)
	New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
	$nodeArgs = @($SnapshotJs, 'backup', '--profile', $ProfileId, '--out', $OutDir)
	if (-not [string]::IsNullOrWhiteSpace($DshHome)) { $nodeArgs += @('--dsh-home', $DshHome) }
	if ($RehearseOnline) { $nodeArgs += @('--rehearse-rebuild', 'pnpm install --frozen-lockfile') }
	elseif ($Rehearse) { $nodeArgs += '--rehearse-install' }
	& node @nodeArgs | Out-Host
	$manifestPath = Join-Path $OutDir 'manifest.json'
	if (-not (Test-Path -LiteralPath $manifestPath)) { return $null }
	return (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
}

function Invoke-BundleBackup {
	$root = Get-BackupRoot
	New-Item -ItemType Directory -Force -Path $root | Out-Null
	$out = Join-Path $root ('dsh-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
	$ids = @(Get-ProfileIds -Only $Profiles)
	$entries = New-Object System.Collections.Generic.List[object]
	$failed = 0
	foreach ($id in $ids) {
		$target = Join-Path (Join-Path $out 'profiles') $id
		if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $DshRoot 'profiles') $id))) {
			$failed++
			$entries.Add([ordered]@{ profile = $id; status = 'failed'; completeness = $null; dir = 'profiles/' + $id; files = 0; plugins = 0; reason = 'profile not found' })
			Write-Host ('[bundle] ' + $id + ' 跳过：profiles 下没有这个 profile')
			continue
		}
		$m = New-ProfileSnapshot -ProfileId $id -OutDir $target
		if ($null -eq $m) {
			$failed++
			$entries.Add([ordered]@{ profile = $id; status = 'failed'; completeness = $null; dir = 'profiles/' + $id; files = 0; plugins = 0 })
			Write-Host ('[bundle] ' + $id + ' 备份失败（无 manifest）')
			continue
		}
		$entries.Add([ordered]@{ profile = $id; status = 'ok'; completeness = [string]$m.completeness.status;
			dir = 'profiles/' + $id; files = @($m.files).Count; plugins = @($m.plugins).Count })
		Write-Host ('[bundle] ' + $id + ' status=' + $m.completeness.status + ' files=' + @($m.files).Count + ' plugins=' + @($m.plugins).Count)
	}
	$pkg = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json
	$bundle = [ordered]@{
		schema               = 'dsh-backup-bundle/v1'
		created_at           = (Get-Date).ToUniversalTime().ToString('o')
		tool                 = [ordered]@{ name = 'dsh-config-pack'; version = [string]$pkg.version; schema = 'dsh-backup-bundle/v1' }
		default_profile      = $Profile
		default_profile_note = ('恢复后默认启动 profile 仍是 ' + $Profile + '；bundle 不改动启动命令，也不写任何默认 profile 指针。')
		dsh_home             = $DshRoot
		profiles             = $entries
	}
	Set-Content -LiteralPath (Join-Path $out 'bundle.json') -Value ($bundle | ConvertTo-Json -Depth 8) -Encoding utf8
	Write-Host ('bundle=' + $out)
	Write-Host ('profiles=' + $ids.Count + ' default=' + $Profile + ' failed=' + $failed)
	if ($failed -gt 0) { exit 1 }
	return $out
}

function Get-BundleInfo {
	param([string]$Snap)
	$p = Join-Path $Snap 'bundle.json'
	if (-not (Test-Path -LiteralPath $p)) {
		throw ('不是多 profile bundle（缺 bundle.json）：' + $Snap + ' —— 多 profile 打包用 backup -AllProfiles 生成；单 profile 快照走不带 -AllProfiles 的入口。')
	}
	$b = Get-Content -LiteralPath $p -Raw -Encoding utf8 | ConvertFrom-Json
	if ([string]$b.schema -ne 'dsh-backup-bundle/v1') { throw ('bundle schema 不兼容：' + [string]$b.schema) }
	return $b
}

function Invoke-BundleRestore {
	param([switch]$Write)
	$snap = [IO.Path]::GetFullPath($Snapshot)
	$b = Get-BundleInfo -Snap $snap
	$ok = @($b.profiles | Where-Object { $_.status -eq 'ok' })
	if ($ok.Count -eq 0) { throw 'bundle 里没有任何成功的 profile 快照，无法恢复。' }
	Write-Host ('bundle=' + $snap)
	Write-Host ('profiles=' + $ok.Count + ' default=' + [string]$b.default_profile)
	if ($ok.profile -notcontains [string]$b.default_profile) {
		Write-Host ('[bundle] 警告：默认 profile ' + [string]$b.default_profile + ' 不在这份 bundle 里；恢复后确认启动命令指向存在的 profile。')
	}
	foreach ($e in $ok) {
		$sub = Join-Path (Join-Path $snap 'profiles') $e.profile
		if (-not (Test-Path -LiteralPath (Join-Path $sub 'manifest.json'))) { throw ('bundle 内缺 manifest：' + $sub) }
		Write-Host ('--- ' + $e.profile + '（completeness=' + [string]$e.completeness + '）---')
		if ($Write) {
			& node $SnapshotJs 'verify' '--snapshot' $sub | Out-Host
			if ($LASTEXITCODE -ne 0) { throw ('profile ' + $e.profile + ' 快照文件校验失败（verify exit ' + $LASTEXITCODE + '）') }
		}
		$nodeArgs = @($SnapshotJs, 'restore', '--snapshot', $sub, '--profile', $e.profile, '--mode', $Mode)
		if (-not [string]::IsNullOrWhiteSpace($DshHome)) { $nodeArgs += @('--dsh-home', $DshHome) }
		if (-not $Write) { $nodeArgs += '--dry-run' }
		$nodeArgs += '--allow-partial'
		if ($ConfirmRemovals) { $nodeArgs += '--confirm-removals' }
		& node @nodeArgs | Out-Host
		if ($LASTEXITCODE -ne 0) { throw ('profile ' + $e.profile + ' 恢复失败（exit ' + $LASTEXITCODE + '）') }
	}
	if (-not $Write) {
		Write-Host ('以上为恢复计划；真正写回加 -Apply（会先逐 profile 写 pre-restore 安全快照）。默认启动 profile 保持 ' + [string]$b.default_profile + '。')
	}
}

function Invoke-SnapshotBackup {
	param([string]$NamePrefix)
	$root = Get-BackupRoot
	New-Item -ItemType Directory -Force -Path $root | Out-Null
	$name = $NamePrefix + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
	$out = Join-Path $root $name
	$nodeArgs = @($SnapshotJs, 'backup', '--profile', $Profile, '--out', $out)
	if (-not [string]::IsNullOrWhiteSpace($DshHome)) { $nodeArgs += @('--dsh-home', $DshHome) }
	if ($RehearseOnline) { $nodeArgs += @('--rehearse-rebuild', 'pnpm install --frozen-lockfile') }
	elseif ($Rehearse) { $nodeArgs += '--rehearse-install' }
	& node @nodeArgs
	$code = $LASTEXITCODE
	$manifestPath = Join-Path $out 'manifest.json'
	if (-not (Test-Path -LiteralPath $manifestPath)) {
		Write-Host "backup failed (snapshot exit $code)"
		exit 1
	}
	$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
	Write-Host $name
	Write-Host ('status=' + $manifest.completeness.status)
	Write-Host ('out=' + $out)
	return [pscustomobject]@{ Name = $name; Out = $out; Status = [string]$manifest.completeness.status; Code = $code }
}

function Invoke-SnapshotRestore {
	param([switch]$Write)
	if ([string]::IsNullOrWhiteSpace($Snapshot)) { throw 'restore 需要 -Snapshot <快照目录>' }
	$snap = [IO.Path]::GetFullPath($Snapshot)
	if (-not (Test-Path -LiteralPath (Join-Path $snap 'manifest.json'))) { throw "快照目录没有 manifest.json：$snap" }
	if ($Write -and $Mode -eq 'mirror' -and -not $ConfirmRemovals) {
		throw 'mirror 会把范围内多出来的文件隔离移走。确认后加 -ConfirmRemovals。'
	}
	$nodeArgs = @($SnapshotJs, 'restore', '--snapshot', $snap, '--profile', $Profile, '--mode', $Mode)
	if (-not [string]::IsNullOrWhiteSpace($DshHome)) { $nodeArgs += @('--dsh-home', $DshHome) }
	if (-not $Write) { $nodeArgs += '--dry-run' }
	# 干跑要能看到 partial 快照的写入计划。真正写回仍要调用方显式 -AllowPartial。
	if ((-not $Write) -or $AllowPartial) { $nodeArgs += '--allow-partial' }
	if ($ConfirmRemovals) { $nodeArgs += '--confirm-removals' }
	& node @nodeArgs
	exit $LASTEXITCODE
}

if ($Command -eq 'backup') {
	if ($AllProfiles) {
		[void](Invoke-BundleBackup)
		exit 0
	}
	Invoke-SnapshotBackup -NamePrefix 'dsh-backup' | Out-Null
	exit 0
}

$doWrite = $Apply -and -not $DryRun
if (-not $doWrite) {
	Write-Host 'restore dry-run：只打印计划，不写 profile。真正写回加 -Apply。'
	if ($AllProfiles) { Invoke-BundleRestore; exit 0 }
	Invoke-SnapshotRestore
}

# 引擎一致性门槛：conflict 直接拒绝恢复；drift 需 -AcceptEngineDrift 人工确认
$null = Assert-EngineGovernance -AcceptDrift:$AcceptEngineDrift

# 多 profile 写回：逐 profile 先做 pre-restore 安全快照，再按各自 snapshot/v1 写回。
if ($AllProfiles) {
	$bundleRoot = [IO.Path]::GetFullPath($Snapshot)
	$bundleInfo = Get-BundleInfo -Snap $bundleRoot
	$targets = @($bundleInfo.profiles | Where-Object { $_.status -eq 'ok' })
	if ($targets.Count -eq 0) { throw 'bundle 里没有任何成功的 profile 快照，无法恢复。' }
	$partialIds = @($targets | Where-Object { [string]$_.completeness -ne 'complete' } | ForEach-Object { [string]$_.profile })
	if ($partialIds.Count -gt 0 -and -not $AllowPartial) {
		throw ('bundle 内 ' + $partialIds.Count + ' 个 profile 是 partial（' + ($partialIds -join ',') + '）；写回需 -AllowPartial。先不加 -Apply 看计划。')
	}
	$safetyRoot = Join-Path (Get-BackupRoot) ('pre-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
	Write-Host 'pre-restore：先逐 profile 保留当前配置，再写回快照。'
	foreach ($t in $targets) {
		$safeOut = Join-Path (Join-Path $safetyRoot 'profiles') ([string]$t.profile)
		$safeManifest = New-ProfileSnapshot -ProfileId ([string]$t.profile) -OutDir $safeOut
		if ($null -eq $safeManifest) { throw ('pre-restore 失败：' + [string]$t.profile) }
	}
	Write-Host ('pre-restore=' + $safetyRoot)
	Invoke-BundleRestore -Write
	exit 0
}

$snapManifest = Join-Path ([IO.Path]::GetFullPath($Snapshot)) 'manifest.json'
if (-not (Test-Path -LiteralPath $snapManifest)) { throw "快照目录没有 manifest.json：$Snapshot" }
$snapStatus = [string](Get-Content -Raw -LiteralPath $snapManifest | ConvertFrom-Json).completeness.status
if ($snapStatus -ne 'complete' -and -not $AllowPartial) {
	throw "快照状态是 $snapStatus 。写回 partial 快照需要 -AllowPartial。先不加 -Apply 看计划。"
}
Write-Host 'pre-restore：先保留当前配置，再写回快照。'
$safety = Invoke-SnapshotBackup -NamePrefix 'pre-restore'
Write-Host ('pre-restore ' + $safety.Status + ' ' + $safety.Out)
Invoke-SnapshotRestore -Write
