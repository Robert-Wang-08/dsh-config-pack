# 通用 PTC 多代理模式使用说明

本模式适用于任意工作区，不假设语言、框架、目录结构或项目治理体系。它只增加多代理编排控制面；调用项目现有指令和事实源仍然优先。

## 模式和主控

在 DSH Web 选择 **PTC 多代理主控（通用）**（preset：`ptc-multi-agent`）。新建会话时选择：

- 首选 `codex-relay/gpt-5.6-sol` + `high`；
- 备用 `kimi-coding/k3-256k`；
- `kimi-coding/k3-256k` 支持 `reasoning_effort=max`；Max 是推理强度档位，不是模型名，不得写成模型 `k3-max`。

固定路由：Codex Relay `gpt-6-astra` 默认处理设计；仅高难度复核或显式全新领域自顶向下设计使用一次 Opus 5.5 plan reviewer。OpenCode DS V4.1 Flash 处理原子查询/修改；Cursor/Grok 处理同一代码面的连续修改；Kimi 生成文档草稿。任何降级都要登记实际 provider/model 和原因。

## 自动工作分层路由

用 `scripts/ptc_route.py` 把可观测特征转换为唯一的 route/executor/model/shape，并同时得到降级链、信封字段和验证要求。8 值 route enum 与账本控制器同源，不改 receipt schema。

~~~powershell
python scripts/ptc_route.py --input-json '{"writes_files":true,"file_count":3,"uncertainty":"medium","adjudication":false,"validation_burden":"high","context_lines":4000,"cross_directory":false,"failure_cost":"medium","work_kind":"code","prefers_acp":false,"background":false}'
~~~

判定顺序：跨目录、高代价、文档、仲裁设计、独立设计、≥6 文件、2–5 文件连续修改、单点或只读定点执行、主控兜底。一般/模糊设计链为 Astra → GPT/DS 后备；高难度或 `top_down` 设计链为 Astra → Opus 5.5 独立 review → GPT 后备；文档链为 Kimi → controller。

主控 provider 自身失败（WebSocket error、`PI_AI_ERROR`、会话中断）时，路由 CLI 不会热切换主控；需在会话层新建会话并改用后备 provider，并登记 `risk` 事件。

外部 ACP 有明显冷启动成本，因此短任务不要为外部 ACP 冷启动；Cursor 只保留给连续多文件修改。

离线测试：

~~~powershell
python -B scripts/test_ptc_route.py
~~~

## 便携式账本

加载 skill 后，DSH 会报告 Base directory。设为 `$SKILL_ROOT`：

```powershell
$ctl = Join-Path $SKILL_ROOT 'scripts/ptc_task_control.py'
```

CLI 默认把账本放在当前工作区 `.ptc/registry.jsonl`，因此同一套 skill 可在任意仓库工作。项目需要已有控制目录时，使用 `--ledger <path>` 或环境变量 `PTC_LEDGER`；模式不会强迫项目采用 `.ptc` 之外的任何目录。

```powershell
python $ctl init --project-id <project-id> --project-name "<project-name>"
python $ctl task-create --project-id <project-id> --title "<title>" --objective "<single-objective>" --contract "$SKILL_ROOT/assets/task-contract.template.json"
python $ctl session-start --task-id <task-id> --session-id <session-id> --controller <agent> --controller-model <provider/model+effort>
python $ctl event-add --project-id <project-id> --task-id <task-id> --kind decision --message "<decision>" --evidence "<evidence>"
python $ctl subtask-create --task-id <task-id> --title "<atomic-task>" --objective "<single-action>" --route execute-dsv41-flash --expected-output "receipt JSON"
python $ctl receipt-add --task-id <task-id> --receipt <receipt.json>
python $ctl status-update --task-id <task-id> --status review --progress 90 --summary "待验收" --next-action "主控复核" --evidence "tests passed"
python $ctl artifact-add --task-id <task-id> --path <workspace-relative-path> --kind config --format yaml --evidence "config parsed"
python $ctl show --task-id <task-id>
python $ctl verify
python $ctl session-end --task-id <task-id> --session-id <session-id> --summary "<summary>"
```

