# 更新记录

本文件记录整个项目（CLI + Raycast 扩展）的变更。`raycast/CHANGELOG.md` 是给 Raycast Store 用的另一份，只记面向扩展用户的变更。

## [未发布]

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
