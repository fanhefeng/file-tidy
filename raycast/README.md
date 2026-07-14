# File Tidy（Raycast 扩展）

file-tidy CLI 的 Raycast 前端，核心逻辑通过 `"file-tidy": "link:.."` 直接复用上层目录的 `src/*.js`（符号链接，改核心代码即时生效），与命令行版共享配置和 `.tidy/runs` 撤销记录。

## 平台支持

- **Raycast 扩展**：macOS 和 Windows（manifest `platforms` 已声明两者；API 跨平台，未用任何原生代码）。
- **CLI**：macOS / Windows / Linux。配置路径按平台：macOS 与 Linux 在 `~/.config/tidy/config.json`（尊重 `$XDG_CONFIG_HOME`），Windows 在 `%APPDATA%\tidy\config.json`。图形文件夹选择框按平台用 osascript / PowerShell / zenity·kdialog。

## 命令

- **Tidy Folder（整理文件夹）**：选源文件夹（可选就地整理 / 递归），先展示按 `类型/年月` 分组的整理计划和重复文件清单，确认后才移动文件。
- **Undo Last Tidy（撤销上次整理）**：选归档目录（就地整理时选源文件夹本身），把上一次整理的文件移回原位。

## 偏好设置

- **默认归档目录**：表单里不选目标目录时使用。

## 开发

```sh
pnpm install
pnpm dev        # ray develop，导入 Raycast 并热重载
pnpm build      # ray build，仅校验构建
```

## 发布到 Store

1. 在 Raycast 里登录账号（fanhefeng901121@gmail.com）。
2. 把 `package.json` 的 `author` 改成你的 Raycast 用户名（Raycast 设置 → Account 里可以看到 handle）。
3. `pnpm publish`（即 `npx @raycast/api@latest publish`），按提示走 raycast/extensions 的审核流程。

仅本机使用的话不需要发布：`ray develop` 导入过一次后，扩展会一直留在 Raycast 里（标记为 Development）。