## 唯一性与防漂移

- ID 由 UTC 微秒时间、类型前缀和随机后缀组成，全局唯一。
- 每个 session 只绑定一个根 task；每个 task 默认只允许一个活动 session。
- 账本是追加式 JSONL，每次写入前全量重放验证。
- task 创建时把目标和产出契约写入账本并计算 hash；实质变更创建新 task。
- worker 不写账本，只提交严格 schema receipt；额外字段也会拒绝。
- `review` / `done` 要 evidence，`done` 要 100%，进度不可回退。
- 项目事件支持 `decision`、`progress`、`risk`、`handoff`、`note`、`milestone`。

## DSH bundle

bundle 位于 `assets/dsh-bundle/`。安装到某个 profile（含换机器后的新 profile）：

```powershell
dsh plugin --profile <名字> add <bundle 绝对路径> `
  '@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2' `
  '@deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2'
```

后两个包**必须显式列出**：它们不在 DSH 根安装内，且 DSH 的插件加载器是从 **profile 根**解析
`name:` 里的包，bundle 自己在 `dependencies` 里声明只会装进 pnpm 虚拟库，对应行照样 import 失败。
失败表现极具欺骗性——只是一行 `dsh: warning: N entry did not activate`，会话照常起，工具却没了。
装完必须确认这行警告消失。

模型 id 可通过以下环境变量适配不同机器：

| 变量 | 默认值 |
| --- | --- |
| `PTC_OPENCODE_CONFIG_CONTENT` | `{"model":"ais1dsglm/deepseek-v4.1-flash"}` |
| `PTC_OPENCODE_ACP` | 未设（整体覆盖 OpenCode 的内层命令串；设了就完全替换默认的 `<PTC_CLI_OPENCODE> acp`） |
| `PTC_CLI_OPENCODE` | `opencode`（OpenCode 可执行命令名；仅当 `PTC_OPENCODE_ACP` 未设时追加 `acp`） |
| `PTC_CURSOR_ACP` | `cursor-agent --model auto acp`（默认让 Cursor 自选；要指定就写 `--model grok-4.7-high`） |
| `PTC_KIMI_DOCS_MODEL` | `kimi-code/k3-256k`（别名清单见 SKILL.md；长文档可选 `kimi-code/kimi-for-coding` 或 `kimi-code/k3`，均为 1M 上下文） |
| `PTC_CLAUDE_OPUS55_MODEL` | `claude-opus-5-5`（5.5 档执行工具 `subagent_claude_opus55_plan`） |
| `PTC_CLAUDE_OPUS5_MODEL` | `claude-opus-5`（5 / 4.8 档执行工具 `subagent_claude_opus5_plan`；设 `claude-opus-4-8` 即切 4.8 档） |
| `PTC_CLAUDE_OPUS55_CONFIG_DIR` / `PTC_CLAUDE_OPUS5_CONFIG_DIR` | `~/.claude-profiles/tokeniss` / `~/.claude-profiles/relay`（两档各自独立的 Claude Code 配置目录） |
| `PTC_CURSOR_KEEP_PROXY` | 未设（默认让 Cursor 域名绕开代理，见坑 5） |

### ACP 插件与超时梯子

三条 ACP 行（`subagent-acp-opencode-dsv41` / `subagent-acp-kimi-docs` / `subagent-acp-cursor-grok`）指向哪个插件，
由生成器答案 `acpPlugin` 决定，默认 `resilient`：

| 取值 | 插件 | 超时能力 |
| --- | --- | --- |
| `resilient`（默认） | `@local/dsh-subagent-acp-resilient` | 同 `providerName`/`command`/`args`/`permission`/`env` 语义，另加分级超时梯子（`processStartTimeoutMs` … `disposalTimeoutMs` 与 `guardWorkspaceReuse`），每个值都写成 `PTC_ACP_<字段名 UPPER_SNAKE>` 环境覆盖，未设置时用插件文档默认值 |
| `upstream` | `@deepseek-ai/dsh-subagent-acp` | **完全没有超时字段**：`dispose()` 无界等待子进程退出，子进程挂住时父级工具调用不会返回 |

