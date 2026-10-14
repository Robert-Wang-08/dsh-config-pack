# 公开 PTC 伴生包 clean-profile 端到端验收报告

- 日期：2026-10-14
- 根任务：`task-20261014T050745382035Z-bf1221d0376d`（契约哈希 `a0e5594969811bf2e1484cdc6432ad0abcd3dc8e13fba00b6d31f46f0ed60702`）
- 验收对象：`dsh-config-pack` 的公开 PTC 伴生包（`templates/ptc-public-companion/` + `scripts/generate-ptc-companion.mjs`）
- 主控真实模型（观测值）：`ais-2dsglm / deepseek-v4.1-flash`
- 结论摘要：**静态检查全部通过，clean-profile 端到端验收未通过。** 实测出 3 项可复现的真实缺陷（1 项阻断）与 2 项文档/验收判据错误。

---

## 1. 目标

消解文档中登记的限制：

> The public companion has not yet been installed and exercised end to end in a clean DSH profile.
> That remains a release acceptance limitation; static checks do not prove plugin activation or evaluated `!!js` behavior.

即：在一个全新的、与现有 `web` profile 完全隔离的 DSH profile 中，真实执行

1. 公开模板生成
2. skill 安装
3. bundle 激活
4. `dsh --dump-config`
5. 真实 ACP 路由验收

并据实回写文档结论。

## 2. 验收环境与隔离策略

| 项 | 值 |
| --- | --- |
| DSH 版本 | 0.2.0-rc.2 |
| 全新 profile | `ptc-clean-test`，由发行模板 `headless` 初始化 |
| profile 层 | `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`（**不含** web profile 的任何插件） |
| 生成物目录 | `<WORKSPACE>/.ptc/ptc-clean-acceptance/companion`（非 Git 跟踪） |
| 证据目录 | `<WORKSPACE>/.ptc/ptc-clean-acceptance/` |

两条刻意的隔离决定，及其源码依据：

1. **不触碰 SkillHub Junction。** 本机 `~/.agents/skills/ptc-multi-agent-control` 是 Junction，指向被治理规则保护的
   `<SHARED_DRIVE>/skillhub/store/installed/ptc-multi-agent-control`。验收改用
   `DSH_AGENTS_HOME` 重定向到独立目录：
   依据 `@deepseek-ai/dsh-skill-filesystem/lib/index.js`：
   - 第 78 行 `this.agentsHome = resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents"))`
   - 第 177–180 行 `roots.push({ path: join(this.agentsHome, "skills"), source: "user-agents", rank: 500 })`

   因此 `DSH_AGENTS_HOME=<dir>` 时用户级 skill 根就是 `<dir>/skills`，无需删除或重建 Junction。
   该重定向**只用于本次验收的可观测性**；公开用户的默认路径仍是 `~/.agents/skills`。

2. **不改动现有 `web` profile**，所有验证都在 `ptc-clean-test` 与其 `--patch` 叠加层内完成。

## 3. 步骤与实测结果

### 3.1 公开模板生成

~~~powershell
node scripts/generate-ptc-companion.mjs --answers <answers.json> --out <companion> --dry-run
node scripts/generate-ptc-companion.mjs --answers <answers.json> --out <companion>
~~~

- dry-run 与真实生成均 `EXIT=0`，产物 8 项齐全（`ptc.local.json`、`ptc.local.patch.yml`、`ptc.env.example`、
  `companion.manifest.json`、`README.md`、`.gitignore`、`dsh-bundle/`、`ptc-multi-agent-control/`），另加 `.ptc-generation.json`。
- 生成器自报 `"secrets_written": false`、`"clean_profile_verified": false`。
- 生成时的唯一偏离：`features.cursor` 由默认 `false` 改为 `true`，以便三条 ACP 路由都在激活态下被验收。

### 3.2 skill 安装与发现

将生成的 skill 复制到 `<acceptance>/agents-home/skills/ptc-multi-agent-control`（16 个文件，含 frontmatter、
`SKILL.md`、7 个 `scripts/*.py`、`assets/`、`references/`、`evals/`），并以 `DSH_AGENTS_HOME` 启动会话。

**通过。** 该会话的 skill 目录注入事件（`user/message`，`source.kind = "skill-catalog"`）中只有 1 条：

