# dsh-config-pack

一个**通用 DSH 配置包**：把"插件选择 + 本地配置层 + agent 预设"打成单个可被 DSH 直接安装的 npm 包，
经 git 分发，一条命令装进任意 DSH profile。

```powershell
dsh plugin --profile packed add github:Robert-Wang-08/dsh-config-pack#v0.4.0
```

> **一键安装交付什么、不交付什么**
>
> - **交付**：本包的配置层（`cordis.patch.yml`）、`config/*.yml`，以及 `package.json` 里声明的依赖插件
>   （provider-failover、provider-badge、sidebar-visibility、archived-sessions、subagent-monitor、ACP 抗性版）。
> - **不交付**：PTC 多代理预设与 bundle（`@local/dsh-ptc-multi-agent-mode`）。它需要额外一步——
>   用 `scripts/generate-ptc-companion.mjs` 生成 companion，再安装其中的 `dsh-bundle/`（见下文「公开 PTC 伴生配置」）。
> - SkillHub 侧资产（如 `ptc-multi-agent-control`）只做索引登记，正文在 `packages/dsh-ptc-multi-agent-mode/`。
> - 完整的 bundle / 依赖 / 设备级补充对照表见 [`docs/device-setup.md`](docs/device-setup.md) 的「目标 bundle 集合」。

---

## 它解决什么

换一台设备时，DSH 的 profile 里有三类东西：

| 层 | 内容 | 能否随包分发 |
|---|---|---|
| **L1 包内容** | 预设行、provider 路由、默认模型、预设注册表、插件配置覆盖 | ✅ 本包用 `cordis.patch.yml` 承载 |
| **L2 激活** | 依赖 + `dsh.profile.bundles` 顺序 | ✅ `dependencies` + DSH 自己的 `reconcile` |
| **L3 不可分发** | 凭据、环境变量、CLI 登录态、`link:` 路径 | ❌ 由 `pack.manifest.yaml` 声明为清单 |

L3 由包**自描述**，不再靠文档口口相传。

## 公开 PTC 伴生配置

公开用户不依赖 SkillHub：默认走 **Git 模板 + AI 问答**。生成器交付本机设置、最终 profile patch、完整 DSH bundle，以及去隐私化的完整 `ptc-multi-agent-control` skill（含 route/ledger/check-model/ACP 自检脚本、离线测试、schema 与 references）。

```powershell
# AI 问答模板：templates/ptc-public-companion/AI-QUESTIONNAIRE.md
node scripts/generate-ptc-companion.mjs --interactive --out <local-companion>
node scripts/generate-ptc-companion.mjs --answers <answers.json> --out <local-companion> --dry-run
node scripts/generate-ptc-companion.mjs --answers <answers.json> --out <local-companion>
```

把 `<local-companion>/ptc-multi-agent-control` 复制或链接到 `~/.agents/skills/ptc-multi-agent-control`，安装生成的 `dsh-bundle/` 及 profile-root ACP/Claude 依赖，再把 `ptc.local.patch.yml` 作为最后一层应用。若 skill 不存在或加载失败，preset 会明确降级为手工协调，不会声称拥有完整自动路由或账本能力。

问卷只保留真实消费者支持的字段。凭据、共享源、codex/Claude/node 可执行路径、ACP task timeout 与可配置重试已从 schema 删除；未知字段会被拒绝。完整说明见 [`docs/ptc-public-companion.md`](docs/ptc-public-companion.md)，隐私审计见 [`docs/ptc-privacy-audit.md`](docs/ptc-privacy-audit.md)。**公开 companion 尚未完成 clean-profile 端到端安装验收**；离线测试不能替代插件激活与 `!!js` 求值验证。

### 发布渠道边界

- **Git（本仓库的 annotated tag）是通用 DSH 配置、公开 PTC skill/bundle、故障转移档位和模板的发布源。** 安装、升级和回滚必须钉住 tag。
- 私有管理渠道可继续承载目录映射、key 指针和环境变量清单，但不是公开 PTC 完整性的依赖。真实凭据始终不进 Git。
- `templates/device-config.env.example` 只保留占位符和非敏感默认值。
- 子代理超时根因与设备落地说明见 [`docs/subagent-timeout-fixes-20261013.md`](docs/subagent-timeout-fixes-20261013.md) 与 [`docs/device-setup.md`](docs/device-setup.md)。

---

## 安装

### 正常设备

```powershell
# 一条命令：建 profile、写 pnpm 前置、装包、校验 bundle 登记，全在里面
pwsh scripts/install.ps1 -ProfileName packed

# 起
dsh packed
```