插件名与梯子**成对**发射，不能拆开：DSH 的插件配置 schema 不拒绝未知键，把梯子键写在
`@deepseek-ai/dsh-subagent-acp` 旁边只会**静默失效**——不报错，也不生效。所以这个选择同时落到生成的
`dsh-bundle/cordis.patch.yml`、skill 自带的 `assets/dsh-bundle/cordis.patch.yml`，以及生成的
`ptc.local.patch.yml`（后者的顶层 `- id:` 行会整体替换该行的 config，必须重复插件名和梯子）。

resilient 插件通过公开 Git 仓库分发（`github:Robert-Wang-08/dsh-subagent-acp-resilient#v0.2.1`），两个公开 bundle package manifest 都声明了该依赖。安装 bundle 时让包管理器完成依赖解析即可；DSH 仍要求启动前该插件已经存在于 profile 根的 `node_modules` 中。

加载期一致性由 resilient 插件自己校验：`processStartTimeoutMs <= startupTimeoutMs`、
`softTimeoutMs <= absoluteTimeoutMs <= complexHardTimeoutMs`、`complexSoftTimeoutMs <= complexHardTimeoutMs`，
且所有值必须是正的有限数；`idleWarnMs > idleTimeoutMs` 不是错误，会被夹到 `idleTimeoutMs` 并告警。
`PTC_ACP_*` 的完整变量名与默认值清单见生成物 `ptc.env.example`。

### 换机器时的五个坑（已实测）

1. **OpenCode 不能用 `--model`。** `opencode acp --model X` 和 `opencode --model X acp` 都会 exit 1。
   模型必须写进 `OPENCODE_CONFIG_CONTENT`；该变量是**合并**语义，不会丢掉用户自己定义的 provider。
2. **`command` 必须是可被 CreateProcess/execve 直接执行的入口。** `opencode`、`cursor-agent`
   在多数安装下只有 `.cmd`/`.ps1` shim，裸名 spawn 会失败，表现为 ACP `initialize`/transport 失败。
   本 bundle 统一用 `cmd /c`（Windows）或 `sh -c`（POSIX）包装；`kimi` 是真实 exe，直接调用。
3. **不要覆盖 `XDG_DATA_HOME`/`HOME` 等数据目录变量。** OpenCode 的登录凭据在
   `<XDG_DATA_HOME>/opencode/auth.json`，改指空目录会让所有调用退化成认证失败。
4. **模型名必须真实存在于当前账号。** `cursor-agent --model grok-code-fast-1 acp` 会直接 exit 1，
   并且把这个失败报成 `Authentication required`——非常容易被误判成"没登录"，从而在登录上白花时间。
   查可用列表用 `cursor-agent --list-models`（权威，逐条列出 id 与显示名，例如
   `grok-4.7-high - Grok 4.7  High`）；不要靠报错信息猜。
   实测该账号有 `grok-4.7-low/medium/high/xhigh`（含 `-fast`）、`cursor-grok-4.6-*` 等；
   `grok-code-fast-1` 不存在。
