# Changelog

本文件由 `scripts/release.ps1` 维护；每次发版在顶部追加一段。

## 0.10.12

安装/更新脚本补「按实际在用选定 profile」判据（2026-10-27 web/packed 装反事故的教训：默认值 packed 只代表新装引导场景，装前必须用运行中进程/AGENTS 声明/活跃度取证确认目标），update.ps1 更新后验收 Recent Sessions 登记；bundle 补丁内容与 v0.10.11 相同

## 0.10.11

openai-codex（gpt official）显式声明官方模型清单——新增 gpt-6.1-sol（pi-ai 0.87.1 内置目录缺失、1.4.0 才收录；声明窗口 500k / 输出 128k / 文本+图片 / 全推理档位），补齐 0.87.1 ∪ 1.4.0 全部 9 个官方 id（旧目录独有的 gpt-5.5、gpt-5.3-codex-spark 标注保留）；同时去掉子代理模型白名单里重复的 openai-codex/gpt-6.1-sol 条目

## 0.10.10

组件锁推进：provider-failover v3.6.0（多 key 保存按 Host 同口径预校验、冷却语义修正、WINDOWFIX 上下文溢出切换）、sidebar-visibility v0.0.7（rc.2 目录树视图与未读亮点）；三份依赖 pin 同步

## 0.10.9

kimi-coding 对齐 kimi 官网目录：新增 k3.1-pro / k3.1-pro-highspeed（2026-10-23 发布），kimi-for-coding 显示名改 Kimi K2.8 Preview（id 不变），子代理白名单同步两条新路由

## 0.10.8

文档：pnpm store 不一致（ERR_PNPM_UNEXPECTED_STORE / ERR_PNPM_PREPARE_PACKAGE）的诊断与 profile 重链步骤；补充 -NoRetry 说明

## 0.10.7

一键安装提速：组件登记跳过 link: 本地仓库已提供的同名包、缺失项合并为一次 add；新增 -NoRetry 关闭 pnpm 取包重试与自愈重试

## 0.10.6

provider 徽标可见配置参考与覆盖示例（docs/provider-badge-config.md、examples/provider-badge.config.yml），并把组合锁里的 dsh-plugin-provider-badge 钉从 v0.1.0 升到 v0.3.1（否则按 tag 安装的设备拿不到 10-23 的额度修复与可见配置）；三处依赖 spec 与两份清单同步，cordis.patch.yml 内容未变

## 0.10.5

默认切换顺序与 PTC 路由链统一 gpt-6.1-sol：allowedModels/README 的 openai-codex 项改 6.1、subagent-codex 钉 gpt-6.1-sol；ds4.1-flash 在 ais-2dsglm 声明 reasoningEfforts(low/high/max) 并给 failover tier2 加 reasoningEffort max；setup.ps1 复制共享盘答案后按本机 DSHPACK_ROUTE_* 重写档位 route 名，修复源设备路由名被抄成空转条目

## 0.10.4

移除误入版本库的本机 .bak 备份副本，并加忽略规则防止 release 再次打包

## 0.10.3

install.ps1 自动解析最新 tag 并用可执行校验挑选 Python，修复一键安装落后版本与 Claude 预置空转

## 0.10.2

修复 Claude 配置预置读取 Windows User 和 Machine 环境变量

## 0.10.1

修正 v0.10.0 遗留的档位来源不一致：public-runtime-config 的 opusLadder 首档 provider 改 claudetokeniss25、five_five.defaultConfigDir 改 tokeniss25；SKILL.md 中「5.5 只在 tokeniss 提供」的过时表述同步为 tokeniss/tokeniss25 双源 + 默认 tokeniss25。此前后者已随 bundle 默认值改为 tokeniss25，但运行时配置与 skill 文档仍指旧源，属同一次改动的文档一致性缺口

## 0.10.0

子代理失败原因上抛：claude 适配器经 pnpm 静态补丁透传上游 cause（403 余额不足等可操作原因直达调用方）；补丁随 assets/patches 分发、prepare-profile 注入 patchedDependencies，install 即自动应用；opus55 档默认配置目录改指 tokeniss25，claude_config_profiles.py 新增该档、install.ps1 自动预置；acp-resilient 组件锁升至 v0.2.2

