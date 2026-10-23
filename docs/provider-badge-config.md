# provider-badge 的可见配置（额度 / 配色 / 缩写）

> 适用：`dsh-plugin-provider-badge`（独立子模块 `github:Robert-Wang-08/dsh-plugin-provider-badge`）。
> 本文只讲**配置层**；插件行为与验收见该仓库的 `README.md`。

## 1. 三层结构（谁是真源）

| 层 | 位置 | 作用 | 跨设备 |
| --- | --- | --- | --- |
| 默认值 | 插件 `index.js` 的 `CONFIG_DEFAULTS` / `QUOTA_SOURCES`、`client.js` 的 `ROUTE_LABELS` / `ROUTE_COLORS` / `ROUTE_ALIASES` | **唯一真相**：没装本包、本包没更新、整块 config 被替换时的行为 | `git pull` 即生效 |
| 覆盖 | profile `cordis.patch.yml` 里 `- id: provider-badge` + `config:` | 只写差异项（改色、改缩写、关掉某个数据源…） | 属本机偏好，不进 Git |
| 回显 | `GET /provider-badge/config` | 看**生效结果**与 `warnings`，不用读 JS | — |

**为什么覆盖不放进本包的 `config/`**：patch 是按 id 覆盖的；本包若声明 `- id: provider-badge`，
在**没装该插件**的设备上会报 `patch: entry ... not found`，整层失效。所以本包只提供
`examples/provider-badge.config.yml` 让你按需复制到 profile patch，不无条件下发。

## 2. 端点

```
GET http://127.0.0.1:<DSH 端口>/provider-badge/config
```

- 只答**本机回环**（非回环 403）；只答 GET（否则 405）；
- 响应里**没有凭据值**，只有引用名（`apiKeyEnv` / `recordKey` / `fallbackRefs`）；
- 关键字段：
  - `configVersion`：patch 结构版本，结构变了才会变；
  - `sources.<规范名>`：`usageUrl` / `baseHosts` / `aliases` / `auth` / `refNames` / `routeIds`
    （`routeIds` 是本机按 settings 里 provider 的 `baseURL` **判定出来的真实路由 id**）；
  - `ui`：`labels` / `colors` / `aliases` 三类覆盖；
  - `warnings`：被降级的配置项（`{path, message}`），**空数组 = 全部合法**。

## 3. 可配项

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | `false` → 额度端点一律回 `disabled`，不打上游 |
| `cacheTtlMs` | int | `60000` | 收敛到 5000..600000 |
| `timeoutMs` | int | `8000` | 收敛到 1000..30000 |
| `sources.<规范名>.enabled` | bool | `true` | 规范名限 `openai-codex` / `kimi-coding` / `opencode-go` |
| `sources.<规范名>.baseHosts` | string[] | 代码常量 | 判定真实路由 id 用的 `baseURL` 片段 |
| `sources.<规范名>.aliases` | string[] | 代码常量 | 同族命名；空数组等于不覆盖 |
| `sources.<规范名>.usagePath` | string | 代码常量 | `/` 开头 = 拼到默认端点 origin；绝对 URL 必须 https 且主机 ∈ `opencode.ai` / `api.kimi.com` / `chatgpt.com` |
| `ui.labels` | `{routeId: 缩写}` | 代码常量 | ≤ 8 字符 |
| `ui.colors` | `{routeId: "#RRGGBB"}` | 代码常量 | 只接受六位 hex |
| `ui.aliases` | `{routeId: 规范名}` | 代码表 `ROUTE_ALIASES` | 配置优先于内置别名表 |

**不配**：窗口秒数映射、`parse`、凭据名。窗口与解析是响应形状知识，写错只会静默错标，
收益为负；凭据名由插件从 settings 的 `apiKeyEnv` 读，不需要也不允许配置。

## 4. 安全红线

1. **不出现凭据值**：配置里只写引用名。提交前自查有没有 `sk-` 形态字符串。
2. **不自由覆盖 usage URL**：额度请求带真凭据，URL 可任意改 = 可把 Bearer 发到任意主机。
   绝对 URL 白名单校验在 `resolveConfig` 里，白名单外直接忽略并记 warning。
3. **配置错了不能把面板搞崩**：一切非法项降级为默认值 + warning，端点照常 200。

## 5. 命名差异不需要配置

同一 provider 在不同设备可能叫 `opencode-go` / `opencodego`。插件**按 settings 里 provider 的
`baseURL` 自动判定真实路由 id**，凭据也按该 id 读 `apiKeyEnv`，浏览器半另有别名兜底。
所以本包**不需要**为它新增 `DSHPACK_*` 环境变量。

## 6. 改完怎么验

```powershell
# 1) 看生效值与被降级的项
curl.exe -s http://127.0.0.1:<DSH 端口>/provider-badge/config

# 2) 客户端门禁
cd dsh-plugin-provider-badge; node probe\smoke-host.mjs; node probe\smoke-client.mjs

# 3) 重构本包补丁层（只改 docs/examples 时输出应无变化）
cd dsh-config-pack; npm run build; npm run verify
```

改配置后必须**重启 DSH**（配置在启动时读取），然后新开会话看徽标。
