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
  '@deepseek-ai/dsh-subagent-codex@0.2.0-rc.2'

# 2) 只读校验
node <repo>/scripts/verify.mjs --profile packed

# 3) 起
dsh packed
```

> ⚠️ **必须显式安装那三个子代理包。** DSH 的插件加载器从 **profile 根**解析行的 `name:`，
> 不是从 bundle 自己的 `node_modules`。只在 `dependencies` 里声明**不够**：对应行激活失败，
> 而 DSH 只打一行 `dsh: warning: N entry did not activate`，会话照常起来、工具却凭空消失。
> **判据是「启动输出里没有 `did not activate`」**，不是退出码。

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
- 只有能读该文件的插件版本（`dsh-provider-failover` ≥ 3.4.0）才认它；旧版会**静默忽略**。
- 没有该文件时，本包 `config/45-failover.yml` 的档位表直接生效——这是新设备的默认行为。

子代理侧的候选链（设计/开发/验证/连续任务）由主控在路由前读取，同样来自该文件，不来自 Git。

---

## 6. 校验清单

| 检查 | 命令 | 期望 |
| --- | --- | --- |
| 组合配置可解析 | `dsh --profile packed --dump-config` | `exit 0` |
| 无未激活条目 | 启动 DSH 的输出 | **没有** `did not activate` |
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
| `dsh plugin add` 直接失败 | 目标设备 registry / 网络解析不到依赖 | `dsh plugin add` 的退出码是唯一判据；先解决 registry/网络 |

---

## 8. 完整全流程在哪

本文件刻意只保留**去隐私**的通用做法。含以下内容的**完整跨设备全流程**保存在
**SkillHub 的 `dsh-preset-pack` skill**（私有）：

- 本机与目标设备的实际路径、profile 名与 `DSH_HOME`；
- 本机路由层的实际候选链与人工确认结果；
- SkillHub 侧需要同步哪些 skill（含提供 PTC 预设 bundle 的那个）；
- 逐步验证命令与实测判据、以及本次落地踩过的坑。

新设备首次落地请**先读 SkillHub 那份**，再用本文件做通用核对。
