# 设备安装与本地个性化（去隐私版）

本文是 `dsh-config-pack` 的**设备落地说明**，内容为**去隐私版本**，可以随本仓库公开。

> **渠道边界**
> - **Git（本仓库）**：通用配置——预设、provider 装配、failover 档位表、**个人化模板**。
> - **SkillHub**：含设备路径、账号指针、个人路由偏好的**完整全流程**，保存在 `dsh-preset-pack` skill。
> - 凭据永不入库：本仓库只登记 `requires_env` 指针，不写 key 原值、不写凭据文件路径之外的内容。

---

## 1. 前置条件

| 项 | 要求 |
| --- | --- |
| DSH | `0.2.0-rc.2` 及以上 |
| Node.js | 20 及以上（`scripts/*.mjs` 依赖） |
| 包管理器 | pnpm（由 `dsh plugin add` 内部驱动） |
| Git | 用于按 tag 安装/升级 |

---

## 2. 安装（新设备推荐路径）

```powershell
# 0) 查看可用版本（版本契约是 annotated tag，tag 不可移动）
git ls-remote --tags https://github.com/Robert-Wang-08/dsh-config-pack.git

# 1) 装进一个新 profile（推荐：不与既有 profile patch 争同一个 id）
dsh plugin --profile packed add github:Robert-Wang-08/dsh-config-pack#<RELEASE_TAG> `
  '@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2' `
  '@deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2' `
  '@deepseek-ai/dsh-subagent-codex@0.2.0-rc.2' `
  '@deepseek-ai/dsh-web-app@0.2.0-rc.2'

# 2) git 宿主插件（本机路由层的加载器；构建脚本策略见 §2.1 约束 2）
dsh plugin --profile packed add github:Robert-Wang-08/dsh-provider-failover#v3.4.0
#    注意：本包 `package.json` 已把 `dsh-deepseek-keypool`（来源就是
#    `github:Robert-Wang-08/dsh-provider-failover#v3.4.0`）列为 dependencies，装包时会一并解析。
#    这里单独再 add 一次的用途是**显式登记它的 bundle**（依赖被解析 ≠ bundle 已登记到 profile），
#    不是重复安装。两条都做过时用 `node scripts/verify.mjs --profile <p>` 确认没有同 id 遮蔽。

# 3) 只读校验
node <repo>/scripts/verify.mjs --profile packed

