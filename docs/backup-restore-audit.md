# 配置备份恢复审计与修复（2026-10-29）

## 已确认的原因

v0.10.10 及以前，`openai-codex` 只声明显示名，模型来自设备安装的 pi-ai 目录；failover 和子代理白名单引用模型不会注册模型。源设备目录有 `gpt-6.1-sol`，旧目录设备没有，因此同步相同配置也可能看不到模型。这个问题属于配置包的隐式依赖，不应靠复制 node_modules 解决。v0.10.11 已显式声明官方模型目录，保留 OAuth provider 身份；6.1 Sol 明确声明窗口 500000、输出 128000、文本/图片与推理档位。

另一个独立问题是 profile 内联补丁覆盖配置包。源设备 web 使用内联 llm-pi-ai 和本地 link 插件，没有直接登记 dsh-config-pack；源设备运行状态不能证明另一设备装入的包已经生效。需要确认实际使用的 profile 与最终组合配置。

## 本次补齐的备份覆盖

| 内容 | 处理 |
| --- | --- |
| profile 六项配置：cordis.yml、cordis.patch.yml、package.json、pnpm-lock.yaml、pnpm-workspace.yaml、compatibility.json | 均纳入候选，并区分不存在和拒绝 |
| profile/patches 下 .patch 文件 | 纳入；否则 patchedDependencies 清单恢复后依赖安装可能失败 |
| device.env、device-answers.json、route-config.json、cordis.local.yml、PTC 本机配置 | 纳入已知文件；用户环境变量值不导出 |
| .agent-presets 下 YAML/JSON/Markdown | 纳入；ZIP 不再遗漏隐藏目录 |
| plugins 下 settings/config/route-config 的 JSON/YAML | 纳入；其他文件列入 excluded |
| node_modules、CLI/OAuth 登录态、凭据、会话、日志和未知插件数据库 | 不属于此配置备份；不能用配置包备份替代本机私密快照 |
| dsh-device/provider-model-catalog.snapshot.json、provider-resource-manifest.json | 云盘同步的无凭据模型/子代理可用性资源；setup 恢复到 device/ 并校验 schema |

清单 schema 升至 dsh-backup/v2，包含逐文件 SHA256、complete/partial、absent/rejected/excluded。发现拒绝项仍落盘报告，但返回 2；任何读取/复制错误会失败。输出目录必须为空，避免把旧文件误混进新备份。纯环境变量引用可通过扫描，包含内联 token 或非空常量回退的表达式仍拒绝。扫描不是对任意未知格式的隐私审计，配置备份仍应保存在可信位置，公开分发只使用 Git 配置包。

## 另一台设备的更新与恢复

先用运行中进程、工作区约定和插件清单确认实际 profile；以下将实际名称填入参数，不能盲用默认 packed。

```powershell
git pull --ff-only
dsh plugin --profile <实际profile> list
pwsh -File scripts/backup.ps1 -Profile <实际profile>
# 备份 exit 0 且 manifest.status=complete 才可作为本次配置范围的恢复点。
pwsh -File scripts/update.ps1 -ProfileName <实际profile> -Source github:Robert-Wang-08/dsh-config-pack#v0.10.13
```

没有安装配置包的新设备使用 setup.ps1；共享盘 dsh-device 必须同时提供 device.env、route-config.json、provider-model-catalog.snapshot.json 和 provider-resource-manifest.json；模型快照只记录目录和可用性，不包含 node_modules 或登录态。已有内联配置且含自定义 provider 的设备，先用 dsh-backup-restore 创建本机快照，再按同 id 整体覆盖规则合并内联 llm-pi-ai。必须保留设备已有 provider、端点、凭据指针和自定义模型，把官方 models 段同步过去；不要直接删除整个内联块。配套 AI 应使用 dsh-profile-route-config 流程完成这一设备操作。

```powershell
pwsh -File scripts/setup.ps1 -ProfileName <实际profile> -SharedRoot <共享盘根> -Source github:Robert-Wang-08/dsh-config-pack#v0.10.13
```

设备答案来自共享盘 dsh-device 或本机 device；凭据在目标设备重新设置，官网 provider 重新登录。旧快照没有的文件无法从旧备份凭空恢复：应在源设备用新版脚本重新备份。

## 本机快照回滚

完整本机快照由 dsh-backup-restore 管理，恢复先 DryRun，实际恢复自动做 pre-restore 备份。配置包自己的配置备份可按 manifest.copied 逐项核对 SHA256：profile/ 映射回 profiles/<实际profile>/，其余保持 DSH_HOME 相对路径。先留当前快照，再复制被核验的文件；不得将 rejected 当作已经备份。修正 link 的设备路径，进入 profile 运行 pnpm install。若要回滚配置包版本，使用 install.ps1 显式指定之前的不可变 tag，不移动或覆盖 tag。

## 验收

```powershell
node scripts/verify.mjs
node scripts/test-model-config.mjs
pwsh -File scripts/test-backup.ps1
node scripts/verify-install.mjs --profile <实际profile>
```

安装验收必须同时满足核心依赖/登记、profile 没有遮蔽包行、dump 成功、无 did not activate/patch target missing、组合验证成功及官网模型显式声明。相同版本也会验收，版本号不能替代检查。--NoVerify 是显式跳过，不能据此宣称验收成功。

恢复后重启 DSH 并新开会话，在 Models 页确认 gpt（official）包含 GPT-6.1 Sol，完成 OAuth 登录后再做真实请求。目录注册验证不能证明账号权限、额度或上游可用性。

## Provider 模型清单更新（v0.10.14）

OpenCode Go 不再省略 `models` 字段，包内固定当前 pi-ai `opencode-go.json` 的 30 个模型；以后 pi-ai 升级后必须重新核对并发布。Kimi 按官方模型页补充 K3.1 Pro 系列、K2.7 Code 系列和 K2.6；旧 `k3-256k`、`kimi-for-coding` 等别名保留，避免现有路由和 ACP 配置失效。OpenAI official 的 9 个模型继续与当前 `openai-codex.json` 对齐。Anthropic relay、Codex relay、AIS 使用自定义端点，配置包只声明已确认的路由模型，不能把公共目录自动等同于私有端点可用性。

来源： [OpenCode Go 官方说明](https://opencode.ai/v2/docs/console/go/)、[Kimi API 官方模型列表](https://platform.kimi.ai/docs/models)、本机 pi-ai provider data。

## 本轮验证证据

使用真实 DSH 适配器，把宿主目录中的 6.1 Sol 条目移除后，仍从配置成功解析该模型，保留原 OAuth auth 对象及 openai-codex-responses 协议；默认配置的六条 provider 均成功注册，白名单引用均存在。合成备份覆盖配置/补丁、逐文件 SHA256 往返、隐藏 ZIP、纯 env 指针、凭据拒绝、partial 退出与重复输出拒绝。源设备真实配置备份已达到 12 个文件、零拒绝；本机私密快照另行保存在用户 DSH backups 目录。另一设备运行态和真实官网请求未在本会话直接验证。