## 0.9.6

codex-relay 模型补 contextWindow：gpt-6.1-sol=500000，gpt-5.6-sol/gpt-5.6/gpt-5.5/gpt-6-astra=272000；修复上游已受理的会话被 pi-ai 误判上下文超限、compaction 恢复无效而整轮失败；新增模型必须在 config/40-models.yml 显式声明窗口

## 0.9.5

failover 档位/默认模型统一 gpt-6.1-sol；模型目录 6.1 提前；依赖追平 keypool v3.5.0

## 0.9.4

修正 v0.9.3 组件锁：sidebar v0.0.4 / archived v0.4.2 重打 tag（补版本号与 prepare 脚本）后，锁内解引用 commit 对齐新 tag；同步 update.ps1（已安装设备一键更新：解析远端最新 tag、版本比较、复用 install 全流程与偏差验收）。

## 0.9.3

一键安装修复：prepare-profile 默认放行第一方 git 组件构建（tag 压缩包只有 src，不构建则 lib 入口缺失、插件无法激活）；组件锁升级 sidebar v0.0.4 / archived v0.4.2（新增 prepare 脚本，git 安装自动构建 lib）；install.ps1 改为 pack+可选组一次多 spec add（连续多次 add 的 reconcile 会挤掉先前登记的依赖 bundle）；可选组 spec 补 name@version 形态；自愈升级为提取 pnpm 建议的完整 tarball URL key。

## 0.9.2

默认档切 gpt-6.1-sol：config/10-subagents、40-models、45-failover、50-presets 与 PTC 资产（SKILL/CHANGELOG/bundle/runtime-config/ptc_route.py）、setup.ps1、docs 联动更新；install.ps1 默认 Source 追平本 tag。

## 0.9.1

新增安装后偏差比较验收 verify-install.mjs：期望集（核心依赖+可选三方组）对照实装（版本/bundle/入口），聚合 shadowing/composed/patch 对照，支持 --baseline 对拍观察基线（采样 SHA256）；install.ps1 第 4.6 步自动执行，默认 Source 追平本 tag。

## 0.9.0

三方插件改为可选组：recent-sessions/dshmarket/director/palette 移出包依赖，进 assets/optional-components.json，install.ps1 默认补装、-SkipOptional 整组跳过；github 件保留组件锁（optional: true，tag→commit 照常校验）。

## 0.8.1

按源设备实装清单补齐三方插件：dshmarket v1.66.21（组件锁）、dsh-plugin-subagent-director 0.5.6、dsh-palette 0.2.1；自写件 ptc-switches 暂无独立仓库，仍走伞仓库 link。

## 0.8.0

纳入 dsh-recent-sessions v0.1.2 组件锁（修复新设备漏装 Recent Sessions：此前它只在源设备 web profile 手工登记，config-pack 依赖/组件锁/setup 均未覆盖）；同时收录已在线但未发版的提交：一条命令 setup（共享盘或模板）、continuous 档改 ais-2dsglm/glm-5.3-flash、openai-codex 显示名 gpt（official）；install.ps1 默认 Source 升至本 tag。

## 0.7.0

**破坏性（对内）**：公开伴生包的生成器换源，模板副本整目录删除。版本升 minor 而非补丁，因为**输入源与校验面都变了**，不只是修 bug。

### Changed
- **生成器输入由模板副本改为权威本体** `packages/dsh-ptc-multi-agent-mode/`。`templates/ptc-public-companion/ptc-multi-agent-control/` 整目录删除，替换为一段说明该路径**有意保持为空**的指引（生成器仍按原目录名交付产物，安装路径不变）。
- **删掉硬编码的 `SKILL_VERSION` 常量**，改为运行时读取权威本体的 `skill.json`。此前版本号有**四个互不校验的副本**（manifest 声明 1.0.0、生成器硬编码 1.2.0、模板 1.2.0、权威本体 0.13.0），硬编码正是漂移的根因。
- 权威本体的 `SKILL.md` 补上 `version: 0.13.0`（此前**没有**该 frontmatter 行，换源会立即撞上 frontmatter 与 skill.json 的 parity 校验）。
- `pack.manifest.yaml` 的 `public_companion.skill` 指向权威本体，`skill_version` 由 1.0.0 更正为 0.13.0。
- 公开伴生包的依赖集合与权威本体、主包**逐项一致**（16 项），并由验证器在三份 manifest 之间强制。