~~~text
<available_skills>
- \`ptc-multi-agent-control\`: 通用 PTC 多代理主控模式。提供可观测路由、追加式账本、worker receipt 和产出契约；适用于跨工作区的多模型协作。
</available_skills>
~~~

即：生成的公开 skill 可被发现、被注入，且该 profile 未泄漏 web profile 的其它 17 个 skill（隔离成立）。

### 3.3 bundle 激活

~~~powershell
dsh plugin --profile ptc-clean-test add \
  '@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2' \
  '@deepseek-ai/dsh-subagent-claude-code@0.2.0-rc.2' \
  '<companion>/dsh-bundle'
~~~

- `EXIT=0`；`@local/dsh-ptc-public-companion` 与 `@deepseek-ai/dsh-subagent-claude-code` 被自动登记进
  `dsh.profile.bundles`；`@deepseek-ai/dsh-subagent-acp` 按预期只作普通依赖（它不声明 `dsh.bundle`）。
- 安装本身无 `patch: entry ... not found`。

### 3.4 `dsh --dump-config`

| 命令 | 退出码 | stderr |
| --- | --- | --- |
| `dsh --profile ptc-clean-test --dump-config` | 0 | 空 |
| `dsh --profile ptc-clean-test --patch <companion>/ptc.local.patch.yml --dump-config` | 0 | `patch: entry "tool-presentation" not found` |

dump 结果：伴生 bundle 的 44 个 id 全部进入组合树（与 `skillhub` 权威 bundle 的 44 个 id 逐条一致），
`providerName` 无重复。

### 3.5 真实 ACP 路由验收

分两层执行，均为真实 ACP 会话（`initialize → session/new → session/prompt`），非静态断言。

**（A）路由级**（`acp_smoke.py --route <r> --timeout 60 --json`，使用生成的 skill 自带脚本与生成的环境变量名）：

| 路由 | 结果 | stage | attempts | answer | modelLock |
| --- | --- | --- | --- | --- | --- |
| `kimi-docs` | **通过** | prompt | 1 | `Kimi` | unverified |
| `opencode-dsv41` | **通过** | prompt | 1 | `ais1dsglm/deepseek-v4.1-flash` | **verified** |
| `cursor-grok` | **未在验收窗口内收敛** | — | 0（单次尝试） | — | — |

**（B）DSH 级**（在同一 clean profile 内由模型真实调用 `subagent_opencode_dsv41`）：

| 叠加层 | 结果 | 证据 |
| --- | --- | --- |
| 仅诊断 overlay + **伴生 `ptc.local.patch.yml`** | **失败** `stage: initialize / category: process-exit / exit code: 1` | `dsh-acp-call.log` |
| 仅诊断 overlay（不叠加本地 patch） | **成功**，子代理返回 `ACP-OK` | `dsh-acp-call-nopatch.log` |

（诊断 overlay 的作用见缺陷 D2：伴生 bundle 把 ACP 工具行只放在无法激活的 preset 内，故验收时用
`accept-tool-subagent-*` 顶层行复现同一 provider，未改动任何 Git 跟踪文件。）

## 4. 实测缺陷

### D1（阻断）本地 patch 的 Windows 引号使 opencode/cursor 的 ACP spawn 失败

`<companion>/ptc.local.patch.yml` 生成：

~~~yaml
command: !!js (process.platform === 'win32' && 'cmd') || 'sh'
args:
  - !!js (process.platform === 'win32' && '/c') || '-c'
  - !!js (process.platform === 'win32' && ('"' + (process['env']["PTC_CLI_OPENCODE"] || "opencode") + '" acp')) || ...
~~~

在 Windows 上得到的实参是 `cmd /c "opencode" acp`，子进程 stderr：

~~~text
'"opencode"' is not recognized as an internal or external command, operable program or batch file.
Error: subagent-acp: Subagent failure (provider: ACP; stage: initialize; category: process-exit; exit code: 1)
~~~

而**同一个 bundle 自带的**写法是 `args: ['/c', 'opencode acp']`（不加引号），实测可用；
去掉本地 patch 后同一 profile、同一 prompt 立即成功返回 `ACP-OK`。

- 影响：按文档要求把 `ptc.local.patch.yml` 作为最后一层应用，会**让 opencode（以及同写法的 cursor）路由整体不可用**。
- 最小复现：`dsh ptc-clean-test --patch overlay-acp-tools.yml --patch companion/ptc.local.patch.yml "<调用 subagent_opencode_dsv41>"`。
- 建议修复：本地 patch 的 args 与 bundle 保持一致，不加内嵌引号；若确需支持含空格的绝对路径，
  应改为整体实参覆盖变量（如 cursor 行已有的 `PTC_CURSOR_ACP` 形式），而不是在命令名两侧加引号。

### D2（阻断）preset 服务缺失，PTC 预设无法激活，PTC 工具全部不可见

全新 profile 启动即报：

~~~text
dsh: warning: 1 entry did not activate
preset-ptc-multi-agent (@deepseek-ai/dsh-agent-preset): pending (waiting for service: agentPresets)
~~~

根因（源码查证）：

- `@deepseek-ai/dsh-agent-preset/lib/index.js:10` `static inject = ["agentPresets"]`；
- 该服务的提供者是 `@deepseek-ai/dsh-agent-preset-registry`，由 **`dsh-web-app`** 的 bundle 插入
  （`dsh-web-app/cordis.patch.yml:562` `- id: agent-preset-registry`），`dsh-base` 不提供（0 命中）；
- 伴生 bundle 既未声明该行，也未依赖 `dsh-web-app`。

后果（实测）：该会话 `request/header` 的工具表共 24 个，**不含**
`subagent_opencode_dsv41`、`subagent_kimi_docs`、`subagent_cursor_grok`、
`subagent_claude_opus5_plan`、`subagent_claude_opus48_plan`、`present`；
系统提示中也没有 PTC persona。也就是说，44 行里的 PTC 能力面**全部**位于 preset 内，preset 不激活等于伴生包整体不可用。

建议修复（二选一，推荐 (a)）：
(a) 伴生 bundle 自带 `agent-preset-registry` 行并把 `@deepseek-ai/dsh-agent-preset-registry` 列入依赖与安装命令，
    使 bundle 自足；需处理与 `dsh-web-app` 同行 id 的层序（本包必须在其后）。
(b) 明确声明硬前置：目标 profile 必须包含提供 `agentPresets` 的 bundle（如 `@deepseek-ai/dsh-web-app`），
    并在生成器与文档里把这条前置写成可检查的前置条件，而不是只在安装说明里说“安装后在模式选择器中选择”。

### D3 本地 patch 的 `tool-presentation` 是无消费者的假配置

`ptc.local.patch.yml` 顶层声明 `- id: tool-presentation`，但伴生 bundle 里的 `tool-presentation` 只存在于
**preset 的 plugins 内层**（dump 中缩进 lead=6），不是顶层条目。因此该行解析失败：

~~~text
dsh: [<companion>/ptc.local.patch.yml] patch: entry "tool-presentation" not found
~~~

该行被静默丢弃，`PTC_FEATURE_PRESENTATION` 开关**实际不生效**（呈现功能仍由 preset 内层的 `mode: ptc` 提供，
所以表面无症状，属典型静默失效）。

建议修复：从本地 patch、schema 与 `consumption-map.json` 中移除这个不支持的开关
（与本包“删除无真实消费者的假配置字段”的既有原则一致），或改为在 bundle 的 preset 内提供可控开关
（`!!js` 在 preset 内层求值即可，无需顶层 patch）。

### D4 文档给出的验收判据不成立

1. `dsh --dump-config` **不求值** `!!js`，只打印组合后的原始 patch 树：dump 中仍可见
   `command: !!js process.platform==='win32'?'cmd':'sh'`。因此“看 dump”无法证明 `!!js` 求值。
2. `--dump-config` **不会**报告激活失败：两个 dump 的 stderr 均无 `did not activate`，
   而真实启动立刻报出 D2。因此 README/文档里“装完再跑一次 dump-config，看不到 `did not activate` 才算真的装上”
   这条判据**不可靠**——必须真实启动一次才算。

建议修复：文档把“bundle 激活判据”从 dump 改为真实启动（例如一次性 headless 会话），
`!!js` 求值证据同样以真实启动/真实 ACP 调用为准。

### D5 公开伴生包不提供默认预设选中

`dsh-web-app` 的注册表行默认是 `default: standard`（`cordis.patch.yml:565`）。
本机 `web` profile 之所以默认走 PTC 预设，来自 `dsh-config-pack/config/60-registry.yml:5-9` 的
`selectedDefault: !!js ... || 'ptc-multi-agent'`，属**设备/包层**，不是伴生层。
因此全新 profile 即使解决了 D2，也仍默认使用 `standard` 预设，PTC 路由不会自动生效。
文档已要求“在模式选择器中选择”，但这一点在 headless/无人值守场景无法完成，应写明。

## 5. 结论

- 生成、skill 安装、bundle 注册、`--dump-config` 均能跑通且可复现；生成的公开 skill 可被发现。
- **路由级** ACP 验收：`kimi-docs` 与 `opencode-dsv41` 两条真实 ACP 会话通过（见 §6 对 cursor 的说明）。
- **端到端**验收**未通过**：按文档流程（叠加 `ptc.local.patch.yml`）在 clean profile 中调用 ACP 子代理会失败（D1）；
  且在一台没有 `dsh-web-app` 的 profile 上，伴生包的 PTC 能力面整体无法激活（D2）。
- 因此 **CHANGELOG / README / docs 中“clean-profile 端到端未验证”的限制必须保留**，并补充本报告实测到的具体前置条件与缺陷。

## 6. 限制

- `cursor-grok` 路由**未能收敛**：`--timeout 45 --retries 0` 的单次尝试运行超过 5 分钟仍未返回，
  而 `cursor-agent --list-models` 本身 7.5 秒即可完成、模型 `auto` 在列表内。运行中观测到 cursor-agent 子进程存活、
  CPU 占用很低（网络等待）。本机 shell 环境带有 `HTTPS_PROXY=http://127.0.0.1:7890`，与既知约束
  “Cursor 经代理时 HTTP/2 keepalive 5 秒硬超时”一致。该路由在公开模板里默认关闭（`features.cursor` 默认 `false`），
  仅在本次验收中打开，因此**不影响本次结论**，但公开模板若要默认提供 cursor 路由，需要先解决这条环境依赖。
  可复核命令：`python <companion>/ptc-multi-agent-control/scripts/acp_smoke.py --route cursor-grok --timeout 45 --retries 0 --json`。
