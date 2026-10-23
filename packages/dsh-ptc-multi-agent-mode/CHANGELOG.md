# 版本变更记录

本文件只记录技能与配套资产的版本演进。故障诊断、机器环境修复和验证证据见 [ISSUE_FIX_HISTORY.md](ISSUE_FIX_HISTORY.md)。

## 未发布

- **Claude 配置凭据作用域兼容（0.16.1，2026-10-23）**：`claude_config_profiles.py` 的凭据解析顺序扩展为 DSH credentials 文件 → 当前进程环境 → Windows User 环境 → Windows Machine 环境；解决 `CLAUDETOKENISS25_API_KEY` 已安装在 Machine scope、但一键预置仍误报缺失的问题。Windows registry 读取在非 Windows/不可用时安全退化，`REG_EXPAND_SZ` 会展开，且任何路径均不打印凭据值。新增 6 项隔离测试覆盖优先级与缺失行为。

- **子代理失败原因上抛 + pnpm 静态补丁分发（2026-10-21）**：诊断只报固定 facts，上游 403 余额不足等可操作原因到不了调用方；根因在适配器未填充（服务层 `diagnostic` 字段与 4096 字节截断本就支持）。claude 适配器经 `pnpm patch` 生成的静态补丁修正：`is_error` 分支补传 cause、渲染 `resultKind`、`cause:` 行透出上游原文；补丁随 `assets/patches/` 分发，`prepare-profile.mjs` 复制到 profile 并写 `patchedDependencies`，`install.ps1` 在 `dsh plugin add` 前注入，故任何 `pnpm install` 与新设备安装都自动应用。opus55 档默认配置目录由 `~/.claude-profiles/tokeniss` 改为 `tokeniss25`（tokeness.io 账户余额不足时该档整档 403 不可用），`claude_config_profiles.py` 新增 `tokeniss25` 档，`install.ps1` 第 2.5 步自动预置三个配置目录（缺凭据只报告不失败）；`PTC_CLAUDE_OPUS55_CONFIG_DIR` 仍可覆盖回 tokeniss。
- 预设 persona 不再常驻路由契约：需要路由时用 skill 加载 `ptc-multi-agent-control`（§3 路由与派发 + 路由策略），persona 只保留触发句与 receipt 口径。常驻上下文缩短约 700 字符，判定依据仍是 `scripts/ptc_route.py` 与运行时配置。
- `ptc_task_control.py`：receipt 出现多余字段时，报错同时列出允许的 12 个字段。此前只报多余字段名，写入方只能靠试错反推 schema（实测一个会话内触发 13 次）。行为不变，仅错误文案。

## 0.16.0 - 2026-10-20

- 用户指定：主控/分析/设计/验证的默认路由由 `codex-relay/gpt-5.6-sol` 上位为 `codex-relay/gpt-6.1-sol`；`controller.model`、`design.astraModel`、`subagent_codex_relay`、`subagent_codex_astra` 四处同步，`openai-codex/gpt-5.6-sol` 仍是 GPT 组后备，`kimi-coding/k3-256k` 不变。
- config-pack 侧同步：failover 首选档（`config/45-failover.yml`、`cordis.patch.yml`）、`setup.ps1` 生成的档位表、`subagent-model-selection-settings.allowedModels` 的 codex-relay 条目、`public-runtime-config.json` 的 `controller.model` 与 `design.astraModel`。
- `codex-relay/gpt-6.1-sol` 未收录于 pi-ai 内置目录，按 gpt-6-sol / gpt-5.6-sol 同族声明档位（reasoningEfforts 全档）；首次真实派发已验证默认档往返成功。
- `scripts/ptc_route.py` 的 R4/R5 判定理由文案与 `SKILL.md`、`references/USAGE.md`、bundle 内提示词同步改为 GPT-6.1 Sol / gpt-6.1-sol，receipt 依据不再回指 5.6。

## 0.15.0 - 2026-10-16

