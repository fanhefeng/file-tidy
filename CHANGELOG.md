# 更新记录

本文件记录整个项目（CLI + Raycast 扩展）的变更。`raycast/CHANGELOG.md` 是给 Raycast Store 用的另一份，只记面向扩展用户的变更。

## [0.5.2] - 2026-08-04

两轮全量 code review 的修复。

**修复**

- **撤销的包含检查能被符号链接绕过**（安全）。`undo.js` 的 `isInside` 只做 `path.resolve` 的词法比较，而 `rename` / `mkdir` / `rmdir` 都会跟着符号链接走。于是一份「每条路径字面上都在 destDir 内」的 manifest——只要中间某段（如 `ft_Images`）是指向外部的符号链接——就能让撤销把 destDir 外的文件搬进 sourceDir，并删掉 destDir 外的空目录，且全程不报任何失败。已实测复现。现在包含检查前先 `canonicalPath` 解析符号链接（`createdDirs` 的清理走同一个检查，一并覆盖）。注意这堵的是检查本身，堵不住竞态：检查通过后、操作发生前被换掉的符号链接仍会被跟随，那需要 `openat`/`O_NOFOLLOW`，Node 的 fs API 不提供。
- **文件在扫描后消失会中断整次运行**。`scan.js` 此前只在扫描内部跳过 `statSync` 失败的条目，可那个窗口只有几毫秒；真正的窗口在扫描之后——`dedup.js` 要把每个候选文件整个读一遍算 SHA-256，`phash.js` 要解码图片，两步都可能跑几十秒，而它们的 `ENOENT` 会让整次分析白跑。整理 `~/Downloads` 时下载正好完成、临时文件被重命名走，正是这个场景。现在读不了的文件从该轮比对里剔除，其余文件照常分析。`phash.js` 的文档块此前就写着「never fatal: this pass is advisory」，实际并非如此。
- **配置文件只写一个 `null` 会以裸 TypeError 崩溃**。`null` 是合法 JSON，手工清空配置文件常留下的正是它，而 `loadConfig` 读 `raw.categories` 之前没验证 `raw` 本身。其余标量（`5`、`"abc"`、`[]`）都已经安全，只有 `null` 会炸，且抛的是 core 的内部措辞。现在非对象一律退回默认配置。

- **`tidy undo --dest <目录>` 在部分撤销时会崩溃**。只要有文件没能还原，打印失败原因的那一步就抛 `ReferenceError`：`main()` 在模块求值期间就被调用，而这条路径全程不 `await`，等它跑到失败分支时文案表还在 TDZ 里。结果是用户看到「N 个失败」却永远看不到失败原因。文案表已挪到调用点之前。
- **core 不再漏出原始英文**。`plan.js` 的路径校验此前抛的是不带 `code` 的裸错误，违反「core 不说话」的约定；现在带 `INVALID_SEGMENT`，CLI 和扩展各自有文案。
- **Raycast 扩展补上错误码文案映射**。此前它把 `err.message` 直接打给用户，`CONFIG_PARSE` / `EXDEV_VERIFY` / `INVALID_SEGMENT` 全部漏的是 core 的内部措辞。新增 `raycast/src/errors.ts`，两个命令共用。
- **手改坏的配置不再以 TypeError 崩溃**。`categories: {Images: "jpg"}`（漏了方括号）此前会把 j/p/g 当成三个扩展名，`subCategories: {Documents: 5}` 直接抛「5 is not iterable」。现在非列表的值一律忽略，非对象也不能替换掉整份默认值。
- **扫描期间文件消失不再中断整次扫描**。整理 `~/Downloads` 时浏览器正好完成下载并重命名临时文件，`statSync` 的 `ENOENT` 会让整个扫描失败；现在跳过该条目。
- `pnpm sync:fork` 不再把 `raycast/pnpm-lock.yaml` 带进 Store fork —— 它被 gitignore 了，但 fork 镜像是整目录复制，而 Store CI 只认 npm。
- `pnpm sync --check` 的目录比对改为递归：此前只比对顶层，子目录里的漂移检不出来，而且会以 EISDIR 崩掉。

**清理**

- 删掉死接口 `hammingDistance`（导出且写进 `.d.ts`，但两个适配层和测试都不用）。
- `similar.js` 的模块文档块此前错位挂在 `pickLargest` 上，实际描述的是 `findSimilar`。
- `plan.d.ts` 里重复抄写的 `Granularity` 与 `CompiledSubRule` 改为引用既有类型。
- 根 `package.json` 补 `files` 字段（此前 `npm publish` 会把 `raycast/`、`test/`、`scripts/` 一起打包），`engines` 从 `>=20` 收紧到 `>=20.12.0`——CLI 用的 `node:util` `styleText` 是 20.12 才有的。

