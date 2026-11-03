# 插件通道管理表

本表把“设置如何迁移”和“插件如何安装”分开管理。新设备、新 profile、新插件默认走公共通道；只有需要跨设备携带运行配置的少数组件才走 adapter。

权威机器可读清单：assets/plugin-channel-policy.json。

## A. Adapter 表：少数需要迁移设置的组件

| 插件 | Adapter | 公共安装来源 | 当前观测版本 | 设置为什么迁移 |
|---|---|---|---:|---|
| dsh-deepseek-keypool | provider-failover | github:Robert-Wang-08/dsh-provider-failover#v3.6.0 | 3.8.2 | provider routing and failover settings affect runtime behavior |
| dsh-plugin-provider-badge | provider-badge | github:Robert-Wang-08/dsh-plugin-provider-badge#v0.3.1 | 0.4.0 | user-visible provider display settings |
| dsh-plugin-sidebar-visibility | sidebar-visibility | github:Robert-Wang-08/dsh-plugin-sidebar-visibility#v0.0.7 | 0.0.7 | portable sidebar visibility preferences |
| @jiangdaoli/dsh-archived-sessions | archived-sessions | github:Robert-Wang-08/dsh-archived-sessions#v0.4.3 | 0.4.3 | archive plugin configuration and restore behavior |
| @deepseek-ai/dsh-subagent-acp | subagent-acp-opencode | @deepseek-ai/dsh-subagent-acp@0.2.1-rc.5 | 0.2.0-rc.2 | ACP row configuration is part of the runtime route |
| @deepseek-ai/dsh-mcp-client | mcp-rows | @deepseek-ai/dsh-mcp-client@0.2.1-rc.5 | 0.2.0-rc.2 | MCP endpoint rows and enablement affect runtime behavior |

Adapter 只处理配置来源；插件本体仍按公共安装来源安装。目标设备先安装插件，再应用配置并重启 DSH。

## B. 公共通道表：其他组件不进入普通设置快照

这些组件只登记公共来源、使用版本、安装方式和更新方式。目标设备自行下载、安装、配置和更新；快照将其标成 not_applicable。

| 插件 | 公共来源 / 版本 | 默认安装 | 更新方式 | 状态 |
|---|---|---|---|---|
| @deepseek-ai/dsh-subagent-claude-code | @deepseek-ai/dsh-subagent-claude-code@0.2.1-rc.5 / 0.2.0-rc.2 | pack dependency | target device installs config-pack release | 公共 |
| @deepseek-ai/dsh-subagent-codex | @deepseek-ai/dsh-subagent-codex@0.2.1-rc.5 / 0.2.0-rc.2 | pack dependency | target device installs config-pack release | 公共 |
| @local/dsh-ptc-multi-agent-mode | github:Robert-Wang-08/dsh-config-pack#v0.11.4 (dsh-bundle) / 0.16.1 | pack bundle | target device installs config-pack release | 公共 |
| @local/dsh-subagent-acp-resilient | github:Robert-Wang-08/dsh-subagent-acp-resilient#v0.2.3 / 0.2.3 | pack dependency | target device installs config-pack release | 公共 |
| @weibaohui/dsh-dashboard | @weibaohui/dsh-dashboard@0.2.1 / 0.2.1 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-chat-import | dsh-chat-import@0.25.2 / 0.25.2 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-embedded-browser | dsh-embedded-browser@0.3.0 / 0.3.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-mermaid-smooth | dsh-mermaid-smooth@0.1.0 / 0.1.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-notify-bell | dsh-notify-bell@0.12.0 / 0.12.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-palette | dsh-palette@0.2.1 / 0.2.1 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-plugin-new-session | 暂无公共来源 / 0.2.0 | blocked until public tag/package is published | target device installs config-pack release | 待发布 |
| dsh-plugin-ptc-switches | github:Robert-Wang-08/dsh-config-pack#v0.11.4 (bundled public artifact) / 0.2.0 | pack bundle | target device installs config-pack release | 公共 |
| dsh-plugin-subagent-director | dsh-plugin-subagent-director@0.5.6 / 0.5.6 | public npm optional component | target device runs optional component install | 公共 |
| dsh-plugin-subagent-monitor | github:Robert-Wang-08/dsh-plugin-subagent-monitor#v0.1.0 / 0.1.0 | pack dependency | target device installs config-pack release | 公共 |
| dsh-recent-sessions | github:huangxp12/dsh-recent-sessions#v0.1.2 / 0.1.2 | public optional component | target device runs optional component install | 公共 |
| dsh-task-progress | dsh-task-progress@0.3.0 / 0.3.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-task-supervisor | dsh-task-supervisor@0.1.9 / 0.1.9 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-ui-progress | dsh-ui-progress@0.1.2 / 0.1.2 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-worktable | 暂无公共来源 / 0.5.0 | blocked until public package/release is published | target device installs config-pack release | 待发布 |
| dshmarket | github:dsh-market/dsh-market#v1.66.21 / 1.66.21 | public optional component | target device runs optional component install | 公共 |

## 新设备默认路径

默认使用 config-pack 的公开 release 和表中的公共 npm/Git 来源，不把本机 link 写入新 profile。

```powershell
pwsh D:/src/dsh/dsh-config-pack/scripts/install.ps1 -ProfileName packed
```

没有公共 tag/package 的组件暂不进入默认新装路径；必须先发布公共版本。设备差异、路由偏好和凭据指针仍由设备配置管理，凭据原值永不进入本表或快照。
