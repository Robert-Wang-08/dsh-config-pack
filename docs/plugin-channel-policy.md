# 插件通道管理表

本表把“设置如何迁移”和“插件如何安装”分开管理。新设备、新 profile、新插件默认走公共通道；只有需要跨设备携带运行配置的少数组件才走 adapter。

权威机器可读清单：assets/plugin-channel-policy.json。


## 代码归属（与安装通道独立）

当前表覆盖 26 个插件：**项目自写 8 个、上游 fork 1 个、官方 4 个、外部第三方 13 个**。公共通道不等于第三方，使用本机 link 也不证明自写。

- ACP resilient：项目维护的增强替换实现，保留基于官方 ACP 契约的来源说明。
- 会话归档：Jiangdl0220 的上游插件，本项目维护 fork，不标纯自写。
- Worktable：Aisland-SJL 的外部插件；本机 vendor tgz 是安装形态，上游仓库确实存在，公共发布版本可安装性仍待验证。
- Notify Bell：外部属性沿用既有组件库存；安装包缺 repository，作者记录不能视作本次独立联网核验。

本次仅核对归属和补标，不改变 adapter/public 的分组、已安装插件或目标版本。

## 备份方式说明

| 备份方式 | 备份内容 | 目标设备恢复方式 |
|---|---|---|
| 配置包（含 adapter 声明的配置） | 登记来源和版本，并保存 adapter 明确覆盖的非敏感配置 | 先安装插件，再还原配置；仅保证 adapter 已声明的范围 |
| 仅登记，自行安装配置 | 仅登记使用了哪个插件、来源和版本；不单独迁移其设置 | 目标设备自行下载、安装、配置或更新版本 |

两种方式都不备份插件二进制或 node_modules，也不包含密钥、登录态或会话历史。没有可用发布来源的插件仍保留“待发布”，登记不代表已经具备一键安装能力。

PTC switches 的开关和角色参与策略由 provider-failover 的 route-config 保存，随其 adapter 迁移；switches 插件本体仍只登记、自行安装。

本列记录管理策略，不代表快照已完成该插件所有配置的备份或恢复验证；公共 profile 配置文件若整体入快照，也不等于承诺公共通道插件的独立设置迁移。

## 初始安装时间说明

“初始安装时间”指本次盘点的源设备 web profile 首次成功安装/登记该插件的时间，按设备和 profile 分别记录。已安装的插件缺少可确认的首次安装日志时填“未知”（机读值为 null）；不能把文件创建/修改时间、源码提交时间、包发布时间或本表创建时间当成初始安装时间。

后续新增插件应在首次成功安装并验收时记录带时区的 ISO 8601 时间和验收证据；升级不覆盖初始时间。迁移到另一设备时由该设备登记自己的初始安装时间，不继承源设备的日期。

当前 26 项的真实首次安装时间均未获得可靠证据，因此本次统一保留未知；“备份方式”列原样保留。

## A. Adapter 表：少数需要迁移设置的组件

| 插件 | 代码归属 | 作者/维护方 | 备份方式 | 初始安装时间 | Adapter | 公共安装来源 | 当前观测版本 | 设置为什么迁移 |
|---|---|---|---|---|---|---|---:|---|
| dsh-deepseek-keypool | 项目自写 | Robert-Wang-08 | 配置包（含 adapter 声明的配置） | 未知 | provider-failover | github:Robert-Wang-08/dsh-provider-failover#v3.6.0 | 3.8.2 | provider routing and failover settings affect runtime behavior |
| dsh-plugin-provider-badge | 项目自写 | Robert-Wang-08 | 配置包（含 adapter 声明的配置） | 未知 | provider-badge | github:Robert-Wang-08/dsh-plugin-provider-badge#v0.3.1 | 0.4.0 | user-visible provider display settings |
| dsh-plugin-sidebar-visibility | 项目自写 | Robert-Wang-08 | 配置包（含 adapter 声明的配置） | 未知 | sidebar-visibility | github:Robert-Wang-08/dsh-plugin-sidebar-visibility#v0.0.7 | 0.0.7 | portable sidebar visibility preferences |
| @jiangdaoli/dsh-archived-sessions | 上游 fork，本地维护 | Jiangdl0220（原作者）；Robert-Wang-08（fork 维护） | 配置包（含 adapter 声明的配置） | 未知 | archived-sessions | github:Robert-Wang-08/dsh-archived-sessions#v0.4.3 | 0.4.3 | archive plugin configuration and restore behavior |
| @deepseek-ai/dsh-subagent-acp | DeepSeek 官方 | deepseek-ai | 配置包（含 adapter 声明的配置） | 未知 | subagent-acp-opencode | @deepseek-ai/dsh-subagent-acp@0.2.1-rc.5 | 0.2.0-rc.2 | ACP row configuration is part of the runtime route |
| @deepseek-ai/dsh-mcp-client | DeepSeek 官方 | deepseek-ai | 配置包（含 adapter 声明的配置） | 未知 | mcp-rows | @deepseek-ai/dsh-mcp-client@0.2.1-rc.5 | 0.2.0-rc.2 | MCP endpoint rows and enablement affect runtime behavior |

Adapter 只处理配置来源；插件本体仍按公共安装来源安装。目标设备先安装插件，再应用配置并重启 DSH。

## B. 公共通道表：其他组件不进入普通设置快照

这些组件只登记公共来源、使用版本、安装方式和更新方式。目标设备自行下载、安装、配置和更新；快照将其标成 not_applicable。项目级自写但尚未公共发布的组件单独标为“自写/待发布”，不进入新设备公共默认安装。

