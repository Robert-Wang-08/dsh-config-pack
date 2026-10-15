---
name: ptc-multi-agent-control
description: 编排跨工具、跨模型的 PTC 多代理任务。设计默认使用 codex-relay/gpt-6-astra；仅在高难度独立复核或全新领域自顶向下设计时使用一次 Opus 5.5 plan reviewer。提供唯一根任务、追加式项目账本、契约冻结、分层路由、worker receipt 和证据化收口。
managed-by: git
source: dsh-config-pack
version: 0.13.0
metadata:
  origin: self
  author: wang
  created: 2026-10-12
  updated: 2026-10-15
  version: 0.11.1
  managed-by: skillhub
  source: skillhub
  asset-type: skill
  asset-id: ptc-multi-agent-control
  status: active
  changelog: CHANGELOG.md
---

# PTC 多代理主控

维护索引：[版本变更](CHANGELOG.md) · [问题与修复历史](ISSUE_FIX_HISTORY.md)

## 适用范围

本 skill 是与仓库技术栈无关的多代理控制面。它负责识别主控、冻结目标、拆分和路由工作、验收 worker receipt、记录进度与证据；业务事实仍由调用项目的指令、任务板、ADR、代码、测试和发布流程裁决。

加载后把工具返回的 Base directory 记为 `SKILL_ROOT`：

- 账本控制器：`scripts/ptc_task_control.py`
- 自动路由器：`scripts/ptc_route.py`
- worker receipt schema：`assets/worker-receipt.schema.json`
- 任务契约模板：`assets/task-contract.template.json`
- DSH 安装与环境细节：[references/USAGE.md](references/USAGE.md)

默认账本是目标工作区的 `.ptc/registry.jsonl`。只有项目明确指定时才使用 `--ledger <path>` 或 `PTC_LEDGER`。

## 不变量

1. 一个会话只绑定一个全局唯一根 `task_id`；执行拆分使用 `subtask_id`。
2. 一个工作区只有一个权威追加式 JSONL 账本；禁止改写历史。
3. 只有主控写账本。worker 只提交符合 schema 的 receipt。
4. `task-create` 时冻结 `objective`、完整 contract 及其 hash；目标或验收口径实质变化时创建新任务。
5. `review` 和 `done` 必须有 evidence；`done` 必须为 100%。worker 自述不能代替主控验收。
6. 主控不能外包目标解释、拆分、路由、receipt 验收、账本写入和最终结论。
7. 所有模型和 provider 名称都记录运行时观测值，不以本文件的默认路由反推实际执行者。

## 标准流程

### 1. 观测主控

每次开始业务工作前运行：

```powershell
python $SKILL_ROOT/scripts/check-model.py
```

用同一次观测结果填写 `session-start --controller-model` 和最终回复的“实际路由”。观测不到就写 `unverified`；不要填文档默认值。

### 2. 创建任务并进入执行态

```powershell
$ctl = Join-Path $SKILL_ROOT 'scripts/ptc_task_control.py'
python $ctl init --project-id <project-id> --project-name "<project-name>"
python $ctl task-create --project-id <project-id> --title "<title>" --objective "<single-objective>" --contract "$SKILL_ROOT/assets/task-contract.template.json"
python $ctl session-start --task-id <task-id> --session-id <session-id> --controller <agent> --controller-model <observed-provider/model+effort>
python $ctl status-update --task-id <task-id> --session-id <session-id> --status in_progress --progress 1 --summary "目标和契约已冻结" --next-action "拆分首批子任务"
```

必须遵守以下顺序：

```text
task-create -> session-start -> in_progress -> work -> review -> done -> session-end
```

- `task-create` 产生 `backlog`，不能直接跳到 `review` 或 `done`。
- 旧任务未终结时，`session-start` 不会解除原绑定。
- `session-end` 是最后一步；结束后的 session 不能重新绑定。

### 3. 路由与派发

优先用路由器，而不是凭“复杂/简单”的语感决定执行者。`SKILL.md` 解释政策与边界，但 Python 不解析自然语言；模型/provider/executor 等可变值来自 `assets/public-runtime-config.json`，R1–R9 的首条命中顺序、输入校验和输出契约保留在可单测的代码中。这是“配置驱动数据 + 代码执行规则”的边界：

```powershell
$route = Join-Path $SKILL_ROOT 'scripts/ptc_route.py'
python $route --input-json '<normalized-work-item-json>'
```