### Added
- **版本一致性强制**：`public_companion.skill_version` 必须等于 `public_companion.skill` 所指路径下 `skill.json` 的版本，纳入 `npm run verify`；不一致即非零退出。此前该字段**没有任何校验器读取**，因此静默漂移。

### Notes
- 公开前隐私复核结论：权威本体比模板多出的 6 个文件**全部可公开，未做任何排除**。唯一判断点是 `claude_config_profiles.py` 提及两个 relay 端点，但同类端点已在公开的 `config/40-models.yml` 中，不构成新增暴露。

## 0.6.3

companion bundle 对齐主包（选项 C），并把"一致"从口头承诺变成被强制的检查。

### Changed
- 两份 companion bundle 的 `dependencies` 由 3 项扩到与主包**逐项一致**（16 项，含全部自写组件、上游 fork 与第三方 npm 包）。
- `scripts/verify-components.mjs` 扩展为**同时校验三份 manifest**：任一依赖缺失、pin 与锁不符、或三份之间规格不同，即非零退出。

### Added
- `docs/component-inventory.md`：逐项说明**每个插件的来源**（自写 5 个 / 上游 fork 1 个 / 第三方 npm 3 个 / 官方）、三类来源各自的处理方式，以及 **4 个 MCP 服务器**的传输、端点、默认状态与本机差异点。
- `pack.manifest.yaml` 的 `verification:` 块新增 `inventory` 指向该清单。

### Notes
- 选项 C 的两个已知后果已写入清单文档：①四个 MCP 行仍只有主包声明，`@deepseek-ai/dsh-mcp-client` 在 companion 路径上暂无消费者；②`dsh-base`/`dsh-web-app`/`fzstd` 也在 companion 依赖里，是"完全一致"口径的直接结果，不是遗漏。
- 已实测：只改其中一份 companion 的 pin、或从一份里删掉一个依赖，验证器都会失败并指出具体文件与依赖名。

## 0.6.2

修掉 README 里与实际行为**相矛盾**的安装说明。

### Changed
- README 安装章节由"手工装三个子代理包 + 手改 `pnpm-workspace.yaml` + 显式跑校验"改为**一条** `pwsh scripts/install.ps1 -ProfileName <p>`，并说明安装器只调一次 `dsh plugin add`、失败时按 pnpm 错误码有界自愈、最后校验 bundle 登记。
- 升级章节的 `#v0.4.0` 更新为当期 tag，并给出安装器写法。
- 历史硬约束段落保留，但明确标注为**根因与排障口径**（对应前置已由 `scripts/prepare-profile.mjs` 在 `add` 之前写好），不再要求人工执行。
- 补上"顺序很关键"的实测结论：第一次 `add` 失败后直接重试，依赖已落盘，DSH 不会再登记 `dsh.profile.bundles`。
- 「为什么不需要安装脚本」一节改为准确表述：本包**不编辑 `cordis.patch.yml`**；开发命令表补上 `node scripts/verify-components.mjs` 与 `docs/one-command-install.md` 入口。

## 0.6.1

补齐 0.6.0 遗漏的文档面：新工具此前在仓库里**零文档**，而 README 仍在教已经被自动化掉的旧手工流程。

### Added
- `docs/one-command-install.md`：单命令安装做了什么、为什么必须先写前置再 add、组合锁字段含义、验证器用法与**已实测的四种失败模式**、CI 强制点、发布列车顺序，以及任何包都替代不了的带外步骤。
- `pack.manifest.yaml` 新增 `verification:` 自描述块，统一指向锁、验证器、CI、安装器与本文档。

