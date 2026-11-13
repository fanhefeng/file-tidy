import { contextBridge, ipcRenderer } from "electron";
import type { Progress, TidyBridge } from "../shared.js";

async function invoke(method: string, input?: unknown) {
  const result = await ipcRenderer.invoke(`tidy:${method}`, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const bridge: TidyBridge = {
  getPreferences: () => invoke("getPreferences"),
  setLocale: (locale) => invoke("setLocale", locale),
  getSettings: () => invoke("getSettings"),
  getDefaults: () => invoke("getDefaults"),
  chooseDirectory: () => invoke("chooseDirectory"),
  analyze: (input) => invoke("analyze", input),
  execute: (id) => invoke("execute", id),
  undo: (destDir, manifestPath) => invoke("undo", { destDir, manifestPath }),
  getLastRun: (destDir) => invoke("getLastRun", destDir),
  saveConfig: (json) => invoke("saveConfig", json),
  onProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Progress) => callback(progress);
    ipcRenderer.on("tidy:progress", listener);
    return () => ipcRenderer.removeListener("tidy:progress", listener);
  },
};
contextBridge.exposeInMainWorld("tidy", bridge);
