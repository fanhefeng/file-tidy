# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# file-tidy

CLI + Raycast 扩展，共用 `src/core`。扩展已上架 Raycast Store，提交走 fork（`fanhefeng/extensions`），每次提交新开一个 `ext/file-tidy-*` 分支，合并后由 Raycast 自动删除。

**动手前先读 [CONTRIBUTING.md](CONTRIBUTING.md)** —— 分层约定、语言约定、commit 规范、Store 提交流程与检查清单都在那里。

## 常用命令

根目录用 pnpm，`raycast/` 目录用 npm（有自己的 `package-lock.json`）。Node >= 20.12。

```bash
pnpm test            # 全部测试 + 校验 raycast 副本未漂移（改完必跑）
node --test test/core.test.js                        # 只跑一个测试文件
node --test --test-name-pattern="undo" test/*.js     # 按名字过滤单个测试
pnpm sync            # src/core → raycast/src/core，test/ → raycast/tests
pnpm sync:fork       # 再把 raycast/ 镜像到 Store fork（提交 PR 用）
pnpm format          # prettier --write
```

```bash
cd raycast && npm run dev     # ray develop 实时调试扩展
cd raycast && npm run lint    # ray lint，Store 提交前必须全绿
```

测试分工：`test/core.test.js` 覆盖归档/去重/移动/撤销，`test/smart.test.js` 覆盖检测流水线（health/similar/phash/analyze）。

## 架构

一份纯逻辑 core，两个适配层：

- `src/core/` —— 唯一真源，纯 ESM JS，配手写 `.d.ts`。**改 core 导出签名时要同步改对应 `.d.ts`**。
- `bin/tidy.js` —— CLI 适配层：终端文案、参数解析、系统文件夹选择框。
- `raycast/src/*.tsx` —— Raycast 适配层：表单与列表 UI。
- `raycast/src/core/` 和 `raycast/tests/` 是 `scripts/sync.js` 的生成物，**改了会被覆盖**，且 `pnpm test` 会检出漂移并失败。要改就改 `src/core/` 和 `test/`，然后 `pnpm sync`。

两端共用 `analyze.js` 这一个流水线入口，保证检测步骤与顺序不分叉：

```
scan → health（先于 dedup：坏文件不参与去重）→ dedup（字节级：大小 → 头尾哈希 → SHA-256）
     → similar（文件名启发式，只标注）→ perceptual（图片感知哈希，缓存在 .tidy/，只标注）
     → buildPlan
```

关键约定：

- **只有 `plan.js` 决定文件去向**，别处不要拼目标路径。新检测加进 `analyze.js` 编排，以 Map 喂给 `buildPlan`。
- `execute.js` 执行移动并把运行清单写进目标目录 `.tidy/runs/`，`undo.js` 靠它撤销。它还在有标注时追加 `.tidy/similar.md`——`similar`/`perceptual` 不改去向，报告是这层分组关系唯一活过本次运行的地方。**报告里的 peers 必须重映射到移动后的落点**（记录时是移动前的路径，跟 `keeperPath` 同一类问题），文案照例归适配层的 `formatSimilarBlock`。
- 判断路径包含关系必须先对两端 `canonicalPath`（字符串比较会被符号链接绕过，`undo.js` 栽过）；`.tidy` 下的路径一律走 `tidyPath()`，不要自己 `path.join`。
- **core 不写面向用户的文案**，只抛带 `code` 的错误（`CONFIG_PARSE`、`INVALID_SEGMENT`、`TIDY_DIR_ESCAPES`、`EXDEV_VERIFY`、`MANIFEST_CORRUPT`）。文案只在两处：CLI 的 `formatError`（`bin/tidy.js`）和扩展的 `describeError`（`raycast/src/errors.ts`）。**新增错误码两边都要补**，否则 core 的原始英文会漏给用户。
- CLI 和扩展读同一份配置：`~/.config/tidy/config.json`（Windows 是 `%APPDATA%\tidy\config.json`），逻辑在 `config.js`。

## 语言约定

**代码、注释、测试描述、commit message、运行时输出一律英文**（Raycast 不支持 i18n，只收 US English）。中文只出现在根目录文档，以及识别中文文件名的匹配规则里（`config.js` 二级分类正则、`similar.js`/`dedup.js` 的副本/拷贝标记——那是功能数据，不是文案）。跟用户交流仍用中文。

## 测试约定

- 用 node:test，无测试框架依赖。改 `src/core/` 必须有对应测试。
- 涉及文件移动的测试在 `os.tmpdir()` 下建临时目录，用完删干净。

## Commit

Conventional Commits，英文：`<type>(<scope>): <subject>`，scope 用 `core` | `cli` | `raycast` | `sync` | `docs`。正文写动机与取舍，不复述 diff。
