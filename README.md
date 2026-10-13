# dsh-config-pack

一个**通用 DSH 配置包**：把"插件选择 + 本地配置层 + agent 预设"打成单个可被 DSH 直接安装的 npm 包，
经 git 分发，一条命令装进任意 DSH profile。

```powershell
dsh plugin --profile packed add github:Robert-Wang-08/dsh-config-pack#v0.2.0
```

---

## 它解决什么

换一台设备时，DSH 的 profile 里有三类东西：

| 层 | 内容 | 能否随包分发 |
|---|---|---|
| **L1 包内容** | 预设行、provider 路由、默认模型、预设注册表、插件配置覆盖 | ✅ 本包用 `cordis.patch.yml` 承载 |
| **L2 激活** | 依赖 + `dsh.profile.bundles` 顺序 | ✅ `dependencies` + DSH 自己的 `reconcile` |
| **L3 不可分发** | 凭据、环境变量、CLI 登录态、`link:` 路径 | ❌ 由 `pack.manifest.yaml` 声明为清单 |

L3 由包**自描述**，不再靠文档口口相传。

### 发布渠道边界

- **Git（本仓库的 annotated tag）是通用 DSH 配置、预设、故障转移档位和个性化模板的唯一发布源。** 安装、升级和回滚必须钉住 tag；不要从 SkillHub 的旧 `dsh-preset-pack` bundle 安装。
- **SkillHub 只管理内部 skill 与隐私/个人单文件**，例如 PTC skill、目录映射、key 指针和环境变量清单。真实凭据仍不进 Git，也不进入公共同步载荷。
- `templates/device-config.env.example` 是个性化文件模板。复制到 SkillHub 管理的个人文件后填写设备值；本仓库只保留占位符和非敏感默认值。

---

## 安装

### 正常设备

```powershell
# 1) 装进一个新 profile（推荐，不会和现有 profile 打架）
#    必须把三个子代理包一起显式装上，理由见下面的警告。
dsh plugin --profile packed add github:Robert-Wang-08/dsh-config-pack#v0.2.0 '@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2' '@deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2' '@deepseek-ai/dsh-subagent-codex@0.2.0-rc.2'

# 2) 校验（只读，不动任何文件）
node scripts/verify.mjs --profile packed

# 3) 起
dsh packed
```

> ⚠️ **为什么必须显式安装那三个子代理包。** DSH 的插件加载器从 **profile 根**解析行的
> `name:`，不是从 bundle 自己的 `node_modules`。只在 `package.json` 的
> `dependencies` 里声明它们**不够**：对应行激活失败，而 DSH 只打一行
> `dsh: warning: N entry did not activate`，会话照常起来，工具却凭空消失——不报错，也没有
> 其它症状。装完再跑一次，看不到 `did not activate` 才算真的装上。
>
> 佐证（本机实测，非推测）：`profiles/web/package.json` 里这三个包是**直接声明**的，
> 而伴生 bundle `@local/dsh-ptc-multi-agent-mode` 也声明了其中两个——两者同时存在，
> 与「必须装进 profile 根」一致。本次改动**没有**在一个全新 profile 上复验过完整安装，
> 所以请以「装完没有 `did not activate`」为唯一判据。

### 升级

版本契约是 **annotated tag**。tag 不可移动、不可覆盖；修复必须发布新版本。升级时换成新 tag，DSH 会重新安装并保留 `dsh.profile.bundles` 中的注册：

```powershell
git -C <repo> fetch --tags origin
git -C <repo> checkout v0.2.0
dsh plugin --profile web add github:Robert-Wang-08/dsh-config-pack#v0.2.0
```

回滚使用旧 tag 重跑同一条安装命令。

### 卸载

```powershell
dsh plugin --profile packed remove dsh-config-pack
```

> ⚠️ 卸载**不会**恢复任何被本包覆盖的行；被覆盖的行会回落到上一个声明它的层（通常是该插件的 bundle 默认值）。

---

## 为什么不需要安装脚本

DSH 自己就把"装包"和"激活"合成了一步。这条链路可在安装目录里查证：

```
dsh plugin --profile <p> add <spec>
  → dsh/lib/plugin-*.js  runPluginCommand
      → @deepseek-ai/dsh-plugin-manager  lib/types/operations.js:526
          → runProfilePnpm (:246)
              → pnpm install
              → reconcile (:44, 调用点 :504)
                  → 新依赖若声明 dsh.bundle → push 进 dsh.profile.bundles (:64)
                  → 原子写 package.json (:71)
```

所以**注册 bundle 不需要手改 `package.json`**。本包因此不含任何"编辑 profile patch"的 PowerShell——
上一版方案那 200 行脚本是多余复杂度。

