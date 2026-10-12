# Changelog

本文件由 `scripts/release.ps1` 维护；每次发版在顶部追加一段。

## Unreleased

### Fixed
- `release.ps1` 用 lightweight tag（`git tag vX.Y.Z`）配合 `--follow-tags`，而 `--follow-tags` **只推送 annotated tag**，导致 tag 从未上远端，`github:...#vX.Y.Z` 形式的安装 spec 解析不到。改为 `git tag -a` + `-m`。

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
