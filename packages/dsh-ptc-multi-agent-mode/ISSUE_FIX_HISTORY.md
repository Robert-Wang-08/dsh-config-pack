# 问题与修复历史

本文件保存诊断背景和验证记录，不是每次加载 skill 都必须阅读的操作规范。当前应执行的规则以 [SKILL.md](SKILL.md) 为准，版本演进见 [CHANGELOG.md](CHANGELOG.md)。

## 追踪表

| 日期 | 问题 | 根因 | 修复 | 状态 |
| --- | --- | --- | --- | --- |
| 2026-10-15 | 把“Opus 5.5 不可用”当成已证结论 | 只探测了一个来源（`anthropic-relay`）就把单来源观测外推成全局结论；实际上 `claude-opus-5-5` 由另一个来源提供 | 改为 `opusLadder` 显式降级梯（5.5 -> 5 -> 4.8 -> 报告 Opus 不可用），对每个来源实测“请求 id 与回显 id 是否一致”，并把同档别名（请求 4-8 回 5-5）写成换来源必修项 | 已修复为流程规则 |
| 2026-10-14 | SkillHub registry 版本落后于技能实体 | 两处 registry 仍保留较早登记版本，而 `SKILL.md` 与 `skill.json` 已推进到 0.10.0 | 后续通过 SkillHub 正式登记/发布流程刷新 registry；本次不手工改缓存登记 | 待刷新 |
| 2026-10-14 | 两个 SkillHub store 副本的 `SKILL.md`、`skill.json` 与 bundle 版本不一致 | 开发 store 与坚果云副本分别演进，版本流水又写在单行 frontmatter 中，难以发现分叉 | 0.9.2 先收拢文档和较新 bundle；0.10.0 再将说明与历史分层。同步必须比较完整目录，不能只看 frontmatter | 文档已合并；整包仍需 SkillHub 校验 |
| 2026-10-14 | ACP 超时后“文件已修改但结果无法返回” | 旧超时路径置位 cancelled，回收结果时丢弃诊断和已完成变更信息；单档超时也会误判慢响应 | bundle 0.6.x 引入分阶段超时、活动延长、恢复等待与工作区复用保护；resilient 0.2.1 修正取消和回收语义 | 已固化 |
| 2026-10-14 | 换设备后 resilient 插件无法解析，三条 ACP 行静默消失 | bundle 依赖写成机器本地的 workspace link 绝对路径 | bundle 0.6.1 改为钉定 `github:Robert-Wang-08/dsh-subagent-acp-resilient#v0.2.1` | 已修复 |
| 2026-10-13 | Kimi 文档子代理两次“超时无输出” | ACP 调用被包进有独立 120–600 秒期限的 `run_code`，外层到期取消了在途任务 | ACP 改为顶层调用；长任务后台运行；按规模估算等待窗口并观察 ACP 会话日志 | 已修复为通用规则 |
| 2026-10-13 | 后台 `job_output.text` 为空，被误判为任务停滞 | 后台汇总接口不提供实时正文，不能代表子代理没有推进 | 以会话日志或等价实时证据判断；停滞阈值为两个预期 LLM 轮次 | 已修复为通用规则 |
| 2026-10-13 | 大文档任务耗时长、难判断进度 | 单次全量扫描缺少增量边界和 receipt | 拆成 5–10 项一批，每批返回增量 receipt；全量扫描仅后台执行 | 已修复为通用规则 |
| 2026-10-13 | Cursor 经代理偶发 `HTTP/2 keepalive ping timed out after 5000ms` | 代理路径未传 ping 参数，落到 5 秒默认值；直连路径使用 10/20 秒，配置层又没有超时开关 | 曾用 `no_proxy` 防御；0.9.2 后 bundle 不再强制代理例外，交由外部策略决定，并保留 HTTP/1.1 修正 | 策略已去机器化 |
| 2026-10-13 | Cursor 模型错误被误报为认证错误 | `cursor-agent` 对不可用模型 id 返回误导性的 `Authentication required` | 默认使用 `--model auto`；固定模型前运行 `cursor-agent --list-models`；自检把该类归为 `model` | 已修复 |
| 2026-10-13 | ACP 停在 initialize 或表现为 transport 失败 | Windows 上 `opencode`、`cursor-agent` 常是 `.cmd`/`.ps1` shim，不能当作原生 executable 直接 spawn | Windows 用 `cmd /c`，POSIX 用 `sh -c`；Kimi 真实可执行文件可直接调用 | 已修复 |
| 2026-10-13 | DSH 会话正常启动，但子代理工具消失 | 依赖只进入 bundle 的 pnpm 虚拟库；DSH 实际从 profile 根解析插件，失败只显示 `did not activate` 警告 | 在目标 profile 显式安装依赖，并把警告消失作为验收条件 | 已修复为安装规则 |
| 2026-10-13 | PTC preset 中无法使用 Relay GPT | Relay 子代理只在其他 preset 声明 | PTC bundle 新增独立 `subagent_codex_relay` | 已修复 |
| 2026-10-13 | 把 “K3 Max” 当作模型名 | 混淆 Kimi 模型 id 与 effort | 使用带 provider 前缀的真实别名；`max` 只写在 effort | 已修复 |
| 2026-10-13 | `backlog -> review`、重绑 session、提前 `session-end` 失败 | 账本状态机与会话绑定是强约束，不会自动补中间状态或解除旧绑定 | 固定 `task-create -> session-start -> in_progress -> review -> done -> session-end` | 已修复为流程规则 |
| 2026-10-12 | 用 Host provider failover 推断 ACP 会自动降级 | Host provider 和 ACP 子代理属于不同控制面 | ACP 失败由主控显式重试/降级并写 `risk`；主控自身失败需新会话 | 已修复为路由规则 |

