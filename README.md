# File Tidy

按 `类型/年月` 归档文件，字节级去重，一步撤销。

一个杂乱的 `Downloads`、桌面、或者刚倒出来的存储卡目录，整理成这样：

```
归档目录/
├── Images/2026-07/…
├── Videos/2026-06/…
├── Documents/2025-11/…
├── Duplicates/          # 内容重复的文件隔离在这里，附清单.md 说明匹配了谁
└── .tidy/runs/          # 每次运行的记录，撤销靠它
```

核心行为：

- **按扩展名分类**，落进 `Images` / `Videos` / `Audios` / `Documents` / `Archives`，认不出的进兜底类别。
- **日期取自内容**：照片和视频优先用 EXIF 拍摄时间，其他文件取创建/修改时间里较早的那个。
- **去重是字节级的，跟文件名无关**：先比大小，再比头尾哈希，最后全文件 SHA-256。和归档目录里已有文件重复的也会被拦下。
- **动手前先给完整预览**，确认后才移动。
- **可撤销**：每次运行在目标目录下写 `.tidy/runs` 清单，撤销时逐条还原并清掉建出来的空目录。

## 两种用法

### CLI

```bash
tidy ~/Downloads --dest ~/Archive   # 整理到指定目录
tidy ~/Downloads --in-place         # 就地整理，分类目录建在源文件夹内
tidy ~/Downloads --dry-run          # 只看计划，不动文件
tidy undo --dest ~/Archive          # 撤销上一次
```

不传源文件夹会弹出系统文件夹选择框（macOS 用 osascript，Windows 用 PowerShell，Linux 用 zenity/kdialog）。完整选项见 `tidy --help`。

需要 Node.js >= 20。

### Raycast 扩展

两个命令：**Tidy Folder** 和 **Undo Last Tidy**，能力与 CLI 一致，带表单和预览界面。源码在 `raycast/`。

## 配置

类别到扩展名的映射放在共享配置文件里，首次运行时生成默认值：

- macOS / Linux：`~/.config/tidy/config.json`
- Windows：`%APPDATA%\tidy\config.json`

CLI 和 Raycast 扩展读的是同一份配置。加类别、改扩展名归属、固定默认归档目录都在这里。

## 仓库结构与同步流程

```
src/core/        ★ 唯一真源：纯逻辑，不含面向用户文案（附 .d.ts 类型声明）
bin/tidy.js      CLI 适配层：中文文案、终端交互
raycast/src/     Raycast 适配层：英文文案、表单与列表 UI
raycast/src/core 生成物 —— 由 sync 脚本从 src/core 原样复制，勿手改
scripts/sync.js  同步脚本
test/            核心逻辑冒烟测试（node:test）
```

core 只返回数据、抛带 `code` 的错误；所有"说话"（中文/英文文案）都在各自适配层。因此两份 core 字节相同，同步就是复制：

```bash
pnpm test        # 跑测试 + 校验 raycast/src/core 未漂移
pnpm sync        # src/core → raycast/src/core
pnpm sync:fork   # 再把 raycast/ 镜像到 fork 的 extensions/file-tidy/（commit/push 手动）
```

### 与 Raycast Store 的关系

Store 要求扩展目录自包含，PR 也只能包含 `extensions/file-tidy/` 一个目录，所以扩展无法直接 import 本仓库的 core —— 这就是 `raycast/src/core/` 这份复制存在的原因。提交渠道是 `raycast/extensions` 的 fork（`fanhefeng/extensions` 分支 `ext/file-tidy`，本地检出在 `~/.config/raycast/public-extensions-fork`），对应 PR：[raycast/extensions#29437](https://github.com/raycast/extensions/pull/29437)。

日常改动流程：改 `src/core/` 或适配层 → `pnpm test` → `pnpm sync:fork` → 在 fork 里 commit + push，PR 自动更新。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。`raycast/CHANGELOG.md` 是另一份，格式由 Raycast Store 规定，只记面向用户的扩展变更。
