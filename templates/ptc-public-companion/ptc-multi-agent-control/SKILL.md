---
name: ptc-multi-agent-control
description: 通用 PTC 多代理控制面。默认由 codex-relay/gpt-6-astra 承担设计，只在高难度独立复核或全新领域自顶向下设计时使用 Opus 5.5；同时提供确定性路由、追加式账本、worker receipt 和产出契约。
origin: self
updated: 2026-10-14
version: 1.2.0
managed-by: git
source: dsh-config-pack
asset-type: skill
asset-id: ptc-multi-agent-control
status: active
changelog: "1.2.0: Opus review becomes an explicit ladder (5.5 -> 5 -> 4.8) with two Claude Code config dirs and PTC_CLAUDE_OPUS5_MODEL tier switch; 1.1.0: default design to codex-relay/gpt-6-astra; keep one Opus 5.5 plan reviewer only for high-risk or explicit top-down greenfield design."
---

# PTC 多代理主控

## 定位

这是一个与具体仓库技术栈和治理制度解耦的“一个主控、多个执行器”模式。它只管理代理编排事实，不覆盖调用项目已有的需求、任务板、ADR、代码、测试或发布事实源。项目自己的指令决定业务内容；本 skill 只增加身份、路由、receipt、进度和产出物契约。

加载本 skill 后，把工具返回的 Base directory 记为 `SKILL_ROOT`。账本 CLI 为 `SKILL_ROOT/scripts/ptc_task_control.py`，默认在**当前工作区**写 `.ptc/registry.jsonl`；可用 `--ledger <path>` 或 `PTC_LEDGER` 改为项目指定位置。

## 不变量

1. 每个会话绑定一个全局唯一根 `task_id`；细分执行只能使用 `subtask_id`。
2. 每个工作区只有一个权威编排账本，默认 `.ptc/registry.jsonl`；它是追加式 JSONL，禁止改写历史。
3. 只有主控写账本。worker 只返回符合 `assets/worker-receipt.schema.json` 的 receipt。
4. task 创建时冻结 `objective` 和完整 `contract`，并记录 contract hash。实质变更创建新 task，不静默漂移。
5. `review` / `done` 必须有 evidence；`done` 必须 100%。worker 自述不构成完成证据。
6. 主控不可外包：目标解释、拆分、路由、receipt 验收、进度写入、最终结论。
7. 业务事实仍由调用项目自己的治理系统裁决；本模式不要求项目采用任何特定任务板、规范体系、目录或文档格式。

## 通用模型路由

开始路由前，若 `$DSH_HOME/plugins/provider-failover/route-config.json` 存在且 `schemaVersion` 受支持，先读取其中的 `subagentRouting` 作为本机人工确认规则；仅缺失时才使用下表默认值。`providerFailover` 由 Host 插件消费，不能把 Cursor/ACP 子代理名称当作 Host provider。不得从凭据文件推断路由。

| 工作类型 | 首选 | 降级 |
| --- | --- | --- |
| 主控、拆分、验收、收口 | `codex-relay/gpt-5.6-sol` + `high` | `openai-codex/gpt-5.6-sol`，再降级 `kimi-coding/k3-256k`（Max 为 `reasoning_effort=max`，不是模型名） |
| 一般设计、模糊设计、高不确定性发散 | `subagent_codex_astra` + `codex-relay/gpt-6-astra` | GPT-5.6 Sol 主控或官方 Codex；必要时 DS 独立复核 |
| 高难度设计、冲突仲裁 | `subagent_codex_astra` + `codex-relay/gpt-6-astra` | `subagent_claude_opus55_plan` 作一次独立只读复核（不可用时按 `opusLadder` 降到 `subagent_claude_opus5_plan`） |
| 全新领域且明确要求自顶向下设计 | `subagent_codex_astra` + `codex-relay/gpt-6-astra` | `subagent_claude_opus55_plan` 作一次独立只读复核（不可用时按 `opusLadder` 降到 `subagent_claude_opus5_plan`） |
| 验证 | DS 组（`ais-2dsglm/deepseek-v4.1-flash`） | `opencode-go/deepseek-v4.1-flash`，允许人工指定 |
| 开发、定点查询、字段核查、单点修改 | `ais-2dsglm/deepseek-v4.1-flash` | `opencode-go/deepseek-v4.1-flash`，允许人工指定并提升优先级 |
| 同一代码面的长连续修改 | `subagent_cursor_grok` / Grok | Cursor/Grok 不可用时转 `subagent_opencode_dsv41` |
| 正式说明、总结、大量背景文档汇总 | `subagent_kimi_docs` + `kimi-code/k3-256k` | 主控整合并复核事实 |