- 本次只验收了 `headless` 模板 profile。未验证 `@deepseek-ai/dsh-web-app` 类 profile 下 D2 是否消失
  （源码上应当消失，但未实测）。
- skill 安装用 `DSH_AGENTS_HOME` 重定向，未在真实 `~/.agents/skills` 上做替换验收（该路径被治理规则保护）。
- 未 commit / push / 打 tag。

## 7. 证据清单

| 文件 | 说明 |
| --- | --- |
| `dump-00-init.yml` | 全新 profile 首次 dump（base + headless） |
| `install-01.log` | `dsh plugin add` 完整输出 |
| `dump-01-bundle.yml` / `.err` | 仅伴生 bundle 的 dump（stderr 空） |
| `dump-02-local-patch.yml` / `.err` | 叠加本地 patch 的 dump（stderr 报 D3） |
| `boot-01.log` | 真实启动，报出 D2 |
| `acp-kimi-docs.json` / `acp-opencode-dsv41.json` | 路由级真实 ACP 会话证据 |
| `dsh-acp-call.log` / `dsh-acp-call-nopatch.log` | DSH 级 ACP 调用的失败/成功对照（D1 隔离证据） |
| `overlay-acp-tools.yml` | 验收用诊断 overlay（非 Git） |

---

## 8. 修复后复验（2026-10-14 同日追加）

