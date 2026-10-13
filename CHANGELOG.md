# Changelog

本文件由 `scripts/release.ps1` 维护；每次发版在顶部追加一段。

## 0.3.3

pin dsh-deepseek-keypool dependency to annotated tag v3.4.0

## 0.3.2

document remote-tag install recipe: blockExoticSubdeps, allowBuilds, pack last

## 0.3.1

document verified clean-profile install constraints: bundle order, allowBuilds, explicit web-app

## 0.3.0

add subagent_codex_relay preset entry, de-privatized device setup guide, local route layer docs

## 0.2.0

### Added
- `config/45-failover.yml`：把归档 `failover-tiers` 的完整 `dsh-deepseek-keypool` 档位表迁入本包；
  `pack.manifest.yaml` 将该行从 `delegated` 改为 `owns`。全部 failover `route` 可用
  `DSHPACK_ROUTE_*` 覆盖（`DSHPACK_ROUTE_OPENCODE` 默认 `opencode-go`，另一设备可设 `opencodego`）；
  凭据仍只走 `requires_env` 指针，不进 Git。
- `pack.manifest.yaml` 的 `delegated` 补全：把 PTC 专用行（`subagent-acp-opencode-dsv41` /
  `-kimi-docs` / `-cursor-grok`、两个 claude 只读档、五个 `tool-subagent-*`、`tool-presentation`）
  登记为由 `ptc-multi-agent-control` 的 dsh-bundle 提供。**本包不声明这些 id**——同一个 id 被两个
  bundle 声明时按层序覆盖、顺序不可控，正是本包 README 禁止的情况。
- `requires_env` 登记 `DSHPACK_OPENCODE_CONFIG` / `DSHPACK_DEFAULT_PROVIDER` /
  `DSHPACK_DEFAULT_MODEL` / `DSHPACK_SELECTED_PRESET`。
- `scripts/verify.mjs` 新增两组只读断言：`delegated` 里的 id 不得出现在本包（占有边界），
  以及 `cordis.patch.yml` 中 `providerName` 不得重复。
- `scripts/verify.mjs --composed <dump>`：对 `dsh --dump-config` 的组合结果做 provider 完整性检查——
  每个 `dsh-tool-subagent` 行消费的 `provider:` 必须能解析到某个已注册 provider
  （`providerName:` 标量、内置 `spawn`/`fork`/`acp`，或以 `@deepseek-ai/dsh-subagent-` 开头的行的后缀）。
  默认不启用。本机 `web` profile 实测：28 个工具行、14 个已注册 provider、0 dangling。
- `scripts/metrics.mjs`：只读执行指标提取器（`npm run metrics:selftest` 可离线自检，108 条断言）。
  见 README「执行指标与路由校准」。

### Fixed
- cursor 行的 `no_proxy` 取值改为推导而非字符串拼接：原先在
  `DSHPACK_CURSOR_KEEP_PROXY` 为真且 `no_proxy` 未设时会得到**空字符串**（等于不绕过任何地址，
  连 localhost 也走代理）；空字符串作为该变量取值时也会丢掉 `cursor.sh` 绕过。现在前者回落到
  `localhost,127.0.0.1,::1`，后者视同未设置。
- kimi 行参数顺序改为 `--model` 在前、`acp` 在后（`args: [ '--model', kimi-code/k3-256k, acp ]`）。
- opencode 行的 `OPENCODE_CONFIG_CONTENT` 默认模型 id 由 `ais-2dsglm/deepseek-v4.1-flash` 改为
  `ais1dsglm/deepseek-v4.1-flash`。后者才是 OpenCode 自己的 provider id；`ais-2dsglm` 只是本包
  DSH 侧的 llm-pi-ai 路由名（`config/40-models.yml`），OpenCode 不认识。两者命名空间不同。
- `release.ps1` 用 lightweight tag（`git tag vX.Y.Z`）配合 `--follow-tags`，而 `--follow-tags`
  **只推送 annotated tag**，导致 tag 从未上远端，`github:...#vX.Y.Z` 形式的安装 spec 解析不到。
  改为 `git tag -a` + `-m`。

## 0.1.0

### Added
- 包骨架：`package.json`（`dsh.bundle.patch` + `dependencies` 即插件选择）、`pack.manifest.yaml`（自描述：owns / switches / requires_env / requires_cli / never_sync）。
- `config/` 六个片段，覆盖本机 web profile 的全部可移植行：
  - ACP 子代理 opencode / kimi / cursor-agent（Windows 经 `cmd /c` 包装）
  - claude-code / codex 的 bypass 权限覆盖
  - 四个 MCP server 行（codegraph / ticktick / 腾讯文档 / 腾讯幻灯片）
  - 目录选择器 `-browse` 接线
  - 默认模型 + `llm-pi-ai` 六条路由（baseURL / apiKeyEnv 均可环境变量覆盖）
  - legacy 预设 `preset-standard-codex`（自本机 profile 逐行搬入）
  - 预设注册表 `selectedDefault`
- `scripts/build.mjs`：`config/*.yml` → `cordis.patch.yml`（纯字节拼接，避开 YAML 库对 `!!js` 自定义标签的处理差异）。
- `scripts/verify.mjs`：三组只读断言——owns 覆盖唯一性、`!!js` 标量合法性、目标 profile 遮蔽检查。

### Fixed
- `!!js` 三元运算符：`? 'cmd' : 'sh'` 里的 ` : ` 会被 YAML 当作映射键。全部改写为 `(cond && 'a') || 'b'`。
- `!!js` 以 `[` 开头会被解析成 flow 序列。改为以 `String(...)` 开头。