- 用户指定：同一代码面的连续修改（R7 / continuous 档）改派 `ais-2dsglm/glm-5.3-flash`，不再是 Cursor/Grok；Cursor 也不再作为该档的后备候选。该 provider 上唯一的 GLM 档是 `glm-5.3-flash`。
- 新增 `assets/public-runtime-config.json` 的 `continuous` 段（provider/model/executor）。模型与 provider 仍从配置读取，代码里不再写死 `auto`。
- `ptc_route.py`：删除 `CURSOR_MODEL` 与 `EXEC_CURSOR`；continuous 候选链改为 `subagent`（`ais-2dsglm/glm-5.3-flash`）-> `subagent_opencode_dsv41`（`opencode-go/deepseek-v4.1-flash`）-> 主控。
- **保留冻结 route enum**：continuous 档的 route 标签仍是 `continuous-cursor-grok`，因此 receipt schema、`ROUTES` 兼容集与账本可重放性不变；真实执行者一律以 `receipt.executor/provider/model` 为准。同一档位换模型沿用 0.13.0 的先例（设计档换模型但保留 `design-codex-astra` 标签）。
- 本机路由层同步：`~/.dsh/plugins/provider-failover/route-config.json` 的 `subagentRouting.continuous` 首选换为 `ais-2dsglm/glm-5.3-flash`；`catalog` 新增只读项 `glm-continuous`，并把 `cursor-grok` 标注为「连续修改档已不派发」。
- **生效边界（重要）**：`subagent` 工具的显式 provider/model 受顶层 Session 在组合时记录的白名单约束。必须先把 `ais-2dsglm/glm-5.3-flash` 加进 profile patch 的 `subagent-model-selection-settings.allowedModels`，并**重启 DSH 后新建会话**该路由才可派发；已有会话保持记录时的旧白名单。2026-10-16 实测：在改动前建立的会话里直接派发会被拒（`child LLM route "ais-2dsglm/glm-5.3-flash" is not allowed for this Session`），即该约束确实生效。
- Cursor ACP 工具本身未卸载：`subagent_cursor_grok` 仍可人工调用，`python scripts/acp_smoke.py --route cursor-grok` 仍然有效。

## 0.14.0 - 2026-10-15

- 新增 Subagent Director 协同：Director settings 独占角色 persona/provider/model/toolFilter，PTC 本机路由层只保存角色参与策略，避免双重事实源。
- `ptc_route.py` 每次判定热读 `subagentRouting.directorRoles`，按 tier、首选/后备位置、priority 稳定合并 `executor=subagent_role` 候选，并输出 role id 与 route revision。
- 保留冻结 route enum；Director 候选沿用所属 PTC tier 的历史 route 标签，receipt 必须记录实际 executor/provider/model。
- PTC 控制面可视化配置角色启用、适用层级、首选/后备和优先级；Director 角色本体仍在其官方设置页维护。
- 统一路由配置路径优先级为 `PTC_ROUTE_CONFIG > DSH_HOME > ~/.dsh`；非法 Director 策略整项跳过，`director_roles` 从最终过滤后的候选链反推，并额外记录 `filtered_director_roles`。

## 0.13.0 - 2026-10-15

- 用户指定：设计/分析/验证默认改回 `codex-relay/gpt-5.6-sol`（`reasoning_effort=xhigh`），`gpt-6-astra` 不再作默认；冻结的 `design-codex-astra` route 标签保留，真实模型继续以 `receipt.executor/model` 为准。
- **Opus 复核拆成两个执行档，各自独立后端，可同时可用**：`subagent_claude_opus55_plan`（5.5 档，来源 tokeniss）与 `subagent_claude_opus5_plan`（5 档，来源 anthropic-relay）。二者是不同 provider 上的只读 plan reviewer，工具名不互换。
- **档位隔离点必须是 `CLAUDE_CONFIG_DIR`，不是环境变量**。2026-10-15 实测：Claude Code 的 settings.json 里 env 优先级高于进程环境——给子进程塞一个无效 `ANTHROPIC_AUTH_TOKEN` 仍然调用成功，说明 env 覆盖不了后端。只给两个执行档设 env 会让它们串到同一后端。改用独立配置目录后四向验证通过：relay 目录问 5.5 直接 403，tokeniss 目录问 5.5 成功。
- 新增 `scripts/claude_config_profiles.py`：预置 `~/.claude-profiles/{relay,tokeniss}` 两个配置目录，从 DSH 凭据库取 key，幂等、不打印凭据值。目录内含凭据，属设备本地状态，不入库。
- `opusLadder` 每档新增 `executor` 字段，梯子由「同一工具的候选序列」改为「每档绑定自己的执行档」；路由器按档派发。`public-runtime-config.json` 新增 `opusExecutors` 映射，路由器新增 `EXEC_OPUS_EXECUTORS`。
- 修正 0.12.0 的耦合缺陷：上一版梯子第一档（5.5）虽然排在前面，但执行档只认 `PTC_CLAUDE_OPUS55_MODEL` 与 Claude Code CLI 的全局后端，而该全局后端当时是 anthropic-relay（不提供 5.5），因此那一档实际不可执行。本次把后端绑定下沉到执行档自身，梯子才真正可执行。
- 实测记录：anthropic-relay 对 `claude-opus-5-5` 返回 403 `该令牌无权访问模型 claude-opus-5-5`，可据此直接判定该档不可用，无需猜测。