路由器按首条命中原则处理：跨目录、高失败代价、文档、仲裁型设计、独立设计、六个以上文件、二至五个文件连续修改、单点或只读执行、主控兜底。它输出唯一的 tier、route、候选链、执行形态、信封字段和验证要求；route enum 以 `ptc_task_control.ROUTES` 为单一事实源。

派发前登记子任务：

```powershell
python $ctl subtask-create --task-id <task-id> --session-id <session-id> --title "<atomic-task>" --objective "<single-action>" --route <route> --expected-output "worker receipt JSON"
```

worker 信封必须包含：`task_id`、`subtask_id`、contract hash、允许读写路径、禁止项、预期输出和验证要求。worker 不得扩展范围或写账本；失败时返回 `blocked` 或 `failed`。

### 4. 验收与记账

主控检查实际文件、验证结果和风险后再登记 receipt：

```powershell
python $ctl receipt-add --task-id <task-id> --session-id <session-id> --receipt <receipt.json>
python $ctl event-add --project-id <project-id> --task-id <task-id> --session-id <session-id> --kind <decision|progress|risk|handoff|note|milestone> --message "<message>" --evidence "<evidence>"
python $ctl artifact-add --task-id <task-id> --path <workspace-relative-path> --kind <code|config|document|report> --format <format> --evidence "<verification>"
```

receipt 的 `route` 必须与已登记 subtask 一致；`executor` 和 `model` 填真实观测值。

### 5. 收口

```powershell
python $ctl status-update --task-id <task-id> --status review --progress 90 --summary "待主控验收" --next-action "复核证据" --evidence "<evidence>"
python $ctl status-update --task-id <task-id> --status done --progress 100 --summary "已验收" --next-action "无" --evidence "<evidence>"
python $ctl session-end --task-id <task-id> --session-id <session-id> --summary "<summary>"
```

最终回复包含：根任务与目标、完成项、实际路由与降级、产出物、验证证据、限制或阻塞、下一步唯一动作。

## 路由策略

若 `$DSH_HOME/plugins/provider-failover/route-config.json` 存在且 schema 受支持，先读取其中的 `subagentRouting`。它是本机人工确认规则；仅缺失时使用下列默认值。不得从凭据文件推断路由。

| 工作类型 | 默认候选链 |
| --- | --- |
| 主控、拆分、验收、收口 | `codex-relay/gpt-5.6-sol` -> `openai-codex/gpt-5.6-sol` -> `kimi-coding/k3-256k` |
| 一般设计、模糊设计、高不确定性发散 | `subagent_codex_astra` + `codex-relay/gpt-6-astra` -> GPT/DS 后备；不自动调用 Claude |
| 高难度设计或冲突仲裁 | `codex-relay/gpt-6-astra` 设计 -> `subagent_claude_opus55_plan` 独立只读复核 -> GPT 后备 |
| 全新领域且明确要求自顶向下设计 | `design_mode=top_down`：Astra 设计 -> 单次 Opus 5.5 独立复核 -> GPT 后备 |
| 原子开发、查询、字段核查、验证 | `ais-2dsglm/deepseek-v4.1-flash` -> `opencode-go/deepseek-v4.1-flash` -> 主控 |
| 同一代码面的连续修改 | Cursor/Grok -> OpenCode Go -> 主控 |
| 正式说明、总结、大背景汇总 | Kimi K3-256K -> 主控 |

补充规则：

- GPT 组是 `codex-relay` 与 `openai-codex`；二者是独立工具，不会自动互相重派发。
- 设计档使用专用工具 `subagent_codex_astra`（绑定 `codex-relay/gpt-6-astra`）；`subagent_codex_relay` 固定绑定 `gpt-5.6-sol`，两者不可互相冒充。
- DS 组是 `ais-2dsglm` 与 `opencode-go`；只有用户明确指定时才提升后者优先级。
- 设计默认使用 `codex-relay/gpt-6-astra`；一般与模糊设计不自动使用 Claude。
- 只有高难度复核，或显式 `top_down` 的全新领域设计，才调用一次 Opus 独立复核。
- Opus 有两个只读复核执行档，各自绑定独立的 Claude Code 配置目录，可同时可用、互不串档：
  `subagent_claude_opus55_plan`（5.5 档，来源 tokeniss）与 `subagent_claude_opus5_plan`（5 档，来源 anthropic-relay）。
