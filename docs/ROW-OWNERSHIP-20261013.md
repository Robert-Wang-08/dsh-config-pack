# DSH 配置行归属对照表（2026-10-13）

> 由脚本扫描三类声明源生成（顶层 patch 行与 insert 块内行分别统计；bundle 路径用真实 profile 的 package.json 解析）。可复现，非手工整理。

## 1. 机制前提（已实测）

- **profile patch 是最后一层**；同 id **后写胜**，先写的那份**静默失效**，不报错、不警告。
- 活体 `dsh --profile web --dump-config`：顶层 `- id:` 共 **207 个，零重复** —— 所有两处声明都以「后写胜」消解，**败方是死码**。
- `node scripts/verify.mjs` 输出：`OK — 17 owned id(s) declared exactly once, !!js scalars well-formed`，exit 0。
  **范围仅限包内自洽** —— 它不检查目标 profile 是否遮蔽本包。所以「verify 通过」不等于「装上有效」。

## 2. 各声明源的规模

| 源 | 类型 | 顶层 patch 行 | insert 行 | 合计 |
|---|---|---|---|---|
| `web-profile-patch` | profile | 10 | 43 | 53 |
| `dsh-config-pack` | git | 7 | 44 | 51 |
| `bundle:dsh-subagent-claude-code` | bundle | 0 | 1 | 1 |
| `bundle:dsh-subagent-codex` | bundle | 0 | 1 | 1 |
| `bundle:dsh-chat-import` | bundle | 0 | 1 | 1 |
| `bundle:dsh-archived-sessions` | bundle | 0 | 1 | 1 |
| `bundle:dsh-plugin-sidebar-visibility` | bundle | 0 | 1 | 1 |
| `bundle:dsh-notify-bell` | bundle | 0 | 1 | 1 |
| `bundle:dsh-mermaid-smooth` | bundle | 0 | 1 | 1 |
| `bundle:dsh-deepseek-keypool` | bundle | 0 | 1 | 1 |
| `bundle:dsh-plugin-provider-badge` | bundle | 0 | 1 | 1 |
| `bundle:dsh-ptc-multi-agent-mode` | bundle | 0 | 43 | 43 |
| `bundle:dsh-preset-failover-tiers` | bundle | 1 | 0 | 1 |

## 3. 冲突行：被多个源声明（共 51 行）