---

## 开发

```powershell
npm run build     # config/*.yml → cordis.patch.yml（生成物，入库）
npm run verify    # 只读校验
node scripts/verify.mjs --profile web   # 额外检查目标 profile 是否遮蔽本包
```

### 目录

```
config/10-subagents.yml   ACP provider 行 + claude-code/codex 权限覆盖
config/20-mcp.yml         四个 MCP server 行（默认全关，ticktick 按入口路径自动开）
config/30-ui.yml          目录选择器接线 + 欢迎语版本
config/40-models.yml      默认模型 + llm-pi-ai 六条路由
config/45-failover.yml    dsh-deepseek-keypool 完整故障转移档位（route 可 DSHPACK_ROUTE_* 覆盖）
config/50-presets.yml     legacy 预设 preset-standard-codex
config/60-registry.yml    预设注册表 selectedDefault
scripts/metrics.mjs       执行指标提取器（只读；见「执行指标与路由校准」）
scripts/compare-profile.mjs 只读对照 pack vs 目标 profile（stdout JSON）
docs/ROW-OWNERSHIP-20261013.md
                          跨层行归属分析（伴生工作产出，非本包契约的一部分）。
                          其中只有头条数字经独立复核：组合后的 web 配置顶层 `- id:` 共 207 个、零重复。
```

改配置**只改 `config/`**，然后 `npm run build`。`cordis.patch.yml` 是产物，不要手改。

### 开关

所有开关都是环境变量；**改完必须重启 DSH**（环境变量不会进入已在运行的进程）。

| 变量 | 默认 | 作用 |
|---|---|---|
| `DSHPACK_ACP_OPENCODE` | 开 | ACP 子代理 opencode |
| `DSHPACK_ACP_KIMI` | 开 | ACP 子代理 kimi |
| `DSHPACK_ACP_CURSOR` | **关** | 设为 `on` 启用 cursor-agent |
| `DSHPACK_MCP_CODEGRAPH` | 关 | 设为 `on` 启用 |
| `DSHPACK_MCP_TENCENT_DOCS` | 关 | 需 `TENCENT_DOCS_TOKEN` |
| `DSHPACK_MCP_SLIDE` | 关 | 需 `TENCENT_DOCS_TOKEN` |
| `DSHPACK_TICKTICK_ENTRY` | 空 | 填 ticktick-mcp 的 dist/index.js 绝对路径即自动开启 |
| `DSHPACK_NODE` | `node` | stdio MCP 用的 node 绝对路径 |
| `DSHPACK_DEFAULT_PROVIDER` / `DSHPACK_DEFAULT_MODEL` | `codex-relay` / `gpt-5.6-sol` | 新会话默认模型 |
| `DSHPACK_SELECTED_PRESET` | `ptc-multi-agent` | 预设注册表选中项 |
| `DSHPACK_BASE_*` / `DSHPACK_KEY_*` | 见 `config/40-models.yml` | 覆盖路由 baseURL / apiKeyEnv |
| `DSHPACK_ROUTE_CODEX_RELAY` | `codex-relay` | failover tier1 主路由 id |
| `DSHPACK_ROUTE_OPENAI_CODEX` | `openai-codex` | failover tier1 备用路由 id |
| `DSHPACK_ROUTE_AIS` | `ais-2dsglm` | failover tier2 主路由 id |
| `DSHPACK_ROUTE_OPENCODE` | `opencode-go` | failover tier2 DeepSeek 备用；另一设备可设为 `opencodego` |
| `DSHPACK_ROUTE_KIMI` | `kimi-coding` | failover tier3 路由 id |
| `DSHPACK_ROUTE_DEEPSEEK_OFFICIAL` | `deepseek-official` | failover tier4（默认禁用） |

---

## 超时模型（2026-10 对 DSH 0.2.0-rc.2 实装的核实）

「子代理超时」有五个互不相同的层，混为一谈是本仓反复踩过的坑。**没有任何一层是「子代理任务运行超时」配置项**：

