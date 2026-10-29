# 新设备一条命令：选共享盘或模板，然后装包、写路由、设用户环境变量。
# 密钥只进用户环境变量。device.env / device-answers.json 里只留变量名。
#
#   pwsh -File scripts/setup.ps1
#   pwsh -File scripts/setup.ps1 -SharedRoot D:\nutstore\Skill+Tool\skillhub
#   pwsh -File scripts/setup.ps1 -SkipInstall
#
# 共享盘约定目录（没有 junction，也不跑 skillhub.py）：
#   <共享盘>\dsh-device\device.env
#   <共享盘>\dsh-device\device-answers.json   可选
#   <共享盘>\dsh-device\route-config.json     可选，有则优先
param(
    [string] $SharedRoot = '',
    [string] $ProfileName = 'packed',
    [string] $Source = '',
    [switch] $SkipInstall,
    [switch] $UpdateRoutes,
    [switch] $SkipOptional,
    [switch] $NonInteractive
)

$ErrorActionPreference = 'Stop'
$packRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $env:USERPROFILE '.dsh\device'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$routeDest = Join-Path $dshHome 'plugins\provider-failover\route-config.json'
$utf8 = New-Object System.Text.UTF8Encoding $false
$secretRe = [regex]'(?i)(^sk-|^ghp_|^gho_|^AKIA|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY)'

function Read-DeviceEnv([string] $Path) {
    $map = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trim = $line.Trim()
        if ($trim.Length -eq 0 -or $trim.StartsWith('#')) { continue }
        $eq = $trim.IndexOf('=')
        if ($eq -lt 1) { continue }
        $name = $trim.Substring(0, $eq).Trim()
        $value = $trim.Substring($eq + 1).Trim()
        if ($secretRe.IsMatch($value)) {
            throw "拒绝 $name ：值像密钥。文件里只能写环境变量名，密钥用用户环境变量。"
        }
        $map[$name] = $value
    }
    return $map
}

function Write-DeviceEnv([string] $Path, $Map) {
    $example = Join-Path $packRoot 'templates\device-config.env.example'
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('# 本机副本。只放指针和路由名，不放密钥原值。')
    foreach ($line in [System.IO.File]::ReadAllLines($example)) {
        $trim = $line.Trim()
        if ($trim.Length -eq 0 -or $trim.StartsWith('#')) {
            $lines.Add($line)
            continue
        }
        $eq = $trim.IndexOf('=')
        if ($eq -lt 1) { $lines.Add($line); continue }
        $name = $trim.Substring(0, $eq).Trim()
        $value = if ($Map.Contains($name)) { $Map[$name] } else { $trim.Substring($eq + 1).Trim() }
        $lines.Add("$name=$value")
    }
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    [System.IO.File]::WriteAllLines($Path, $lines, $utf8)
}

function Set-UserValue([string] $Name, [string] $Value) {
    if ([string]::IsNullOrWhiteSpace($Name) -or [string]::IsNullOrWhiteSpace($Value)) { return }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
}

function Prompt-OrDefault([string] $Label, [string] $Current) {
    if ($NonInteractive) { return $Current }
    $typed = Read-Host "$Label [$Current]"
    if ([string]::IsNullOrWhiteSpace($typed)) { return $Current }
    return $typed.Trim()
}

function New-Tier($Number, [bool] $Enabled, $Entries) {
    return [ordered]@{
        tier    = $Number
        enabled = $Enabled
        entries = @($Entries)
    }
}

function New-Entry([string] $Id, [string] $Route, [string] $Model, [int] $CooldownMs, $Models) {
    $entry = [ordered]@{
        id         = $Id
        route      = $Route
        model      = $Model
        cooldownMs = $CooldownMs
    }
    if ($null -ne $Models) { $entry.models = @($Models) }
    return $entry
}

