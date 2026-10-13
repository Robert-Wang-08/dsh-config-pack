# 子代理超时根因与本地环境修正说明（2026-10-13）

> 定位：说明 2026-10-13 对 DSH ACP 子代理（kimi-docs / cursor-grok）超时问题的根因诊断、三项本地环境修正及验证结果。修改全部在用户级配置与全局 skill 目录，不影响本包打包与分发。

## 1. 背景与根因

现象：subagent_kimi_docs 两次前台调用"超时无输出"，后台调用看似无进展。

诊断结论（只读诊断，证据取自 DSH 会话日志与 kimi ACP 日志）：

1. **主因**：子代理调用被包在 run_code 内，run_code 执行期限（默认 120s / 上限 600s）到期即取消在途 ACP 子代理；kimi 实际一直在正常工作。
2. **主因**：任务规模与时间窗不匹配——k3-256k thinking=high 每轮 5–60 秒，大文档梳理需数十轮，合理时长 10–30 分钟级。
3. **放大因素**：后台运行期间 job_output 文本恒为空是可见性假象，导致健康长跑被误杀。
4. **次要**：cursor-agent 经系统代理时 HTTP/2 ping 5 秒硬超时会断流。
5. **次要**：kimi 配置的 7 个 Orca hooks 在无 sh 的 Windows 环境每事件最多 stall 10 秒，逐 tool-use 累积拖慢。

## 2. 三项修正

| # | 修正 | 位置 | 备份 |
|---|---|---|---|
| 1 | cursor-agent 强制 HTTP/1.1（useHttp1ForAgent=true） | ~/.cursor/cli-config.json | 同目录 .bak-20261013-http1 |
| 2 | 删除 kimi 全部 7 个 Orca hooks | ~/.kimi-code/config.toml | 同目录 .bak-20261013-orca-hooks-removed |
| 3 | 子代理调度 5 条规则固化（不包 run_code、后台运行、等待时长按任务动态评估、运行期以 ACP 日志为可见输出通道、分批 5–10 项、降级链主控显式执行） | ptc-multi-agent-control skill SKILL.md §子代理调度规则，版本升 0.9.0（SkillHub 管理） | SkillHub installed 与 cloud-sync 载荷已同步一致 |

## 3. 验证结果（11/11 PASS）

- kimi config.toml：TOML 解析通过、hooks 已清空、k3-256k 模型配置完整；
- cursor cli-config.json：JSON 解析通过、useHttp1ForAgent=true；
- SKILL.md：frontmatter 完整、version=0.9.0、updated=2026-10-13、调度规则章节存在；
- cloud-sync 载荷与源 SHA256 一致。

验证脚本：scripts/verify_config_changes.py（本仓库）。

## 4. 影响与回滚

- 全部为 DSH 安装包外的用户级配置，DSH 重装/升级不覆盖；本包的 cordis.patch.yml 未改动（ACP 30 分钟预算、no_proxy 注入原本已正确）；
- 回滚：还原两个 .bak-20261013-* 备份；skill 规则章节可从 SKILL.md 删除并按 skill-stamp 降版本。