5. **别让 Cursor 走代理。** `cursor-agent` 的代理路径把 HTTP/2 ping 超时写死成 5 秒，
   直连路径是 10 秒 / 20 秒，而配置层没有超时项可调（`network.*` 只有 `useHttp1ForAgent`）：
   ```js
   proxyUrl !== undefined
     ? new Q.A({authority, proxyUrl, http2SessionOptions})                        // 落到 5e3/5e3 默认值
     : new S.gE(url, {pingIntervalMs:1e4, pingTimeoutMs:2e4, pingIdleConnection:!0}, opts)
   ```
   症状是 `RetriableError: [internal] HTTP/2 keepalive ping timed out after 5000ms`
   （DSH 侧报 `stage: new-session; category: transport`）。bundle 已默认把 Cursor 域名
   加进**小写** `no_proxy`（cursor-agent 只读小写，且按 `host.endsWith(条目)` 后缀匹配，
   所以 `cursor.sh` 能覆盖 `api2.cursor.sh` 与 `agentn.global.api5.cursor.sh`）。
   如果本机必须经代理才能访问 Cursor，设 `PTC_CURSOR_KEEP_PROXY` 为任意非空值即可恢复原行为。

   **归因边界**：代理故障期间测得"绕开 6/6、走代理 1/6"，但两臂先后执行，属时间混淆。
   代理修好后做交错 A/B（同时段各 4 次）结果为**两臂均 4/4**。因此这条绕过是**防御性加固**
   （代理劣化时不拖垮 Cursor），不是在健康代理下的必需项；超时的真正来源是代理故障本身。

自检方式（不依赖 DSH 会话）：直接对 `opencode acp` / `cursor-agent ... acp` 发 ACP
`initialize` → `session/new` → `session/prompt`，若子代理自报的模型标识与预期不符，说明锁定没生效。

Cursor 已端到端跑通：**默认 `--model auto`**（由 Cursor 自选，不绑定具体模型，换账号最稳）；
早期在 `grok-4.7-high` 下也验证过 `session/new` 与 `session/prompt` 均成功、子代理自报 "Grok 4.7"。
要固定成 Grok 就把 `PTC_CURSOR_ACP` 设为 `cursor-agent --model grok-4.7-high acp`；若模型名失效，
按上面第 4 条用 `cursor-agent --list-models` 重新取列表。

**瞬时失败仍应重试**：早期 4 次 DSH 会话调用中有 2 次返回
`RetriableError: [internal] HTTP/2 keepalive ping timed out after 5000ms`（DSH 侧表现为
`stage: new-session; category: transport`）。后续查明主因是代理故障（修好后交错 A/B 两臂均 4/4），
但代理抖动仍可能复现同类瞬时错误。连续修改作业应带重试，重试仍失败再按路由表降级到
`subagent_opencode_dsv41`。

## 排障先自检

不要靠读报错猜原因——ACP 的四类失败对外长得像，历史上已因此误判过两次。一条命令走完
`initialize → authenticate → session/new → session/prompt`：

```bash
python scripts/acp_smoke.py --all                  # 三条内置路由
python scripts/acp_smoke.py --route cursor-grok --json
python scripts/acp_smoke.py --command "some-agent acp"
```

| 失败类型 | 典型文本 | 处置 |
| --- | --- | --- |
| `spawn` | `is not recognized as an internal or external command` | 命令入口不对：补 `cmd /c` / `sh -c` 或修正路径 |
| `model` | `Cannot use this model` | 用 `cursor-agent --list-models` 取真实 id；**cursor-agent 会把它谎报成认证问题** |
| `auth` | `Authentication required` | 重新登录子代理 CLI；重试无用 |
| `transport` | `RetriableError ... keepalive ping timed out` | 查代理健康度；可重试一次 |

模型与命令取自与 bundle 相同的环境变量（`PTC_OPENCODE_CONFIG_CONTENT`、`PTC_OPENCODE_ACP`、
`PTC_CLI_OPENCODE`、`PTC_CURSOR_ACP`、`PTC_KIMI_DOCS_MODEL`），所以不会与资产各写一套而漂移。cursor 路由会先做 `--list-models`
预检，模型名非法时**不消耗会话**。离线单测：`python scripts/test_acp_smoke.py`。

模型锁定只能由子代理自报或 provider 的权威查询验证；无法观测时必须标记为 `unverified`。

## 输出契约

任务创建前把 `assets/task-contract.template.json` 复制为任务专用 contract，填写明确的工作区相对路径、格式和验收项，再传给 `task-create`。最终回复固定包含：根任务、完成项、实际路由与降级、产出物、验证证据、限制以及下一步唯一动作。