### Changed
- 补上 `dsh-permission-compat` 的带外使用步骤（打补丁 / 校验 / 回滚）。它是宿主补丁工具，**不能**作为 `dsh plugin` 依赖安装，因此不在单命令路径内，此前除锁里的 `why` 之外没有任何说明。

### Notes
- README 的安装章节仍描述旧的手工前置（显式安装子代理包、手改 `pnpm-workspace.yaml`）。该文件当时带有其它会话的未提交改动，为避免把他人在制品裹进本次提交，**本版未回写 README**；待其确权后统一改写。

## 0.6.0

本包成为**唯一公开发布入口**：单条命令即可把插件、DSH 配置、agent 预设与 PTC 路由控制面装进一个全新 profile，且全部依赖都从匿名可读的公开源解析。

### Added
- **组合锁**：`pack.manifest.yaml` 新增 `components:`，逐个登记组件的仓库、不可变 tag 与**解引用后的 commit SHA**；这是 release train 的唯一事实源。
- **失败即关闭的组件验证器** `scripts/verify-components.mjs`：匿名重新解析每个 tag，校验①仓库可匿名读取 ②tag 存在 ③tag 解析出的 commit 与锁记录一致；并交叉校验 `package.json` 的依赖集合（无未登记的 git 依赖、无未钉 tag 的 spec、pin 与锁一致）。任一不符即非零退出。
- CI 工作流 `.github/workflows/verify-components.yml`：push / PR 触发，另有每周定时任务 —— 因为 tag 可在上游被移动或重建，没有定时复核就没人会发现。
- `scripts/install.ps1` 重写为真正的单命令安装器：profile 不存在时按发行模板创建，写好在装本包必需的 pnpm 前置，然后**只调一次** `dsh plugin add`，失败时按 pnpm 错误码做有界自愈后重试（最多 3 次），最后校验 bundle 登记并跑只读校验。
- `scripts/prepare-profile.mjs`：把 `blockExoticSubdeps: false`、`nodeLinker: hoisted` 与 `allowBuilds` 写进目标 profile 的 pnpm 配置；只改 pnpm 配置，不碰 `cordis.patch.yml`。
- 新增依赖 `dsh-plugin-subagent-monitor`、`@local/dsh-subagent-acp-resilient`（后者的 provider 行此前已在包内，但包没有依赖它，导致全新 profile 启动即报 `failed to import`）。

### Changed
- 全部 git 宿主依赖从**跟随默认分支**改为**钉不可变 annotated tag**：`dsh-plugin-provider-badge#v0.1.0`、`dsh-plugin-sidebar-visibility#v0.0.3`、`dsh-archived-sessions#v0.4.1`、`dsh-plugin-subagent-monitor#v0.1.0`、`@local/dsh-subagent-acp-resilient#v0.2.1`；`dsh-deepseek-keypool` 保持 `#v3.4.0`。
- 上述组件此前从匿名不可读的仓库解析，公开用户装不上；现已全部公开并验证可匿名读取。

### Notes
- **只钉 tag 名不是强制一致**：pnpm 在安装时才解析 git spec，tag 一旦被移动就会把不同的代码发给所有使用者；因此锁必须记 commit SHA 并由验证器复核。
- 验证器区分"网络不可达"与"tag 被移动"：传输类失败有界重试；私有/不存在（凭据提示或 404）属确定性失败，立即返回不重试。
- 单命令路径的实测结论：**必须先写好 pnpm 前置再执行 add**。若第一次 add 失败后直接重试，依赖已经落盘，DSH 不会为新依赖登记 `dsh.profile.bundles`，表现为"装上了但整包不生效"。
- 全新 profile 真实启动的激活判据以**实际启动**为准（`--dump-config` 既不求值 `!!js`、也不报告 `did not activate`）。

## 0.5.0

公开伴生模板新增 acpPlugin 选择（upstream 默认 / resilient 私有加固版），并固化 PTC_ACP_* 超时阶梯环境变量。

