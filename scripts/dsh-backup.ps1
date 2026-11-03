<#
.SYNOPSIS
  配置包内的一键备份与恢复。备份写本机快照；恢复默认只打印计划。

.DESCRIPTION
  调用同目录 snapshot.mjs。快照只读 DSHPACK_ 前缀环境变量，不收录凭据值、会话、日志和 node_modules。

  backup
    在 %USERPROFILE%\.dsh\backups（或 -Dest）下新建 dsh-backup-<时间戳>。
    未加 -Rehearse 时快照通常是 partial：文件已复制，但未做隔离安装演练，不能当成跨设备完整恢复点。

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
	[switch]$DryRun,
	[switch]$Apply,
	[switch]$AllowPartial,
	[switch]$Rehearse,
	[switch]$ConfirmRemovals,
	[switch]$AllowPrivateToDest,
	[string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$SnapshotJs = Join-Path $PSScriptRoot 'snapshot.mjs'
if (-not (Test-Path -LiteralPath $SnapshotJs)) { throw "找不到 snapshot.mjs：$SnapshotJs" }

function Get-BackupRoot {
	if (-not [string]::IsNullOrWhiteSpace($Dest)) {
		$full = [IO.Path]::GetFullPath($Dest)
		$home = [IO.Path]::GetFullPath($env:USERPROFILE)
		$dsh = if ($env:DSH_HOME) { [IO.Path]::GetFullPath($env:DSH_HOME) } else { Join-Path $home '.dsh' }
		function Test-Under([string]$Child, [string]$Parent) {
			$prefix = $Parent.TrimEnd('\') + '\'
			$probe = $Child.TrimEnd('\') + '\'
			return $probe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
		}
		$under = (Test-Under $full $home) -or (Test-Under $full $dsh)
		if (-not $under -and -not $AllowPrivateToDest) {
			throw "备份目录在用户目录之外：$full 。确认后加 -AllowPrivateToDest。"
		}
		return $full
	}
	$base = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
	return Join-Path $base 'backups'
}

function Invoke-SnapshotBackup {
	param([string]$NamePrefix)
	$root = Get-BackupRoot
	New-Item -ItemType Directory -Force -Path $root | Out-Null
	$name = $NamePrefix + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
	$out = Join-Path $root $name
	$nodeArgs = @($SnapshotJs, 'backup', '--profile', $Profile, '--out', $out)
	if (-not [string]::IsNullOrWhiteSpace($DshHome)) { $nodeArgs += @('--dsh-home', $DshHome) }
	if ($Rehearse) { $nodeArgs += '--rehearse-install' }
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
	Invoke-SnapshotBackup -NamePrefix 'dsh-backup' | Out-Null
	exit 0
}

$doWrite = $Apply -and -not $DryRun
if (-not $doWrite) {
	Write-Host 'restore dry-run：只打印计划，不写 profile。真正写回加 -Apply。'
	Invoke-SnapshotRestore
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
