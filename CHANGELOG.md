# Changelog

本文件由 `scripts/release.ps1` 维护；每次发版在顶部追加一段。

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