`install.ps1` 默认从**远端最新 v\* 发布 tag** 安装：`git ls-remote` 解析后按语义版本取最大，不再写死版本。要钉死版本时显式传 `-Source github:Robert-Wang-08/dsh-config-pack#vX.Y.Z`。它只调**一次**
`dsh plugin add`（装包与激活仍由 DSH 自己完成），失败时按 pnpm 错误码做有界自愈后重试，
最后校验 `dsh.profile.bundles` 里确实登记了本包。完整说明见
[`docs/one-command-install.md`](docs/one-command-install.md)。

> ⚠️ **顺序很关键。** 第一次 `add` 失败后直接重试，依赖其实已经落盘，DSH **不会**再为新依赖
> 登记 `dsh.profile.bundles`，结果是"装上了但整包不生效"。这也是下面这些历史硬约束曾经必须
> 手工处理的原因——现在由 `scripts/prepare-profile.mjs` 在 `add` **之前**写好。

> 以下几段保留的是**根因与排障口径**；对应的前置现在由 `install.ps1` 自动处理，不再需要手工执行。
>
> ⚠️ **为什么必须显式安装那三个子代理包。** DSH 的插件加载器从 **profile 根**解析行的
> `name:`，不是从 bundle 自己的 `node_modules`。只在 `package.json` 的
> `dependencies` 里声明它们**不够**：对应行激活失败，而 DSH 只打一行
> `dsh: warning: N entry did not activate`，会话照常起来，工具却凭空消失——不报错，也没有
> 其它症状。装完再跑一次，看不到 `did not activate` 才算真的装上。
>
> 佐证（本机实测，非推测）：`profiles/web/package.json` 里这三个包是**直接声明**的，
> 而伴生 bundle `@local/dsh-ptc-multi-agent-mode` 也声明了其中两个——两者同时存在，
> 与「必须装进 profile 根」一致。
>
> **2026-10-13 已在全新 profile 上复验完毕。** 除本条之外还测出三条硬约束：web app 必须显式加入
> profile 依赖；本包必须排在它要覆盖的行所属 bundle **之后**（否则 stderr 打 `patch: entry ... not found`，
> 覆盖静默失效）；git 宿主插件要先按其报错处理 pnpm 的 `allowBuilds` 再装，中途失败后重试不会自动补登记。
> 判据是 stderr 里**既没有** `did not activate`，**也没有** `patch: entry ... not found`。
> **从远端 tag 安装还有一条前置**：profile 的 `pnpm-workspace.yaml` 必须先写 `blockExoticSubdeps: false`（本包自带 git 宿主依赖，否则报 `ERR_PNPM_EXOTIC_SUBDEP`）与 `allowBuilds`，并把本包写在 `dsh plugin add` 参数**最后**。
> 完整步骤与实测数据见 [`docs/device-setup.md`](docs/device-setup.md) §2.1/§2.2。

### 升级

版本契约是 **annotated tag**。tag 不可移动、不可覆盖；修复必须发布新版本。升级时换成新 tag，DSH 会重新安装并保留 `dsh.profile.bundles` 中的注册：

```powershell
git -C <repo> fetch --tags origin
git -C <repo> checkout vX.Y.Z
dsh plugin --profile web add github:Robert-Wang-08/dsh-config-pack#vX.Y.Z
# 更省事：一键更新自动解析最新 tag，并顺带做 pnpm 前置与安装后偏差校验
pwsh scripts/update.ps1 -ProfileName web
```

回滚使用旧 tag 重跑同一条安装命令。

### 卸载

```powershell
dsh plugin --profile packed remove dsh-config-pack
```

> ⚠️ 卸载**不会**恢复任何被本包覆盖的行；被覆盖的行会回落到上一个声明它的层（通常是该插件的 bundle 默认值）。

### pnpm store 不一致：装不动的头号原因

`dsh plugin add/remove` 底层跑的是 pnpm。pnpm 把**当次安装用的 store** 记在
`<profile>/node_modules/.modules.yaml` 的 `storeDir` 里；之后若全局配置指向了别的 store，
命令会直接失败（`ERR_PNPM_UNEXPECTED_STORE`），表现是「装不上 / 卸不掉」，与本包无关。

诊断就两行对比：

```powershell
pnpm config get store-dir
Select-String -Path "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\.modules.yaml" -Pattern storeDir
```

两者不一致就必须**重链**（只改配置不够，node_modules 要重装一次）：

```powershell
# 1) 先停掉该 profile 的 DSH 进程（Windows 上文件被占用会重装失败）
# 2) 旁路旧目录，保留回滚能力
Rename-Item "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules" node_modules.oldstore
# 3) 用统一后的 store 重装（CI=true 让 pnpm 在非交互环境重建）
$env:CI='true'; pnpm install      # 在 profile 目录内执行
# 4) 验收
dsh plugin --profile <profile> list
```

回滚：删掉/改名新 `node_modules`，把 `node_modules.oldstore` 改回 `node_modules` 即可。