function Build-RouteFromMap($Map, $Existing) {
    $pick = {
        param($Name, $Fallback)
        if ($Map.Contains($Name) -and -not [string]::IsNullOrWhiteSpace($Map[$Name])) { return $Map[$Name] }
        return $Fallback
    }
    $tiers = @(
        (New-Tier 1 $true @(
            (New-Entry 'codex-relay' (& $pick 'DSHPACK_ROUTE_CODEX_RELAY' 'codex-relay') 'gpt-6.1-sol' 60000)
            (New-Entry 'codex-official' (& $pick 'DSHPACK_ROUTE_OPENAI_CODEX' 'openai-codex') 'gpt-6.1-sol' 120000)
        ))
        (New-Tier 2 $true @(
            (New-Entry 'ais' (& $pick 'DSHPACK_ROUTE_AIS' 'ais-2dsglm') 'deepseek-v4.1-flash' 60000 @('deepseek-v4.1-flash', 'glm-5.3-flash'))
            (New-Entry 'opencodego' (& $pick 'DSHPACK_ROUTE_OPENCODE' 'opencode-go') 'deepseek-v4.1-flash' 60000)
        ))
        (New-Tier 3 $true @(
            (New-Entry 'kimi' (& $pick 'DSHPACK_ROUTE_KIMI' 'kimi-coding') 'k3-256k' 60000)
        ))
        (New-Tier 4 $false @(
            (New-Entry 'deepseek-official' (& $pick 'DSHPACK_ROUTE_DEEPSEEK_OFFICIAL' 'deepseek-official') 'deepseek-flash' 120000)
        ))
    )
    $doc = [ordered]@{
        schemaVersion    = 1
        source           = 'dsh-config-pack/scripts/setup.ps1'
        providerFailover = [ordered]@{
            tiers         = $tiers
            failurePolicy = [ordered]@{
                switchOn           = @('QUOTA', 'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'NO_ADAPTER', 'SERVER', 'RATE_LIMIT', 'TRANSPORT')
                doNotSwitchOn      = @('POLICY')
                onExhausted        = 'error'
                maxSwitchesPerTurn = 6
            }
        }
    }
    if ($null -ne $Existing -and $Existing.subagentRouting) {
        $doc.subagentRouting = $Existing.subagentRouting
    }
    return $doc
}

function Apply-AnswersRoutes($Doc, $Answers) {
    if (-not $Answers.routes) { return $Doc }
    $byTier = @{}
    foreach ($tier in $Doc.providerFailover.tiers) { $byTier[[int]$tier.tier] = $tier }
    foreach ($key in @('tier1', 'tier2', 'tier3', 'tier4')) {
        $spec = $Answers.routes.$key
        if (-not $spec) { continue }
        $n = [int]($key.Substring(4))
        $tier = $byTier[$n]
        if (-not $tier) { continue }
        if ($null -ne $spec.enabled) { $tier.enabled = [bool]$spec.enabled }
        $slots = @()
        if ($spec.primary) { $slots += $spec.primary }
        if ($spec.fallback) { $slots += $spec.fallback }
        for ($i = 0; $i -lt $slots.Count -and $i -lt $tier.entries.Count; $i++) {
            if ($slots[$i].route) { $tier.entries[$i].route = [string]$slots[$i].route }
            if ($slots[$i].model) { $tier.entries[$i].model = [string]$slots[$i].model }
        }
    }
    return $Doc
}

function Write-Route($Doc) {
    $dir = Split-Path -Parent $routeDest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $json = ($Doc | ConvertTo-Json -Depth 8) + "`n"
    if ($secretRe.IsMatch($json)) { throw '生成的 route-config 含密钥形态，已中止。' }
    [System.IO.File]::WriteAllText($routeDest, $json, $utf8)
}

function Apply-EnvMap($Map) {
    $set = @()
    foreach ($name in $Map.Keys) {
        if (-not $name.StartsWith('DSHPACK_')) { continue }
        $value = [string]$Map[$name]
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        if ($value.StartsWith('<') -and $value.EndsWith('>')) { continue }
        if ($name.StartsWith('DSHPACK_KEY_')) {
            $pointer = $value
            if ([string]::IsNullOrWhiteSpace($pointer)) { continue }
            Set-UserValue $name $pointer
            $set += "$name -> $pointer"
            $current = [Environment]::GetEnvironmentVariable($pointer, 'User')
            if (-not [string]::IsNullOrWhiteSpace($current)) {
                $set += "$pointer (已有)"
                continue
            }
            if ($NonInteractive) {
                Write-Host "未设置用户环境变量 $pointer"
                continue
            }
            $secure = Read-Host "密钥 $pointer（直接回车跳过）" -AsSecureString
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            try {
                $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
            } finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            }
            if ([string]::IsNullOrWhiteSpace($plain)) { continue }
            Set-UserValue $pointer $plain
            $set += "$pointer (新写入)"
            continue
        }
        Set-UserValue $name $value
        $set += $name
    }
    return $set
}