## 关键诊断详情

### 1. ACP 超时与结果回传

旧 bundle 使用单档 45 秒、120 秒和 1800 秒限制。慢模型或 Cursor 连续修改可能仍在正常推进，却被空闲或绝对超时取消；取消标记继续传入结果回收阶段后，已经发生的文件变更和诊断文本不能可靠返回给主控。

bundle 0.6.x 将生命周期拆为启动、建会话、空闲告警、软上限、硬上限、活动延长和恢复等待。普通与复杂任务使用不同窗口，并开启工作区复用保护。resilient 0.2.1 又补齐首帧、子进程退出、双进度证人、有界 dispose、quiescence 证明和结果保留语义。具体默认值以当前 `assets/dsh-bundle/cordis.patch.yml` 为准，避免文档复制值后再次漂移。

### 2. Cursor 代理链路

代码检查显示：代理路径没有显式传入 ping 参数，落到 `pingIntervalMs=5000`、`pingTimeoutMs=5000`；直连路径显式使用约 10 秒间隔和 20 秒超时。配置层只有 `network.useHttp1ForAgent`，没有可直接设置 30 秒 ping timeout 的选项。

代理故障期间曾测得绕开代理 6/6 成功、走代理 1/6 成功，但两组按先后顺序执行，存在时间混淆。代理恢复后进行交错 A/B，各 4 次均为 4/4。因此 `no_proxy` 只能作为外部环境的临时防御措施，不应被 bundle 强制，也不应被表述为健康代理环境的必需条件；真正的根因仍是当时的代理故障。HTTP/1.1 修正继续保留。

### 3. ACP 延迟样本

2026-10-12 的 U3 小样本为每条路由两次完整 prompt 往返：OpenCode 中位数约 8.6 秒、Kimi 约 9.5 秒、Cursor 约 51 秒。它不是首 token 延迟，也不足以做性能承诺；只支持一个调度结论：短小单点任务通常不值得冷启动外部 ACP，Cursor 更适合连续多文件修改。

### 4. 本机环境修复

2026-10-13 曾执行两项本机修复：

- `~/.cursor/cli-config.json` 设置 `network.useHttp1ForAgent=true`。
- 从 `~/.kimi-code/config.toml` 移除七个在无 `sh` 环境下会停滞的 Orca hooks。

当时均创建 `.bak-20261013-*` 备份。这些是特定机器的处置记录，不是跨设备安装步骤；新设备应先复现和诊断，再决定是否应用。

### 5. SkillHub 副本分叉

本次整理过程中先后观测到：

- 初始坚果云目录的 `SKILL.md` 标为 0.9.1，bundle 为 0.5.0，`skill.json` 为 0.8.1；registry 指向的开发 store 则包含另一条 0.9.0/0.6.0 演进记录。
- 随后的 0.9.2 合并使两处 `SKILL.md` 与 `skill.json` 一致，并把坚果云 bundle 提升为 0.6.1；开发 store 的 bundle 一度仍为 0.6.0，说明只同步说明文件仍不能保证整包一致。

这说明“版本字符串相同或更高”不足以判断整包新旧。后续同步应以 SkillHub registry 的 canonical location 为源，比较整个目录内容并先做 dry-run；不要只复制 `SKILL.md` 或只比较 frontmatter 版本。