> **本机实测过的第二个失败模式**：默认 store（`%LOCALAPPDATA%\pnpm\store`）在部分 Windows
> 环境下跑不了 git 宿主依赖的 prepare，报 `ERR_PNPM_PREPARE_PACKAGE` 并指向
> `.../dsh-archived-sessions/tar.gz/...`。这类机器只能用**另一个可写 store**，并让全局配置
> 指向它——配置与 `.modules.yaml` 两边一致才算装好。具体 store 路径属设备本地信息，
> 写在 `~/.dsh/device/device.env`，**不进本仓库**。
> 排障全流程见工作区 `docs/bootstrap/pnpm-store-与重链.md`。

另一个和速度相关的开关：`install.ps1 -NoRetry` 关掉 pnpm 取包重试与自愈重试。镜像对
跨平台二进制（`claude-agent-sdk-*`、`@openai/codex`、`libreoffice-kit-*`）持续 403 时，
默认重试会把单次 `add` 拖到 4 分钟以上；确定这些平台包用不到时可以关掉。

---

## 为什么不需要安装脚本

DSH 自己就把"装包"和"激活"合成了一步。这条链路可在安装目录里查证：

```
dsh plugin --profile <p> add <spec>
  → dsh/lib/plugin-*.js  runPluginCommand
      → @deepseek-ai/dsh-plugin-manager  lib/types/operations.js:526
          → runProfilePnpm (:246)
              → pnpm install
              → reconcile (:44, 调用点 :504)
                  → 新依赖若声明 dsh.bundle → push 进 dsh.profile.bundles (:64)
                  → 原子写 package.json (:71)
```

所以**注册 bundle 不需要手改 `package.json`**。本包因此**不编辑 `cordis.patch.yml`**——
`scripts/install.ps1` 相应只做三件事：建 profile、写 pnpm 前置（`scripts/prepare-profile.mjs`）、
把**一次** `dsh plugin add` 交给 DSH，然后校验登记结果。它不碰运行时 patch 文件。

---

## 开发

```powershell
npm run build     # config/*.yml → cordis.patch.yml（生成物，入库）
npm run verify    # 包校验 + PTC 公开模板隐私/契约校验 + 组件锁离线交叉校验
npm test          # PTC 生成器 dry-run/overwrite/rollback 行为测试
node scripts/verify.mjs --profile web   # 额外检查目标 profile 是否遮蔽本包
node scripts/verify-components.mjs      # 组件锁 vs 已发布现实（匿名解析每个 tag）
```

组合锁、验证器的判定口径、发布列车顺序与带外步骤见
[`docs/one-command-install.md`](docs/one-command-install.md)。

### 目录

```
config/10-subagents.yml   ACP provider 行 + claude-code/codex 权限覆盖
config/20-mcp.yml         四个 MCP server 行（默认全关，ticktick 按入口路径自动开）
config/30-ui.yml          目录选择器接线 + 欢迎语版本
config/40-models.yml      默认模型 + llm-pi-ai 六条路由
config/45-failover.yml    dsh-deepseek-keypool 完整故障转移档位（route 可 DSHPACK_ROUTE_* 覆盖）
config/50-presets.yml     legacy 预设 preset-standard-codex
config/60-registry.yml    预设注册表 selectedDefault
scripts/metrics.mjs       执行指标提取器（只读；见「执行指标与路由校准」）
scripts/compare-profile.mjs 只读对照 pack vs 目标 profile（stdout JSON）
docs/ROW-OWNERSHIP-20261013.md
                          跨层行归属分析（伴生工作产出，非本包契约的一部分）。
                          其中只有头条数字经独立复核：组合后的 web 配置顶层 `- id:` 共 207 个、零重复。
```

改配置**只改 `config/`**，然后 `npm run build`。`cordis.patch.yml` 是产物，不要手改。

### 开关

所有开关都是环境变量；**改完必须重启 DSH**（环境变量不会进入已在运行的进程）。