# 3) 起
dsh packed
```

> ⚠️ **必须显式安装那三个子代理包。** DSH 的插件加载器从 **profile 根**解析行的 `name:`，
> 不是从 bundle 自己的 `node_modules`。只在 `dependencies` 里声明**不够**：对应行激活失败，
> 而 DSH 只打一行 `dsh: warning: N entry did not activate`，会话照常起来、工具却凭空消失。
> **判据是「启动输出里没有 `did not activate`」**，不是退出码。

---

## 目标 bundle 集合

一台设备最终启用哪些 bundle，由 **profile 的 `dsh.profile.bundles`** 决定，不是由本包的 dependencies 决定。
下表把三类分开，避免"声明了依赖"被误读成"bundle 已启用"。

### 1. 本包自身的 bundle

| 项 | 值 | 依据 |
|---|---|---|
| bundle 名 | `dsh-config-pack` | `package.json` 的 `dsh.bundle.patch` |
| patch 层 | `./cordis.patch.yml` | 同上 |

### 2. 本包声明为 dependencies 的包（会被解析安装）

来源：`package.json` 的 `dependencies`（**16 项**，含第三方 npm 包 `fzstd`）。

| 包 | 规格 | 说明 |
|---|---|---|
| `@deepseek-ai/dsh-base` | 0.2.0-rc.2 | 宿主基础 |
| `@deepseek-ai/dsh-web-app` | 0.2.0-rc.2 | Web 界面 |
| `@deepseek-ai/dsh-mcp-client` | 0.2.0-rc.2 | MCP 客户端 |
| `@deepseek-ai/dsh-subagent-acp` | 0.2.0-rc.2 | ACP 子代理（上游版） |
| `@deepseek-ai/dsh-subagent-claude-code` | 0.2.0-rc.2 | Claude Code 子代理 |
| `@deepseek-ai/dsh-subagent-codex` | 0.2.0-rc.2 | 官方 Codex 子代理 |
| `dsh-chat-import` | 0.25.2 | 会话导入 |
| `dsh-mermaid-smooth` | 0.1.0 | 图形渲染 |
| `dsh-notify-bell` | 0.12.0 | 通知 |
| `dsh-deepseek-keypool` | github:Robert-Wang-08/dsh-provider-failover#v3.4.0 | 故障转移与档位路由 |
| `dsh-plugin-provider-badge` | github:Robert-Wang-08/dsh-plugin-provider-badge#v0.1.0 | provider 标识 |
| `dsh-plugin-sidebar-visibility` | github:Robert-Wang-08/dsh-plugin-sidebar-visibility#v0.0.3 | 侧栏可见性 |
| `dsh-archived-sessions` | github:Robert-Wang-08/dsh-archived-sessions#v0.4.1 | 归档会话 |
| `dsh-plugin-subagent-monitor` | github:Robert-Wang-08/dsh-plugin-subagent-monitor#v0.1.0 | 子代理监控 |
| `@local/dsh-subagent-acp-resilient` | github:Robert-Wang-08/dsh-subagent-acp-resilient#v0.2.1 | ACP 抗性版（超时阶梯 / guardWorkspaceReuse） |
| `fzstd` | ^0.1.1 | 解压依赖（非插件） |

> 依赖被解析 **不等于** 对应行已激活：DSH 从 **profile 根**解析行的 `name:`，
> 见上文 §2 的 `did not activate` 警告。

### 3. 属于设备级补充安装、不由本包交付

| 能力 | 交付方式 | 依据 |
|---|---|---|
| PTC 多代理预设与 bundle（`@local/dsh-ptc-multi-agent-mode`） | 用 `scripts/generate-ptc-companion.mjs` 生成 companion，再安装其中的 `dsh-bundle/` | `README.md` 的「公开 PTC 伴生配置」一节 |
| SkillHub 侧资产（如 `ptc-multi-agent-control`） | SkillHub 只做索引登记，正文在 `packages/dsh-ptc-multi-agent-mode/` | `templates/ptc-public-companion/ptc-multi-agent-control/INDEX.md` |
| 本机 provider 路由顺序 / 端点 / 凭据名 | `DSHPACK_ROUTE_*` / `DSHPACK_BASE_*` / `DSHPACK_KEY_*`，指引见 `docs/AI-DEVICE-SETUP.md` | `config/45-failover.yml`、`config/40-models.yml` |

因此：**本包一键安装 ≠ 完整 PTC 能力安装**；PTC 需要额外一步生成并安装 companion。

---

## 2.1 干净 profile 复验出的三条硬约束

以下三条是 2026-10-13 在一个**全新 profile**（DSH 默认只带 dsh-base）上实测得出，本仓库此前的安装段没有覆盖。

### 约束 1：本包必须排在它要覆盖的行所属 bundle 之后

补丁只能覆盖**先声明**的行。顺序不对时这些行不会生效，stderr 会逐条打出：

    dsh: [dsh-config-pack] patch: entry "directory-picker" not found
    dsh: [dsh-config-pack] patch: entry "ui-settings-general" not found
    dsh: [dsh-config-pack] patch: entry "dsh-deepseek-keypool" not found
    dsh: [dsh-config-pack] patch: entry "agent-preset-registry" not found

实测：本包排在 dsh-web-app / keypool 插件**之前**时出现上述 4 行；把本包移到 `dsh.profile.bundles` 末位后重建，4 行全部消失，组合结果由 26475 字节增至 65836 字节——说明覆盖这时才真正生效。

正确顺序（末位是本包）：

    bundles: [ @deepseek-ai/dsh-base, @deepseek-ai/dsh-subagent-claude-code,
               @deepseek-ai/dsh-subagent-codex, @deepseek-ai/dsh-web-app,
               dsh-deepseek-keypool, dsh-config-pack ]

### 约束 2：git 宿主插件会被构建脚本策略拦下，中途失败后的重试不会自动补登记

- 首次 add 可能报 `ERR_PNPM_IGNORED_BUILDS`（本次实测键是 `koffi`）。DSH 会在报错里给出做法：把 pnpm 打印的那个键写进该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`（`true` 或 `false`），再重跑同一条命令。
- 若首次失败时依赖已被写进 profile 的 `package.json`，重试会因为「依赖不是首次出现」而**不再登记为 bundle**（`reconcile` 只激活新出现的依赖），于是插件行继续 `not found`。恢复办法：先 `dsh plugin remove` 掉这些包，再重新 `add`。
- 判据不是退出码，而是 stderr 里**既没有** `did not activate`，**也没有** `patch: entry ... not found`。

