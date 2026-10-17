# AI 协助的设备级配置生成（异构 provider / 不同路由顺序）

适用：换一台设备，本机**没有**与仓库默认相同的 provider 或模型，或想用**不同的路由顺序**。
目标：不改仓库默认值，生成一份**本机覆盖**，装完即用。

入口是 `scripts/setup.ps1`。没有共享盘时选「交给 AI」，再按本文生成文件，放到 `%USERPROFILE%\.dsh\device\` 后重新运行该脚本。

---

## 0. 为什么不需要改代码

| 可变项 | 承载方式 | 位置 |
|---|---|---|
| 路由顺序 / 档位指向哪条路由 | 环境变量 | `DSHPACK_ROUTE_*`（`cordis.patch.yml` 里每行都是 `!!js process['env'].X || '默认'`） |
| 新会话默认 provider/model | 环境变量 | `DSHPACK_DEFAULT_PROVIDER` / `DSHPACK_DEFAULT_MODEL` |
| provider 端点 | 环境变量 | `DSHPACK_BASE_<PROVIDER>` |
| 凭据变量名 | 环境变量（**只写名字**） | `DSHPACK_KEY_<PROVIDER>` |
| provider 集合、模型清单、api 类型 | **配置文件** | `config/40-models.yml` |
| 档位表（tier 结构） | **配置文件** | `config/45-failover.yml` |

所以"切换 provider/模型"是**改数据**，不是改代码；仓库里的 YAML 就是那份数据。
设备差异一律走**本机覆盖层**，不要改仓库默认值（否则下次升级冲突）。

---

## 1. 引导文件（AI 的输入）

复制 `assets/device-answers.example.json` 为 `%USERPROFILE%\.dsh\device\device-answers.json`（**不入库**），按下表填写。
样例本身就是填写契约，仓库里没有单独的 schema 文件。不要加凭据字段；`scripts/setup.ps1` 看到密钥形状会拒绝写入。

| 字段 | 含义 |
|---|---|
| `providers[]` | 本机实际可用的 provider：`id`（路由名，如 `anthropic-relay`）、`api`（`openai-responses`/`openai-completions`/`anthropic-messages`）、`baseURL`、`apiKeyEnv`（**变量名**）、`models[]` |
| `routes[]` | 档位到路由的映射：`tier`（`tier1`..`tier4`）、`primary`、`fallback` |
| `defaults` | 新会话默认 provider/model |
| `subagents` | 本机启用的子代理：`opencode`/`kimiDocs`/`cursor`/`claudePlan` 布尔 |

## 2. AI 的产出（两个文件）

### a) `dsh.env.ps1` —— 环境变量（机器本地，不入库）

```powershell
# 路由顺序：按你设备的实际路由名重排
[Environment]::SetEnvironmentVariable('DSHPACK_ROUTE_CODEX_RELAY', 'anthropic-relay', 'User')
[Environment]::SetEnvironmentVariable('DSHPACK_ROUTE_OPENAI_CODEX', 'kimi-coding',   'User')
[Environment]::SetEnvironmentVariable('DSHPACK_ROUTE_AIS',          'local-openai',  'User')
# 端点（没有就省略，省略即用仓库默认）
[Environment]::SetEnvironmentVariable('DSHPACK_BASE_ANTHROPIC_RELAY', 'https://your-endpoint', 'User')
# 凭据变量名（只写名字；值由你另行设置）
[Environment]::SetEnvironmentVariable('DSHPACK_KEY_ANTHROPIC_RELAY', 'MY_ANTHROPIC_KEY', 'User')
# 新会话默认
[Environment]::SetEnvironmentVariable('DSHPACK_DEFAULT_PROVIDER', 'anthropic-relay', 'User')
[Environment]::SetEnvironmentVariable('DSHPACK_DEFAULT_MODEL',    'claude-opus-5',   'User')
```

### b) `cordis.local.yml` —— 本机覆盖层（只写差异）

复用仓库的**同名 id**，profile 补丁是最后一层，按 id 覆盖、后写胜：

```yaml
# 覆盖 provider 集合：只列出本机有的
- id: llm-pi-ai
  config:
    providers:
      anthropic-relay:
        displayName: Anthropic Relay
        api: anthropic-messages
        baseURL: !!js process['env'].DSHPACK_BASE_ANTHROPIC_RELAY || 'https://your-endpoint'
        apiKeyEnv: !!js process['env'].DSHPACK_KEY_ANTHROPIC_RELAY || 'MY_ANTHROPIC_KEY'
        models:
          - id: claude-opus-5
      local-openai:
        displayName: Local OpenAI-compatible
        api: openai-completions
        baseURL: !!js process['env'].DSHPACK_BASE_LOCAL || 'http://127.0.0.1:11434/v1'
        apiKeyEnv: !!js process['env'].DSHPACK_KEY_LOCAL || 'LOCAL_OPENAI_KEY'
        models:
          - id: qwen3-32b

# 覆盖子代理模型白名单，只列本机可用对
- id: subagent-model-selection-settings
  config:
    enabled: true
    allowedModels:
      - provider: anthropic-relay
        model: claude-opus-5
      - provider: local-openai
        model: qwen3-32b
```

应用方式二选一：
- 放进 `$DSH_HOME/profiles/<p>/cordis.patch.yml`（本机私有层）；
- 或用 `dsh --profile <p> --patch ./cordis.local.yml` 临时叠加。

## 3. 校验（装完必做）

```powershell
node scripts/verify.mjs --profile <p>              # id 是否被遮蔽
dsh --profile <p> --dump-config > "$env:TEMP\composed.yml"
node scripts/verify.mjs --composed "$env:TEMP\composed.yml"   # 悬空 provider
```

注意 `--dump-config` 回显的是**未求值**的补丁源，不能证明 `!!js` 取到了什么值；判定可用性要在新会话里实调一次。

## 4. 隐私红线（AI 必须遵守）

1. **只写变量名，不写值**：`apiKeyEnv` / `DSHPACK_KEY_*` 里永远是名字。
2. `device-answers.json`、`dsh.env.ps1`、`cordis.local.yml` **都是机器本地文件，不入库**。
3. 不把任何 key、token、cookie、私钥、凭据文件路径写进上述文件。
4. profile 目录里的本地状态（`$DSH_HOME/profiles/<p>/*`）与其备份一律不提交。

## 5. 一键备份与恢复

```powershell
pwsh scripts/backup.ps1 -Profile <p>          # 产出目录 + zip + manifest.json + PRIVACY.md
pwsh scripts/backup.ps1 -Profile <p> -NoZip   # 只要目录
```

备份只包含配置与清单：profile 的 `cordis.patch.yml`/`package.json`/`pnpm-workspace.yaml`、
本机路由策略 `route-config.json`，加上登记变量名与 link 依赖的 `manifest.json`。
**凭据文件与凭据值永不进入备份**；恢复时在新设备重新提供凭据即可。
