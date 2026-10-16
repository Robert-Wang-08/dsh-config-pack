# 索引：PTC skill 正文不在此目录

本目录**不承载任何 PTC skill 正文**。原副本（会漂移的第二版本来源）已于 **2026-10-15** 删除，
删除时其中仅剩一份指针 README，无 SKILL.md、无 skill.json、无 bundle。

## 真实位置（唯一真值）

| 内容 | 位置 |
|---|---|
| PTC skill 正文 | `packages/dsh-ptc-multi-agent-mode/` |
| 版本号真值 | `packages/dsh-ptc-multi-agent-mode/skill.json` |
| DSH 插件包（bundle） | `packages/dsh-ptc-multi-agent-mode/assets/dsh-bundle/` |
| 公开伴生包 | 由 `scripts/generate-ptc-companion.mjs` 从上述正文生成 |

## 退役副本备份（**本机留存，不进公开仓库**）

`backups/ptc-multi-agent-control-template-shell-20261015.zip`

该路径已被仓库根 `.gitignore` 忽略，公开克隆里不会出现；它也只是那份指针 README 的快照，不含正文。

## 为什么退役

副本的 SKILL.md、skill.json 与 bundle 各自落后一个版本，构成第二个版本来源，已发生漂移。
生成器现在只从 `packages/dsh-ptc-multi-agent-mode/` 读正文；生成的公开伴生包**仍然**交付名为
`ptc-multi-agent-control/` 的目录（安装路径不变），只是来源唯一。

## 规则

- 阅读或修改 PTC 正文，只改 `packages/dsh-ptc-multi-agent-mode/`。
- 不要在本目录重建 skill 副本。