if (-not $NonInteractive -and [string]::IsNullOrWhiteSpace($SharedRoot)) {
    $typed = Read-Host '共享盘目录（直接回车表示没有，改从安装包模板填写）'
    if (-not [string]::IsNullOrWhiteSpace($typed)) { $SharedRoot = $typed.Trim() }
}

$deviceEnvPath = Join-Path $localDir 'device.env'
$answersPath = $null
$sharedRoute = $null

if (-not [string]::IsNullOrWhiteSpace($SharedRoot)) {
    if (-not (Test-Path -LiteralPath $SharedRoot)) { throw "共享盘目录不存在: $SharedRoot" }
    $directEnv = Join-Path $SharedRoot 'device.env'
    $nestedEnv = Join-Path $SharedRoot 'dsh-device\device.env'
    if (Test-Path -LiteralPath $directEnv) {
        $bundle = $SharedRoot
        $sharedEnv = $directEnv
    } elseif (Test-Path -LiteralPath $nestedEnv) {
        $bundle = Join-Path $SharedRoot 'dsh-device'
        $sharedEnv = $nestedEnv
    } else {
        throw "共享盘上没有 device.env。可放在 $directEnv ，或 $nestedEnv 。同目录可选 device-answers.json 和 route-config.json。"
    }
    $map = Read-DeviceEnv $sharedEnv
    if (-not (Test-Path -LiteralPath $localDir)) { New-Item -ItemType Directory -Path $localDir | Out-Null }
    Copy-Item -LiteralPath $sharedEnv -Destination $deviceEnvPath -Force
    $answersPath = Join-Path $bundle 'device-answers.json'
    $sharedRoute = Join-Path $bundle 'route-config.json'
    Write-Host "已读取共享盘 $bundle"
} else {
    New-Item -ItemType Directory -Force -Path $localDir | Out-Null
    $example = Join-Path $packRoot 'templates\device-config.env.example'
    if (-not (Test-Path -LiteralPath $deviceEnvPath)) {
        Copy-Item -LiteralPath $example -Destination $deviceEnvPath
    }
    $map = Read-DeviceEnv $deviceEnvPath
    $choice = '1'
    if (-not $NonInteractive) {
        Write-Host '没有共享盘。选一种填法：'
        Write-Host '  1  用模板默认路由，只补密钥'
        Write-Host '  2  逐项确认路由和开关'
        Write-Host '  3  先退出，把 docs/AI-DEVICE-SETUP.md 交给 AI，生成文件放进本机目录后再跑'
        $choice = Read-Host '选择 [1]'
        if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' }
    }
    if ($choice -eq '3') {
        Write-Host "模板: $example"
        Write-Host "答案样例: $(Join-Path $packRoot 'assets\device-answers.example.json')"
        Write-Host "说明: $(Join-Path $packRoot 'docs\AI-DEVICE-SETUP.md')"
        Write-Host "写好后放到: $localDir"
        Write-Host '然后重新运行 scripts/setup.ps1'
        exit 0
    }
    if ($choice -eq '2') {
        foreach ($name in @($map.Keys)) {
            $map[$name] = Prompt-OrDefault $name $map[$name]
            if ($secretRe.IsMatch([string]$map[$name])) {
                throw "拒绝 $name ：不要把密钥写进答案文件。"
            }
        }
        Write-DeviceEnv $deviceEnvPath $map
    }
    $localAnswers = Join-Path $localDir 'device-answers.json'
    if (Test-Path -LiteralPath $localAnswers) { $answersPath = $localAnswers }
    Write-Host "本机答案目录: $localDir"
}