术语落地（避免“GPT 组/DS 组”停留在口号）：**GPT 组** = 主控 provider `codex-relay` → `openai-codex`，或子代理 `subagent_codex_relay`（relay，spawn + agentOptions）→ `subagent_codex`（官方 app-server）；**DS 组** = `ais-2dsglm/deepseek-v4.1-flash` → `opencode-go/deepseek-v4.1-flash`（spawn 或 `subagent_opencode_dsv41`）。官方 Codex 与 Relay 是两个独立工具，**不互为自动重派发**：`subagent_codex` 因额度/认证失败时，主控需显式改派 `subagent_codex_relay`（反之亦然）。主控会话自身 provider 失败无法在同会话内热切换，需新建/重启会话后按主控链重选。设计档另有专用工具 `subagent_codex_astra`（绑定 `codex-relay/gpt-6-astra`）；`subagent_codex_relay` 固定绑定 `gpt-5.6-sol`，两者不可互相冒充。

路由中的“复核”必须是独立的第二遍检查，不是让同一模型复述原方案。设计默认由 `codex-relay/gpt-6-astra` 完成；一般设计和模糊设计都不自动调用 Claude。只有高难度冲突仲裁，或任务明确标记为全新领域的 `top_down` 设计时，才加入一次 `subagent_claude_opus55_plan` 独立复核。当前 `anthropic-relay` 广告的实际模型 id 是 `claude-opus-5`，因此“Opus 5.5”是本路由的能力/工具标签，receipt 必须记录 provider 返回的真实模型 id，不得伪造 `claude-opus-5.5`。

运行时命名空间可不同：DSH 主会话可能使用 `kimi-coding/...`，Kimi CLI/ACP 使用 `kimi-code/...`；OpenCode provider id 与 DSH route 也可能不同。应记录实际 provider/model，不靠名字推断成功。

**主控的实际模型由人决定，不由本表决定。** 人可以在任何时候切换主控模型（DSH 模型选择器，或 profile 里 `agent-default-model` 行的 `provider`/`model`）。因此「当前主控是什么」是**运行时事实，必须观测**：本表只规定各类工作**首选**哪一档，不构成对主控现状的断言。

## 自动工作分层路由（v1.1）

路由不再只靠“复杂/特别复杂”的语感。先把工作项归一化成 12 个输入：是否写文件、文件数、不确定性、是否仲裁、验证负担、上下文行数、是否跨目录、失败代价、工作种类、是否必须 ACP、是否后台运行、显式设计模式（可选）；再由纯函数按 R1→R9 首条命中原则输出唯一的 tier、route、executor、model、effort、shape、候选链、信封字段和验证要求。

权威实现为 `scripts/ptc_route.py`；route enum 直接从 `ptc_task_control.ROUTES` 导入，并与 receipt schema 同步。`SKILL.md` 负责解释政策和使用边界，但不会被 Python 在运行时解析：把 R1–R9 只写成自然语言会产生歧义、无法做输入校验，也无法用单测冻结首条命中顺序。模型/provider/executor 等可变值放在 `assets/public-runtime-config.json`，而优先级、条件和输出契约保留为可测试的代码；这就是“配置驱动数据 + 代码执行规则”的边界。快速调用：

~~~powershell
$route = Join-Path $SKILL_ROOT 'scripts/ptc_route.py'
python $route --input-json '{"writes_files":true,"file_count":1,"uncertainty":"low","adjudication":false,"validation_burden":"low","context_lines":500,"cross_directory":false,"failure_cost":"low","work_kind":"code","prefers_acp":false,"background":false}'
~~~

优先级固定：跨目录 → 高失败代价 → 文档 → 仲裁型设计 → 独立设计 → ≥6 文件 → 2–5 文件连续修改 → 单点/只读定点执行 → 主控兜底。设计档只读；外部 ACP 均 one-shot；只有进程内 spawn 且后台启动才标为 continuable。worker 的实际 provider/model 必须写入 receipt 的 `executor/model`，route 只代表已登记的层级/首选族，且 receipt.route 必须与 subtask.route 一致。

