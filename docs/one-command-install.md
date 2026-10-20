# 单命令安装、组合锁与组件验证器

本包是**唯一公开发布入口**：使用者只装本包，本包再把各组件钉死到各自仓库的不可变 tag 上。
本文说明这条路径怎么用、一致性由什么强制、以及哪些步骤**任何包都替代不了**。

## 1. 一条命令

```powershell
pwsh scripts/install.ps1 -ProfileName <profile>
# 默认 Source = github:Robert-Wang-08/dsh-config-pack#v0.9.0
```

`install.ps1` 会依次：

1. profile 不存在时，按发行模板（默认 `@web`@）创建一个；
2. 在该 profile 的 `pnpm-workspace.yaml` 里写好好装本包必需的前置
   （`blockExoticSubdeps: false`、`nodeLinker: hoisted`、`allowBuilds`），由
   `scripts/prepare-profile.mjs` 完成，**只改 pnpm 配置，不碰 `cordis.patch.yml`**；
3. 调**一次** `dsh plugin --profile <p> add <spec>` —— 装包与把 bundle 注册进
   `dsh.profile.bundles` 都由 DSH 自己完成；
4. 失败时按 pnpm 错误码做**有界**自愈后重试（最多 3 次），而不是让人工改配置重来；
5. 跑 `scripts/verify-install.mjs --profile <p>` —— **安装后偏差比较**：期望集（核心依赖 +
   可选三方组，来自 `package.json` 与 `assets/optional-components.json`）逐项对照实装
   （版本、bundle 登记、入口文件），并聚合三项只读配置检查：`verify.mjs --profile`
   （shadowing）、`--dump-config` → `verify.mjs --composed`（dangling）、
   `compare-profile.mjs`（pack 补丁 vs profile 补丁逐行归类）；
   可选 `--baseline <观察基线.json>` 对拍另一台设备的观察快照（含采样文件 SHA256）；
6. **默认补装可选三方插件组**发生在第 4 与第 5 步之间：`assets/optional-components.json`
   （`dsh-recent-sessions`、`dshmarket`、`dsh-plugin-subagent-director`、`dsh-palette`，逐个
   `dsh plugin add`，失败不阻塞）；加 `-SkipOptional` 整组跳过——注意升级时跳过会让已装件被依赖变更移除。

### 为什么必须先写前置再 add（实测结论）

**第一次 `add` 失败后直接重试，包会"装上了但整包不生效"。** 依赖其实已经落盘，DSH 不会为
已存在的依赖重新登记 `dsh.profile.bundles`，于是 patch 层根本不参与组合。
判据是 stderr 里**既没有** `did not activate`、**也没有** `patch: entry ... not found`，
而且 `dsh.profile.bundles` 里确实出现了 `dsh-config-pack`。

## 2. 组合锁

`pack.manifest.yaml` 的 `components:` 是 release train 的**唯一事实源**，逐项登记：

| 字段 | 含义 |
|---|---|
| `id` | 组件标识 |
| `package` | 依赖名，必须与 `package.json` 的依赖键一致 |
| `repo` | 公开仓库 URL |
| `tag` | 不可变 annotated tag |
| `commit` | **该 tag 解引用后的 commit SHA** |
| `installable` | 能否作为 `dsh plugin` 依赖安装；为 `false` 必须写 `why` |
| `optional` | 可选三方组标记；为 `true` 时允许不出现在 `package.json` 依赖里（由 `install.ps1` 默认补装、`-SkipOptional` 跳过），锁的 tag→commit 校验照常执行 |

**只钉 tag 名不算强制一致。** tag 是可以被移动、删除后重建的，而 pnpm 在**安装时**才解析 git
spec —— 一个被移动的 tag 会把不同的代码静默发给所有使用者。记录并复核解引用后的 commit，
才把"我们钉了版本"变成**被强制的不变量**。

## 3. 组件验证器

