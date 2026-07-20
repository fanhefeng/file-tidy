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

## 仓库结构

```
bin/tidy.js     CLI 入口
src/            CLI 的核心逻辑
raycast/        Raycast 扩展（自带一份 src/core/，见下）
```

### 关于 raycast/ 的两份历史

`raycast/` 这个目录同时存在于两个地方，改动时**两边都要推**：

1. **本仓库** —— 项目的源头，CLI 和扩展都在这里开发。
2. **`raycast/extensions` 的 fork**（`fanhefeng/extensions` 分支 `ext/file-tidy`，本地检出在 `~/.config/raycast/public-extensions-fork`）—— 提交给 Raycast Store 的那份，只包含 `raycast/` 目录的内容，平铺成 `extensions/file-tidy/`。对应 PR：[raycast/extensions#29437](https://github.com/raycast/extensions/pull/29437)，截至目前仍在等待官方 review。

两边的提交历史是各自独立的，没有 remote 关系，也没有自动同步。只在本仓库改而忘了同步 fork，Store 上的版本就会落后；反过来只在 fork 上改（比如按审核意见临时修），本仓库就会丢掉那次改动 —— 目前 fork 上因审核产生的 4 次修改都已回流到这里。

另外 `raycast/src/core/` 是 `src/` 的一份副本加了 `.d.ts` 类型声明：Store 要求扩展目录自包含，不能引用目录外的文件。改核心逻辑时记得两处同步。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。`raycast/CHANGELOG.md` 是另一份，格式由 Raycast Store 规定，只记面向用户的扩展变更。