候选链：一般/模糊 design = **codex-relay/gpt-6-astra → GPT-5.6 Sol 主控/官方 Codex → DS 组**；高难度或显式 `top_down` design = **codex-relay/gpt-6-astra → Opus 5.5 独立复核 → GPT 后备**。Opus 不再是模糊设计默认入口，Opus 4.8 已移除。execute = ais-2dsglm spawn → 人工指定时 opencode-go → controller；continuous = Cursor/Grok → OpenCode Go → controller；docs = Kimi K3-256K → controller；controller = codex-relay → openai-codex → kimi-code/k3-256k → local-controller。仅 transport 失败重试一次，其余类型直接跨 provider 或回主控。

**主控 provider 失败不会自动热切换。** 候选链只在主控能继续执行时生效；若主控模型本身报错（例如 WebSocket error / `PI_AI_ERROR`）、会话中断或 provider 不可用，路由 CLI 无法接管当前会话——必须由会话层新建/重启会话并选择后备 provider（`openai-codex/gpt-5.6-sol`，再 `kimi-coding/k3-256k`），并在账本登记 `risk` 事件说明降级原因。不要假设 `ptc_route.py` 会重连、重试或热切换主控。

经验基线表明外部 ACP 有明显冷启动成本，因此**短小单点任务默认主控或进程内 spawn，只有需要 ACP 文件执行/独立权限系统时才为 OpenCode 冷启动；Cursor 只用于确实需要 2–5 文件连续修改的任务。**

离线验证：

~~~powershell
python -B scripts/test_ptc_route.py
~~~

## 开工

### 第 0 步：先检查当前主控模型（业务之前）

主控模型可被人随时切换，所以**每次处理业务之前先观测，不凭记忆、不凭本 skill 的默认值**：

~~~powershell
python $SKILL_ROOT/scripts/check-model.py
~~~

它读会话 projcache 的 `modelSelection.lastUsed` 与 `/provider-failover/status`，打印实际 provider/model，并判定是否落在 `PTC_EXPECTED_CONTROLLERS`（默认 `codex-relay,openai-codex`）之内。**观测不到就据实写 `unverified`，绝不填文档默认值**——把断言写在证据的位置，是本模式最严重的失误类型。

### 第 1 步：开账本

在目标工作区执行；以下 `$SKILL_ROOT` 代表本 skill 的真实 Base directory：

```powershell
$ctl = Join-Path $SKILL_ROOT 'scripts/ptc_task_control.py'
python $ctl init --project-id <project-id> --project-name "<project-name>"
python $ctl task-create --project-id <project-id> --title "<标题>" --objective "<单一目标>" --contract "$SKILL_ROOT/assets/task-contract.template.json"
python $ctl session-start --task-id <task-id> --session-id <session-id> --controller <agent> --controller-model <provider/model+effort>
python $ctl status-update --task-id <task-id> --session-id <session-id> --status in_progress --progress 1 --summary "已冻结目标和契约" --next-action "拆分首批子任务"
```

`init` 对已有 project 幂等。project 是共享账本内的稳定业务边界；同一产品/权威事实源/治理 owner 通常复用 project，否则创建新 project。

## 项目事件

决策、风险、里程碑、交接或重要进度必须登记为结构化事件，而不是只留在聊天中：

```powershell
python $ctl event-add --project-id <project-id> --task-id <task-id> --session-id <session-id> --kind decision --message "采用追加式单一账本" --evidence "ADR-001"
```

`kind` 可选：`decision`、`progress`、`risk`、`handoff`、`note`、`milestone`。

## 子任务与 Receipt

派发前先登记：

```powershell
python $ctl subtask-create --task-id <task-id> --session-id <session-id> --title "<原子任务>" --objective "<单一动作>" --route execute-dsv41-flash --expected-output "符合 worker receipt schema 的 JSON"
```

worker 信封必须带 `task_id`、`subtask_id`、contract hash、允许读写路径、禁止项、预期格式和验证要求。worker 不写账本，不扩展范围；失败返回 `blocked` / `failed`。

主控检查实际文件、验证和风险后登记：

```powershell
python $ctl receipt-add --task-id <task-id> --session-id <session-id> --receipt <receipt.json>
```

## 状态与产出物

```text
backlog -> in_progress <-> blocked
                 |
                 v
              review -> done
                 | \
                 |  -> blocked
                 +----> in_progress
```

未完成状态可进入 `cancelled`，进度不得倒退。进入 `review` / `done` 时 `--evidence` 必填且可重复：