## [0.5.1] - 2026-08-01

回流 Raycast 官方维护者在合并 PR #29437 前推的加固改动，并把同类问题在 CLI 侧一并修掉。附带一轮项目规范化。

**修复**（数据安全）

- **撤销不再删掉运行前就存在的目录**。此前撤销按每条移动记录向上回溯删空目录，你自己建的 `ft_Documents/` 只要被这次运行用过、文件移回后变空，就会被一起删掉。现在清单记录本次真正新建了哪些目录，撤销只删这些。
- **同一毫秒内的两次运行不再覆盖彼此的撤销记录**。清单文件名此前只用 ISO 时间戳，毫秒相同就撞名，第二次运行会把第一次的唯一撤销依据整个盖掉。现在追加高精度计时与 UUID。
- **跨卷移动删不掉源文件时，会清掉已复制的目标副本**，不再两边各留一份却报告成功。
- **撤销改用同一套移动逻辑**，跨卷撤销此前直接失败。
- **"记录了但没执行"的移动不再计入还原数**，撤销报告的数字此前偏大。

**修复**（输入信任边界）

- **配置里的类别名、二级分类名、目录前缀不能再逃出目标目录**。这三项都是用户可手改的，写成 `../../` 就会归档到目标目录之外。
- **撤销前校验运行清单**：结构、路径是否越界、是否确实位于目标目录的 `.tidy/runs` 下。损坏或被改过的清单会以 `MANIFEST_CORRUPT` 报错，而不是照着它移动文件。

**修复**（行为一致）

- **预览显示的就是最终落盘名**。重名文件的 ` (n)` 后缀此前在执行阶段才定，预览里看到的是原名。现在计划阶段就定下来，CLI 和 Raycast 两侧一致。
- Raycast：表单和执行按钮防重复触发，确认框阶段的报错不再被吞掉，选中的目录在提交时会重新校验是否还存在。

**规范化**

- 新增 [CONTRIBUTING.md](CONTRIBUTING.md)：分层约定、语言约定、Conventional Commits 提交规范、Raycast Store 提交流程与规范要点、上游改动的回流检查。
- 新增 `CLAUDE.md`、`LICENSE`（此前 package.json 声明 MIT 却无授权文件）。
- 根 `package.json` 补全 `license` / `repository` / `author` / `keywords` / `packageManager`，新增 `format` 脚本与 Prettier 依赖，全仓库格式统一。
- **运行时输出全面英文化**：CLI 文案（含 `--help`、所有提示与错误）、同步脚本的 log 都改为英文，代码注释与测试描述同样统一英文。依据是 Raycast 官方明确不支持 i18n、只接受 US English 且劝阻自建本地化方案，而仓库公开、`bin` 可全局安装，CLI 没有理由单独说中文。中文只保留在两处：根目录项目文档，以及识别中文文件名的匹配规则（截屏、发票、副本标记等），后者是功能数据而非文案。
- 顺带补上了此前会漏出的英文原文：`plan.js` 新增的路径校验错误在 CLI 里没有对应文案，会把 core 的原始消息直接打给用户；现在两个适配层的错误码文案对齐，`CONTRIBUTING.md` 也把"新增错误码要两边都补"写成了约定。
- CLI 不再自带一份重复的去重清单文案，直接用 core 的默认实现，与 Raycast 侧一致。
- `pnpm sync` 一并镜像 `test/` → `raycast/tests/`：维护者往 Store 版本加了测试，而 `sync:fork` 是整目录覆盖，不镜像就会把它删掉。
- 拉回上游机器人对截图与图标做的无损压缩（约省 32%）。
- 重写 `raycast/README.md`（Store 展示页，此前仍停留在 0.4 的能力描述），并把 `raycast/CHANGELOG.md` 里塞进已发布条目的 0.5.0 内容拆成独立条目——Store 不允许改写已发布的历史条目。

## [0.5.0] - 2026-07-27

更聪明的分类与去重。起因是拿它整理一块 20GB 的资料盘时发现：3723 个文件里字节级重复 **0 个**，但实际有 22 组同一本书的不同扫描版；而字体、LUT、电子书被按下载年月拆进十几个目录，毫无意义。

