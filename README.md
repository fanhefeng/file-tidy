# File Tidy

归档文件、去重、挑出坏文件，一步撤销。

一个杂乱的 `Downloads`、桌面、或者刚倒出来的存储卡目录，整理成这样：

```
归档目录/
├── ft_Images/2026-07/…
├── ft_Images/Screenshots/2026-07/…
├── ft_Documents/Ebooks/2025/…
├── ft_Audios/Artist/Album/…        # 音频默认按歌手、专辑归类
├── ft_Archives/Installers/…        # 安装包不按日期分——下载日期没有意义
├── ft_Duplicates/                  # 内容完全相同的文件，附 manifest.md 说明留下了谁
├── ft_Review/empty|corrupt|junk/   # 0 字节、坏文件、系统垃圾——移走但绝不删
├── .tidy/runs/                     # 每次运行的记录，撤销靠它
└── .tidy/similar.md                # 标注过的疑似重复与相似图片，及它们各自归档到了哪
```

生成的目录一律带 **`ft_` 前缀**，一眼能和你自己建的目录区分开。前缀可在配置里改，设成 `""` 就是旧行为；目标目录里已经有无前缀的旧归档目录时会自动沿用，不会把一份档案劈成两套。

核心行为：

- **可配置分类**：内置图片、视频、音频、文档、压缩包、字体、代码、数据和设计格式。先按扩展名分类，再按文件名规则细分出 `Screenshots`、`Ebooks`、`Invoices`、`Installers` 等子目录。规则全在配置里，可改可删。
- **音频标签归类**：读取本地真实音频标签，按歌手、专辑歌手、专辑、歌曲名、流派、年份自由组合层级。缺失标签进入明确的 `Unknown Artist` / `Unknown Album` 等目录，歌曲名缺失时使用原文件名。
- **日期粒度按类型定**：照片视频按 `年-月`（EXIF 拍摄时间），文档按 `年`，安装包和字体不按日期——它们只有下载日期，按月拆只会把一套东西撒进十几个目录。
- **字节级去重**：先比大小，再比头尾哈希，最后全文件 SHA-256，跟文件名无关。和归档目录里已有文件重复的也会被拦下。
- **疑似重复**（只标注，照常归档）：文件名归一化后同名（剥掉来源水印、副本标记、日期戳）、同名不同格式、同一软件的不同版本号。
- **相似图片**（只标注）：感知哈希，抓连拍、换分辨率重新导出、聊天软件压缩过的版本——这些字节哈希一个都抓不到。
- **坏文件与垃圾**：0 字节文件、内容与扩展名不符的文件、`.DS_Store` 之类，移进 `ft_Review/` 分类存放，**从不删除**。
- **动手前先给完整预览**，确认后才移动。
- **可撤销**：每次运行在目标目录下写 `.tidy/runs` 清单，撤销时逐条还原并清掉建出来的空目录。

疑似重复和相似图片是**启发式判断，不是内容相同的证明**，所以不会被移进任何特殊目录——标注完照常归档，删不删由你决定。只有字节级完全相同的才会被隔离。

也正因为它们散落在各自的普通归档目录里，预览一关这层分组关系就没了。所以**只要某次运行标注过东西，就会在目标目录写一份 `.tidy/similar.md`**，逐组列出是哪些文件、分别归档到了哪。这是这些标注唯一活过本次运行的地方。

## 三种用法

### CLI

```bash
npm i -g @fanhefeng/file-tidy       # 装完命令名是 tidy
```

```bash
tidy ~/Downloads --dest ~/Archive   # 整理到指定目录
tidy ~/Downloads --in-place         # 就地整理，分类目录建在源文件夹内
tidy ~/Downloads --dry-run          # 只看计划，不动文件
tidy ~/Downloads --plain            # 关掉疑似重复/坏文件/相似图片检测，只做基础归档与字节去重
tidy undo --dest ~/Archive          # 撤销上一次
```

不传源文件夹会弹出系统文件夹选择框（macOS 用 osascript，Windows 用 PowerShell，Linux 用 zenity/kdialog）。完整选项见 `tidy --help`。

需要受支持的 Node.js 22.23.4、24.22.1 或 26.12.1 分支及更高补丁版本。Node 20 已结束支持，不再作为安全支持和 CI 基线。

### Raycast 扩展

两个命令：**Tidy Folder** 和 **Undo Last Tidy**，能力与 CLI 一致，带表单和预览界面。源码在 `raycast/`。

### Electron 桌面端

源码在 `desktop/`，使用 Electron 45、React 19.3、TypeScript 7、Vite 8 和 electron-vite 6，依赖锁定在 `desktop/package-lock.json`。界面提供**整理文件 / 分类规则 / 整理记录**（也可切换为英文）：目录选择、就地整理、递归扫描、可搜索筛选的移动预览、JSON 规则编辑及音频预设、执行与撤销。

```bash
pnpm install
npm --prefix desktop ci
pnpm desktop:dev        # 开发模式
pnpm desktop:build      # 类型检查与生产构建
pnpm desktop:test       # 构建并验证后台线程的真实文件移动与撤销
pnpm desktop:package    # 为当前平台打包
```

首页采用同屏工作台：左侧选择目录与选项，右侧预览分类位置、筛选和搜索文件，底部确认执行。规则页按文件类别提供日期分组、子分类增删编辑与顺序调整；音频类别可设置歌手、专辑等分组。自定义后缀规则有独立入口，JSON 编辑器按需打开，并与可视化设置共用一份草稿。标题栏可切换简体中文和 English，首次跟随系统，后续记住选择；语言偏好独立于分类规则保存，切换时保留目录、预览和未保存的草稿，原生菜单与错误提示也同步切换。