```powershell
python $ctl status-update --task-id <task-id> --status review --progress 90 --summary "待验收" --next-action "主控复核" --evidence "unit tests passed" --evidence "artifact hash verified"
python $ctl artifact-add --task-id <task-id> --path <workspace-relative-path> --kind <code|config|document|report> --format <format> --evidence "<验证证据>"
```

## DSH 通用模式

`assets/dsh-bundle/` 是可安装的 DSH bundle，新增 preset `ptc-multi-agent`（`order: 4`）。模型可通过环境变量覆盖：

- `PTC_OPENCODE_CONFIG_CONTENT`：OpenCode 配置 JSON，默认 `{"model":"ais1dsglm/deepseek-v4.1-flash"}`
- `PTC_CURSOR_ACP`：Cursor 完整 ACP 命令串，**默认 `cursor-agent --model auto acp`——让 Cursor 自选模型**；要指定模型时改成 `cursor-agent --model grok-4.7-high acp` 等（模型名规则见硬约束 3）
- `PTC_CURSOR_KEEP_PROXY`：设为非空值则让 Cursor 域名继续走代理（默认绕开，理由见硬约束 5）
- `PTC_KIMI_DOCS_MODEL`：Kimi 模型别名，默认 `kimi-code/k3-256k`
- `PTC_CLAUDE_OPUS55_MODEL`：5.5 档执行工具（`subagent_claude_opus55_plan`）的模型 id，默认 `claude-opus-5-5`
- `PTC_CLAUDE_OPUS5_MODEL`：5 / 4.8 档执行工具（`subagent_claude_opus5_plan`）的模型 id，默认 `claude-opus-5`；设为 `claude-opus-4-8` 即切到 4.8 档（设备启动期开关，不能与 5 档同时生效）
- `PTC_CLAUDE_OPUS55_CONFIG_DIR` / `PTC_CLAUDE_OPUS5_CONFIG_DIR`：两个执行档各自的 Claude Code 配置目录（默认 `~/.claude-profiles/tokeniss` / `~/.claude-profiles/relay`）。Claude Code 的 `settings.json` 里 env 优先级高于进程环境，所以隔离必须靠配置目录，不能靠环境变量分后端
- Opus 复核按 `assets/public-runtime-config.json` 的 `opusLadder` 首条命中降级：5.5 -> 5 -> 4.8；三档都不可用时如实报告 Opus 不可用，不自动改用 Sonnet。档位到 provider/model 的映射属设备本地配置，换档前须核验该来源在售并回显同一 model id

Kimi 的可用别名以 `kimi provider list` 与 `~/.kimi-code/config.toml` 为权威（**别名必须带 provider 前缀**，
`-m` 收的就是这个名字；`kimi acp` 没有 `--list-models`）：

| 别名 | 显示名 | 上下文 | effort |
| --- | --- | --- | --- |
| `kimi-code/k3-256k` | K3-256k | 256K | low/high/max（默认 high） |
| `kimi-code/k3` | K3 | 1M | low/high/max（默认 high） |
| `kimi-code/kimi-for-coding` | K2.8 Preview | 1M | low/high/max（默认 max） |
| `kimi-code/kimi-for-coding-highspeed` | K2.7 Code Highspeed | 256K | — |

注意：**没有叫 "Max" 的模型**；但 `k3` 与 `kimi-for-coding` 都支持 `effort = max`，
所以"K3 Max"是合法**配置**而不是模型名，别写成 `-m k3-max`（会直接失败）。

五个已实测的硬约束，改动 bundle 时不要违反：

