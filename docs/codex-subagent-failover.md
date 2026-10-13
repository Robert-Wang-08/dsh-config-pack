# Codex 子代理路由与故障处理

## 两套机制

主控 provider failover 和子代理 provider failover 是两套机制。

- subagent_codex 使用 openai-codex 官方 app-server，依赖 OpenAI OAuth/Office 额度。
- subagent_codex_relay 使用通用 in-process spawn 子代理，固定选择现有 codex-relay/gpt-5.6-sol。
- relay provider 的适配器是 openai-responses；endpoint 和认证由 config/40-models.yml 的 baseURL / apiKeyEnv 解析，密钥变量名为 CRS_OAI_KEY，配置包不保存密钥值。
- 官方 Codex 子代理不被替换，也不读取 relay 的 endpoint 或凭据。

## 工具配置

工具行位于 config/50-presets.yml 的 delegation group：

| 工具 | 后端 | 实际 provider/model | 凭据 |
|---|---|---|---|
| subagent_codex | official Codex provider | openai-codex/gpt-5.6-sol（运行时由官方 provider 解析） | OpenAI OAuth/Office |
| subagent_codex_relay | spawn + agentOptions | codex-relay/gpt-5.6-sol | CRS_OAI_KEY |

relay 工具使用 one-shot，保留通用子代理的超时、取消、dispose 和结果收集机制；它不启动 @openai/codex app-server。

没有可用 codex-relay provider、模型或 CRS_OAI_KEY 时，工具必须返回 provider 配置/认证错误；不得把该错误伪装成 Office quota，也不得报告成功。

## 失败分类

主控 dsh-deepseek-keypool 的 agent/request-error 只处理主控模型请求。它不接管 subagent_codex 的工具结果。

子代理失败应按以下原则解释：

- quota、usage-limit、insufficient_quota、office quota exhausted：官方额度失败。
- rate limit：只有错误明确表示额度/配额限制时才按 quota；普通服务限流不应伪装成额度耗尽。
- transport：最多按现有传输重试策略重试一次。
- auth、invalid-result、product-error：不要盲目重复官方 provider。
- relay 的 auth、transport、invalid-result 或 server 错误属于 relay 失败，不得归因于 Office quota。

## 当前自动 fallback 边界

本配置包已经提供独立的 subagent_codex_relay 入口，但当前安装的 DSH 0.2 子代理工具没有一个稳定的“工具结果失败 -> 重新派发另一个工具 -> 聚合父结果”配置 hook；现有主控 failover 也只监听 agent/request / agent/request-error。因此仅通过 profile YAML 不能安全宣称 subagent_codex quota 失败会自动重派发。

要完成自动 fallback，运行时必须在子代理调度层增加一次性的 attempt 状态机，至少持有：

- 原始 attempt id、原始错误和 openai-codex/gpt-5.6-sol；
- quota 分类的唯一 failover 事件；
- 最多一次 codex-relay/gpt-5.6-sol attempt；
- relay 失败后的现有后备链或最终失败；
- cancel、timeout、user abort 时不重派发；
- relay 失败绝不回到官方 Codex。

这部分不能由 dsh-provider-failover 的主控事件监听器替代，也不能在同一次官方 app-server 调用内部热切换。

## Receipt 约定

PTC worker receipt 的 route 是 PTC 层枚举，不是 provider 名称；它仍必须使用 schema 允许的 route。子代理运行时结果应在扩展元数据中保留真实值：

    {
      "executor": "codex-relay",
      "provider": "codex-relay",
      "model": "gpt-5.6-sol",
      "fallback_from": {
        "executor": "openai-codex",
        "provider": "openai-codex",
        "model": "gpt-5.6-sol",
        "reason": "quota"
      }
    }

当前 PTC worker-receipt.schema.json 使用 additionalProperties: false，且只允许固定的 PTC route 枚举；本配置包不伪造扩展 receipt，也未修改 PTC Skill 正文。运行时若要持久化上述字段，应先通过项目已有扩展字段机制或最小 schema 变更同步校验器。

## 排障

1. 用 npm run verify 检查 tool-subagent-codex-relay 是否只声明一次、provider 是否无 dangling。
2. 用 dsh --profile <name> --dump-config 检查两条工具行都存在；转储只证明组合，不证明 !!js 已求值。
3. 检查 codex-relay 的真实模型定义来自 config/40-models.yml，不要用主控最近一次 provider 推断子代理 provider。
4. 检查 CRS_OAI_KEY 是否已由本机凭据系统提供；不要把值写入 profile、日志或 receipt。
5. 看到 Product subagent failure 时保留原文和分类；没有运行时 fallback 状态机时，应明确报告官方失败，不要伪造 relay 已执行。