| 行 id | 声明源 |
|---|---|
| `agent-default-model` | web-profile-patch [patch-row] + dsh-config-pack [patch-row] |
| `agent-instructions` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `agent-preset-registry` | web-profile-patch [patch-row] + dsh-config-pack [patch-row] |
| `command-compact` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `command-goal` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `compaction` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `compaction-basic` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `delegation` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `directory-picker` | web-profile-patch [patch-row] + dsh-config-pack [patch-row] |
| `directory-picker-browse` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `dsh-deepseek-keypool` | bundle:dsh-deepseek-keypool [insert-row] + bundle:dsh-preset-failover-tiers [patch-row] |
| `llm-pi-ai` | web-profile-patch [patch-row] + dsh-config-pack [patch-row] |
| `mcp-codegraph` | web-profile-patch [patch-row] + web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `mcp-slide` | web-profile-patch [patch-row] + web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `mcp-tencent-docs` | web-profile-patch [patch-row] + web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `mcp-ticktick` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `persona` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `plan-mode` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `planning` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `present` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `preset-standard-codex` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `skill-filesystem` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `subagent-acp-kimi` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `subagent-acp-opencode` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `subagent-claude-code` | web-profile-patch [patch-row] + dsh-config-pack [patch-row] + bundle:dsh-subagent-claude-code [insert-row] |
| `subagent-codex` | web-profile-patch [patch-row] + dsh-config-pack [patch-row] + bundle:dsh-subagent-codex [insert-row] |
| `tool-ask-user` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-bash` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-fs` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-fs-search` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-goal` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-jobs` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-plugin-manager` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-pwsh` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-ralph` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-result-pruner` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-skill` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-subagent` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-subagent-claude-code` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `tool-subagent-codex` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-subagent-control` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-subagent-fork` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-subagent-kimi` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `tool-subagent-list-agents` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-subagent-opencode` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `tool-todo` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-web` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `tool-workflow` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |
| `ui-directory-picker-browse` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] |
| `ui-settings-general` | web-profile-patch [patch-row] + dsh-config-pack [patch-row] |
| `workflow-ptc` | web-profile-patch [insert-row] + dsh-config-pack [insert-row] + bundle:dsh-ptc-multi-agent-mode [insert-row] |

## 4. 各源的独有贡献

**`dsh-config-pack` 独有的行：** `subagent-acp-cursor`

**`bundle:dsh-ptc-multi-agent-mode` 独有（12 行，该 bundle 真正起作用的部分）：**

- `preset-ptc-multi-agent`
- `subagent-acp-cursor-grok`
- `subagent-acp-kimi-docs`
- `subagent-acp-opencode-dsv41`
- `subagent-claude-opus48-plan`
- `subagent-claude-opus5-plan`
- `tool-presentation`
- `tool-subagent-claude-opus48-plan`
- `tool-subagent-claude-opus5-plan`
- `tool-subagent-cursor-grok`
- `tool-subagent-kimi-docs`
- `tool-subagent-opencode-dsv41`

**profile patch 独有的顶层行（0）：** （无）

**profile patch 独有的 insert 行（0）：** （无）

## 5. 按新政策的逐行裁定

政策：**Git 出包**（通用 DSH 配置 + 个性化文件模板）；**SkillHub 只留**内部 skill 与含隐私的单个配置文件（目录、key 指针、环境变量）。

| 行 id | 现声明源 | 裁定 | 理由 |
|---|---|---|---|
| `agent-default-model` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `agent-instructions` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `agent-preset-registry` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `command-compact` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `command-goal` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `compaction` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `compaction-basic` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `delegation` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `directory-picker` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `directory-picker-browse` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `dsh-archived-sessions` | bundle:dsh-archived-sessions | 归 bundle:dsh-archived-sessions | 单一声明者 |
| `dsh-deepseek-keypool` | bundle:dsh-deepseek-keypool, bundle:dsh-preset-failover-tiers | 保持现状 | insert 建行 + patch 覆盖行，设计如此 |
| `dsh-mermaid-smooth` | bundle:dsh-mermaid-smooth | 归 bundle:dsh-mermaid-smooth | 单一声明者 |
| `import-claude` | bundle:dsh-chat-import | 归 bundle:dsh-chat-import | 单一声明者 |
| `llm-pi-ai` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `mcp-codegraph` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `mcp-slide` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `mcp-tencent-docs` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `mcp-ticktick` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `notify-bell` | bundle:dsh-notify-bell | 归 bundle:dsh-notify-bell | 单一声明者 |
| `persona` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `plan-mode` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `planning` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `present` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `preset-ptc-multi-agent` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `preset-standard-codex` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `provider-badge` | bundle:dsh-plugin-provider-badge | 归 bundle:dsh-plugin-provider-badge | 单一声明者 |
| `sidebar-visibility` | bundle:dsh-plugin-sidebar-visibility | 归 bundle:dsh-plugin-sidebar-visibility | 单一声明者 |
| `skill-filesystem` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `subagent-acp-cursor` | dsh-config-pack | 归 git 包 | pack 已声明 |
| `subagent-acp-cursor-grok` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest `delegated` 已登记；verify 禁止本包再声明 |
| `subagent-acp-kimi` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明（与 PTC 的 kimi-docs 不同 id） |
| `subagent-acp-kimi-docs` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest `delegated` 已登记；verify 禁止本包再声明 |
| `subagent-acp-opencode` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明（与 PTC 的 opencode-dsv41 不同 id） |
| `subagent-acp-opencode-dsv41` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest `delegated` 已登记；verify 禁止本包再声明 |
| `subagent-claude-code` | bundle:dsh-subagent-claude-code, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `subagent-claude-opus48-plan` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `subagent-claude-opus5-plan` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `subagent-codex` | bundle:dsh-subagent-codex, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-ask-user` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-bash` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-fs` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-fs-search` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-goal` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-jobs` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-plugin-manager` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-presentation` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `tool-pwsh` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-ralph` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-result-pruner` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-skill` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-claude-code` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-claude-opus48-plan` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `tool-subagent-claude-opus5-plan` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `tool-subagent-codex` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-control` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-cursor-grok` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `tool-subagent-fork` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-kimi` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-kimi-docs` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `tool-subagent-list-agents` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-opencode` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-subagent-opencode-dsv41` | bundle:dsh-ptc-multi-agent-mode | 归 PTC bundle | pack.manifest delegated 已登记为委托 |
| `tool-todo` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-web` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `tool-workflow` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `ui-directory-picker-browse` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `ui-settings-general` | dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |
| `workflow-ptc` | bundle:dsh-ptc-multi-agent-mode, dsh-config-pack, web-profile-patch | 归 git 包 | pack 已声明 |

## 6. 这三条结论决定了迁移怎么做

1. **profile patch 是当前唯一真正生效的层** —— 它最后写入，所以 51 行冲突全部由它胜出。
2. **但 profile patch 的 53 行里，没有一行是独有的**（顶层 10 行 + insert 43 行，全部同时被 `dsh-config-pack` 或某个 bundle 声明）。
   也就是说：**结构上它是冗余的**，只是靠「最后写入」在生效。这正是 Git 出包可行的前提 —— 不必发明新机制，只要让它把位置让出来。
3. **`dsh-config-pack` 的 51 行里，50 行与 profile patch 重合**；唯一独有的是 insert 行 `subagent-acp-cursor`。
   所以**今天把 pack 装进 web profile 不会改变任何一行**（除新增 ACP cursor 子代理外），因为 profile patch 会全部覆盖它 —— 而且不报错。

## 7. 迁移动作清单（按裁定结果执行，尚未执行）

| # | 动作 | 前置 | 风险 |
|---|---|---|---|
| 1 | **把 bundle 源搬出被 gitignore 的 `store/installed/`**（`failover-tiers` 现居 `skillhub/.gitignore:31` 之下，profile 用 `link:` 指进去） | 定一个 git 仓库作为 bundle 宿主 | 低（纯搬移） |
| 2 | **profile patch 让出 `dsh-config-pack` 的 `owns` 17 行** | 先逐行对比 pack 与 profile 的同 id 内容，确认 pack 版本不弱于现状 | **中** —— 内容若不同，行为会变 |
| 3 | **个性化值迁出 profile，改为模板 + 实际文件** | 见第 8 节 | 中 |
| 4 | 把 `ptc-multi-agent-control` 的 12 行独有内容留在其 dsh-bundle（`pack.manifest.yaml` 的 `delegated` 已如此登记） | —— | 低 |
| 5 | SkillHub 侧收敛为：内部 skill + 隐私单文件 | —— | 低 |

**执行顺序建议：第 2 条之前必须先做逐行内容 diff。** 行归属只说明「谁声明」，不说明「内容是否等价」。**同 id 内容 diff 已完成（见第 9 节）**；live profile 让出 owns 行仍待单独授权执行。

## 8. 个性化文件模板机制（设计）

**这个机制其实已经存在，只是没被如此命名。** `pack.manifest.yaml` 里的 `switches` / `requires_env` / `requires_cli` / `never_sync` 四张表，加 `config/*.yml` 里的 `!!js` 表达式，就是「模板 + 运行时替换」：

| pack 里（进 git，无隐私） | 设备上（不进 git，含隐私） |
|---|---|
| `switches`：开关名与默认值（`DSHPACK_ACP_OPENCODE` 等 7 个） | 实际环境变量值 |
| `requires_env`：变量名 + 用途（`CRS_OAI_KEY` 等 8 个，**只登记名字**） | 变量实际值（OS 环境） |
| `requires_cli`：命令 + 探测方式 + 登录态说明 | 各 CLI 的实际登录态 |
| `never_sync`：绝不跨设备复制的路径（`.credentials.yaml`、`sessions`） | 那些文件本身 |
| `config/*.yml` 用 `!!js` 读环境变量并给默认值 | 覆盖用的真实值 |

对应到你说的三类隐私单文件：

- **目录**：`DSHPACK_NODE`、`DSHPACK_TICKTICK_ENTRY`，以及 profile `package.json` 里的 `link:` 路径 → pack 只出**变量名与占位模板**，真实路径由 SkillHub 管的单文件或本机环境提供。
- **key 指针**：`CRS_OAI_KEY`、`AIS_2DSGLM_API_KEY`、`CLAUDE_RELAY_TOKEN`、`LLMKEY_KIMI`、`OPENCODE_API_KEY` → **指针名进 git，值永不进**。
- **环境变量**：同上，pack 声明 `switches` 默认值，实际值留在设备上。

**唯一需要新做的**：给「真实值」定义一个 SkillHub 管的载体（对标 `dsh-profile-defaults.yaml` 那种只登记名字与用途、绝不含值的单文件），并让 pack 的模板在缺失时**明确报错**，而不是静默用默认值 —— 否则又回到「静默降级」那类问题上。

## 9. 内容 diff 结论（2026-10-13，`scripts/compare-profile.mjs`）

同 id 对照 `D:\src\dsh\dsh-config-pack\cordis.patch.yml` ↔ `~/.dsh/profiles/web/cordis.patch.yml`：

| 类别 | 行 id | 结论 |
|---|---|---|
| 已模板化 | `mcp-*` / `agent-default-model` / `llm-pi-ai` / `ui-settings-general` / `agent-preset-registry` | pack 用 `!!js`+环境变量；profile 多为字面量或本机路径 → **以 pack 为权威，个性化留在设备 env** |
| 等价 | `subagent-claude-code` / `subagent-codex` / `directory-picker*` / `preset-standard-codex` | 结构与关键值一致 |
| 设备偏好（勿回写 pack） | `agent-default-model` 的 profile 值 `opencode-go` / `deepseek-v4-flash-vision-exp` | 属本机偏好；pack 默认 `codex-relay` / `gpt-6.1-sol`，用 `DSHPACK_DEFAULT_*` 覆盖 |
| 设备路径（勿回写 pack） | `mcp-ticktick` 的 node 解释器绝对路径 / 入口脚本绝对路径 | 只通过 `DSHPACK_NODE` / `DSHPACK_TICKTICK_ENTRY`（本机具体值属私有，记在 SkillHub 的 `dsh-preset-pack` skill） |
| pack 独有 | `subagent-acp-cursor` | 保留 |
| profile 有、pack 无（不同 id） | `subagent-acp-opencode` / `subagent-acp-kimi` 在两侧同名；PTC 的 `*-dsv41/docs/grok` 不在 pack | 归属边界已用 `delegated` 钉死 |

## 10. 未核与限制

- `verify.mjs` 现检查：owns 唯一、`delegated` 不落包、`!!js` 合法、可选 profile 遮蔽、可选 `--composed` provider 完整性。
- 我**没有**向任何 profile 安装过 `dsh-config-pack`；迁移动作清单第 2 条（profile 让出 owns 行）仍未在 live profile 上执行（本任务禁止改 web profile）。