| 层 | 真实配置面 | 默认值 | 是任务级超时吗 |
|---|---|---|---|
| @deepseek-ai/dsh-subagent-acp | 只有 `providerName` / `command` / `args` / `cwd` / `permission` / `env` / `disposeEofGraceMs` / `disposeGraceMs` | 6000 / 3000 ms | **否**。前者是 stdin EOF 后的收尾宽限，后者是失败后观测结构化进程事实、以及 POSIX 上 SIGTERM→SIGKILL 的宽限。都是清理参数 |
| @deepseek-ai/dsh-tool-subagent | 没有 `timeoutMs` | — | **否**。所以 subagent 工具不受 `dsh-tool-call-timeout-policy` 约束 |
| @deepseek-ai/dsh-tool-fs-search | 协作式预算 30000 ms | 30 s | 是（工具级）。`glob` / `grep` 报的 `tool call timed out after 30000ms` 来自这里 |
| @deepseek-ai/dsh-ptc-runtime-node | `timeoutMs`（上限 `maxTimeoutMs`） | 120000 / 600000 ms | **是，且是本机最常触发的那一层**：覆盖运行时准备与执行，**包含等待嵌套工具与审批的时间**。从 `run_code` 里调子代理时卡住的就是它 |
| cursor-agent 自身 | `network.*` 只暴露 `useHttp1ForAgent` | 代理路径 ping 5 s；直连 10 s / 20 s | 不可配置 |

### 实务结论

- **不要把长时子代理塞进 `run_code` 的前台等待里。** 后台派发（`run_in_background`）再回收，或显式传更大的 `timeoutMs`（上限 600000）。
- **不要靠调大 `disposeEofGraceMs` / `disposeGraceMs` 来「放宽超时」**——它们不是任务超时。
- **Cursor 经代理传输不稳**：代理路径不给 HTTP/2 会话传 ping 选项，落到 5 s；直连路径 10 s / 20 s，而配置层没有超时项可调。本包因此把 `cursor.sh` 追加进小写 `no_proxy`（cursor-agent 只读小写，且按 host 后缀匹配）。**归因必须诚实**：当初的 A/B 是先后跑的、被时间混淆；代理恢复后做交错 A/B，两臂都是 4/4。所以这条是**防御性加固**，不是已验证的修复——真正的解法是把代理修好。网络必须经代理时设 `DSHPACK_CURSOR_KEEP_PROXY`。
- **重试规则**：只有被判定为 `transport` 的失败才重试，最多一次。`model` / `auth` / `spawn` 是确定性失败，重试只会浪费时间并掩盖真因。
- **统计超时不要按文本搜**：助手自己的推理正文也会复述 `execution deadline reached` 这类字样，按子串扫会高估。本机一次原始文本扫得 55，按 `tool/result` 事件计只有 17。以事件为准。

本机一次性观测（242 个会话日志、113245 行、21532 次去重工具调用）：ACP transport 失败 11、其它 ACP 失败 4、工具调用超时 12、PTC deadline 事件 17、取消 4。这是单机单次记录，不是普适统计。

## 执行指标与路由校准

`scripts/metrics.mjs` 只读解析 DSH 会话日志（多帧 zstd，经 `fzstd`），把「模型能不能把活干对」和「DSH 能不能可靠地收到并验收结果」分开计量。

```powershell
npm run metrics:selftest                       # 离线自检，108 条断言
node scripts/metrics.mjs scan  --sessions "$env:USERPROFILE\.dsh\sessions\<工作区目录>" --json
node scripts/metrics.mjs stats --sessions "<同上>" --group-by route,executor,model [--labels labels.json]
```

**能拿到**：按稳定事件 id 去重的工具调用次数（顶层 `callId` 与 `run_code` 内嵌的 PTC `subCallId` 分开计）；**互不合并**的超时分类（`toolTimeout` / `ptcDeadline` / `acpTransport` / `acpOther` / `cancelled`）；工具错误与错误码；实际观测到的 provider/model；token 用量；以及日志里**字面出现**退出码时的测试退出码。

**拿不到，且不会伪造**：

| 指标 | 状态 |
|---|---|
| 成本 | 永远 `null`，`costSource: unavailable`。DSH 只记 token，不记钱；Cursor 订阅也无法摊到单任务。**不要**据此排「单位成功成本」 |
| 首轮成功率 | 无 `--labels` 时为 `null`；`firstPassLabelCoveragePct` 报告覆盖率。分母为 0 或未标注时输出 `null`，不是 0 |
| 真实单任务耗时 | 目前报的是**会话墙钟跨度**（首事件到最后事件），长会话或续接会话会显著高估。时钟偏移的导入日志按 `null` 报，不猜 |

工具调用次数**只能**从子代理自己的会话日志取值：父侧 ACP 流只收已提交的 `agent_message_chunk` 文本，reasoning / 工具活动 / plan 都留在子会话日志里，不上 ACP。

### 校准路由的方法（方法是确定的，结论要靠数据）

1. 把现有规则路由当作冻结基线；
2. 按 `(route, executor, model)` 分组累积**带标注**的样本，标注是唯一可用的验收来源；
3. 只比较标注样本量足够的分组，每个比率旁边必须同时给出样本数；
4. 成本真的可得时再比「单位成功任务成本」；否则比首轮成功率、超时率与耗时，并说明用的是哪个基准；
5. **绝不自动切换路由**——只产出建议供人复核，记录用了哪些统计量，并保留人工强制与回滚。