## 0.12.0 - 2026-10-15

- Opus 复核改为显式降级梯（`assets/public-runtime-config.json` 的 `opusLadder`，首条命中）：5.5 -> 5 -> 4.8；三档都不可用时如实报告 Opus 不可用，不自动改用 Sonnet。路由器按梯子生成 `design-opus55` 候选链，该路由因此可携带多个 provider/model 组合。
- 修正上一版文档中过宽的断言。0.11.x 写的“实际模型 id 是 claude-opus-5”只是当时对 `anthropic-relay` 单来源的观测，不等于“5.5 不存在”。2026-10-15 实测：`claude-opus-5-5` 由设备本地 provider 提供且回显自身 id；`anthropic-relay` 广告 `claude-opus-5` 与 `claude-opus-4-8`；同名 `claude-opus-4-8` 在设备本地来源是别名（实测回 `claude-opus-5-5`）。换来源后必须重验回显 id。
- `skill.json` 版本此前停在 0.11.0，未跟随 0.11.1 条目；本次一并对齐为 0.12.0。

## 0.11.1 - 2026-10-15

- 修复 ptc_task_control.py 路由兼容集：补回 0.6.x 历史路由名 design-opus48（账本中有 2 条该路由的历史 subtask_created 事件）。缺陷表现为重放即炸，导致 event-add 等所有账本写入被整体拒绝；追加式账本不篡改历史，按既有约定把旧名保留在 ROUTES 兼容集以便重放校验。

## 0.11.0 - 2026-10-14

- 设计默认路由改为 `codex-relay/gpt-6-astra`；一般与模糊设计不再自动调用 Claude。
- 仅高难度独立复核或显式 `top_down` 全新领域设计调用一次 `subagent_claude_opus55_plan`。
- 删除 Opus 4.8 fallback 与旧 `subagent_claude_opus5_plan` / `subagent_claude_opus48_plan` 工具注册。
- 将模型、provider 和 executor 可变值移入 `assets/public-runtime-config.json`；R1–R9 条件与顺序继续由可单测代码执行。

## 0.10.0 - 2026-10-14

- 重写 `SKILL.md`，按“适用范围—不变量—标准流程—路由—ACP—DSH—验证”组织，删除重复解释。
- 将长篇版本流水从 frontmatter 拆到本文件。
- 将故障现象、根因、修复和实测记录拆到 `ISSUE_FIX_HISTORY.md`。
- 在 `SKILL.md` 顶部增加两个追踪文件的索引。
- 将 SkillHub stamp 收入合法的 `metadata` 节点，保留全部来源、版本和维护字段，同时通过当前 skill schema 校验。
- 合并此前两份 store 副本中并行出现的 0.9.x 记录；未把副本差异误写成单一线性历史。

## 0.9.3 - 2026-10-14

- 清理 frontmatter 历史中的机器本地绝对路径，改为不暴露设备信息的通用表述；行为、bundle 和路由不变。

## 0.9.2 - 2026-10-14

- 收拢开发 store 与坚果云副本中的文档和 bundle 分叉。
- bundle 升到 0.6.1，`@local/dsh-subagent-acp-resilient` 升到 0.2.1，并改为钉定 Git tag，移除不可移植的本机 workspace link 依赖。
- resilient 插件补齐六类生命周期问题：首帧结束启动阶段；子进程退出参与 `session/prompt` 赛跑；以 ACP 事件和有界工作区指纹作为双进度证人；`dispose` 有界并返回 quiescence 证明；已确认正常退出时保留结果；超时路径不再用 cancelled 丢弃变更与诊断。
- bundle 不再强制写入 `no_proxy`，代理策略交回父进程环境和系统策略；保留 HTTP/1.1 修正。
- 保留 2026-10-13 的调度规则和 Opus 5.5 路由名称。