- `opencode acp` 不接受 `--model`（传了直接退出 1），OpenCode 模型只能经 `OPENCODE_CONFIG_CONTENT` 注入；该变量与用户配置是合并语义，因此 `ais1dsglm` provider 定义仍然有效。
- `opencode` 与 `cursor-agent` 在 PATH 上通常只有 `.cmd`/`.ps1` shim，没有 `.exe`，裸名作 `command` 会 spawn 失败并让 ACP 停在 `initialize`/transport 阶段；必须经 `cmd /c`（Windows）或 `sh -c`（POSIX）包装。`kimi` 是真实 exe，无需包装。
- **模型名必须存在于当前账号的可用列表**，否则 `cursor-agent` 直接退出 1，而且会把这个失败报成 `Authentication required`——极容易被误判成登录问题。查列表用 `cursor-agent --list-models`（权威，逐条列出 id 与显示名）。**默认用 `--model auto` 让 Cursor 自选**（不绑定具体模型，换账号最稳）；要固定成 Grok 时才写 `grok-4.7-high`（或 `grok-4.7-*`、`cursor-grok-4.6-*` 等），注意 `grok-code-fast-1` 这个 id 并不存在。
- 光在 bundle 里声明依赖**不够**。`@deepseek-ai/dsh-subagent-acp` 与 `@deepseek-ai/dsh-subagent-claude-code` 不在 DSH 根安装里，只由 web profile 单独安装；而 DSH 的插件加载器是**从 profile 根解析** `name:` 里的包，不是从 bundle 自己的 node_modules 解析。所以在缺少这两个包的 profile 里，bundle 的依赖声明只会把它们装进 pnpm 虚拟库，对应行仍然 import 失败——而且**失败只是 `dsh: warning: N entry did not activate` 的静默警告，会话照常运行，工具凭空消失**。必须显式装进 profile：

  ```powershell
  dsh plugin --profile <名字> add <bundle 路径> '@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2' '@deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2'
  ```

  装完再跑一次，若不再出现 `did not activate` 才算真正可用。

- **经代理时 Cursor 传输不稳，且超时不可配置。** `cursor-agent` 的代理路径用
  `new Q.A({authority, proxyUrl, http2SessionOptions})`，**不传 ping 选项**，于是落到类默认值
  `pingIntervalMs = 5e3, pingTimeoutMs = 5e3`；而直连路径显式传 `{pingIntervalMs:1e4, pingTimeoutMs:2e4}`。
  配置层 `network.*` 只暴露 `useHttp1ForAgent`，没有超时项，所以"把超时调到 30 秒"做不到。
  表现为 `RetriableError: [internal] HTTP/2 keepalive ping timed out after 5000ms`
  （在 DSH 侧被归成 `stage: new-session; category: transport`）。bundle 的做法是让 Cursor 域名
  **绕开代理**、回到 20 秒那条路径：**cursor-agent 只读小写 `no_proxy`**，按 `host.endsWith(条目)` 匹配，
  所以追加 `cursor.sh` 即可覆盖 `api2.cursor.sh` 与 `agentn.global.api5.cursor.sh`。
  需要保留代理时设 `PTC_CURSOR_KEEP_PROXY`。
  **归因说明（重要）**：代理故障期间测得绕开 6/6、走代理 1/6，但那两臂是先后跑的，属时间混淆；
  代理恢复正常后做**交错 A/B**（A,B,A,B… 各 4 次，同一时间窗）结果为**两臂均 4/4**。
  所以这条绕过应视为**防御性加固**（代理劣化时不至于拖垮 Cursor），不是健康代理下的必需项。
  真正让超时消失的是把代理修好；瞬时失败仍应重试一次。

主控模型仍在新建会话时选择；preset 不强制覆盖用户的模型路由。

## 自检与重试

排障顺序固定为**先自检、再怀疑路由**，不要靠读报错猜。`scripts/acp_smoke.py` 一条命令走完
`initialize → authenticate（若需要）→ session/new → session/prompt`，并把失败分成四类——
这四类过去被混淆过，导致误判：

| 类型 | 典型表现 | 要做什么 |
| --- | --- | --- |
| `spawn` | `is not recognized as an internal or external command` | 命令入口不对，补 `cmd /c`/`sh -c` 或修正路径 |
| `model` | `Cannot use this model`（cursor-agent 会**谎报成认证问题**） | 用 `cursor-agent --list-models` 取真实 id |
| `auth` | `Authentication required` | 重新登录子代理 CLI，或用其支持的环境变量方式提供凭据；**不要靠重试** |
| `transport` | `RetriableError ... keepalive ping timed out` | 检查代理健康度；**可重试** |

```bash
python scripts/acp_smoke.py --all              # 三条内置路由全查
python scripts/acp_smoke.py --route cursor-grok --json
python scripts/acp_smoke.py --command "some-agent acp"
```

脚本只从与 bundle **相同的环境变量**取模型和命令（`PTC_OPENCODE_CONFIG_CONTENT`、
`PTC_CURSOR_ACP`、`PTC_KIMI_DOCS_MODEL`），因此不会与资产各写一套而漂移；对 cursor 路由会先跑
`--list-models` 预检，**模型名非法时不消耗会话**。离线单测：`python scripts/test_acp_smoke.py`。