## 写 `!!js` 的两条硬约束

不是风格问题，违反会导致 YAML 解析失败：

1. **不能出现「冒号加空格」** → 因此**禁用三元运算符**。`cond ? 'a' : 'b'` 里的 ` : ` 会被 YAML
   当成映射键。统一改写：`(cond && 'a') || 'b'`（各分支均为真值时安全）。
2. **不能以引号 / `{` / `[` / `!` 开头** → 会被当成映射、flow 序列或另一个标签。
   需要数组时用 `String(...)` 之类以标识符开头的写法包装。

这两条有自动化检查：`npm run verify`。

---

## 本包不覆盖什么

| 行 id | 由谁提供 |
|---|---|
| `preset-ptc-multi-agent` | `ptc-multi-agent-control` 的 dsh-bundle |
| `subagent-acp-opencode-dsv41` / `-kimi-docs` / `-cursor-grok` | 同上 |
| `subagent-claude-opus5-plan` / `-opus48-plan` | 同上 |
| 五个 `tool-subagent-*` 与 `tool-presentation` | 同上 |

`dsh-deepseek-keypool` **由本包 owns**：插件只 insert 空 Host 行；完整档位表在 `config/45-failover.yml`。
装本包后应卸掉旧的 SkillHub `failover-tiers` bundle，并确保目标 profile 不再内联同 id 覆盖。

**为什么本包不自己声明这些 ACP 行。** 本包的 ACP 行用通用名（`opencode` / `kimi` / `cursor`），
PTC 用它的专用名（`opencode-dsv41` / `kimi-docs` / `cursor-grok`）并由 PTC bundle 自己注册，
其 `dsh-tool-subagent` 行再按这些名字绑定。**同一个 id 若被两个 bundle 同时声明，会按层序覆盖、
顺序不可控**——正是下面最后一条限制要避免的情况。所以 PTC 的 id 一律登记在 `delegated`，
`verify.mjs` 会拒绝本包再声明它们。

装齐两侧后可用组合视图自查：

```powershell
dsh --profile <name> --dump-config > composed.yml
node scripts/verify.mjs --composed composed.yml
```

`pack.manifest.yaml` 的 `owns:` 列出本包**独占**的行 id。若目标 profile 的
`cordis.patch.yml` 里还留着同 id 的内联块，**它会遮蔽本包**（profile patch 是最后一层，
按 id 覆盖、后写胜）。`verify.mjs --profile X` 会把这种情况报成错误。

---

## 已知限制

- **`--dump-config` 不能证明 `!!js` 被求值**。它回显的是**未求值的补丁源**（长表达式会被
  DSH 自身序列化成 `!!js >-` 折叠块）。`exit=0` 只证明"YAML 解析 + 层组合成功"，
  证明不了"表达式求值成了预期值"。要证后者，只能真起一个 profile 看行为。
- `dependencies` 里 `@deepseek-ai/dsh-base` / `dsh-web-app` 能否由目标设备的 pnpm 解析，
  取决于该设备的 registry/anchor 配置。`dsh plugin add` 的退出码是唯一判据。
- `reconcile` 只激活**新出现**的依赖（`operations.js:54-56 if (beforeDeps.has(name)) continue`）。
  若某依赖已存在但被从 `dsh.profile.bundles` 里手工删掉，重装本包不会把它加回来。
- 本包**不**依赖 bundle 之间的顺序。`readProfilePlugins` 用 `package.json` 里 `dependencies`
  的书写顺序，而 pnpm 会按字母序重写它——所以每行 id 必须由本包独占，否则顺序不可控。
- **在本仓库里跑 `npm install` 目前会失败**，原因是一个**与本次改动无关的既有** peer 冲突：
  `dsh-chat-import@0.25.2` 要求 `@deepseek-ai/dsh-tools <0.3.0`，而本仓锁在 `0.2.0-rc.2`。
  `scripts/metrics.mjs` 需要运行时依赖 `fzstd`（已在 `dependencies` 声明）。
- `config/60-registry.yml` 的 `selectedDefault: ptc-multi-agent` 依赖伴生 bundle 提供该预设，
  本包自己不带它；`verify.mjs` 目前**不检查**这条跨包依赖。
- `--composed` 需要先手工生成一份 `dsh --dump-config` 转储，且该转储是**未求值**的补丁源。
- `scripts/metrics.mjs` 报的耗时是**会话墙钟跨度**，不是单任务耗时；时钟偏移的导入日志按 `null` 报。
  要真正的单任务耗时需要按 turn 聚合，目前没有做。

## License

MIT