本节是 §1-§7 实测缺陷的修复与复验记录。根任务 `task-20261014T054151359614Z-6c7d28538a7f`，
契约哈希 `961c26b87a7547b62a8172488f80bff49bcf31ea278b3e467bcece322cfbf697`。

### 8.1 修复项

| 缺陷 | 修复内容 |
| --- | --- |
| D1（阻断） | `generate-ptc-companion.mjs` 的 `shellCommand()` 不再给可执行名加引号；opencode 行新增整体实参覆盖变量 `PTC_OPENCODE_ACP`（与 cursor 行既有的 `PTC_CURSOR_ACP` 同形），cursor 默认值同样去引号；`companion.patch.yml.example` 同步 |
| D2（阻断） | bundle 新增 env 门控行 `ptc-agent-preset-registry`（`disabled: !!js process['env'].PTC_PROVIDE_PRESET_REGISTRY !== 'on'`，`config.default: ptc-multi-agent`），两份 bundle 副本逐字节一致；前置条件写入生成物的 `companion.manifest.json`/`README.md`/`ptc.env.example`；`delegated-contract.json` 与校验器 `expectedIds` 同步为 13 行 |
| D3 | `PTC_FEATURE_PRESENTATION` 开关下沉到 bundle 内层 preset 的 `tool-presentation` 行（`disabled` 表达式），本地 patch 不再声明顶层 `tool-presentation`；consumption-map 的 `features.presentation` 消费者改指 bundle 内层 |