### Added
- 问答键 acpPlugin（enum，默认 upstream）：选 upstream 时生成的 bundle 与既有公开模板逐字节相同；选 resilient 时三条 ACP 行的 name 切到 @local/dsh-subagent-acp-resilient 并注入完整分级超时阶梯。
- 15 个 PTC_ACP_* 环境变量（进程启动 30s / 会话建立 60s / 空闲告警 3min / 空闲 10min / 绝对 20min / 复杂软硬 20min-45min / 活动延长 / 活动探针 / 退出沉降 / 恢复沉降 / dispose 宽限 / 处置超时 / 工作区复用守卫），全部列进生成的 ptc.env.example。
- 生成器同步产出 skill 自带的 assets/dsh-bundle/cordis.patch.yml：USAGE.md 要求从该目录安装，若只改顶层副本会交付静默失效的阶梯。

### Changed
- 公开模板默认仍指向上游 @deepseek-ai/dsh-subagent-acp：resilient 插件是私有仓库，公开产物不引用。
- 去隐私化 Cursor 代理策略（不再在 bundle 内强制 no_proxy，保留 HTTP/1.1 修正），两份 bundle 模板保持一致。
- 行为断言 68 -> 77。

### Notes
- 上游插件不声明任何超时字段，而 schemastery 会透传未知键：阶梯配在上游 name 下不会报错，只会静默失效。因此插件名与阶梯必须成对出现（selectAcpRows 强制 3 行）。
- 需要在 profile 根安装插件：dsh plugin --profile <name> add github:Robert-Wang-08/dsh-subagent-acp-resilient#v0.2.1

## 0.4.0

新增公开配置工作流（Git 模板 + AI 问答生成 PTC 伴生配置）与子智能体逐次模型选择策略。
**公开 companion 尚未通过 clean-profile 端到端验收**，见下文 Added 末条与 `docs/ptc-public-companion-acceptance-20261014.md`。

### Added
- 公开 PTC 伴生模板现包含完整去隐私化 skill（route/ledger/check-model/ACP 自检、tests/assets/references）和完整 12 行 DSH bundle；版本与 Git source metadata 自动校验。
- 生成器交付本机设置、最终 patch、env-name example、消费清单、完整 skill 与 bundle；overwrite/rollback 可备份恢复目录树，rollback metadata 不再写本机绝对路径。
- schema 删除无真实消费者的 credentials、shared source、task timeout、transport retry 与 codex/Claude/node CLI 字段；保留字段均由 consumption-map 映射到 route config、bundle、patch 或 env example。
- 离线验证与 64 条行为断言覆盖完整路由/账本/ACP 测试、字段消费闭包、秘密/路径扫描、重复 id、版本一致、目录覆盖回滚和 persona 降级语义。
- 文档说明公开 skill 安装到 ~/.agents/skills/ptc-multi-agent-control，SkillHub 非依赖。
- **2026-10-14 已执行 clean-profile 端到端验收，结论为未通过**，详见 [`docs/ptc-public-companion-acceptance-20261014.md`](docs/ptc-public-companion-acceptance-20261014.md)。实测缺陷：
  - 叠加生成的 `ptc.local.patch.yml` 后，opencode/cursor 行的 `cmd /c "<cli>" acp` 引号写法使 ACP 子进程在
    Windows 上 initialize 即 process-exit（去掉本地 patch 后同一 profile 立即成功），该本地 patch 目前是阻断项；
  - 伴生 bundle 只提供 preset 定义，不提供 `agentPresets` 服务（由 `dsh-web-app` 的 `agent-preset-registry` 行提供），
    在不含 web app 的 profile 中 preset 无法激活，PTC 工具面整体缺席；
  - 本地 patch 的顶层 `- id: tool-presentation` 无对应顶层条目，解析报 `patch: entry "tool-presentation" not found`
    并被静默丢弃，`PTC_FEATURE_PRESENTATION` 开关实际失效；
  - `dsh --dump-config` 既不对 `!!js` 求值、也不报告激活失败，因此文档原先的“跑一次 dump 看有没有 did not activate”判据不成立。