**重试规则（必须遵守）。** 委派 ACP 子代理时，仅当失败被判定为 `transport` 才重试，最多 1 次；
`model`/`auth`/`spawn` 是确定性失败，重试只会浪费时间并掩盖真因。连续修改作业（Cursor/Grok
长任务）默认按此规则带一次重试，重试仍失败才降级到 `subagent_opencode_dsv41`，并在账本
`event-add` 记一条 `risk` 说明降级原因。判定依据用上面的自检脚本复核，不要只凭错误文本。

## 子代理调度规则（2026-10-13 超时根因诊断修正）

**禁止把 ACP 子代理调用包在 run_code 里。** run_code 有自身执行期限（默认 120s、上限 600s），到期会取消在途的 subagent run——2026-10-13 两次 subagent_kimi_docs "超时无输出"的直接原因就是它，不是 ACP/网络/认证故障。subagent_kimi_docs、subagent_cursor_grok、subagent_opencode_dsv41 一律作为顶层工具调用；长跑任务一律 run_in_background: true。

**等待时间按任务动态评估，不设默认时长。** ACP 子代理的硬上限是绝对超时 30 分钟（absoluteTimeoutMs 1800s），但主控不得拿它当默认等待值：派发前先按任务规模估算合理窗口（如 5–10 项一批的文档梳理约 5–15 分钟；k3-256k thinking=high 每轮 LLM 5–60 秒，按预计轮数折算），到窗口下限前先查进度，超过预估上限且日志无推进才判异常。

**子代理运行期间必须有可见输出通道，凭输出判断而非凭等待判断。** 后台运行期间 job_output 的 text 恒为空是可见性假象，不得作为死活依据。派发后立即定位并持续观察子代理的实时日志（如 kimi：tail ~/.kimi-code/sessions/*/logs/kimi-code.log，llm response 行持续增长即健康；opencode/cursor 同理用各自 ACP 会话日志），进度判断一律以日志推进为准；日志停滯超过两个 LLM 轮次时长才允许考虑干预。

**大文档任务必须分批。** 梳理类任务拆成 5–10 项/批，每批返回增量 receipt；全量扫描只放后台。

**降级链由主控显式执行。** provider-failover/route-config 只覆盖 Host provider，不覆盖 ACP 子代理；ACP 失败按重试规则判 transport 后由主控显式降级并写入 receipt。


## 收官

最终回复固定包含：根任务与目标、完成项、实际路由和降级、产出物、验证证据、限制/阻塞、下一步唯一动作。主控依次写入 `review`、验收后写入 `done`，再结束 session。

**「实际路由」必须是观测值。** 它与 `session-start --controller-model` 必须来自同一次 `check-model.py` 观测。若主控既不是 Codex 族、也不在指定清单内，**据实写它的 provider/model 原文**——不得用文档默认值替代、不得含糊成「Codex」、不得据 tier 表反推。

**需要升档时才升档。** 设计优先使用 `codex-relay/gpt-6-astra`；一般与模糊设计不调用 Claude。只有高难度复核，或显式标记为全新领域自顶向下设计时，才调用只读档 `subagent_claude_opus55_plan`，产出正文仍由主控落盘。

**账本命令必须按这个顺序**（顺序错了会被状态机挡住，细节见下）：

```
task-create  →  session-start  →  status-update(in_progress)  →  …工作…
             →  status-update(review)  →  status-update(done)  →  session-end
```

三个已实测的约束，不要凭直觉调换：

- **状态机是单向的**：`backlog → in_progress → blocked/review → done`。`task-create` 建出来的是
  `backlog`，**不能**直接写 `review` 或 `done`（会报 `非法状态迁移: backlog -> review`）；
  必须先落一次 `in_progress`。`review` 也只能到 `done`（可退回 `in_progress`）。
- **`session-start` 不会替你解除旧绑定**：若某会话上次绑定的任务还不是终态，重绑会被拒绝
  （`… 状态为 backlog，尚未终结；先收官或取消该 task 再换绑`）。所以要把任务推到终态**再**换绑。
- **`session-end` 要留到最后一步**：会话一旦结束就不能再 `session-start`（`session 已结束`）。
  先结束会话、再想把任务推到 `done`，就会卡在没有活动会话的状态里。
- `artifact-add` / `event-add` 不受上述顺序限制，可在任意阶段追加；证据要跟着状态一起写，
  因为 `review` 与 `done` 都要求带 `--evidence`。
