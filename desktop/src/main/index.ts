import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Locale } from "../locale.js";
import { describeError, desktopError } from "./errors.js";
import { readPreferences, writePreferences } from "./preferences.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const userDataDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (path.isAbsolute(userDataDirectory)) app.setPath("userData", userDataDirectory);
let window: BrowserWindow | null = null;
let worker: Worker | null = null;
let serial = 0;
let quitting = false;
let locale: Locale = "en";
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const methods = ["getSettings", "getDefaults", "saveConfig", "getLastRun", "analyze", "execute", "undo"];

function rejectPending(message: string) {
  for (const request of pending.values()) request.reject(new Error(message));
  pending.clear();
}

function createWorker() {
  const instance = new Worker(new URL("./worker.js", import.meta.url), { workerData: { version: app.getVersion() } });
  instance.on("message", (message) => {
    if (message.progress) {
      window?.webContents.send("tidy:progress", message.progress);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    request.resolve(message.ok ? { ok: true, value: message.value } : { ok: false, error: message.error });
    if (quitting && !pending.size) app.quit();
  });
  instance.on("error", () => rejectPending(describeError(desktopError("BACKGROUND_STOPPED"), locale)));
  instance.on("exit", () => {
    rejectPending(describeError(desktopError("BACKGROUND_STOPPED"), locale));
    worker = null;
  });
  return instance;
}

function request(method: string, input: unknown) {
  worker ??= createWorker();
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, method, input, locale });
  });
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function updateMenu() {
  const zh = locale === "zh-CN";
  const label = (english: string, chinese: string) => (zh ? chinese : english);
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin")
    template.push({
      label: "File Tidy",
      submenu: [
        { role: "about", label: label("About File Tidy", "关于 File Tidy") },
        { type: "separator" },
        { role: "hide", label: label("Hide File Tidy", "隐藏 File Tidy") },
        { role: "hideOthers", label: label("Hide Others", "隐藏其他应用") },
        { role: "unhide", label: label("Show All", "显示全部") },
        { type: "separator" },
        { role: "quit", label: label("Quit File Tidy", "退出 File Tidy") },
      ],
    });
  template.push(
    {
      label: label("Edit", "编辑"),
      submenu: [
        { role: "undo", label: label("Undo", "撤销") },
        { role: "redo", label: label("Redo", "重做") },
        { type: "separator" },
        { role: "cut", label: label("Cut", "剪切") },
        { role: "copy", label: label("Copy", "复制") },
        { role: "paste", label: label("Paste", "粘贴") },
        { role: "selectAll", label: label("Select All", "全选") },
      ],
    },
    {
      label: label("View", "视图"),
      submenu: [
        { role: "reload", label: label("Reload", "重新加载") },
        { role: "toggleDevTools", label: label("Toggle Developer Tools", "切换开发者工具") },
        { type: "separator" },
        { role: "resetZoom", label: label("Actual Size", "实际大小") },
        { role: "zoomIn", label: label("Zoom In", "放大") },
        { role: "zoomOut", label: label("Zoom Out", "缩小") },
        { type: "separator" },
        { role: "togglefullscreen", label: label("Toggle Full Screen", "切换全屏") },
      ],
    },
    {
      label: label("Window", "窗口"),
      submenu: [
        { role: "minimize", label: label("Minimize", "最小化") },
        { role: "zoom", label: label("Zoom", "缩放") },
        { role: "close", label: label("Close", "关闭窗口") },
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const rendererURL = process.env.ELECTRON_RENDERER_URL;
  window = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 760,
    minHeight: 600,
    title: "File Tidy",
    backgroundColor: "#ffffff",
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 22, y: 20 } }
      : {}),
    webPreferences: {
      preload: path.join(dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.once("ready-to-show", () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on("will-prevent-unload", (event) => {
    if (!window || pending.size) return;
    const zh = locale === "zh-CN";
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning",
      title: zh ? "规则尚未保存" : "Unsaved rules",
      message: zh ? "放弃未保存的规则修改？" : "Discard unsaved rule changes?",
      detail: zh
        ? "继续编辑可保留草稿，保存后再退出。"
        : "Keep editing to preserve your draft and save it before leaving.",
      buttons: zh ? ["继续编辑", "放弃修改"] : ["Keep editing", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    // Electron: cancelling this event allows the original close/quit/reload.
    if (choice === 1) event.preventDefault();
    else quitting = false;
  });
  window.on("close", (event) => {
    if (pending.size) event.preventDefault();
  });
  window.on("closed", () => {
    window = null;
  });
  if (rendererURL && !app.isPackaged) void window.loadURL(rendererURL);
  else void window.loadFile(path.join(dirname, "../renderer/index.html"));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  void app.whenReady().then(() => {
    if (process.platform === "darwin") {
      // Set the running icon too: macOS can retain the previous bundle icon
      // after an in-place update, and development otherwise uses Electron's.
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, "icon-macos.png")
        : path.join(dirname, "../../resources/icon-macos.png");
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) app.dock?.setIcon(icon);
    }
    locale = readPreferences(preferencesPath(), app.getLocale()).locale;
    updateMenu();
    for (const method of [...methods, "chooseDirectory", "getPreferences", "setLocale", "openReport"]) {
      ipcMain.handle(`tidy:${method}`, async (event, input) => {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
          return { ok: false, error: describeError(desktopError("WINDOW_UNAVAILABLE"), locale) };
        }
        try {
          if (method === "getPreferences") return { ok: true, value: { locale } };
          if (method === "setLocale") {
            const preferences = writePreferences(preferencesPath(), input);
            locale = preferences.locale;
            updateMenu();
            return { ok: true, value: preferences };
          }
          if (method === "chooseDirectory") {
            const result = await dialog.showOpenDialog(window, {
              title: locale === "zh-CN" ? "选择文件夹" : "Choose a folder",
              buttonLabel: locale === "zh-CN" ? "选择文件夹" : "Choose folder",
              properties: ["openDirectory", "createDirectory"],
            });
            return { ok: true, value: result.canceled ? null : result.filePaths[0] };
          }
          if (method === "openReport") {
            const report = (await request("resolveReport", input)) as
              { ok: true; value: string } | { ok: false; error: string };
            if (!report.ok) return report;
            const failure = await shell.openPath(report.value);
            if (failure) throw desktopError("REPORT_OPEN_FAILED");
            return { ok: true, value: null };
          }
          return await request(method, input);
        } catch (error) {
          return {
            ok: false,
            error: describeError(error, locale),
          };
        }
      });
    }
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("before-quit", (event) => {
    if (pending.size) {
      event.preventDefault();
      quitting = true;
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    void worker?.terminate();
  });
}