| 插件 | 代码归属 | 作者/维护方 | 备份方式 | 初始安装时间 | 公共来源 / 版本 | 默认安装 | 更新方式 | 状态 |
|---|---|---|---|---|---|---|---|---|
| @deepseek-ai/dsh-subagent-claude-code | DeepSeek 官方 | deepseek-ai | 仅登记，自行安装配置 | 未知 | @deepseek-ai/dsh-subagent-claude-code@0.2.1-rc.5 / 0.2.0-rc.2 | pack dependency | target device installs config-pack release | 公共 |
| @deepseek-ai/dsh-subagent-codex | DeepSeek 官方 | deepseek-ai | 仅登记，自行安装配置 | 未知 | @deepseek-ai/dsh-subagent-codex@0.2.1-rc.5 / 0.2.0-rc.2 | pack dependency | target device installs config-pack release | 公共 |
| @local/dsh-ptc-multi-agent-mode | 项目自写 | Robert-Wang-08 / wang | 仅登记，自行安装配置 | 未知 | github:Robert-Wang-08/dsh-config-pack#v0.11.4 (dsh-bundle) / 0.16.1 | pack bundle | target device installs config-pack release | 公共 |
| @local/dsh-subagent-acp-resilient | 项目自写增强，基于官方 ACP | Robert-Wang-08（本地增强）；deepseek-ai（官方 ACP 契约） | 仅登记，自行安装配置 | 未知 | github:Robert-Wang-08/dsh-subagent-acp-resilient#v0.2.3 / 0.2.3 | pack dependency | target device installs config-pack release | 公共 |
| @weibaohui/dsh-dashboard | 外部第三方 | weibaohui | 仅登记，自行安装配置 | 未知 | @weibaohui/dsh-dashboard@0.2.1 / 0.2.1 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-chat-import | 外部第三方 | Nwflower | 仅登记，自行安装配置 | 未知 | dsh-chat-import@0.25.2 / 0.25.2 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-embedded-browser | 外部第三方 | imroc / roc | 仅登记，自行安装配置 | 未知 | dsh-embedded-browser@0.3.0 / 0.3.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-mermaid-smooth | 外部第三方 | gitByteFree | 仅登记，自行安装配置 | 未知 | dsh-mermaid-smooth@0.1.0 / 0.1.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-notify-bell | 外部第三方 | zyar-er（既有库存记录，安装包未声明 repository） | 仅登记，自行安装配置 | 未知 | dsh-notify-bell@0.12.0 / 0.12.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-palette | 外部第三方 | 1921622004 | 仅登记，自行安装配置 | 未知 | dsh-palette@0.2.1 / 0.2.1 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-plugin-new-session | 项目自写 | wang / Robert-Wang-08 | 仅登记，自行安装配置 | 未知 | 暂无公共来源 / 0.2.0 | blocked until public tag/package is published | target device installs config-pack release | 待发布 |
| dsh-plugin-ptc-switches | 项目自写 | Robert-Wang-08 | 仅登记，自行安装配置 | 未知 | 暂无独立公共来源 / 0.2.0 | 根仓库项目级 link | 拉取 dsh-ynm3000；发布独立 npm/Git 版本后才能进入公共默认安装 | 自写/待发布 |
| dsh-plugin-subagent-director | 外部第三方 | SeverusZh | 仅登记，自行安装配置 | 未知 | dsh-plugin-subagent-director@0.5.6 / 0.5.6 | public npm optional component | target device runs optional component install | 公共 |
| dsh-plugin-subagent-monitor | 项目自写 | Robert-Wang-08 | 仅登记，自行安装配置 | 未知 | github:Robert-Wang-08/dsh-plugin-subagent-monitor#v0.1.0 / 0.1.0 | pack dependency | target device installs config-pack release | 公共 |
| dsh-recent-sessions | 外部第三方 | huangxp12 | 仅登记，自行安装配置 | 未知 | github:huangxp12/dsh-recent-sessions#v0.1.2 / 0.1.2 | public optional component | target device runs optional component install | 公共 |
| dsh-task-progress | 外部第三方 | chen8923 | 仅登记，自行安装配置 | 未知 | dsh-task-progress@0.3.0 / 0.3.0 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-task-supervisor | 外部第三方 | gosomea | 仅登记，自行安装配置 | 未知 | dsh-task-supervisor@0.1.9 / 0.1.9 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-ui-progress | 外部第三方 | sdynasty | 仅登记，自行安装配置 | 未知 | dsh-ui-progress@0.1.2 / 0.1.2 | public npm dependency | target device installs exact declared version | 公共 |
| dsh-worktable | 外部第三方 | Aisland-SJL | 仅登记，自行安装配置 | 未知 | 暂无公共来源 / 0.5.0 | blocked until public package/release is published | target device installs config-pack release | 待发布 |
| dshmarket | 外部第三方 | dsh-market | 仅登记，自行安装配置 | 未知 | github:dsh-market/dsh-market#v1.66.21 / 1.66.21 | public optional component | target device runs optional component install | 公共 |

## 新设备默认路径

默认使用 config-pack 的公开 release 和表中的公共 npm/Git 来源，不把本机 link 写入新 profile。

```powershell
pwsh D:/src/dsh/dsh-config-pack/scripts/install.ps1 -ProfileName packed
```

没有公共 tag/package 的组件暂不进入默认新装路径；必须先发布公共版本。设备差异、路由偏好和凭据指针仍由设备配置管理，凭据原值永不进入本表或快照。