扫描、音频解析、去重和移动均由后台线程调用共享核心；渲染进程通过受限 preload 通道操作。预览本身不移动文件。执行前重新检查文件与配置是否变化，过期计划不能执行。Activity 显示当前会话的操作记录，并从所选目标目录读取最近一次可撤销的持久清单。打包和平台分发说明见 [desktop/README.md](desktop/README.md)。

## 配置

共享配置文件，首次运行时生成默认值：

- macOS / Linux：`~/.config/tidy/config.json`
- Windows：`%APPDATA%\tidy\config.json`

CLI、Raycast 和桌面端读的是同一份配置。CLI 也支持 `--config ./tidy.json` 使用独立规则。可调的键：

| 键                    | 作用                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `dest`                | 固定默认归档目录                                                           |
| `categories`          | 类别 → 扩展名映射                                                          |
| `extensions`          | 增量扩展或覆盖后缀规则，无需复制内置类别，支持 `tar.gz` 复合后缀           |
| `groupBy`             | 按类别指定元数据层级，默认音频为 `["artist", "album"]`                     |
| `fallbackCategory`    | 认不出扩展名时的兜底类别                                                   |
| `folderPrefix`        | 生成目录的前缀，默认 `"ft_"`；设成 `""` 恢复旧命名                         |
| `granularity`         | 每个类别的日期粒度：`"month"` / `"year"` / `"none"`                        |
| `subCategories`       | 二级分类规则，`match` 是正则、`exts` 是扩展名，自上而下首个命中生效        |
| `detect`              | 检测开关：`similar` / `health` / `perceptual`，或整体设为 `false` 全部关闭 |
| `perceptualThreshold` | 图片相似度阈值（汉明距离），默认 5，调大更宽松                             |

`categories` 和 `subCategories` 是**整体替换**语义——这样你才能删掉不想要的类别。副作用是：升级后新增的默认类别不会自动进你已有的配置文件。检测到这种情况时会提示一行，让你自己决定加不加，工具不会擅自改你的配置。

`granularity`、`groupBy`、`detect` 按键合并默认值，`extensions` 叠加到内置扩展名索引；其他标量直接替换。新增格式推荐使用 `extensions`，保留默认格式支持。

最小配置示例（完整文件见 [examples/config.json](examples/config.json)）：

```json
{
  "extensions": {
    "myproject": "Projects",
    "tar.gz": "Archives",
    "flac": { "category": "Audios", "groupBy": ["albumArtist", "album"] }
  },
  "groupBy": { "Audios": ["artist", "album"] },
  "granularity": { "Projects": "none" }
}
```

音频 `groupBy` 可选：`["artist"]` 按歌手、`["album"]` 按专辑、`["title"]` 按歌曲、`["genre", "artist", "album"]` 组合分层，`[]` 关闭标签分层。支持字段为 `artist`、`albumArtist`、`album`、`title`、`genre`、`year`。单个扩展名对象规则的 `groupBy`、`granularity` 优先于类别规则。目录顺序为类别、文件名子分类、元数据层级、日期、原文件名；元数据路径字符会安全替换，原文件名保留，重名仍自动编号。

配置加载时校验字段、日期粒度、扩展名、分组字段、正则和目录名；错误会指出具体字段，保存前校验并原子替换。旧版 `categories` 整体替换语义保持不变，旧配置缺失的新类别仍由提示交给用户决定。首次生成配置会写入配置目录，分析预览不写目标归档目录。

## 仓库结构

```
src/core/        ★ 唯一真源：纯逻辑，不含面向用户文案（附 .d.ts 类型声明）
  index.js         三个适配层共用的稳定入口（配置、分析、执行、撤销）
  config.js        默认配置、校验、读写、目录前缀
  rules.js         纯规则编译与分类，不访问文件系统
  metadata.js      音频标签读取，有界并发、跳过封面
  scan.js          遍历源/目标目录
  dedup.js         字节级去重（大小 → 头尾哈希 → SHA-256）
  similar.js       疑似重复（文件名归一化、同名异格式、版本号）
  phash.js         图片感知哈希与聚簇（纯 JS 解码，无原生依赖）
  health.js        0 字节、魔数校验、系统垃圾
  date.js          日期解析与粒度
  plan.js          汇总成移动计划（唯一决定目标路径的地方）
  analyze.js       编排检测、规则匹配和元数据读取，三个适配层共用
  execute.js       执行移动 + 运行清单
  move.js          单个文件的移动，含跨卷复制回退
  undo.js          撤销
bin/tidy.js      CLI 适配层：终端文案与交互
raycast/src/     Raycast 适配层：表单与列表 UI
desktop/src/    Electron 适配层：主进程、后台线程、preload 与 React 界面
raycast/src/core 生成物 —— 由 sync 从 src/core 原样复制，勿手改
raycast/tests    生成物 —— 由 sync 从 test/ 原样复制，勿手改
scripts/sync.js  同步脚本
test/            核心逻辑测试（node:test）
```

core 只返回数据、抛带 `code` 的错误，所有"说话"都在各自适配层，因此两份 core 字节相同，同步就是复制：

```bash
pnpm test        # 跑测试 + 校验 raycast 副本未漂移
pnpm sync        # src/core → raycast/src/core，test → raycast/tests
pnpm sync:fork   # 再把 raycast/ 镜像到 Store fork
```

分层约定、commit 规范、Raycast Store 提交流程与检查清单见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

## Raycast 扩展

已上架 Raycast Store（[PR #29437](https://github.com/raycast/extensions/pull/29437)，2026-07-31 合并）。Store 要求扩展目录自包含、不能 import 目录外的文件，`raycast/src/core/` 这份复制正是为此存在。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。`raycast/CHANGELOG.md` 是另一份，格式由 Raycast Store 规定，只记面向扩展用户的变更。
