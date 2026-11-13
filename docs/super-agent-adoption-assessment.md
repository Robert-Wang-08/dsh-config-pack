# 引入 dsh-superagent 开源架构的可行性评估

日期：2026-11-02

## 结论

建议引入 dsh-superagent 的架构思想和少量边界，暂不把完整 bundle 直接装进当前 DSH profile，也不替换现有 PTC 多代理控制面。

它最有价值的补充是主动工作生命周期：外部事件进入后，经过准入和授权评估，形成可追踪的 Ticket，再绑定独立执行 Session、工作目录、结果渠道和人工关注状态。当前 DSH/PTC 已覆盖模型路由、子代理派发、任务契约、receipt、账本和证据收口；super-agent 原型覆盖事件监听、授权、工单状态、恢复和运营面板。两者是上下层互补。

推荐先做独立的 observe-only GitHub Source 试点：只接收一个仓库的 Issue、PR 和 CI 事件，记录 Trigger、Policy、Eval、Ticket 和拟执行动作，不自动创建 PR、不自动发消息；验证噪声、重复、授权和人工关注成本后，再决定是否接入真实 Executor。

## 当前工作区基线

本地 dsh-config-pack 已包含 PTC preset、公开 companion 生成器、唯一根任务、contract hash、R1-R9 路由、worker receipt、追加式账本、ACP/Claude/Codex/Kimi/OpenCode 适配、provider failover 和 subagent monitor。因此完整 super-agent bundle 与现有能力的重叠主要在 Session/Executor 接入、面板和配置层，不会自动提升当前 PTC 的模型选择质量。

## 开源架构提炼

官方文档的核心链路是：

Source → Trigger → Thread → Eval → Decision/Mandate → Ticket → Assignment → Executor → Report/Attention → Channel

关键设计：

| 设计 | 对 DSH 的价值 |
|---|---|
| Source 保留游标、事件去重和来源身份 | GitHub、Feishu、webhook 可统一成事件适配器 |
| Trigger 是不可变事件，带 actor、thread、channel 和 disposition | 可审计、可幂等，避免重复接单 |
| Eval 分为确定性的 Gate 与模型 Assessment | 把授权与模型判断分开，减少 prompt 注入改变权限的风险 |
| Mandate 记录 Policy 版本、范围、强度和匹配规则 | 可解释为什么允许做、允许做到哪里 |
| Ticket 独立于 Executor Session | Session 重启、换执行器或恢复时，工作仍有稳定身份 |
| Assignment、Report、Attention 有结构化状态 | 面板可显示工作中、待回答、待审核、失败和阻塞 |
| 每个 Ticket 一个 Session 和目录 | 适合仓库改动隔离到 worktree/目录 |
| Outbox 先落库再发送，带幂等 key 和退避 | 降低重复评论、消息丢失和远端已收到后的重复重试 |
| 面板只优先显示需要人的事项 | 降低运营注意力成本 |

## 与 PTC 的边界

| 能力 | 当前 PTC/DSH | super-agent 原型 | 判断 |
|---|---|---|---|
| 模型/Provider 路由 | 已有 R1-R9 和真实 route receipt | 主要按角色模型配置 | 保留 PTC |
| 子代理派发 | 已有 ACP、Claude、Codex 等 executor | 有 Main Session/Executor Session | 复用 Ticket/Assignment 语义，接入现有派发 |
| 任务契约和范围冻结 | contract hash、授权路径、禁止项 | Mandate/Policy 表达 | 两者映射 |
| Worker 验收 | receipt、validation、evidence | Report、Attention、ready/blocked/failed | 增加状态映射，不重复造路由 |
| 主动监听外部事件 | 当前重点不是这一层 | GitHub、Feishu Source | 主要增量价值 |
| 授权和准入 | 以任务/工具授权为主 | Source Policy、Gate、Admission、Mandate | 主要安全增量 |
| 工作项持久化和恢复 | ledger 记录编排进度 | SQLite Engine/Outbox/Ticket 生命周期 | 先定义桥接，避免两套真相源 |
| 人机运营面板 | 已有监控和 DSH UI | 专用 Overview/Source/Eval/Execution/Settings | 借鉴信息架构，暂不直接合并 UI |

## 三种方案

### 完整引入 bundle

收益是快速得到 GitHub/Feishu 监听、授权、Ticket、执行隔离、恢复和专用面板。当前不推荐，原因是：