| 变量 | 默认 | 作用 |
|---|---|---|
| `DSHPACK_ACP_OPENCODE` | 开 | ACP 子代理 opencode |
| `DSHPACK_ACP_KIMI` | 开 | ACP 子代理 kimi |
| `DSHPACK_ACP_CURSOR` | **关** | 设为 `on` 启用 cursor-agent |
| `DSHPACK_MCP_CODEGRAPH` | 关 | 设为 `on` 启用 |
| `DSHPACK_MCP_TENCENT_DOCS` | 关 | 需 `TENCENT_DOCS_TOKEN` |
| `DSHPACK_MCP_SLIDE` | 关 | 需 `TENCENT_DOCS_TOKEN` |
| `DSHPACK_TICKTICK_ENTRY` | 空 | 填 ticktick-mcp 的 dist/index.js 绝对路径即自动开启 |
| `DSHPACK_NODE` | `node` | stdio MCP 用的 node 绝对路径 |
| `DSHPACK_DEFAULT_PROVIDER` / `DSHPACK_DEFAULT_MODEL` | `codex-relay` / `gpt-6.1-sol` | 新会话默认模型 |
| `DSHPACK_SELECTED_PRESET` | `ptc-multi-agent` | 预设注册表选中项 |
| `DSHPACK_BASE_*` / `DSHPACK_KEY_*` | 见 `config/40-models.yml` | 覆盖路由 baseURL / apiKeyEnv |
| `DSHPACK_ROUTE_CODEX_RELAY` | `codex-relay` | failover tier1 主路由 id |
| `DSHPACK_ROUTE_OPENAI_CODEX` | `openai-codex` | failover tier1 备用路由 id |
| `DSHPACK_ROUTE_AIS` | `ais-2dsglm` | failover tier2 主路由 id |
| `DSHPACK_ROUTE_OPENCODE` | `opencode-go` | failover tier2 DeepSeek 备用；另一设备可设为 `opencodego`（`setup.ps1 -SharedRoot` 复制共享盘答案后，会按此值重写档位 route 名） |
| （profile 行 `agent-default-model.reasoningEffort`） | 未设置 | 新会话默认推理档位。`setup.ps1` 不写 profile，故按设备手工加：`agent-default-model` 的 config 里加 `reasoningEffort: max`；模型须先声明 `reasoningEfforts`（本包已为 `deepseek-v4.1-flash` 声明 low/high/max） |
| `DSHPACK_ROUTE_KIMI` | `kimi-coding` | failover tier3 路由 id |
| `DSHPACK_ROUTE_DEEPSEEK_OFFICIAL` | `deepseek-official` | failover tier4（默认禁用） |

### 异构设备：用引导文件让 AI 生成你本机的路由

本机没有仓库默认的那些 provider，或想换一套路由顺序时，**不要改仓库默认值**——
生成一份本机覆盖层即可。指引与填写模板：

| 文件 | 作用 |
|---|---|
| [`docs/AI-DEVICE-SETUP.md`](docs/AI-DEVICE-SETUP.md) | 给 AI 的引导文件：可变项对照表、产出物形状、校验步骤、隐私红线 |
| [`assets/device-answers.example.json`](assets/device-answers.example.json) | 填写模板（provider 集合 / 档位映射 / 默认模型 / 子代理开关），**不含凭据字段** |

为什么不需要改代码：路由顺序是 `DSHPACK_ROUTE_*`、端点与凭据是 `DSHPACK_BASE_*` / `DSHPACK_KEY_*`、
provider 与模型清单在 `config/40-models.yml`（纯数据）。设备差异一律走 profile 最后一层覆盖。

### 一键安装

```powershell
pwsh scripts/setup.ps1
```

先问有没有共享盘。有，就读 `<共享盘>\dsh-device\` 里已经填好的答案。没有，就从本包模板生成本机文件，用命令行确认，或把 [`docs/AI-DEVICE-SETUP.md`](docs/AI-DEVICE-SETUP.md) 交给 AI。然后安装 Git 包、写入 `route-config.json`、设置 `DSHPACK_*` 用户环境变量。密钥只进用户环境变量。说明见 [`docs/device-setup.md`](docs/device-setup.md) §8。

### 一键同步（更新）

已装好的设备不用重装，一条命令把包、可选三方组和 pnpm 前置一起拉到最新发布版：

```powershell
pwsh scripts/update.ps1 -ProfileName packed
```

它依次做三件事：解析远端最新 `v*` tag（`git ls-remote` 按语义版本取最大，不信任本地 tag）→ 与 profile 当前 spec 比较（相同则提示无需更新，加 `-Force` 强制重跑）→ 复用 `install.ps1` 全流程（pnpm 前置 + 一次多 spec add + 安装后偏差校验）。

> 它**不重拉**共享盘的设备答案与路由；那两项变更后用 `pwsh scripts/setup.ps1 -UpdateRoutes`。

### 脚本位置

PowerShell 入口全部在本包 `scripts\` 下（路径相对仓库根）：

| 脚本 | 作用 | 典型用法 |
| --- | --- | --- |
| `scripts\setup.ps1` | 一键恢复式安装：读共享盘设备答案 → 写 `DSHPACK_*` → 装包进 profile | `pwsh scripts/setup.ps1 -SharedRoot <云盘根>` |
| `scripts\install.ps1` | 装/升级本包到一个 profile（默认自动取最新 tag） | `pwsh scripts/install.ps1 -ProfileName packed` |
| `scripts\update.ps1` | **一键同步**：已装设备更新到最新发布版 | `pwsh scripts/update.ps1 -ProfileName packed` |
| `scripts\backup.ps1` | 备份 profile 配置与清单（凭据不入备份） | `pwsh scripts/backup.ps1 -Profile web` |
| `scripts\release.ps1` | 发版：升版本 → 重建补丁 → 校验 → 写 CHANGELOG → 打 tag（可推送） | `pwsh scripts/release.ps1 -Bump patch -Note '...' -Push` |

`install.ps1` 与 `update.ps1` 都支持 `-Source github:Robert-Wang-08/dsh-config-pack#vX.Y.Z` 钉死版本；不传则自动解析远端最新 tag。