### 约束 3：web app 必须显式加进 profile 依赖

本包在 `dependencies` 里声明 `@deepseek-ai/dsh-web-app`，只能保证它被装进 `node_modules`，**不等于**它会进入 `dsh.profile.bundles`。干净 profile 上必须显式 `add` 一次，否则 `directory-picker` / `ui-settings-general` / `agent-preset-registry` 这些行同样不存在。

---
## 2.2 从远端 tag 安装的实测配方（2026-10-13）

在一台全新 profile 上用 `github:Robert-Wang-08/dsh-config-pack#v0.3.1` 实测走通。关键点：**profile 级的 pnpm 设置必须先写**，否则从 git spec 安装根本走不完。

### 第一步：写 profile 的 pnpm 设置

profile 目录由第一次 `dsh plugin add` 自动创建；创建后编辑其中的 `pnpm-workspace.yaml`：

    packages:
      - .
    nodeLinker: hoisted
    autoInstallPeers: false
    blockExoticSubdeps: false
    allowBuilds:
      '@deepseek-ai/dsh-subprocess-local': false
      '@google/genai': false
      koffi: false
      node-pty: false
      protobufjs: false

- `blockExoticSubdeps: false` 是**必需**的：本包自身依赖若干 git 宿主包（keypool 插件、会话归档、两个 UI 插件），从 git spec 安装时它们会变成「异种子依赖」被 pnpm 默认拒绝，报 `ERR_PNPM_EXOTIC_SUBDEP`。实测**把异种依赖显式列进直接依赖不能绕过**，只有关掉该开关可行。（用本地路径 `link:` 安装不会遇到这条。）
- `allowBuilds` 的键名以安装报错里 pnpm 打印的为准；`true` / `false` 由你决定——`false` 表示跳过其构建脚本（更保守），需要终端等原生能力时再逐项放开。

### 第二步：一条命令装齐，本包写在最后

    dsh plugin --profile packed add `
      '@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2' `
      '@deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2' `
      '@deepseek-ai/dsh-subagent-codex@0.2.0-rc.2' `
      '@deepseek-ai/dsh-web-app@0.2.0-rc.2' `
      'github:Robert-Wang-08/dsh-provider-failover#v3.4.0' `
      'github:Robert-Wang-08/dsh-config-pack#<RELEASE_TAG>'

`dsh.profile.bundles` 的顺序**就是命令行参数的顺序**，所以本包必须写在参数最后，天然满足 §2.1 约束 1。

> 若在这一步之前已经有过**失败的**安装尝试，依赖可能已被写进 `package.json`，此时 bundle 不会登记。先 `dsh plugin --profile packed remove <这些包>`，再执行上面的完整命令。

### 第三步：校验

    dsh --profile packed --dump-config > composed.yml
    node <repo>/scripts/verify.mjs --composed composed.yml

