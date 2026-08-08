# 开发规范

本项目同时发布 CLI 和 Raycast 扩展，扩展要提交到 [raycast/extensions](https://github.com/raycast/extensions) 官方仓库。下面的约定一部分是 Raycast Store 的硬性要求，一部分是为了让两个发行版不产生分歧。

## 分层与单一真源

```
src/core/        唯一真源：纯逻辑，不含任何面向用户的文案
bin/tidy.js      CLI 适配层：终端文案与交互
raycast/src/     Raycast 适配层：表单与列表 UI
raycast/src/core 生成物，由 scripts/sync.js 从 src/core 原样复制
raycast/tests    生成物，由 scripts/sync.js 从 test/ 原样复制
test/            核心逻辑测试（node:test）
```

三条不可破的约定：

1. **core 不说话。** 它只返回数据，出错时抛带 `code` 的错误（`CONFIG_PARSE`、`INVALID_SEGMENT`、`TIDY_DIR_ESCAPES`、`EXDEV_VERIFY`、`MANIFEST_CORRUPT`），措辞归适配层。文案只有两处：CLI 的 `formatError`（`bin/tidy.js`）和扩展的 `describeError`（`raycast/src/errors.ts`）。**新增错误码时两处都要补**，否则 core 的原始英文会直接漏给用户。core 里任何 `throw` 都必须带 `code`，裸 `new Error` 等于绕过这条约定。
2. **`plan.js` 是唯一决定文件去向的地方。** 不要在别处拼目标路径。新增检测请加进 `analyze.js` 的编排，以 Map 形式喂给 `buildPlan`。
   - 与之配套：**判断路径是否在某个目录内，必须先 `canonicalPath` 两端**（`isInsideDir` 的注释写着这条前提）。只比较字符串会被中间某段的符号链接绕过——`undo.js` 曾经栽在这里。`.tidy` 下的任何路径一律走 `tidyPath()`，不要自己 `path.join(destDir, ".tidy", …)`。
3. **生成物不手改。** `raycast/src/core/` 和 `raycast/tests/` 改了也会被下一次 sync 覆盖，`pnpm test` 会检出漂移并失败。

## 语言约定

**一切代码与运行时输出用英文，只有根目录的项目文档用中文。**

| 位置                                       | 语言 |
| ------------------------------------------ | ---- |
| 代码注释、标识符、测试描述                 | 英文 |
| commit message                             | 英文 |
| 运行时输出：CLI 提示、Raycast UI、脚本 log | 英文 |
| 根目录 README / CHANGELOG / CONTRIBUTING   | 中文 |

依据是 Raycast [官方要求](https://developers.raycast.com/basics/prepare-an-extension-for-store)：

> At the moment, Raycast doesn't support localization and only supports US English. Therefore, please avoid introducing your custom way to localize your extension.

没有 i18n 机制，且明确劝阻自建本地化方案，还要求**美式**拼写。CLI 虽然不进 Store，但仓库公开、`bin` 可全局安装，跟着一起用英文。

唯一的例外是**匹配规则里的中文**——`config.js` 的二级分类正则、`similar.js` 的副本标记、`dedup.js` 的 `副本`/`拷贝`。那是识别中文文件名的功能数据，不是文案，删了中文文件就认不出来。

注释写**为什么**，不写**做了什么**——后者代码本身已经说清楚了。约束、边界条件、反直觉的取舍值得写；逐行复述逻辑不值得。

## Commit 规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)，英文，与 Raycast 官方仓库一致。

```
<type>(<scope>): <subject>
```

- **type**：`feat` | `fix` | `refactor` | `perf` | `docs` | `test` | `build` | `chore`
- **scope**：`core` | `cli` | `raycast` | `sync` | `docs`，跨层改动可省略
- **subject**：祈使句、小写开头、结尾不加句号，控制在 72 字符内

正文说明动机与取舍，而不是复述 diff。破坏性变更在正文加 `BREAKING CHANGE:` 段落。

```
fix(core): keep destination folders that predate the run

Undo derived the folders to remove by walking up from each move target,
so a category folder the user had created themselves was deleted once the
run's files moved back out of it. The manifest now records the folders the
run actually created, and undo only removes those.
```

## 测试

```bash
pnpm test        # 跑测试 + 校验 raycast 副本未漂移
```

改动 `src/core/` 必须有对应测试。**测试描述和注释用英文**——`test/` 会同步进 `raycast/tests/` 提交到官方仓库，别人排查失败时要看得懂。中文只出现在测试数据里（中文文件名、中文分类正则），那是被测行为的一部分。

涉及文件移动的测试一律在 `os.tmpdir()` 下建临时目录，用完删干净。

### CI

`.github/workflows/ci.yml` 在推 `main` 和开 PR 时跑三个 job：

| job       | 内容                                                 | 为什么                                                                                                                                              |
| --------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`    | 测试 + `sync --check`，Node 20.12 / 22 / 24 三个版本 | 20.12 是 `engines` 下限（CLI 用的 `node:util` `styleText` 是那时加的）。`sync --check` 一并在这里跑，**改了 `src/core/` 忘记 `pnpm sync` 会被拦下** |
| `format`  | `pnpm format:check`                                  | 保证仓库始终是 Prettier 格式，避免格式改动混进功能 diff                                                                                             |
| `raycast` | `raycast/` 下 `npm ci` + `npm run lint`              | 跟 Store 提交时跑的是同一个 `ray lint`，让 lint 失败止步于本仓库，不流到 fork                                                                       |

`raycast` job 用 npm 而不是 pnpm——扩展目录自包含、有自己的 `package-lock.json`，Store CI 也只认 npm。

`test` job 里**装依赖和跑测试用的是两个不同的 Node**：依赖固定在 Node 22 上装，之后才切到被测版本、直接用 `node --test` 跑。原因是 **pnpm 11 自己要求 Node ≥ 22.13**（它 import 了 `node:sqlite`），在 20.12 上连 `pnpm install` 都跑不起来——照着「一个 Node 版本从头跑到尾」写，下限那档会挂在包管理器上，而不是在被测代码上。依赖全是纯 JS，没有需要重编译的原生模块，所以切换 Node 后照常可用。同理，这一档不能走 `pnpm test`，否则 pnpm 又挡在中间。

## 提交到 Raycast Store

### 流程

```bash
pnpm test                                     # 必须全绿

FORK=~/.config/raycast/public-extensions-fork
git -C $FORK checkout main
git -C $FORK checkout -b ext/file-tidy-<主题>       # 先开分支，再往里 sync
git -C $FORK sparse-checkout add extensions/file-tidy   # 见下方「坑一」

pnpm sync:fork                                # raycast/ → fork 的 extensions/file-tidy/
cd raycast && npm run lint && npm run build   # 必须全绿；在主仓库跑，见下方「坑二」

git -C $FORK add extensions/file-tidy
git -C $FORK commit && git -C $FORK push -u origin ext/file-tidy-<主题>
gh pr create --repo raycast/extensions --base main --head fanhefeng:ext/file-tidy-<主题>
```

fork 是 `fanhefeng/extensions`。**每次提交都新开一个分支**，命名 `ext/file-tidy-<主题>`，合并后 Raycast 会自动删掉它——所以不存在一个长期复用的分支，上面的 `git push` 是往当次那个分支推。已合并的两次：`ext/file-tidy`（#29437，首次上架）、`ext/file-tidy-smart-checks`（#29952，两级归档 + 检测流水线）。

建 PR 用 `gh`，不要用 GitHub MCP：那边的 PAT 对 `raycast/extensions` 没有写权限，会 403。

### fork checkout 的两个坑

`~/.config/raycast/public-extensions-fork` 是个 **sparse-checkout + `blob:none` 部分克隆**的 raycast/extensions（整仓太大，不这样搞没法用）。这带来两个必踩的坑：

**坑一：sparse-checkout 是按扩展圈定的，换扩展干活前必须先把目录加进去。**

做完另一个扩展后，sparse 范围里可能只剩那个扩展。此时 `git add extensions/file-tidy` 会拒绝**新增**文件：

```
The following paths ... exist outside of your sparse-checkout definition,
so will not be updated in the index: extensions/file-tidy/src/core/date.d.ts
```

危险的地方在于**它只报新文件**——已存在的文件因为磁盘上有内容，照常显示为 `M`，看着一切正常。不留神就会提交一个漏掉新文件的分支，而且 lint 和 build 都在主仓库跑，发现不了。

`sparse-checkout add` 之后 git 会按 HEAD 检出该目录，**可能覆盖刚 sync 过去的内容，所以要重新 `pnpm sync:fork` 一次**。上面的流程把 `sparse-checkout add` 放在 sync 之前就是为了这个。

**坑二：fork 里没有 `node_modules`，`ray` 命令不存在。**

`npm --prefix extensions/file-tidy run lint` 在 fork 里跑会直接 `sh: ray: command not found`。lint 和 build 都在**主仓库 `raycast/`** 跑——`sync:fork` 之后两边逐字节一致，等价。真要在 fork 里跑就得先 `npm install`，没必要。

### Store 规范要点

这些是踩过的坑，提交前逐条对照：

- **扩展目录必须自包含。** 不能 import `extensions/file-tidy/` 之外的任何文件——`raycast/src/core/` 这份复制就是为此存在的。
- **标题用 Title Case**：命令 title、Action title、`navigationTitle` 都是（`Tidy Plan (12 Files)`，不是 `Tidy plan (12 files)`）。
- **subtitle 首字母大写**（`Identical to photo.jpg`）。
- **内置 Action 不要自定义 title**，如 `Action.ShowInFinder` 用默认标题。
- **`CHANGELOG.md` 只增不改**：新版本条目加在最上面，日期写 `{PR_MERGE_DATE}` 占位符，合并时由机器人替换成真实日期。**已发布条目的内容和日期都不能再动。**
- **`package.json` 按 Prettier 格式化**（数组每项一行），并且没有 `version` 字段——扩展版本由 Store 管理。
- **截图放 `metadata/`**，合并时机器人会做无损压缩；压缩后的版本要拉回本仓库，否则下次提交会把未压缩的推回去。
- **`README.md` 是 Store 展示页**，功能变了必须同步改——它不会自动跟着代码走。

### 上游改动要拉回来

维护者和机器人会直接往 PR 分支推提交（代码加固、CHANGELOG 定稿、图片压缩）。因为 `sync:fork` 是整目录覆盖，这些改动如果不拉回本仓库，下次提交就会把它们抹掉。合并后检查：

```bash
gh api repos/raycast/extensions/pulls/<PR>/commits --jq '.[] | "\(.author.login) \(.commit.message)"'
```

不是自己的提交就逐个看 diff，判断属于哪一类：

- **缺陷或安全修复** → 回到 `src/core/` 修，别只改 `raycast/` 那份复制。同时想一遍同样的问题在 CLI 侧存不存在。
- **Store 规范适配** → 照做，并补进上面的规范要点。
- **针对扩展的死代码清理** → 先确认 CLI 是否还在用。`src/core` 是两端共用的，对扩展无用的导出对 CLI 未必无用。

## 发版

1. 更新 `package.json` 的 `version`（语义化版本）
2. 在 `CHANGELOG.md` 顶部加版本条目，写清行为变化与迁移影响
3. `raycast/CHANGELOG.md` 单独加一条，只写面向扩展用户的变化
4. commit：`chore(release): 0.6.0`
