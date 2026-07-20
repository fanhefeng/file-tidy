# 更新记录

本文件记录整个项目（CLI + Raycast 扩展）的变更。`raycast/CHANGELOG.md` 是给 Raycast Store 用的另一份，只记面向扩展用户的变更。

## [0.4.0] - 2026-07-20

core 单一化重构 + CLI 缺陷修复。

**架构**

- `src/core/` 成为唯一真源：纯逻辑、无面向用户文案（错误带 `code`，撤销返回结构化结果），中文/英文措辞分别归 CLI（`bin/tidy.js`）和 Raycast 适配层。
- `raycast/src/core/` 降级为生成物，由 `pnpm sync` 从 `src/core` 原样复制；`pnpm sync:fork` 一并镜像到 Store fork。`pnpm test` 含漂移校验。
- 新增核心逻辑冒烟测试（`test/core.test.js`，node:test，覆盖归档/去重/跨目录去重/撤销/冲突后缀）。

**CLI 修复**（此前只修在 Raycast 那份 core 里，CLI 一直带病）

- **源文件夹在归档目标内部时不再误判**：之前 `tidy ~/Downloads/mess --dest ~/Downloads` 会把源文件全部当成"与 dest 中自己重复"而移进 Duplicates；现在双向包含检查直接拦截。
- 路径先经 `canonicalPath` 规范化，符号链接（如 macOS `/var` → `/private/var`）无法绕过包含检查。
- 运行清单改为"先记录后移动"，中途失败也不会出现无记录的移动，撤销不漏文件。
- 撤销时正确跳过"记录了但从未执行"的移动条目。

**行为变化**

- Duplicates 清单文件名统一为 `manifest.md`（原 CLI 写 `清单.md`，与 Raycast 扩展写的 `manifest.md` 会在同一目标目录裂成两份）；旧的 `清单.md` 不迁移，留在原处。
- Raycast 的 Undo 命令改用结构化撤销结果，部分失败时能报出准确的成功/失败数。

## [0.3.1] - 2026-07-20

- 补充根目录 README 和本更新记录。

## [0.3.0] - 2026-07-14

首个完整版本，CLI 与 Raycast 扩展一起成型。

**功能**

- 按 `类型/年月` 归档：`Images` / `Videos` / `Audios` / `Documents` / `Archives` + 兜底类别，扩展名映射可在配置文件里改。
- 日期选取：照片和视频优先读 EXIF 拍摄时间，其余取创建/修改时间的较早者。
- 字节级去重：大小 → 头尾哈希 → 全文件 SHA-256，与文件名无关；和归档目录中已有文件重复的同样拦下，隔离到 `Duplicates` 并写清单。
- 移动前展示完整计划，确认后执行。
- 撤销：每次运行在目标目录写 `.tidy/runs` 清单，可逐条还原并清理建出的空目录。
- CLI 支持就地整理、递归子文件夹、dry-run、跳过确认；不传路径时调用系统文件夹选择框（macOS/Windows/Linux 各自适配）。
- Raycast 扩展提供 **Tidy Folder** 和 **Undo Last Tidy** 两个命令。

**为上架 Raycast Store 做的调整**

- 按 Store 规范改造扩展目录结构，`raycast/src/core/` 独立自包含（Store 不允许引用扩展目录外的文件）。
- author 定为 `fhf1121`，补 3 张 Store 截图。
- 移除误生成的 `raycast/pnpm-lock.yaml` —— Store CI 只认 npm + `package-lock.json`。
- `eslint.config.js` 改名 `.mjs`，消除 Node 模块类型警告。

**审核阶段的修正**（源于 PR #29437 的 Greptile 审核，已从 fork 回流到本仓库）

- manifest 改为先记录后移动，消除「文件已移动但无记录」的时间窗口，撤销不再可能漏文件。
- 包含关系检查前先 `canonicalPath` 规范化路径，避免符号链接或 `..` 绕过「归档目标不能在源文件夹内」的校验。
