# 设备 provider 配置与旧变量迁移

适用于已有设备升级、共享盘答案同步和无快照新装。真实密钥只放用户环境变量或 DSH 凭据服务；本流程只读取端点与凭据变量名。

## 一键入口

新装或从共享盘同步（运行前确认目标 profile）：

```powershell
pwsh scripts/setup.ps1 -ProfileName web -SharedRoot <共享盘根>
```

已经装好 profile，只更新设备配置：

```powershell
pwsh scripts/setup.ps1 -ProfileName web -SharedRoot <共享盘根> -SkipInstall -NonInteractive
```

只迁移旧变量或重新应用已绑定的共享盘：

```powershell
pwsh scripts/migrate-providers.ps1 -ProfileName web -DryRun
pwsh scripts/migrate-providers.ps1 -ProfileName web
pwsh scripts/migrate-providers.ps1 -ProfileName web -Check
```

迁移脚本依赖显式声明的 `yaml` 2.8.2（与 `metrics.mjs` 依赖 `fzstd` 同一约定）：tag 安装由 pnpm 自动装；以 link/junction 方式使用本仓库的开发机需先在仓库根 `npm install`（至少装 `yaml`）。缺依赖会失败并提示，不会静默忽略设备配置。迁移本身不重启 DSH。

setup 同步的 provider-model-catalog.snapshot.json 只作模型目录盘点/审计，不作为 provider 迁移的可执行配置源。模型配置以当前 pack 与设备 providers 输入为准；需要固定设备模型清单时，写 device-answers.json 的 models 字段。无 pi-ai 数据时 refresh 明确报错，不会从审计快照静默恢复。

## 输入与优先级

共享盘根可直接包含 device.env，或包含 dsh-device/device.env。同目录可放 device-answers.json、cordis.local.yml、route-config.json。

按从低到高覆盖：当前 pack 的完整配置 → 现有 profile 的用户修改 → User 环境变量 → Process 环境变量 → device.env → device-answers.json 的 providers → cordis.local.yml 的 config.providers。

旧变量继续兼容，**由迁移脚本转换为字面量**，不再由 llm-pi-ai 中的 !!js 求值：

| 后缀 | provider id |
|---|---|
| CODEX_RELAY | codex-relay |
| AIS | ais-2dsglm |
| ANTHROPIC_RELAY | anthropic-relay |
| KIMI | kimi-coding |
| OPENCODE | opencode-go |

DSHPACK_BASE_<后缀> 对应 baseURL；DSHPACK_KEY_<后缀> 对应 apiKeyEnv。KEY 的值只能是环境变量名。空值与模板占位符忽略，未知后缀阻断并要求改用结构化 providers 输入。

DSHPACK_ROUTE_* 仍用于 failover 路由映射；它与 provider id 是不同配置面。

## 共享盘可写字段差异

推荐复用 assets/device-answers.example.json 的 providers 数组。每项包含 id，以及 api/baseURL/apiKeyEnv/models 等需要覆盖的字段；models 可以是模型 id 字符串或完整模型对象。

或将以下内容放到共享盘 dsh-device/cordis.local.yml：

```yaml
- id: llm-pi-ai
  config:
    providers:
      ais-2dsglm:
        baseURL: https://your-endpoint/v1
        apiKeyEnv: MY_AIS_KEY
```

这里“只写差异”**仅适用于 migrate-providers.ps1 读取的设备输入**：迁移脚本先按 provider/字段合并，再生成完整 providers 集合。未列出的默认 provider 保留；数组（包括 models）整体替换。cordis.local.yml 只接受 llm-pi-ai 的 config.providers，不接受其它插件行、!!js 或密钥值。

**不要把上述局部示例直接复制进 profile 补丁，也不要直接用 dsh --patch 加载。** DSH 原生 - id: X + config 是整行整体替换，直接加载局部 providers 会删除其它 provider。手写 profile 补丁时必须提供完整 llm-pi-ai.config。

## 同步、升级与回滚

setup 记录共享盘来源；后续 install/update 或 migrate-providers 会重新读取该来源。共享盘修改后再次运行一键入口即可应用。共享盘不可用时明确失败；若要改成本机副本，显式执行：

```powershell
pwsh scripts/migrate-providers.ps1 -ProfileName web -InputDir "$env:DSH_HOME/device"
```

先确保目标目录包含希望保留的 device.env / device-answers.json / cordis.local.yml。切换来源后不会自动复制旧共享文件。

脚本写入前生成 cordis.patch.yml.bak-before-provider-migration-<时间戳>；保留其它行的注释和 !!js。profile 内 .provider-migration.json 保存上次生成结果和用户修改，用于升级时更新 pack 模型表，同时保留 GUI 修改。该状态随 snapshot 和配置备份保存；跨设备恢复后必须显式重新绑定本机可用的 InputDir。

设备文件删除字段后，该字段回到 pack 默认值或用户覆盖值；若仍存在低优先级同名环境变量，该环境变量仍生效。设备输入与 GUI 同字段冲突时设备输入优先。

回滚时停止 DSH，恢复同一时间点的 profile patch 和迁移状态备份；首次迁移没有旧状态时，可移除新建状态文件。随后重启 DSH。不要只恢复 patch 后立即重跑迁移，否则设备输入会再次应用。

## 验收

```powershell
pwsh scripts/migrate-providers.ps1 -ProfileName web -Check
node scripts/verify.mjs --profile web
dsh --profile web --dump-config > "$env:TEMP/composed.yml"
node scripts/verify.mjs --composed "$env:TEMP/composed.yml"
node scripts/test-provider-migration.mjs
```

verify --profile 仅放行通过迁移一致性校验的受管理 llm-pi-ai 行，其它遮蔽仍报错。verify --composed 的 dangling 检查主要针对子代理工具 providerName，不能替代模型路由实调；还需重启 DSH，在 Models 页面保存 provider 并发起一次请求。

隐私边界：设备文件与生成配置不得包含 API key 原值、token、cookie、私钥或登录态；apiKeyEnv 只写名字。所有个人配置留在共享盘 dsh-device 或本机 DSH_HOME/device，不提交 Git。
