# Provider 模型目录与子代理可用性刷新

## 选择的沉淀方式

事实同步使用脚本，操作说明由本文和现有运行 skill 承载，Web 按钮只适合作为后续触发器。脚本可以在新设备、CI、发布前和 GUI 外重复运行，能输出差异、版本和退出码；skill 负责让 AI 选择正确 profile、解释 custom endpoint 限制和执行验收；按钮如果直接实现模型同步，会产生第二份逻辑和无法复现的设备差异。

## 刷新入口

先找到目标设备的 pi-ai 数据目录。默认 DSH 依赖通常位于：

    <DSH 安装目录>/node_modules/@earendil-works/pi-ai/dist/providers/data

只读检查：

    node scripts/refresh-model-catalog.mjs --pi-ai-data '<DSH 安装目录>/node_modules/@earendil-works/pi-ai/dist/providers/data' --json

应用可由本机 pi-ai 目录确定的清单：

    node scripts/refresh-model-catalog.mjs --pi-ai-data '<DSH 安装目录>/node_modules/@earendil-works/pi-ai/dist/providers/data' --apply
    node scripts/build.mjs
    node scripts/verify.mjs
    npm test

也可以通过 npm script 调用：

    $env:DSH_PI_AI_DATA = '<DSH 安装目录>/node_modules/@earendil-works/pi-ai/dist/providers/data'
    npm run models:check
    npm run models:apply

--apply 当前会固定 opencode-go 的目录模型并写入本机忽略的 assets/provider-model-catalog.snapshot.json。OpenAI official、Kimi 和现有配置会被检查；Kimi 的官方新增模型由配置包维护。脚本不会把凭据、端点返回值或登录状态写入快照。

## 报告如何解读

- catalog：模型来自本机 pi-ai provider data，可以检查配置是否漏项。
- catalog-plus-official：本机目录和官方模型清单共同决定；配置允许保留兼容别名。
- custom-endpoint：codex-relay、ais-2dsglm、anthropic-relay 等私有端点必须用该端点自己的 /models 或 provider manifest 复核；公共 pi-ai 目录只作参考。
- subagent allowedModels：检查 PTC 子代理白名单是否引用了配置中不存在的 provider/model。
- subagent commands：只检查 opencode、kimi、cursor-agent、codex、claude 命令是否在 PATH；不代表已经登录、额度可用或 ACP 请求成功。

刷新后必须重新构建 cordis.patch.yml，重启 DSH 并新开会话。工具表和模型选择器在会话启动时生成，旧会话不会自动获得新增模型或子代理。

## 更新 pi-ai 和 subagent

配置包不直接修改 DSH 本体的 node_modules，也不替设备执行 OAuth 登录。更新宿主 DSH/pi-ai 后重新运行上述脚本，把结果作为新 tag 的发布证据。ACP/CLI 子代理的命令、权限、超时和环境变量仍由 config/10-subagents.yml 及 PTC bundle 管理；脚本只检查可用性，不把登录状态复制到 Git。

当前 provider 快照和已发布清单见 backup-restore-audit.md。
