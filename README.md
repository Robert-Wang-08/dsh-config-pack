# dsh-config-pack

一个**通用 DSH 配置包**：把"插件选择 + 本地配置层 + agent 预设"打成单个可被 DSH 直接安装的 npm 包，
经 git 分发，一条命令装进任意 DSH profile。

```powershell
dsh plugin --profile packed add github:Robert-Wang-08/dsh-config-pack#v1.0.0
```

---

## 它解决什么

换一台设备时，DSH 的 profile 里有三类东西：

| 层 | 内容 | 能否随包分发 |
|---|---|---|
| **L1 包内容** | 预设行、provider 路由、默认模型、预设注册表、插件配置覆盖 | ✅ 本包用 `cordis.patch.yml` 承载 |
| **L2 激活** | 依赖 + `dsh.profile.bundles` 顺序 | ✅ `dependencies` + DSH 自己的 `reconcile` |
| **L3 不可分发** | 凭据、环境变量、CLI 登录态、`link:` 路径 | ❌ 由 `pack.manifest.yaml` 声明为清单 |

L3 由包**自描述**，不再靠文档口口相传。

---

## 安装

### 正常设备

```powershell
# 1) 装进一个新 profile（推荐，不会和现有 profile 打架）
dsh plugin --profile packed add github:Robert-Wang-08/dsh-config-pack

# 2) 校验（只读，不动任何文件）
node scripts/verify.mjs --profile packed

# 3) 起
dsh packed
```

### 升级

同一条命令换 tag 即可，DSH 会重新装并存回 `dsh.profile.bundles`。

### 卸载

```powershell
dsh plugin --profile packed remove dsh-config-pack
```

> ⚠️ 卸载**不会**恢复任何被本包覆盖的行；被覆盖的行会回落到上一个声明它的层（通常是该插件的 bundle 默认值）。

---

## 为什么不需要安装脚本

DSH 自己就把"装包"和"激活"合成了一步。这条链路可在安装目录里查证：

```
dsh plugin --profile <p> add <spec>
  → dsh/lib/plugin-*.js  runPluginCommand
      → @deepseek-ai/dsh-plugin-manager  lib/types/operations.js:526
          → runProfilePnpm (:246)
              → pnpm install
              → reconcile (:44, 调用点 :504)
                  → 新依赖若声明 dsh.bundle → push 进 dsh.profile.bundles (:64)
                  → 原子写 package.json (:71)
```

所以**注册 bundle 不需要手改 `package.json`**。本包因此不含任何"编辑 profile patch"的 PowerShell——
上一版方案那 200 行脚本是多余复杂度。

---

## 开发

```powershell
npm run build     # config/*.yml → cordis.patch.yml（生成物，入库）
npm run verify    # 只读校验
node scripts/verify.mjs --profile web   # 额外检查目标 profile 是否遮蔽本包
```

### 目录

```
config/10-subagents.yml   ACP provider 行 + claude-code/codex 权限覆盖
config/20-mcp.yml         四个 MCP server 行（默认全关，ticktick 按入口路径自动开）
config/30-ui.yml          目录选择器接线 + 欢迎语版本
config/40-models.yml      默认模型 + llm-pi-ai 六条路由
config/50-presets.yml     legacy 预设 preset-standard-codex
config/60-registry.yml    预设注册表 selectedDefault
```

改配置**只改 `config/`**，然后 `npm run build`。`cordis.patch.yml` 是产物，不要手改。

### 开关

所有开关都是环境变量；**改完必须重启 DSH**（环境变量不会进入已在运行的进程）。

| 变量 | 默认 | 作用 |
|---|---|---|
| `DSHPACK_ACP_OPENCODE` | 开 | ACP 子代理 opencode |
| `DSHPACK_ACP_KIMI` | 开 | ACP 子代理 kimi |
| `DSHPACK_ACP_CURSOR` | **关** | 设为 `on` 启用 cursor-agent |
| `DSHPACK_MCP_CODEGRAPH` | 关 | 设为 `on` 启用 |
| `DSHPACK_MCP_TENCENT_DOCS` | 关 | 需 `TENCENT_DOCS_TOKEN` |
| `DSHPACK_MCP_SLIDE` | 关 | 需 `TENCENT_DOCS_TOKEN` |
| `DSHPACK_TICKTICK_ENTRY` | 空 | 填 ticktick-mcp 的 dist/index.js 绝对路径即自动开启 |
| `DSHPACK_NODE` | `node` | stdio MCP 用的 node 绝对路径 |
| `DSHPACK_DEFAULT_PROVIDER` / `DSHPACK_DEFAULT_MODEL` | `codex-relay` / `gpt-5.6-sol` | 新会话默认模型 |
| `DSHPACK_SELECTED_PRESET` | `ptc-multi-agent` | 预设注册表选中项 |
| `DSHPACK_BASE_*` / `DSHPACK_KEY_*` | 见 `config/40-models.yml` | 覆盖路由 baseURL / apiKeyEnv |

---

## 写 `!!js` 的两条硬约束

不是风格问题，违反会导致 YAML 解析失败：

1. **不能出现「冒号加空格」** → 因此**禁用三元运算符**。`cond ? 'a' : 'b'` 里的 ` : ` 会被 YAML
   当成映射键。统一改写：`(cond && 'a') || 'b'`（各分支均为真值时安全）。
2. **不能以引号 / `{` / `[` / `!` 开头** → 会被当成映射、flow 序列或另一个标签。
   需要数组时用 `String(...)` 之类以标识符开头的写法包装。

这两条有自动化检查：`npm run verify`。

---

## 本包不覆盖什么

| 行 id | 由谁提供 |
|---|---|
| `preset-ptc-multi-agent` | `ptc-multi-agent-control` 的 dsh-bundle |
| `dsh-deepseek-keypool` 的档位表 | 该插件自己的 bundle 覆盖（本包只装插件，不写档位） |

`pack.manifest.yaml` 的 `owns:` 列出本包**独占**的行 id。若目标 profile 的
`cordis.patch.yml` 里还留着同 id 的内联块，**它会遮蔽本包**（profile patch 是最后一层，
按 id 覆盖、后写胜）。`verify.mjs --profile X` 会把这种情况报成错误。

---

## 已知限制

- **`--dump-config` 不能证明 `!!js` 被求值**。它回显的是**未求值的补丁源**（长表达式会被
  DSH 自身序列化成 `!!js >-` 折叠块）。`exit=0` 只证明"YAML 解析 + 层组合成功"，
  证明不了"表达式求值成了预期值"。要证后者，只能真起一个 profile 看行为。
- `dependencies` 里 `@deepseek-ai/dsh-base` / `dsh-web-app` 能否由目标设备的 pnpm 解析，
  取决于该设备的 registry/anchor 配置。`dsh plugin add` 的退出码是唯一判据。
- `reconcile` 只激活**新出现**的依赖（`operations.js:54-56 if (beforeDeps.has(name)) continue`）。
  若某依赖已存在但被从 `dsh.profile.bundles` 里手工删掉，重装本包不会把它加回来。
- 本包**不**依赖 bundle 之间的顺序。`readProfilePlugins` 用 `package.json` 里 `dependencies`
  的书写顺序，而 pnpm 会按字母序重写它——所以每行 id 必须由本包独占，否则顺序不可控。

## License

MIT