- 上游 README 明确声明这是研究原型、不是生产软件；
- 原型 package 要求 DSH ^0.2.1-alpha.2，当前工作区基线是 0.2.0-rc.2，兼容性未证实；
- 现有 config pack 已有大量 agent/subagent 行和 PTC bundle，直接叠加会带来 bundle 顺序、重复行、工具入口和状态源冲突；
- 需要 GitHub/Feishu 账号、CLI、独立 profile、状态目录和长期运行进程；
- Executor 默认以操作系统用户执行命令，文档也明确说明 blocked command wrapper 不是安全边界。

### 只引入架构模式和薄适配层

这是推荐方案：

1. Source adapter 把 GitHub 事件转换为 Trigger；
2. Policy/Gate 判断允许仓库、身份、事件类型和 observe/auto 模式；
3. Ticket 绑定现有 PTC 根任务或子任务，Mandate 映射到 contract hash、授权路径和禁止项；
4. Assignment 调用现有 PTC route，worker 仍只返回 receipt；
5. Report/Attention 映射到现有 ledger event 和 DSH 通知；
6. Outbox 先落本地事件，再发送 GitHub comment/PR，使用稳定幂等 key。

### 暂不引入

若当前工作主要是本地交互式开发、配置包维护和手工发起任务，主动监听不会马上提高产出，反而增加部署和权限管理成本。此时可只吸收 Gate/Assessment、Mandate、Ticket/Assignment、Attention、Outbox 这些设计。

## 最小试点

建议新建独立实验 profile 或插件包，不修改现有 web profile 的 bundle 顺序：

1. 只监听一个非关键 GitHub 仓库；
2. 只接收 Issue、PR comment 和 CI 失败三类 Trigger；
3. 只允许一个明确账号发起 explicit request；
4. accept mode 固定为 observe，inferred candidate 只记录 would accept；
5. Ticket 只创建记录，不启动代码修改 Executor；
6. 提供 Overview、Ticket history、Policy/Decision 和 Attention；
7. PTC ledger 仍是跨代理任务的唯一账本，实验状态使用独立命名空间，禁止两边互相改写；
8. 先验收事件去重、游标恢复、授权拒绝、策略变更和重启恢复；
9. 通过后才让 Ticket 调用 design-codex-astra 或执行档，并要求 receipt 回写既有 contract。

## 成功指标

- 同一事件重放不产生重复 Ticket；
- 未授权账号、未监听范围和 bot 噪声不会启动工作；
- observe 模式只记录拟接单原因，不产生外部副作用；
- DSH 重启后游标、Ticket、Assignment 和 Attention 可恢复；
- 人工事项能在一个面板入口找到，健康状态不制造通知噪声；
- 每个 Ticket 能关联 task_id、subtask_id、contract hash 和 receipt；
- 与手工发起同类任务相比，分诊时间、重复沟通、token 成本和失败重试可量化。

## 限制

本评估基于 GitHub 公开研究原型文档和当前工作区静态证据，没有在 clean profile 上安装并跑通完整 bundle。当前工作区 DSH 基线低于原型 package 声明的 engine 范围。PTC 子代理同步派发在运行时 120 秒内未返回，未取得可验收 worker receipt，因此本报告由主控依据一手资料完成，路由降级为手工协调。完整主动执行能力会扩大外部账号和仓库权限，必须把 observe-only、单仓库、短允许名单作为默认起点。

## 证据

- [dsh-superagent README](https://github.com/deepseek-ai/dsh-superagent-prototype)
- [000 Philosophy](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/000-philosophy.md)
- [001 Domain model](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/001-domain.md)
- [002 Authorization](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/002-authorization.md)
- [003 Execution](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/003-execution.md)
- [005 Panel](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/005-panel.md)
- [006 Deployment](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/006-deployment.md)
- [007 Architecture](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/007-architecture.md)
- [008 Cookbook](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/docs/008-cookbook.md)
- [dsh-superagent package.json](https://raw.githubusercontent.com/deepseek-ai/dsh-superagent-prototype/main/package.json)
- 本地 dsh-config-pack/package.json、README.md、PTC skill 和 ROW-OWNERSHIP-20261013.md

## 下一步唯一动作

先在独立实验 profile 中实现 GitHub observe-only Source + Trigger/Ticket/Policy 只读链路，完成事件去重、授权拒绝、重启恢复和 PTC contract 映射验收；在验收通过前不把完整 super-agent bundle 加入当前 web profile。