- 发布包显式排除 Python __pycache__ / .pyc；ACP 自检在子进程退出后关闭管道，避免测试期 ResourceWarning。
- `config/40-models.yml` 新增 Host 偏好 `subagent-model-selection-settings`（`enabled: true` + 6 条去隐私精确路由白名单），
  使 `tool-subagent` 的 `modelSelectionSettings` 真正对模型生效：`subagent` 工具才会暴露 `provider` / `model` / `reasoning_effort`
  三个可选参数并注册 `list_subagent_models`；白名单只列本包自己声明过的 provider/model 精确对，覆盖 PTC 控制 / 执行 / 设计
  三类及降级项，不含路径或凭据。该策略只对**新建的顶层会话**生效；`owns` 同步为 20 个 id。

### Fixed（2026-10-14 验收后修复，复验见同报告 §8）
- D1：生成的 `ptc.local.patch.yml` 不再给 ACP 可执行名加引号；opencode 行新增 `PTC_OPENCODE_ACP` 整体实参覆盖，
  cursor 行默认值同样去引号。复验：同一条 DSH 级 ACP 调用由 `initialize/process-exit` 失败转为正常返回。
- D2：伴生 bundle 新增 env 门控的 `ptc-agent-preset-registry` 行（默认关闭，避免与 `dsh-web-app` 双提供者），
  并把前置条件写入生成物的 manifest / README / env example；`delegated-contract` 与校验器同步为 13 行。
- D3：`PTC_FEATURE_PRESENTATION` 开关下沉到 bundle 内层 preset 的 `tool-presentation` 行，本地 patch 不再声明顶层
  `tool-presentation`；叠加本地 patch 的 `--dump-config` stderr 由报错变为空。
- `acp_smoke.py` 的 spawn 判定改为起进程前的 `shutil.which()` 预检，修掉 zh-CN/代码页 936 下因 cmd 本地化中文提示
  把 spawn 误判为 initialize 的问题。
- 文档纠正：`dsh-headless` 一次性运行器**不合成** preset 会话（`dsh-headless/lib/index.js`），因此 PTC 工具面只能在
  具备预设选择能力的客户端会话（web/tui）中呈现；一条一次性的 headless 运行即使服务齐备也仍是基础工具集。
- 公开模板内残留的 `ptc-multi-agent-control/scripts/__pycache__/acp_smoke.cpython-312.pyc` 已清除：它会让
  `verify:ptc-public` 与 `npm test` 长期失败（模板 `.gitignore` 是 allowlist，git 不会漏出去，但本地门禁被蒙住）。

## 0.3.3

pin dsh-deepseek-keypool dependency to annotated tag v3.4.0

## 0.3.2

document remote-tag install recipe: blockExoticSubdeps, allowBuilds, pack last

## 0.3.1

document verified clean-profile install constraints: bundle order, allowBuilds, explicit web-app

## 0.3.0

add subagent_codex_relay preset entry, de-privatized device setup guide, local route layer docs

## 0.2.0

### Added
- `config/45-failover.yml`：把归档 `failover-tiers` 的完整 `dsh-deepseek-keypool` 档位表迁入本包；
  `pack.manifest.yaml` 将该行从 `delegated` 改为 `owns`。全部 failover `route` 可用
  `DSHPACK_ROUTE_*` 覆盖（`DSHPACK_ROUTE_OPENCODE` 默认 `opencode-go`，另一设备可设 `opencodego`）；
  凭据仍只走 `requires_env` 指针，不进 Git。
- `pack.manifest.yaml` 的 `delegated` 补全：把 PTC 专用行（`subagent-acp-opencode-dsv41` /
  `-kimi-docs` / `-cursor-grok`、两个 claude 只读档、五个 `tool-subagent-*`、`tool-presentation`）
  登记为由 `ptc-multi-agent-control` 的 dsh-bundle 提供。**本包不声明这些 id**——同一个 id 被两个
  bundle 声明时按层序覆盖、顺序不可控，正是本包 README 禁止的情况。