实测结果（v0.3.1，全新 profile）：`--dump-config` exit 0、65836 字节、stderr **无任何** `patch: entry ... not found`、`subagent_codex_relay` 出现 1 次；composed = 21 tool row / 10 registered provider name / **0 dangling**。

## 2.3 registry 与镜像源（2026-10-13 第二台设备实测）

结论先行：**优先用镜像源**；上游只在镜像确实缺某个版本时临时一用。

在该 profile 的 `.npmrc` 写：

    registry=https://registry.npmmirror.com

- 直连 `registry.npmjs.org` 的实测代价：本次升级首次 `add` 出现 `error (23)`、约 48 KiB/s、反复重试，15 分钟仍未完成；
  改用镜像后**同一条 `add` 1m44s 完成**。
- 镜像的代价是 packument 可能陈旧，解析具体版本时报 `NO_MATCHING_VERSION`。处理顺序：
  1. `pnpm store prune`（清掉陈旧 metadata，实测输出 `Removed all cached metadata files`）；
  2. 重试；仍不行才把该 profile 临时切回上游；
  3. **切回镜像后必须重跑 §6 校验** —— 半装态会留下不一致。
- **半装态**（`remove` 成功、`add` 未完成：`dsh.profile.bundles` 在册但依赖已卸载）不要手改 bundles 清单，
  直接重跑那条完整 `add`（本包仍写在最后）。

---
## 3. 升级与回滚

```powershell
git -C <repo> fetch --tags origin
git -C <repo> checkout v0.3.0
dsh plugin --profile packed add github:Robert-Wang-08/dsh-config-pack#v0.3.0
```

回滚 = 换成旧 tag 重跑同一条命令。tag 不可覆盖，修复必须发布新版本。

---

## 4. 本地个性化（本仓库只保留通用模板）

本仓库**只放模板** `templates/device-config.env.example`；真实设备值属于本机状态，不要提交回来。

1. 把模板复制成**你自己的**设备配置文件（放在本机、受忽略或被 SkillHub 管理的个人文件里）。
2. 按模板填写本机值，并设置成 User 环境变量：

```powershell
[Environment]::SetEnvironmentVariable('DSHPACK_ROUTE_OPENCODE', '<your-route-id>', 'User')
```

3. **重启 DSH** 使环境变量与配置生效。

> **route id 因设备而异。** 同一 provider 在不同设备上可能叫不同名字（例如一台是 `opencode-go`，
> 另一台是 `opencodego`）。正确做法是用 `DSHPACK_ROUTE_*` 覆盖，**不要**把本机名字写回仓库默认值。
> 全部可覆盖项见 `pack.manifest.yaml` 的 `requires_env`。

---

## 5. 本机路由层（不属于本仓库）

provider 与子代理的候选链、failover 顺序属于**机器本地偏好**，由本机的**交互式路由设置**生成：

```text
$DSH_HOME/plugins/provider-failover/route-config.json
```

- 该文件**机器本地**、**不含凭据**（只写 route/model 名字），**不得提交进任何仓库**。
- 插件在**启动时**读取它；存在时覆盖包内联的档位表，因此**改完必须重启 DSH**。
- 只有能读该文件的插件版本（`dsh-provider-failover` ≥ 3.4.0）才认它；旧版会**静默忽略**。本包依赖已钉到 annotated tag `#v3.4.0`，避免跟随分支漂移。
- 没有该文件时，本包 `config/45-failover.yml` 的档位表直接生效——这是新设备的默认行为。

子代理侧的候选链（设计/开发/验证/连续任务）由主控在路由前读取，同样来自该文件，不来自 Git。

---

## 6. 校验清单