**目录前缀**

- 生成的目录统一加前缀，默认 `ft_`（`folderPrefix`，设 `""` 恢复旧命名），和用户手工建的目录区分开。
- 目标目录里已存在无前缀的旧归档目录时**自动沿用旧目录**，不会把一份档案劈成 `Images/` 和 `ft_Images/` 两套。

**分类**

- 新增二级主题分类（`subCategories`）：`Screenshots`、`Ebooks`、`Invoices`、`Contracts`、`Resumes`、`Papers`、`Installers` 等，按文件名正则或扩展名匹配，规则可改可删。
- 日期粒度按类别可配（`granularity`）：照片视频 `month`，文档 `year`，安装包/字体/音频 `none`。粒度为 `none` 时跳过 EXIF 解析，顺带省一轮 IO。
- 新增 `Fonts` 类别；`Documents` 补上 `mobi` / `azw3` / `azw`。

**去重**

- 新增**疑似重复**检测（`similar.js`）：文件名归一化后同名（剥离来源水印、副本标记、日期戳、URL 转义残留）、同名不同格式、同一软件的不同版本号（按数值比较，1.0.10 > 1.0.6）。
- 新增**图片感知哈希**（`phash.js`）：9×8 均值降采样 + 差值哈希，按汉明距离聚簇，抓连拍、换分辨率重新导出、聊天软件压缩版。纯 JS 解码（jpeg-js / pngjs），HEIC 和 RAW 走 EXIF 内嵌缩略图，无原生依赖，Raycast 扩展仍自包含。
- 两者都是**启发式，只标注不隔离**——文件照常归档，删不删由用户判断。只有字节级完全相同的才进隔离区。

**健康检查**

- 0 字节文件、内容与扩展名不符的文件（30 余种格式的魔数校验）、`.DS_Store` / `._*` / `Thumbs.db` 等系统垃圾，移入 `ft_Review/<类别>/`，**从不删除**。
- `scanSource` 新增 `includeJunk`：只额外收已知垃圾名，`.env` 之类的隐藏文件任何时候都不会被碰。

**修复**（多数来自发布前的一轮全量 code review）

- `Duplicates/manifest.md` 里记的 keeper 路径此前指向**源目录**，而 keeper 早已被移进归档目录，照着清单去找必然扑空；现在改写为归档后的真实位置。
- 健康检查改到字节去重**之前**：字节相同的垃圾/坏文件全部进待查区，不再出现一份被当"重复"隔离、清单里的 keeper 却住在待查区的情况。
- 魔数表放宽：无 ID3 的裸帧 MP3（按 11 位帧同步掩码匹配）、`mdat`/`wide`/`free`/`skip` 开头的老式 MOV、AIFF-C 变体不再被误判为坏文件搬走。误判会真实移动文件，所以所有签名一律从宽。
- "沿用无前缀旧目录"只适用于 0.4.0 真正创建过的名字：用户自己的 `Review/`、`Fonts/` 目录不会被认领；同名的是普通文件时也不再沿用（此前会在执行中途 ENOTDIR 崩溃）。
- 改过 `folderPrefix` 之后，旧前缀留下的隔离目录（如 `ft_Duplicates/`）仍会被跳过，不会被扫回当去重 keeper。
- 源目录里恰好名为 `manifest.md` 的重复文件会让位到 `manifest (1).md`，去重清单不再被追加进用户文件。
- `.DS_Store` 等垃圾名判断改为大小写不敏感（FAT/exFAT 卷上大小写会漂）。
- Raycast：「配置缺少新类别」的警告挪到扫描结束后展示，不再被进度 toast 顶掉。

**其他**

- 新增 `analyze.js` 统一编排扫描与各检测步骤，CLI 和 Raycast 不会再在"跑哪些检测、什么顺序"上各写一遍而漂移。
- CLI 新增 `--plain`，Raycast 表单新增 Smart checks 开关，可关掉三项新检测。底层是 `detect: false` 总开关（配置文件里也可用），未来新增检测项也会一并关掉，不会静默漏关。
- 感知哈希结果缓存在归档目录 `.tidy/phash-cache.json`（按 路径+大小+mtime 命中，解码失败也记负缓存），反复整理时不再全量重解码归档区；源批次没有可哈希图片时整个感知哈希步骤直接跳过。
- 因为 `categories` 是整体替换语义，旧配置文件不会自动获得新增类别；检测到时提示一行，但不擅自修改用户配置。
- 测试从 7 个增至 29 个。

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
