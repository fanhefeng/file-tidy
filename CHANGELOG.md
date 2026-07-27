# 更新记录

本文件记录整个项目（CLI + Raycast 扩展）的变更。`raycast/CHANGELOG.md` 是给 Raycast Store 用的另一份，只记面向扩展用户的变更。

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

**修复**

- `Duplicates/manifest.md` 里记的 keeper 路径此前指向**源目录**，而 keeper 早已被移进归档目录，照着清单去找必然扑空；现在改写为归档后的真实位置。

**其他**

- 新增 `analyze.js` 统一编排扫描与各检测步骤，CLI 和 Raycast 不会再在"跑哪些检测、什么顺序"上各写一遍而漂移。
- CLI 新增 `--plain`，Raycast 表单新增 Smart checks 开关，可关掉三项新检测。
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