- 隔离必须靠 `CLAUDE_CONFIG_DIR`，不能靠环境变量：Claude Code 的 settings.json 里 env 优先级高于进程环境（2026-10-15 实测——给子进程塞无效 token 仍能成功），只设 env 会让两个档串到同一后端。配置目录由 `scripts/claude_config_profiles.py` 预置，含凭据，属设备本地状态，不入库。
- Opus 独立复核按 `assets/public-runtime-config.json` 的 `opusLadder` 首条命中降级：5.5 -> 5 -> 4.8；三档都不可用时如实报告 Opus 不可用，不自动改用 Sonnet。
- 梯子的 provider/model 是档位依据与派发记录，执行档本身不读它。换来源或换档后必须重验「该来源在售且回显同一 model id」。2026-10-15 实测：5.5 只在 tokeniss 提供，anthropic-relay 对它直接返回 403 `该令牌无权访问模型 claude-opus-5-5`；4.8 档用 anthropic-relay，因为 tokeniss 的同名档是别名（实测回 5-5）。“Opus 5.5”是路由能力/工具标签，receipt 必须记录 provider 返回的真实模型 id。
- “复核”必须由独立第二遍检查完成，不能让同一执行者复述原方案。
- 人工指定 provider/model 时覆盖默认首选，但仍记录真实值。
- 主控模型由人选择。主控 provider 失败时，路由器不能在当前会话热切换；需要新建或重启会话，并登记 `risk`。
- `provider-failover` 只处理 Host provider，不覆盖 ACP 子代理；ACP 降级由主控显式执行。

## ACP 子代理运行规则

- ACP 子代理必须作为顶层工具调用，禁止包在带独立执行期限的 `run_code` 中。
- 长任务使用后台模式；等待窗口按任务规模估算，不把硬超时当作默认等待时间。
- 启动后立即建立可见进度通道。`job_output.text` 为空不能证明任务停滞；优先使用 ACP 事件与有界工作区指纹这两个独立信号，必要时再查会话日志。
- 两类进度信号连续超过两个预期 LLM 轮次都没有变化时，才考虑干预。
- 大文档或大清单按 5–10 项分批，每批返回增量 receipt；全量扫描仅放后台。
- 短小单点任务优先由主控或进程内 worker 完成，避免无收益的外部 ACP 冷启动。

### 自检与重试

先运行自检，再判断路由故障：

```bash
python scripts/acp_smoke.py --all
python scripts/acp_smoke.py --route cursor-grok --json
python scripts/acp_smoke.py --command "some-agent acp"
```

| 分类 | 处置 |
| --- | --- |
| `spawn` | 修正命令入口；Windows shim 用 `cmd /c`，POSIX shim 用 `sh -c`。不重试。 |
| `model` | 从 provider 的可用模型列表取得真实 id。不重试。 |
| `auth` | 修复登录或凭据来源。不要靠重试掩盖问题。 |
| `transport` | 检查代理与链路；最多重试一次，仍失败则按候选链降级并登记 `risk`。 |

故障的完整现象、根因、修复和证据见 [ISSUE_FIX_HISTORY.md](ISSUE_FIX_HISTORY.md)。

## DSH bundle 约束

`assets/dsh-bundle/` 提供 `ptc-multi-agent` preset。安装、环境变量和跨平台命令详见 [references/USAGE.md](references/USAGE.md)。修改 bundle 时保留这些约束：

- OpenCode 模型通过 `PTC_OPENCODE_CONFIG_CONTENT` 注入，不向 `opencode acp` 传 `--model`。
- Cursor 默认使用 `cursor-agent --model auto acp`；固定模型前先运行 `cursor-agent --list-models`。
- Kimi 模型别名必须带 provider 前缀。`k3` 或 `kimi-for-coding` 可以使用 `effort=max`，但不存在名为 `k3-max` 或 “Max” 的模型。
- DSH 从 profile 根解析插件；依赖必须在目标 profile 中实际安装，并确认没有 `did not activate` 警告。
- `@local/dsh-subagent-acp-resilient` 必须使用可跨设备解析的已钉版本；禁止重新写回机器本地的 workspace link 绝对路径。
- bundle 不替用户强制修改 `no_proxy`；Cursor 的代理策略由父进程环境和系统策略决定，同时保留已验证的 HTTP/1.1 修正。
- ACP 超时和工作区恢复参数以当前 bundle 配置为准，可通过对应的 `PTC_ACP_*` 环境变量覆盖；不要在说明中复制另一套默认值。

## 验证

修改路由、账本或 bundle 后，至少运行相关测试：

```bash
python -B scripts/test_ptc_route.py
python -B scripts/test_acp_smoke.py
```

同时运行 `ptc_task_control.py verify` 检查账本，并对真实产出执行项目自己的测试或验证。只有验证证据进入账本后，任务才可转为 `done`。