- `requires_env` 登记 `DSHPACK_OPENCODE_CONFIG` / `DSHPACK_DEFAULT_PROVIDER` /
  `DSHPACK_DEFAULT_MODEL` / `DSHPACK_SELECTED_PRESET`。
- `scripts/verify.mjs` 新增两组只读断言：`delegated` 里的 id 不得出现在本包（占有边界），
  以及 `cordis.patch.yml` 中 `providerName` 不得重复。
- `scripts/verify.mjs --composed <dump>`：对 `dsh --dump-config` 的组合结果做 provider 完整性检查——
  每个 `dsh-tool-subagent` 行消费的 `provider:` 必须能解析到某个已注册 provider
  （`providerName:` 标量、内置 `spawn`/`fork`/`acp`，或以 `@deepseek-ai/dsh-subagent-` 开头的行的后缀）。
  默认不启用。本机 `web` profile 实测：28 个工具行、14 个已注册 provider、0 dangling。
- `scripts/metrics.mjs`：只读执行指标提取器（`npm run metrics:selftest` 可离线自检，108 条断言）。
  见 README「执行指标与路由校准」。

### Fixed
- cursor 行的 `no_proxy` 取值改为推导而非字符串拼接：原先在
  `DSHPACK_CURSOR_KEEP_PROXY` 为真且 `no_proxy` 未设时会得到**空字符串**（等于不绕过任何地址，
  连 localhost 也走代理）；空字符串作为该变量取值时也会丢掉 `cursor.sh` 绕过。现在前者回落到
  `localhost,127.0.0.1,::1`，后者视同未设置。
- kimi 行参数顺序改为 `--model` 在前、`acp` 在后（`args: [ '--model', kimi-code/k3-256k, acp ]`）。
- opencode 行的 `OPENCODE_CONFIG_CONTENT` 默认模型 id 由 `ais-2dsglm/deepseek-v4.1-flash` 改为
  `ais1dsglm/deepseek-v4.1-flash`。后者才是 OpenCode 自己的 provider id；`ais-2dsglm` 只是本包
  DSH 侧的 llm-pi-ai 路由名（`config/40-models.yml`），OpenCode 不认识。两者命名空间不同。
- `release.ps1` 用 lightweight tag（`git tag vX.Y.Z`）配合 `--follow-tags`，而 `--follow-tags`
  **只推送 annotated tag**，导致 tag 从未上远端，`github:...#vX.Y.Z` 形式的安装 spec 解析不到。
  改为 `git tag -a` + `-m`。

## 0.1.0

### Added
- 包骨架：`package.json`（`dsh.bundle.patch` + `dependencies` 即插件选择）、`pack.manifest.yaml`（自描述：owns / switches / requires_env / requires_cli / never_sync）。
- `config/` 六个片段，覆盖本机 web profile 的全部可移植行：
  - ACP 子代理 opencode / kimi / cursor-agent（Windows 经 `cmd /c` 包装）
  - claude-code / codex 的 bypass 权限覆盖
  - 四个 MCP server 行（codegraph / ticktick / 腾讯文档 / 腾讯幻灯片）
  - 目录选择器 `-browse` 接线
  - 默认模型 + `llm-pi-ai` 六条路由（baseURL / apiKeyEnv 均可环境变量覆盖）
  - legacy 预设 `preset-standard-codex`（自本机 profile 逐行搬入）
  - 预设注册表 `selectedDefault`
- `scripts/build.mjs`：`config/*.yml` → `cordis.patch.yml`（纯字节拼接，避开 YAML 库对 `!!js` 自定义标签的处理差异）。
- `scripts/verify.mjs`：三组只读断言——owns 覆盖唯一性、`!!js` 标量合法性、目标 profile 遮蔽检查。

### Fixed
- `!!js` 三元运算符：`? 'cmd' : 'sh'` 里的 ` : ` 会被 YAML 当作映射键。全部改写为 `(cond && 'a') || 'b'`。
- `!!js` 以 `[` 开头会被解析成 flow 序列。改为以 `String(...)` 开头。