### 一键备份

```powershell
pwsh scripts/backup.ps1 -Profile web           # 目录 + zip + manifest.json + PRIVACY.md
pwsh scripts/backup.ps1 -Profile web -NoZip    # 只要目录
```

配置备份覆盖 profile 的 `cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`compatibility.json` 和 `patches/*.patch`，以及设备答案、预设、插件的 settings/config/route-config 文件。清单记录 SHA256、缺失项、拒绝项与排除项。ZIP 同时包含隐藏预设。

扫描会拒绝凭据形态和个人家目录路径；单纯的环境变量引用无需填入密钥即可备份。退出 0 只代表本次配置范围完整；退出 2 表示 partial，不能当作完整恢复点；其他非零表示失败。旧输出目录不可重复使用。此包不包含宿主依赖、CLI/OAuth 登录态、会话或任意插件数据库；完整本机私密快照使用 `dsh-backup-restore`。

官网模型从 v0.10.11 起显式声明，v0.10.13 起安装验收会阻断旧 profile 遮蔽与激活失败，同版本更新也会验收。v0.10.14 固定 OpenCode Go 的 30 个模型，并补齐 Kimi 官方 K2.7 Code/K2.6 模型；v0.10.15 增加 scripts/refresh-model-catalog.mjs；v0.10.16 将模型/子代理可用性快照纳入共享盘 dsh-device 资源包并接入 setup/backup，可从当前 pi-ai 目录检查并应用模型清单，同时检查 subagent 白名单和 ACP/CLI 命令。自定义 relay 的可用性仍需目标端点实测。使用说明见 [模型目录刷新](docs/model-catalog-refresh.md)。新设备恢复、回滚和验证步骤见 [备份恢复审计](docs/backup-restore-audit.md)。

---

## 超时模型（2026-10 对 DSH 0.2.0-rc.2 实装的核实）

「子代理超时」有五个互不相同的层，混为一谈是本仓反复踩过的坑。**没有任何一层是「子代理任务运行超时」配置项**：

| 层 | 真实配置面 | 默认值 | 是任务级超时吗 |
|---|---|---|---|
| @deepseek-ai/dsh-subagent-acp | 只有 `providerName` / `command` / `args` / `cwd` / `permission` / `env` / `disposeEofGraceMs` / `disposeGraceMs` | 6000 / 3000 ms | **否**。前者是 stdin EOF 后的收尾宽限，后者是失败后观测结构化进程事实、以及 POSIX 上 SIGTERM→SIGKILL 的宽限。都是清理参数 |
| @deepseek-ai/dsh-tool-subagent | 没有 `timeoutMs` | — | **否**。所以 subagent 工具不受 `dsh-tool-call-timeout-policy` 约束 |
| @deepseek-ai/dsh-tool-fs-search | 协作式预算 30000 ms | 30 s | 是（工具级）。`glob` / `grep` 报的 `tool call timed out after 30000ms` 来自这里 |
| @deepseek-ai/dsh-ptc-runtime-node | `timeoutMs`（上限 `maxTimeoutMs`） | 120000 / 600000 ms | **是，且是本机最常触发的那一层**：覆盖运行时准备与执行，**包含等待嵌套工具与审批的时间**。从 `run_code` 里调子代理时卡住的就是它 |
| cursor-agent 自身 | `network.*` 只暴露 `useHttp1ForAgent` | 代理路径 ping 5 s；直连 10 s / 20 s | 不可配置 |

### 实务结论

- **不要把长时子代理塞进 `run_code` 的前台等待里。** 后台派发（`run_in_background`）再回收，或显式传更大的 `timeoutMs`（上限 600000）。
- **不要靠调大 `disposeEofGraceMs` / `disposeGraceMs` 来「放宽超时」**——它们不是任务超时。
- **Cursor 经代理传输不稳**：代理路径不给 HTTP/2 会话传 ping 选项，落到 5 s；直连路径 10 s / 20 s，而配置层没有超时项可调。本包因此把 `cursor.sh` 追加进小写 `no_proxy`（cursor-agent 只读小写，且按 host 后缀匹配）。**归因必须诚实**：当初的 A/B 是先后跑的、被时间混淆；代理恢复后做交错 A/B，两臂都是 4/4。所以这条是**防御性加固**，不是已验证的修复——真正的解法是把代理修好。网络必须经代理时设 `DSHPACK_CURSOR_KEEP_PROXY`。
- **重试规则**：只有被判定为 `transport` 的失败才重试，最多一次。`model` / `auth` / `spawn` 是确定性失败，重试只会浪费时间并掩盖真因。
- **统计超时不要按文本搜**：助手自己的推理正文也会复述 `execution deadline reached` 这类字样，按子串扫会高估。本机一次原始文本扫得 55，按 `tool/result` 事件计只有 17。以事件为准。

本机一次性观测（242 个会话日志、113245 行、21532 次去重工具调用）：ACP transport 失败 11、其它 ACP 失败 4、工具调用超时 12、PTC deadline 事件 17、取消 4。这是单机单次记录，不是普适统计。

## 执行指标与路由校准

`scripts/metrics.mjs` 只读解析 DSH 会话日志（多帧 zstd，经 `fzstd`），把「模型能不能把活干对」和「DSH 能不能可靠地收到并验收结果」分开计量。

```powershell
npm run metrics:selftest                       # 离线自检，108 条断言
node scripts/metrics.mjs scan  --sessions "$env:USERPROFILE\.dsh\sessions\<工作区目录>" --json
node scripts/metrics.mjs stats --sessions "<同上>" --group-by route,executor,model [--labels labels.json]
```

**能拿到**：按稳定事件 id 去重的工具调用次数（顶层 `callId` 与 `run_code` 内嵌的 PTC `subCallId` 分开计）；**互不合并**的超时分类（`toolTimeout` / `ptcDeadline` / `acpTransport` / `acpOther` / `cancelled`）；工具错误与错误码；实际观测到的 provider/model；token 用量；以及日志里**字面出现**退出码时的测试退出码。

**拿不到，且不会伪造**：

| 指标 | 状态 |
|---|---|
| 成本 | 永远 `null`，`costSource: unavailable`。DSH 只记 token，不记钱；Cursor 订阅也无法摊到单任务。**不要**据此排「单位成功成本」 |
| 首轮成功率 | 无 `--labels` 时为 `null`；`firstPassLabelCoveragePct` 报告覆盖率。分母为 0 或未标注时输出 `null`，不是 0 |
| 真实单任务耗时 | 目前报的是**会话墙钟跨度**（首事件到最后事件），长会话或续接会话会显著高估。时钟偏移的导入日志按 `null` 报，不猜 |

工具调用次数**只能**从子代理自己的会话日志取值：父侧 ACP 流只收已提交的 `agent_message_chunk` 文本，reasoning / 工具活动 / plan 都留在子会话日志里，不上 ACP。

### 校准路由的方法（方法是确定的，结论要靠数据）

1. 把现有规则路由当作冻结基线；
2. 按 `(route, executor, model)` 分组累积**带标注**的样本，标注是唯一可用的验收来源；
3. 只比较标注样本量足够的分组，每个比率旁边必须同时给出样本数；
4. 成本真的可得时再比「单位成功任务成本」；否则比首轮成功率、超时率与耗时，并说明用的是哪个基准；
5. **绝不自动切换路由**——只产出建议供人复核，记录用了哪些统计量，并保留人工强制与回滚。

## 写 `!!js` 的两条硬约束

不是风格问题，违反会导致 YAML 解析失败：

1. **不能出现「冒号加空格」** → 因此**禁用三元运算符**。`cond ? 'a' : 'b'` 里的 ` : ` 会被 YAML
   当成映射键。统一改写：`(cond && 'a') || 'b'`（各分支均为真值时安全）。
2. **不能以引号 / `{` / `[` / `!` 开头** → 会被当成映射、flow 序列或另一个标签。
   需要数组时用 `String(...)` 之类以标识符开头的写法包装。

这两条有自动化检查：`npm run verify`。

---

## Codex 子代理路由

本包同时暴露两个不同的 Codex 能力入口：

- `subagent_codex` 仍使用 `openai-codex` 官方 app-server 和 OpenAI OAuth/Office 额度。
- `subagent_codex_relay` 是独立的通用 spawn 子代理，固定使用现有 `codex-relay/gpt-6.1-sol`，通过 `openai-responses` 从 `config/40-models.yml` 读取 endpoint 和 `CRS_OAI_KEY` 引用；它不会启动官方 Codex app-server。

主控 provider failover 和子代理 provider failover 是两套机制。当前配置包提供独立 relay 入口，但 DSH 0.2 的配置层没有稳定的工具结果重派发 hook，因此不能把主控 `agent/request-error` 误称为子代理自动 fallback；quota 自动重派发、attempt 去重和跨 provider receipt 聚合需要运行时调度层支持。完整分类、receipt 约定和排障步骤见 `docs/codex-subagent-failover.md`。

---

## 子智能体逐次模型选择

`config/50-presets.yml` 的 `tool-subagent` 行开了 `modelSelectionSettings: true`，但**工具侧开关本身不够**：
`subagent` 工具只在 Host 偏好 `subagent-model-selection-settings` 有**已记录的非空精确路由白名单**时，
才向模型暴露 `provider` / `model` / `reasoning_effort` 三个可选参数并注册 `list_subagent_models`；
策略为空时工具只暴露 `prompt` / `description` / `run_in_background`——表现就是"派发参数里的显式路由永远是空的"。

本包在 `config/40-models.yml` 里提供这条策略（`enabled: true` + 精确白名单），
覆盖 PTC 路由表的控制 / 执行 / 设计三类及其降级项：

| provider | model | 用途 |
|---|---|---|
| `codex-relay` | `gpt-6.1-sol` | 主控 / 分析 / 设计 / 验证默认（`reasoning_effort=xhigh`） |
| `codex-relay` | `gpt-6-astra` | 可选：需要 Astra 时显式指定，不再作设计默认 |
| `openai-codex` | `gpt-6.1-sol` | GPT 组降级（官方 OAuth） |
| `openai-codex` | `gpt-6.1-sol` | GPT 组降级目标（与 45-failover tier1 一致） |
| `ais-2dsglm` | `deepseek-v4.1-flash` | 执行 / 验证首选 |
| `opencode-go` | `deepseek-v4.1-flash` | DS 组降级 |
| `anthropic-relay` | `claude-opus-5` | Opus 5.5：仅高难度或 `top_down` 独立复核 |

白名单只列本包自己声明过的 provider/model 精确对，不含路径或凭据，可公开分发；某台设备缺某条路由的凭据时，
该条只显示为"已保存但当前不可用"，不影响其它路由。**不要用 `DSHPACK_ROUTE_*` 覆盖这份白名单**：
那组是 failover 的档位路由名（如 `opencodego`），与 llm provider id 不是同一命名空间。

边界：策略只对保存之后**新建的顶层会话**生效，已有或恢复的会话保持禁用；改完需重启 DSH 再开新会话。
自带 `agentOptions` 的工具实例（如 `subagent_codex_relay`）不受本策略影响——它的路由是行级固定的。

---

## 子代理失败原因上抛（2026-10-21）

### 问题

上游真实原因到不了调用方。opus-5.5 档因上游账户余额不足被 403 拒绝时，上层只看到：

```text
error; diagnostic: Product subagent failure (product: Claude Code; stage: query-run; category: invalid-result)
```

真实原因（`HTTP 403 预扣费额度失败，余额 ¥0.45 < 预扣 ¥1.16`）被适配器丢弃，只能绕过适配器用
CLI 直测才查得到。**诊断字段看不出"为什么失败"，等于把排查成本转嫁给使用者。**

### 根因不在服务层

| 层 | 结论 |
|---|---|
| `dsh-subagent` | **本来就支持**：`SubagentResult.diagnostic` 字段 + **4096 字节**上限 + `[diagnostic truncated]` 自动截断 |
| `dsh-tool-subagent` | **本来就支持**：渲染 `Diagnostic: <text>` |
| 适配器 | **未填充**：只输出固定 facts（stage/category/exit code），原始原因仅挂在 `Error.cause` 链上，从不渲染 |

也就是说通道一直在，缺的是把原因填进去。

### 改动

两个适配器各四处：新增 `causeDetail()` 从 `Error` / `AggregateError` / `cause` 链提取文本
（去重、压单行、上限 2000 字符），`failureDiagnostic()` 在固定 facts 之后追加一行 `cause:`。

```text
Product subagent failure (product: Claude Code; stage: query-run; category: invalid-result; result kind: error-result)
cause: upstream error result: Failed to authenticate. API Error: 403 预扣费额度失败, 用户剩余额度: ¥0.450870,
需要预扣费额度: ¥1.157422 (request id: ...)
```

Claude 侧另修三处：`is_error` 分支原本**连 cause 都不传**（403 原文彻底丢失）、
`resultKind` 从未渲染、`category: unknown` 时丢弃 `message.errors`。

### 分发：pnpm 静态补丁，安装即自动应用

Claude 适配器是官方包，不能改上游发布物，所以本包带一个补丁：

| 组成 | 位置 |
|---|---|
| 补丁文件 | `packages/dsh-ptc-multi-agent-mode/assets/patches/@deepseek-ai__dsh-subagent-claude-code@0.2.0-rc.2.patch` |
| 注入 | `scripts/prepare-profile.mjs` 复制到 `<profile>/patches/` 并写 `patchedDependencies` |
| 触发 | `install.ps1` 在 `dsh plugin add` **之前**调用 prepare-profile，pnpm 安装时自动套用 |

由 `pnpm patch` + `pnpm patch-commit` 官方流程生成（不是手工 diff）。**任何 `pnpm install` 都会重新应用**，
不需要事后手工 `git apply`；新设备走 `setup.ps1` / `install.ps1` 即自动获得。

已实测：删掉整个包目录后 `pnpm install --force` 全量重装 136 个包，补丁自动生效，测试 74/74 通过。

### 生效校验

```powershell
python -B scripts/verify-patches.py <profile-dir>
# PASS: all declared patches are applied
```

它读 `pnpm-workspace.yaml` 的 `patchedDependencies`，逐个确认补丁文件在、包已装、且改动标记落在安装产物里。
补丁失效（例如适配器升级后 key 不再匹配）会明确报 FAIL，不会静默放过。

### 限制

1. **版本绑定**：`patchedDependencies` 的 key 含版本号。升级适配器后补丁不会自动套用，需对新版本重跑
   `pnpm patch` 流程；缺失时表现为诊断里没有 `cause:` 行，不会静默给出错误结论。
2. **改动需重启 DSH 生效**：适配器在进程内加载。
3. **cursor 侧不走补丁**：`dsh-subagent-acp-resilient` 由组件锁固定版本（`pack.manifest.yaml`），
   该改动需在其仓库发布新 tag 并更新锁，才能随 `install.ps1` 同步到新设备。

---
## 本包不覆盖什么

| 行 id | 由谁提供 |
|---|---|
| `preset-ptc-multi-agent` | `ptc-multi-agent-control` 的 dsh-bundle |
| `subagent-acp-opencode-dsv41` / `-kimi-docs` / `-cursor-grok` | 同上 |
| `subagent-claude-opus5-plan` / `-opus48-plan` | 同上 |
| 五个 `tool-subagent-*` 与 `tool-presentation` | 同上 |

`dsh-deepseek-keypool` **由本包 owns**：插件只 insert 空 Host 行；完整档位表在 `config/45-failover.yml`。
装本包后应卸掉旧的 SkillHub `failover-tiers` bundle，并确保目标 profile 不再内联同 id 覆盖。

**为什么本包不自己声明这些 ACP 行。** 本包的 ACP 行用通用名（`opencode` / `kimi` / `cursor`），
PTC 用它的专用名（`opencode-dsv41` / `kimi-docs` / `cursor-grok`）并由 PTC bundle 自己注册，
其 `dsh-tool-subagent` 行再按这些名字绑定。**同一个 id 若被两个 bundle 同时声明，会按层序覆盖、
顺序不可控**——正是下面最后一条限制要避免的情况。所以 PTC 的 id 一律登记在 `delegated`，
`verify.mjs` 会拒绝本包再声明它们。

装齐两侧后可用组合视图自查：

```powershell
dsh --profile <name> --dump-config > composed.yml
node scripts/verify.mjs --composed composed.yml
```

`pack.manifest.yaml` 的 `owns:` 列出本包**独占**的行 id。若目标 profile 的
`cordis.patch.yml` 里还留着同 id 的内联块，**它会遮蔽本包**（profile patch 是最后一层，
按 id 覆盖、后写胜）。`verify.mjs --profile X` 会把这种情况报成错误。

---

## 已知限制

- **`--dump-config` 不能证明 `!!js` 被求值**。它回显的是**未求值的补丁源**（长表达式会被
  DSH 自身序列化成 `!!js >-` 折叠块）。`exit=0` 只证明"YAML 解析 + 层组合成功"，
  证明不了"表达式求值成了预期值"。要证后者，只能真起一个 profile 看行为。
- `dependencies` 里 `@deepseek-ai/dsh-base` / `dsh-web-app` 能否由目标设备的 pnpm 解析，
  取决于该设备的 registry/anchor 配置。`dsh plugin add` 的退出码是唯一判据。
- `reconcile` 只激活**新出现**的依赖（`operations.js:54-56 if (beforeDeps.has(name)) continue`）。
  若某依赖已存在但被从 `dsh.profile.bundles` 里手工删掉，重装本包不会把它加回来。
- 本包**不**依赖 bundle 之间的顺序。`readProfilePlugins` 用 `package.json` 里 `dependencies`
  的书写顺序，而 pnpm 会按字母序重写它——所以每行 id 必须由本包独占，否则顺序不可控。
- **在本仓库里跑 `npm install` 目前会失败**，原因是一个**与本次改动无关的既有** peer 冲突：
  `dsh-chat-import@0.25.2` 要求 `@deepseek-ai/dsh-tools <0.3.0`，而本仓锁在 `0.2.0-rc.2`。
  `scripts/metrics.mjs` 需要运行时依赖 `fzstd`（已在 `dependencies` 声明）。
- `config/60-registry.yml` 的 `selectedDefault: ptc-multi-agent` 依赖伴生 bundle 提供该预设，
  本包自己不带它；`verify.mjs` 目前**不检查**这条跨包依赖。
- `--composed` 需要先手工生成一份 `dsh --dump-config` 转储，且该转储是**未求值**的补丁源。
- `scripts/metrics.mjs` 报的耗时是**会话墙钟跨度**，不是单任务耗时；时钟偏移的导入日志按 `null` 报。
  要真正的单任务耗时需要按 turn 聚合，目前没有做。

## License

MIT
