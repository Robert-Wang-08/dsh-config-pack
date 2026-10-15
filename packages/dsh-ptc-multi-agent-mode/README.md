# dsh-ptc-multi-agent-mode

PTC 多代理主控的**权威本体**（skill + DSH 插件包）。本目录是唯一真值来源。

## 目录结构

```
dsh-ptc-multi-agent-mode/
  SKILL.md  skill.json  CHANGELOG.md  ISSUE_FIX_HISTORY.md
  scripts/      路由、账本、ACP 冒烟、模型探测
  assets/       public-runtime-config.json、契约与 schema
  references/   使用说明
  evals/        评测
  assets/dsh-bundle/    DSH 插件包（package.json + cordis.patch.yml）
```

DSH profile 通过 `link:` 指向 `assets/dsh-bundle`：

```json
"@local/dsh-ptc-multi-agent-mode": "link:<本仓库>/packages/dsh-ptc-multi-agent-mode/assets/dsh-bundle"
```

## 与 SkillHub 的分工

| 内容 | 归属 |
|---|---|
| PTC skill 与 bundle 正文 | **本目录（Git）** |
| 个性化文件（凭据、路由策略、Claude Code 配置目录等） | SkillHub 同步 |

SkillHub 对 `ptc-multi-agent-control` 只做**索引登记**：
`policy: index_only`、`body_policy: pointer_only`。它不搬本体、不建 junction、不删除正文。
**任何情况下都不得调用 `skillhub promote` 处理本资产**——当 IDE 入口指回 store 本体时，
promote 会先删目标目录再回读同源路径，导致正文永久丢失（2026-10-15 已发生一次）。

## 引用个性化文件的写法

正文与文档引用共享盘上的个性化文件时，**只写文件名与所在目录，不写绝对路径**：

- 写：`共享盘 Skill+Tool/skillhub 下的 <文件名>`
- 不写：`D:\\nutstore\\...` 或 `/Users/...`

本目录当前不含任何机器绝对路径。

## 发布

随 `dsh-config-pack` 一起发布：

```powershell
pwsh -File scripts/release.ps1 -Bump patch -Note "<变更说明>"
```

`release.ps1` 使用 `git add -A`，本目录会被一并收录；发布前脚本会跑 `verify.mjs`。
bundle 的 `metadata.managedBy` 必须是 `git`、`metadata.source` 必须是 `dsh-config-pack`。

## 版本约定

skill 版本见 `skill.json`；bundle 版本见 `assets/dsh-bundle/package.json`，二者保持一致。