## 0.9.0–0.9.1 - 2026-10-13 至 2026-10-14

这一阶段在开发 store 与坚果云副本中出现过并行记录，内容分别覆盖“调度规则”和“ACP 超时回传加固”。0.9.2 合并时保留两条事实，不沿用冲突的单行 changelog。

### 调度与运行规则

- ACP 子代理改为顶层调用，长任务使用后台模式。
- 等待窗口按任务规模估算；运行状态以 ACP 会话日志等可见证据判断。
- 大文档任务按 5–10 项分批，ACP 降级由主控显式执行。
- 记录了 Cursor HTTP/1 设置和 Kimi Orca hooks 清理等机器本地修复；这些修复不再作为通用 skill 正文。

### bundle 0.6.0 超时与回传加固

- 三条 ACP 路由由单档超时改为分阶段、分任务规模的超时策略，并支持 `PTC_ACP_*` 覆盖。
- 开启工作区复用保护，避免超时后取消标记导致已修改文件和诊断结果被丢弃。
- 配套本地实验插件 `@local/dsh-subagent-acp-resilient`；该依赖含机器路径，跨设备必须重新解析或回落上游实现。

### SkillHub 收敛

- `.cursor`、`.codex`、`.agents` 入口曾统一重指向 SkillHub store。
- 历史副本仍出现过文档版本与 bundle 版本不一致，现作为单独问题跟踪。

## 0.8.0

- PTC preset 新增独立 `subagent_codex_relay`，使用 spawn 与 `agentOptions` 路由到 `codex-relay/gpt-5.6-sol`、`effort=high`。
- 修复 Relay GPT 只存在于其他 preset、PTC 会话实际拿不到该工具的问题。

## 0.7.0

- 新增 `fuzzy`、`high`、`general` 三种显式设计模式。
- 候选链分别为 Opus→GPT、GPT→Opus、GPT→DS，并保持旧输入兼容。

## 0.6.0

- 重排默认路由：主控优先 Relay/官方 Codex，设计按模糊、高难度、一般三档分流，原子执行使用 DS，连续修改使用 Cursor/Grok，文档使用 Kimi。
- route 输出开始保留真实 provider，避免只记抽象模型组。

## 0.5.0

- 新增 `scripts/ptc_route.py`，以 `ptc_task_control.ROUTES` 为 route enum 单一事实源。
- 固化 R1–R9、候选链、worker 信封、验证要求和后台可续接条件。
- 新增 42 例路由单测。
- `receipt-add` 开始拒绝与已登记 subtask route 不一致的 worker receipt。
- U2 验证所有非 controller tier 都有降级链；U3 完成三条 ACP 路由的往返测试。

## 0.4.0

- 复杂方案改为 GPT 设计、Claude Opus 复核；高不确定方案允许 Opus 先发散、GPT 复核。
- GPT 组明确为 `codex-relay`→`openai-codex`，DS 组明确为 `ais-2dsglm`→`opencode-go`。

## 0.3.3

- Cursor 默认模型改为 `auto`，Grok 改为按需显式指定。
- 自检对 `auto` 不做伪模型锁定；无法观测时记录 `unverified`。

## 0.3.2

- 补齐 Kimi provider 前缀别名。
- 更正 “K3 Max” 表述：`max` 是 effort，不是模型名。

## 0.3.1

- 固化账本状态时序：先进入 `in_progress`，再进入 `review`/`done`；旧任务终结后才能重绑；`session-end` 必须最后执行。

## 0.3.0

- 新增 `scripts/acp_smoke.py`，区分 `spawn`、`model`、`auth`、`transport` 四类失败。
- 仅 `transport` 自动重试一次；确定性失败不重试。
- 新增 18 例离线桩测试。

## 0.2.3

- 针对 Cursor 经代理时的 HTTP/2 keepalive 5 秒超时增加防御性绕行，可通过 `PTC_CURSOR_KEEP_PROXY` 保留代理。

## 0.2.2

- 修正不存在的 Cursor 模型 id。
- 补充 DeepSeek ACP 与 Claude Code 子代理依赖声明。
