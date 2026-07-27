# File Tidy

归档文件、去重、挑出坏文件，一步撤销。

一个杂乱的 `Downloads`、桌面、或者刚倒出来的存储卡目录，整理成这样：

```
归档目录/
├── ft_Images/2026-07/…
├── ft_Images/Screenshots/2026-07/…
├── ft_Documents/Ebooks/2025/…
├── ft_Archives/Installers/…        # 安装包不按日期分——下载日期没有意义
├── ft_Duplicates/                  # 内容完全相同的文件，附 manifest.md 说明留下了谁
├── ft_Review/empty|corrupt|junk/   # 0 字节、坏文件、系统垃圾——移走但绝不删
└── .tidy/runs/                     # 每次运行的记录，撤销靠它
```

生成的目录一律带 **`ft_` 前缀**，一眼能和你自己建的目录区分开。前缀可在配置里改，设成 `""` 就是旧行为；目标目录里已经有无前缀的旧归档目录时会自动沿用，不会把一份档案劈成两套。

核心行为：

- **两级分类**：先按扩展名进 `Images` / `Videos` / `Audios` / `Documents` / `Archives` / `Fonts`，再按文件名规则细分出 `Screenshots`、`Ebooks`、`Invoices`、`Installers` 等子目录。规则全在配置里，可改可删。
- **日期粒度按类型定**：照片视频按 `年-月`（EXIF 拍摄时间），文档按 `年`，安装包和字体不按日期——它们只有下载日期，按月拆只会把一套东西撒进十几个目录。
- **字节级去重**：先比大小，再比头尾哈希，最后全文件 SHA-256，跟文件名无关。和归档目录里已有文件重复的也会被拦下。
- **疑似重复**（只标注，照常归档）：文件名归一化后同名（剥掉来源水印、副本标记、日期戳）、同名不同格式、同一软件的不同版本号。
- **相似图片**（只标注）：感知哈希，抓连拍、换分辨率重新导出、聊天软件压缩过的版本——这些字节哈希一个都抓不到。
- **坏文件与垃圾**：0 字节文件、内容与扩展名不符的文件、`.DS_Store` 之类，移进 `ft_Review/` 分类存放，**从不删除**。
- **动手前先给完整预览**，确认后才移动。
- **可撤销**：每次运行在目标目录下写 `.tidy/runs` 清单，撤销时逐条还原并清掉建出来的空目录。

疑似重复和相似图片是**启发式判断，不是内容相同的证明**，所以只在预览里标注、照常归档，删不删由你决定。只有字节级完全相同的才会被隔离。

## 两种用法

### CLI

```bash
tidy ~/Downloads --dest ~/Archive   # 整理到指定目录
tidy ~/Downloads --in-place         # 就地整理，分类目录建在源文件夹内
tidy ~/Downloads --dry-run          # 只看计划，不动文件
tidy ~/Downloads --plain            # 关掉疑似重复/坏文件/相似图片检测，只做基础归档与字节去重
tidy undo --dest ~/Archive          # 撤销上一次
```

不传源文件夹会弹出系统文件夹选择框（macOS 用 osascript，Windows 用 PowerShell，Linux 用 zenity/kdialog）。完整选项见 `tidy --help`。

需要 Node.js >= 20。

### Raycast 扩展

两个命令：**Tidy Folder** 和 **Undo Last Tidy**，能力与 CLI 一致，带表单和预览界面。源码在 `raycast/`。

## 配置

共享配置文件，首次运行时生成默认值：

- macOS / Linux：`~/.config/tidy/config.json`
- Windows：`%APPDATA%\tidy\config.json`

CLI 和 Raycast 扩展读的是同一份配置。可调的键：

| 键 | 作用 |
| --- | --- |
| `dest` | 固定默认归档目录 |
| `categories` | 类别 → 扩展名映射 |
| `fallbackCategory` | 认不出扩展名时的兜底类别 |
| `folderPrefix` | 生成目录的前缀，默认 `"ft_"`；设成 `""` 恢复旧命名 |
| `granularity` | 每个类别的日期粒度：`"month"` / `"year"` / `"none"` |
| `subCategories` | 二级分类规则，`match` 是正则、`exts` 是扩展名，自上而下首个命中生效 |
| `detect` | 检测开关：`similar` / `health` / `perceptual`，或整体设为 `false` 全部关闭 |
| `perceptualThreshold` | 图片相似度阈值（汉明距离），默认 5，调大更宽松 |

`categories` 和 `subCategories` 是**整体替换**语义——这样你才能删掉不想要的类别。副作用是：升级后新增的默认类别不会自动进你已有的配置文件。检测到这种情况时会提示一行，让你自己决定加不加，工具不会擅自改你的配置。

其余键是**合并**语义，只写你关心的那个即可。

## 仓库结构与同步流程

```
src/core/        ★ 唯一真源：纯逻辑，不含面向用户文案（附 .d.ts 类型声明）
  config.js        配置、目录前缀、类别与规则编译
  scan.js          遍历源/目标目录，一二级分类
  dedup.js         字节级去重（大小 → 头尾哈希 → SHA-256）
  similar.js       疑似重复（文件名归一化、同名异格式、版本号）
  phash.js         图片感知哈希与聚簇（纯 JS 解码，无原生依赖）
  health.js        0 字节、魔数校验、系统垃圾
  date.js          日期解析与粒度
  plan.js          汇总成移动计划（唯一决定目标路径的地方）
  analyze.js       编排上述各步，两个适配层共用
  execute.js       执行移动 + 运行清单
  undo.js          撤销
bin/tidy.js      CLI 适配层：中文文案、终端交互
raycast/src/     Raycast 适配层：英文文案、表单与列表 UI
raycast/src/core 生成物 —— 由 sync 脚本从 src/core 原样复制，勿手改
scripts/sync.js  同步脚本
test/            核心逻辑测试（node:test）
```

新增检测请加在 `analyze.js` 的编排里、以 Map 的形式喂给 `buildPlan`；`plan.js` 是唯一决定文件去向的地方，不要在别处拼目标路径。

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