# 只改档位条目的 route 名；其余（failurePolicy / subagentRouting / 各条目 cooldownMs、reasoningEffort）原样保留。
function Update-SharedRouteIds($Raw, $Map) {
    $pairs = @(
        @('codex-relay', 'DSHPACK_ROUTE_CODEX_RELAY'),
        @('codex-official', 'DSHPACK_ROUTE_OPENAI_CODEX'),
        @('kimi', 'DSHPACK_ROUTE_KIMI'),
        @('ais', 'DSHPACK_ROUTE_AIS'),
        @('opencodego', 'DSHPACK_ROUTE_OPENCODE'),
        @('deepseek-official', 'DSHPACK_ROUTE_DEEPSEEK_OFFICIAL')
    )
    $doc = if ($Raw -is [string]) { $Raw | ConvertFrom-Json } else { $Raw }
    $changed = New-Object System.Collections.Generic.List[string]
    foreach ($tier in @($doc.providerFailover.tiers)) {
        foreach ($entry in @($tier.entries)) {
            foreach ($p in $pairs) {
                if ($entry.id -ne $p[0]) { continue }
                $want = $Map[$p[1]]
                if ([string]::IsNullOrWhiteSpace($want)) { continue }
                if ($entry.route -ne $want) {
                    $changed.Add($entry.id + ':' + $entry.route + '->' + $want)
                    $entry.route = $want
                }
            }
        }
    }
    return [pscustomobject]@{ doc = $doc; changed = $changed }
}

$writtenEnv = Apply-EnvMap $map
Write-Host ("用户环境变量: " + ($writtenEnv -join ', '))

$existing = $null
if (Test-Path -LiteralPath $routeDest) {
    $existing = Get-Content -LiteralPath $routeDest -Raw -Encoding UTF8 | ConvertFrom-Json
}

if ((Test-Path -LiteralPath $routeDest) -and -not $UpdateRoutes -and -not $sharedRoute) {
    Write-Host "已有路由文件，未覆盖: $routeDest"
    Write-Host '要按本次答案重写档位，加 -UpdateRoutes'
} elseif ($sharedRoute -and (Test-Path -LiteralPath $sharedRoute) -and ($UpdateRoutes -or -not (Test-Path -LiteralPath $routeDest))) {
    $raw = [System.IO.File]::ReadAllText($sharedRoute)
    if ($secretRe.IsMatch($raw)) { throw '共享盘 route-config.json 含密钥形态，已拒绝。' }
    $dir = Split-Path -Parent $routeDest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    # 2026-10-23：共享盘答案里写的是**源设备**的路由名，直接照抄会把本机不存在的路由名写成
    # 空转条目（本机 provider 是 opencodego，答案里是 opencode-go，实测该档位必然 NO_ADAPTER）。
    # 复制后按本机 device.env 的 DSHPACK_ROUTE_* 重写档位路由名，让同一份答案落多台设备都可用。
    $rewritten = Update-SharedRouteIds $raw $map
    [System.IO.File]::WriteAllText($routeDest, ($rewritten.doc | ConvertTo-Json -Depth 20), $utf8)
    if ($rewritten.changed.Count -gt 0) {
        Write-Host ("按本机 device.env 重写档位路由名: " + ($rewritten.changed -join ', '))
    }
    Write-Host "已复制共享盘路由到 $routeDest"
} elseif ($UpdateRoutes -or -not (Test-Path -LiteralPath $routeDest)) {
    $doc = Build-RouteFromMap $map $existing
    if ($answersPath -and (Test-Path -LiteralPath $answersPath)) {
        $answers = Get-Content -LiteralPath $answersPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $doc = Apply-AnswersRoutes $doc $answers
    }
    Write-Route $doc
    Write-Host "已写入 $routeDest"
} else {
    Write-Host "已有路由文件，未覆盖: $routeDest"
    Write-Host '要改用共享盘或本次答案，加 -UpdateRoutes'
}

if (-not $SkipInstall) {
    $install = Join-Path $PSScriptRoot 'install.ps1'
    if ($Source) {
        & $install -ProfileName $ProfileName -Source $Source -SkipOptional:$SkipOptional
    } else {
        & $install -ProfileName $ProfileName -SkipOptional:$SkipOptional
    }
    if ($LASTEXITCODE -ne 0) { throw 'install.ps1 验收失败；一键安装未完成，见上方报告。' }
} else {
    Write-Host '已跳过 install.ps1'
}

Write-Host '下一步：关掉正在跑的 DSH，重新打开，并新开一个会话。'
Write-Host '备份仍用 scripts/backup.ps1 。'
