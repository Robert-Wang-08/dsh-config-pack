# 本目录已不再承载 PTC skill 正文

权威的 PTC skill 正文已迁移到 `packages/dsh-ptc-multi-agent-mode/`（skill.json 与
assets/dsh-bundle/package.json 均为 0.13.0）。此前的 `templates/ptc-public-companion/ptc-multi-agent-control/`
是一份会漂移的副本——它的 SKILL.md、skill.json 与 bundle 各自落后一个版本——因此已整目录删除。

本路径**有意保持为空**：这里不再复制、不再镜像、也不再生成任何 skill 内容，以免出现第二个版本来源。
需要阅读或修改 PTC 正文，请只改 `packages/dsh-ptc-multi-agent-mode/`。

公开伴生包仍然按原样交付一个名为 `ptc-multi-agent-control/` 的目录：生成器从
`packages/dsh-ptc-multi-agent-mode/` 拷贝该目录，并用 skill.json 的版本号渲染其中的 bundle，
所以公开伴生包的目录名与安装路径不变，只有它的来源变成了唯一的那一份正文。