| 检查 | 命令 | 期望 |
| --- | --- | --- |
| 组合配置可解析 | `dsh --profile packed --dump-config` | `exit 0` |
| 无未激活条目 | 启动 DSH 的输出 | **没有** `did not activate` |
| 无失配补丁行 | 组合或启动时的 stderr | **没有** `patch: entry ... not found` |
| 占有边界与 provider 唯一 | `node scripts/verify.mjs --profile packed` | `OK` |
| 组合后无悬空 provider | `dsh --profile packed --dump-config > composed.yml; node scripts/verify.mjs --composed composed.yml` | `0 dangling` |
| 目标 profile 是否遮蔽本包 | `node scripts/compare-profile.mjs` | 无 pack 独占 id 被覆盖 |

> **限制**：`--dump-config` 回显的是**未求值**的补丁源（`!!js` 表达式按源码折叠输出），
> `exit 0` 只证明「YAML 解析 + 层组合成功」，**证明不了表达式求值成了预期值**。
> 要证后者只能真起一个 profile 看行为。

---

## 7. 故障排查

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| 启动出现 `N entry did not activate` | 子代理包没装进 **profile 根** | 按 §2 把三个子代理包显式 `add` |
| 工具面板少了一整组 | 同上（会静默消失） | 同上；把「无未激活条目」当硬判据 |
| `verify.mjs --profile X` 报 shadowing | 目标 profile 的 patch 仍声明本包 `owns` 的 id | 让那些行退出，按 id 独占，不要靠文件修改时间猜胜者 |
| 改了默认路由但不生效 | 改的是包内联表，被本机 `route-config.json` 覆盖 | 改本机路由文件，或临时移除它；改完**重启 DSH** |
| 改了本机路由文件但不生效 | 插件只在启动时读一次 | 重启 DSH |
| stderr 出现 `patch: entry ... not found` | 本包排在被覆盖行所属 bundle 之前 | 把 `dsh-config-pack` 移到 `dsh.profile.bundles` 末位（§2.1 约束 1） |
| 装插件报 `ERR_PNPM_IGNORED_BUILDS` | pnpm 默认拦截 git 宿主插件的构建脚本 | 按报错提示写入该 profile 的 `allowBuilds` 后重跑（§2.1 约束 2 / §2.2） |
| 从 git tag 安装报 `ERR_PNPM_EXOTIC_SUBDEP` | 本包的 git 宿主依赖成了异种子依赖 | 在该 profile 的 `pnpm-workspace.yaml` 写 `blockExoticSubdeps: false`（§2.2） |
| 插件已装但行仍 `not found`，重装无效 | 依赖已存在，`reconcile` 不再登记 | 先 `dsh plugin remove` 再 `add`（§2.1 约束 2） |
| `dsh plugin add` 直接失败 | 目标设备 registry / 网络解析不到依赖 | `dsh plugin add` 的退出码是唯一判据；先解决 registry/网络（§2.3） |
| 安装/升级卡在上游 registry（极慢、`error (23)`、反复重试） | 直连 `registry.npmjs.org` | 该 profile 的 `.npmrc` 切镜像源（§2.3）；实测同一条 `add` 由 15 分钟未完成变为 1m44s |
| 镜像报某包 `NO_MATCHING_VERSION` | 镜像 packument 陈旧 | 先 `pnpm store prune` 再重试；仍不行才临时切上游，**切回镜像后重跑 §6 校验**（§2.3） |
| `remove` 成功但 `add` 中途失败 | 网络中断，profile 处于半装态 | 不要手改 `dsh.profile.bundles`；直接重跑完整 `add`（本包排最后）（§2.3） |

---

## 8. 完整全流程在哪

本文件刻意只保留**去隐私**的通用做法。含以下内容的**完整跨设备全流程**保存在
**SkillHub 的 `dsh-preset-pack` skill**（私有）：

- 本机与目标设备的实际路径、profile 名与 `DSH_HOME`；
- 本机路由层的实际候选链与人工确认结果；
- SkillHub 侧需要同步哪些 skill（含提供 PTC 预设 bundle 的那个）；
- 逐步验证命令与实测判据、以及本次落地踩过的坑。

新设备首次落地请**先读 SkillHub 那份**，再用本文件做通用核对。
