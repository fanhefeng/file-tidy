# file-tidy

CLI + Raycast 扩展，共用 `src/core`。扩展要提交到 Raycast 官方仓库。

**动手前先读 [CONTRIBUTING.md](CONTRIBUTING.md)** —— 分层约定、语言约定、commit 规范、Store 提交流程都在那里。

几条最容易踩的：

- `raycast/src/core/` 和 `raycast/tests/` 是 `scripts/sync.js` 的生成物，**改了会被覆盖**。要改就改 `src/core/` 和 `test/`，然后 `pnpm sync`。
- core 里不写面向用户的文案，只抛带 `code` 的错误；文案在两个适配层里。加新错误码时两边都要补，否则 core 的原始英文会漏给用户。
- 只有 `plan.js` 决定文件去向，别处不要拼目标路径。
- **代码、注释、commit message、运行时输出一律英文**（Raycast 不支持 i18n，只收 US English）。中文只出现在根目录文档，以及识别中文文件名的匹配规则里。跟用户交流仍用中文。
- 改完跑 `pnpm test`（含 raycast 副本漂移校验）。