### 8.2 复验证据

| 项 | 结果 |
| --- | --- |
| D1：固定后的本地 patch + 真实 ACP 调用 | **通过**。`subagent_opencode_dsv41` 返回 `ACP-OK`（修复前同一条链路报 `'"opencode"' is not recognized` / `stage: initialize, category: process-exit`） |
| D3：`--dump-config` 叠加固定后的本地 patch | **通过**，`EXIT=0`，**stderr 为空**（修复前为 `patch: entry "tool-presentation" not found`），dump 中可见 `ptc-agent-preset-registry` 行 |
| D2：门控 ON 启动 | **通过**，不再出现 `1 entry did not activate`；preset 行成功注册 |
| D2：门控 OFF 负向对照 | **符合预期**，仍报 `preset-ptc-multi-agent ... pending (waiting for service: agentPresets)` —— 默认关闭，避免在已有 `dsh-web-app` 的 profile 里出现 `agentPresets` 双提供者 |
| D3 静态核对 | 两份 bundle 副本 SHA256 相同；本地 patch 中 `tool-presentation` 出现次数为 0 |
| 门禁 | `npm test` 68 assertions EXIT=0；`npm run verify` EXIT=0（13 unique rows）；`git diff --check` EXIT=0 |

### 8.3 复验暴露的新事实（重要，必须按此纠正认知）

**headless 一次性运行器在设计上不合成 preset 会话。** `dsh-headless/lib/index.js:222-223`：

~~~text
session "<id>" runs under agent preset "<preset>", which the one-shot runner does not compose
~~~

预设选择由客户端发起（`@deepseek-ai/dsh-client-ui-agent-preset` 通过 `settings.update selectedDefault`
调用注册表的 select，`lib/client.js:1072`）。因此：

- 门控 ON 后 preset **已注册**（不再静默失败），但**一次性 headless 会话仍然只拿到基础 24 个工具**，
  实测工具表不含 `subagent_opencode_dsv41` 等（`re-boot-on.log`）。
- 结论修正：`PTC_PROVIDE_PRESET_REGISTRY=on` 解决的是“无 web app 的 profile 里 preset 永远无法注册/选择”，
  **不是**“让 headless 一次性会话获得 PTC 工具面”。PTC 工具面只能在具备预设选择能力的客户端会话（web/tui）中呈现。
  文档与生成物 README 已按此改写。
- 本节 D1 的端到端证据因此使用与 §3.5(B) 相同的诊断 overlay（把 ACP 工具行暴露到顶层）来隔离“ACP 派发链路”
  本身，这与“preset 是否被合成”是两个正交问题。

**另修一处验证暴露的真实缺陷（非 §4 登记项）**：`acp_smoke.py` 原先只依赖英文报错文本判定 spawn 失败，
在 zh-CN/代码页 936 环境下 cmd 的“命令不存在”提示为本地化中文，导致 spawn 被误判为 `initialize`。
已改为起进程前用 `shutil.which()` 做与语言无关的 SPAWN 预检；`python -B test_acp_smoke.py` 18 项通过。

### 8.4 复验后的限制

- 上述修复**尚未**在 `dsh-web-app` 类 profile 中复验（源码上 D2 门控默认关闭即安全，但未实测）。
- `cursor-grok` 路由在本机仍不可用（transport 不收敛，见 §6），与本次修复无关；修复后的 cursor args 仅做了静态核对。
- 生成物 `companion.manifest.json` 的 `clean_profile_verified` 仍为 `false`：本次复验覆盖了 D1/D2/D3 的判定链路，
  但“在预设被合成的客户端会话中跑完整 PTC 流程”尚未执行。