```powershell
node scripts/verify-components.mjs             # 完整检查（需要网络）
node scripts/verify-components.mjs --offline   # 只做锁与 package.json 的交叉校验
node scripts/verify-components.mjs --json
```

对每个组件检查三项：

1. 仓库**可匿名读取**（私有或不存在会让所有公开安装失败）；
2. 钉的 tag **确实存在**；
3. tag 解析出的 commit **等于**锁里记录的 commit。

再对 `package.json` 做交叉校验：git 依赖必须全部登记在锁里、必须钉 tag、pin 与锁必须一致、
repo URL 必须一致。**任一不符即非零退出**。

传输类失败有界重试（3 次）；凭据提示或 404 属确定性失败，**立即返回不重试**，
避免私有仓库把 CI 拖成超时。

### 已实测的失败模式

| 注入的问题 | 结果 |
|---|---|
| 锁里的 SHA 与 tag 实际指向不一致 | `EXIT=1`：`tag v0.4.1 now resolves to ca08ed9... but the lock records 1111... - the tag was moved or deleted and recreated` |
| 依赖去掉 `#tag` | `EXIT=1`：`is not pinned to a tag` |
| pin 的 tag 与锁不一致 | `EXIT=1`：`pins #v0.0.9 but the lock says #v0.1.0` |
| 仓库匿名不可读 | `EXIT=1`：`repository is not readable anonymously`（不触发重试挂起） |

## 4. 强制点在哪里

- `npm run verify` 内含 `verify-components.mjs --offline`，因此在**无网络**时也能抓出锁与依赖不一致；
- `.github/workflows/verify-components.yml` 在 **push / PR** 上跑完整校验，并另有**每周定时**任务
  —— 因为 tag 可以在上游被任意移动，没有定时复核就没人会发现。

## 5. 发布列车顺序

固定顺序，不得跳步：

1. 在组件仓库打不可变 annotated tag；
2. 更新本包的 `components:` 锁与 `package.json` 的 pin；
3. 跑 `node scripts/verify-components.mjs`（必须通过）；
4. 在本包打 tag 并推送。

使用者只钉**本包**的 tag。回滚 = 装回上一个本包 tag，它自然指向上一组组件 tag，
因此回滚是**一次原子动作**，不需要逐个降级组件。

## 6. 任何包都替代不了的步骤

### `dsh-permission-compat`（带外，不在单命令路径内）

它是**宿主补丁工具**：直接改写已安装的 dsh 模块（`dsh-sandbox`、`dsh-tool-pwsh`、
`dsh-tool-bash`、`dsh-tool-fs`），因此**不能**作为 `dsh plugin` 依赖安装。
锁里登记为 `installable: false`，验证器仍会校验它的 tag 与匿名可读性。

```powershell
git clone https://github.com/Robert-Wang-08/dsh-permission-compat.git
cd dsh-permission-compat
node tools/apply-dsh-permission-compat.mjs             # 打补丁（带 .bak 备份）
node tools/verify-dsh-permission-compat.mjs            # 校验
node tools/apply-dsh-permission-compat.mjs --revert    # 回滚
```

### 逐台设置的部分

凭据、CLI 登录态与设备路径**永远不进 Git**，由 `pack.manifest.yaml` 的
`requires_env` / `requires_cli` 自描述。`install.ps1` 结束时会打印本机缺失项清单。

## 7. 判据速查

| 想知道 | 用哪个判据 |
|---|---|
| 包是否真的激活 | **真实启动一次**。`--dump-config` 既不求值 `!!js`、也不报告 `did not activate` |
| bundle 是否登记 | `dsh.profile.bundles` 含 `dsh-config-pack` |
| 版本是否被遮蔽 | `node scripts/verify.mjs --profile <p>` |
| 装完是否有偏差 | `node scripts/verify-install.mjs --profile <p>`（可加 `--baseline`） |
| 组件是否一致 | `node scripts/verify-components.mjs` |
