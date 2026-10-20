# 组件清单与来源

本文回答两个问题：**每个插件是谁的、钉在哪**，以及 **MCP 服务器有哪些、怎么开**。

## 为什么需要这份清单

companion bundle 现在与主包声明**同一组依赖**（选项 C）。于是仓库里有**三份** manifest 会装出运行时：

1. `package.json`（主包）
2. `packages/dsh-ptc-multi-agent-mode/assets/dsh-bundle/package.json`（权威本体随包交付的 companion）
3. `templates/ptc-public-companion/dsh-bundle/package.json`（公开伴生包模板）

**它们必须逐项一致**，否则用户从不同入口会装出不同环境。这件事由
`scripts/verify-components.mjs` 强制：任一依赖缺失、pin 与锁不符、或三份之间规格不同，即非零退出。

## 插件

| 包名 | 钉法 | 来源 | 公开仓库 |
|---|---|---|---|
| `dsh-plugin-provider-badge` | `#v0.1.0` | **自写** | `Robert-Wang-08/dsh-plugin-provider-badge` |
| `dsh-plugin-sidebar-visibility` | `#v0.0.3` | **自写** | `Robert-Wang-08/dsh-plugin-sidebar-visibility` |
| `dsh-plugin-subagent-monitor` | `#v0.1.0` | **自写** | `Robert-Wang-08/dsh-plugin-subagent-monitor` |
| `dsh-deepseek-keypool` | `#v3.4.0` | **自写** | `Robert-Wang-08/dsh-provider-failover` |
| `@local/dsh-subagent-acp-resilient` | `#v0.2.1` | **自写**（上游 ACP provider 的替换实现） | `Robert-Wang-08/dsh-subagent-acp-resilient` |
| `dsh-archived-sessions` | `#v0.4.1` | **上游 fork**（上游 `Jiangdl0220/dsh-archived-sessions`） | `Robert-Wang-08/dsh-archived-sessions` |
| `dsh-chat-import` | `0.25.2` | **第三方 npm**（Nwflower） | `Nwflower/dsh-chat-import` |
| `dsh-mermaid-smooth` | `0.1.0` | **第三方 npm**（gitByteFree） | `gitByteFree/dsh-mermaid-smooth` |
| `dsh-notify-bell` | `0.12.0` | **第三方 npm**（zyar-er） | 无 `repository` 字段 |
| `dsh-recent-sessions` | `#v0.1.2` | **第三方**（huangxp12），**可选组** | `huangxp12/dsh-recent-sessions` |
| `dshmarket` | `#v1.66.21` | **第三方**，**可选组** | `dsh-market/dsh-market` |
| `dsh-plugin-subagent-director` | `0.5.6` | **第三方 npm**，**可选组** | 无（按 npm 包名+版本定位） |
| `dsh-palette` | `0.2.1` | **第三方 npm**，**可选组** | 无 |
| `@deepseek-ai/dsh-*` | `0.2.0-rc.2` | 官方 | — |

### 三类来源的处理方式不同

- **自写（5 个）**：本体必须在公开仓库里，且各自钉不可变 annotated tag —— 否则公开用户装不上，
  或拿到会漂移的代码。五个都已建仓、已打 tag、已登记进 `pack.manifest.yaml` 的 `components:` 锁。
- **上游 fork（1 个）**：`dsh-archived-sessions` 本地已改到 `0.4.1`，**领先** npm 上的公开版 `0.4.0`。
  因此它**必须走本仓库 tag**，不能改回 npm —— 改回会静默丢掉本地改动。
- **第三方 npm（3 个核心）**：不建仓、不 fork，按版本号钉。它们由上游维护，本包只消费。
- **可选三方组（4 个）**：`dsh-recent-sessions` / `dshmarket` / `dsh-plugin-subagent-director` / `dsh-palette`。
  清单在 `assets/optional-components.json`，**恢复时默认补装**（`install.ps1` 逐个 `dsh plugin add`），
  `-SkipOptional` 整组跳过。github 件（前两个）仍进 `components:` 锁并标 `optional: true`，
  tag→commit 校验照常；npm 件不入组件锁但必须精确钉版。可选件不得同时是包的必需依赖（验证器强制）。

### 两点需要留意的版本状态

- `dsh-mermaid-smooth` 钉的是 `0.1.0`，npm 最新是 `0.2.1`；**升不升是产品决定**，不是疏漏。
- `dsh-notify-bell` 在上游没有 `repository` 字段，只能靠 npm 包名与版本号定位。

## MCP 服务器

全部由 `@deepseek-ai/dsh-mcp-client` 承载，行定义在 `config/20-mcp.yml`。

| id | 传输 | 端点 / 命令 | 默认 | 本机差异点 |
|---|---|---|---|---|
| `mcp-codegraph` | stdio | `DSHPACK_CODEGRAPH_CMD`，默认 `codegraph-mcp` | **关** | 该包**不在公共 npm**（查询返回 404），需自备 |
| `mcp-ticktick` | stdio | `node <DSHPACK_TICKTICK_ENTRY>` | **设了入口即自动开** | 入口是绝对路径，属本机差异点；npm 上的 `ticktick-mcp` 属第三方（jordyvandomselaar） |
| `mcp-tencent-docs` | streamable-http | `https://docs.qq.com/openapi/mcp` | **关** | 需 `TENCENT_DOCS_TOKEN` |
| `mcp-slide` | streamable-http | `https://docs.qq.com/api/v6/slide/mcp` | **关** | 同上，共用同一个 token |

开关见 `pack.manifest.yaml` 的 `switches`。凭据**只写引用名，永不写值**。

## 选项 C 的两个已知后果

把 companion 对齐到主包，会带来两点必须如实说明的影响：

1. **四个 MCP 行仍只有主包声明**。companion 现在依赖 `@deepseek-ai/dsh-mcp-client`，
   但它的 patch 里没有 `mcp-*` 行 —— 也就是说这个依赖在 companion 路径上**暂时没有消费者**。
2. **`@deepseek-ai/dsh-base`、`dsh-web-app` 与 `fzstd` 也在 companion 的依赖里**。
   前两者是 profile 级 bundle，后者是脚本工具依赖，都不是 PTC 模式本身需要的东西；
   它们出现在这里，是"与主包完全一致"这个口径的直接结果。

两条都建议后续单独决定：要么给 companion 补上 MCP 行（真正对齐），要么把口径收窄为
"只对齐插件子集"。当前状态是**口径 C 的忠实实现**，不是遗漏。
