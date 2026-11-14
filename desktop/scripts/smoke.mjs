import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({
  options: {
    packaged: { type: "boolean", default: false },
    output: { type: "string", default: path.join(desktop, "release", "smoke") },
    "no-sandbox": { type: "boolean", default: false },
  },
});
if (values["no-sandbox"] && (process.platform !== "linux" || !process.env.CI)) {
  throw new Error("--no-sandbox is only available for Linux CI runners");
}
const output = path.resolve(values.output);
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "file-tidy-smoke-"));
const sourceDir = path.join(temporary, "待整理 source");
const destDir = path.join(temporary, "整理结果 archive");
const userData = path.join(temporary, "app-data");
const configHome = path.join(temporary, "config");
for (const directory of [sourceDir, destDir, userData, path.join(configHome, "tidy")]) {
  fs.mkdirSync(directory, { recursive: true });
}
const samples = new Map([
  ["notes.txt", "The original notes for this project."],
  ["notes copy.txt", "A separate revision of the project notes, kept for comparison."],
  ["report.txt", "A report with an exact duplicate."],
  ["duplicate.txt", "A report with an exact duplicate."],
]);
for (const [name, contents] of samples) fs.writeFileSync(path.join(sourceDir, name), contents);
fs.writeFileSync(
  path.join(configHome, "tidy", "config.json"),
  JSON.stringify({ dest: destDir, detect: { perceptual: false }, granularity: { Documents: "none" } }),
);
fs.writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "en" }));

function packagedExecutable() {
  const release = path.join(desktop, "release");
  const directories = fs
    .readdirSync(release)
    .sort((a, b) => Number(b.includes(process.arch)) - Number(a.includes(process.arch)));
  for (const directory of directories) {
    const base = path.join(release, directory);
    let candidate;
    if (process.platform === "darwin" && /^mac(?:-|$)/.test(directory)) {
      candidate = path.join(base, "File Tidy.app", "Contents", "MacOS", "File Tidy");
    } else if (process.platform === "win32" && /^win.*-unpacked$/.test(directory)) {
      candidate = path.join(base, "File Tidy.exe");
    } else if (process.platform === "linux" && /^linux.*-unpacked$/.test(directory)) {
      candidate = path.join(base, "file-tidy-desktop");
    }
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error("No unpacked application found. Run npm run package:dir first.");
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.serial = 0;
    this.pending = new Map();
    this.errors = [];
    this.logs = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails);
      } else if (message.method === "Runtime.consoleAPICalled" || message.method === "Log.entryAdded") {
        this.logs.push(message);
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("The application closed its DevTools connection"));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("DevTools connection timed out")), 15000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        (event) => {
          clearTimeout(timeout);
          reject(new Error(event.message || "DevTools connection failed"));
        },
        { once: true },
      );
    });
    return new DevTools(socket);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("DevTools command timed out: " + method));
      }, 15000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(fn, ...args) {
    const expression =
      "(" + fn.toString() + ")(" + args.map((arg) => JSON.stringify(arg) ?? "undefined").join(",") + ")";
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

let child;
let childClosed;
let devtools;
let failure;
let transcript = "";
const checks = [];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function closesWithin(promise, milliseconds) {
  let timeout;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function poll(fn, label, ...args) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("The application exited while waiting for " + label);
    try {
      if (await devtools.evaluate(fn, ...args)) return;
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for " + label);
}

async function click(selector, text) {
  const point = await devtools.evaluate(
    (selector, text) => {
      const elements = [...document.querySelectorAll(selector)];
      const element = text === undefined ? elements[0] : elements.find((item) => item.textContent.trim() === text);
      if (!element) throw new Error("Missing control: " + selector + (text ? " " + text : ""));
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        disabled: Boolean(element.disabled),
        width: rect.width,
        height: rect.height,
      };
    },
    selector,
    text,
  );
  assert.ok(!point.disabled && point.width > 0 && point.height > 0, "Control is unavailable: " + selector);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await devtools.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
}

async function key(key, code, modifiers = 0) {
  const virtualKey = { Tab: 9, Enter: 13, Escape: 27, End: 35, ArrowDown: 40, a: 65 }[key];
  for (const type of ["keyDown", "keyUp"]) {
    await devtools.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: virtualKey,
      ...(type === "keyDown" && key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
    });
  }
}

async function type(selector, value) {
  await click(selector);
  await key("a", "KeyA", process.platform === "darwin" ? 4 : 2);
  await devtools.send("Input.insertText", { text: value });
  assert.equal(await devtools.evaluate((selector) => document.querySelector(selector).value, selector), value);
}

async function viewport(width, height) {
  await devtools.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await devtools.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function screenshot(name) {
  const { data } = await devtools.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, name + ".png"), Buffer.from(data, "base64"));
}

async function layout(label) {
  const metrics = await devtools.evaluate(() => ({
    viewport: innerWidth,
    document: document.scrollingElement.scrollWidth,
    shell: document.querySelector(".app-shell").scrollWidth,
  }));
  assert.ok(
    metrics.document <= metrics.viewport + 1 && metrics.shell <= metrics.viewport + 1,
    label + " overflows: " + JSON.stringify(metrics),
  );
  checks.push(label);
}

async function executionVisible(label) {
  const visible = await devtools.evaluate(() => {
    const button = document.querySelector(".execution-bar .button-primary");
    const box = button.getBoundingClientRect();
    const panel = button.closest(".preview-panel").getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return (
      box.top >= Math.max(0, panel.top) &&
      box.bottom <= Math.min(innerHeight, panel.bottom) + 1 &&
      (hit === button || button.contains(hit))
    );
  });
  assert.ok(visible, label + ": the execution action is clipped or covered");
  checks.push(label);
}

async function responsiveLayouts() {
  for (const locale of ["en", "zh-CN"]) {
    await click("button[lang='" + locale + "']");
    await poll((locale) => document.documentElement.lang === locale, "language " + locale, locale);
    for (const [width, height] of [
      [1240, 860],
      [1000, 720],
      [760, 600],
      [375, 812],
    ]) {
      await viewport(width, height);
      for (const [index, view] of [
        [1, "organize"],
        [2, "rules"],
        [3, "activity"],
      ]) {
        const selector = "nav.view-tabs button:nth-child(" + index + ")";
        await click(selector);
        await poll(
          (selector) => document.querySelector(selector)?.getAttribute("aria-current") === "page",
          view + " navigation",
          selector,
        );
        await layout(locale + " " + view + " " + width + "x" + height);
        if (width === 375 || width === 760 || (width === 1000 && view === "organize")) {
          await screenshot(view + "-" + locale + "-" + width);
        }
      }
    }
  }
  await viewport(1240, 860);
  await click("button[lang='en']");
  await poll(() => document.documentElement.lang === "en", "English after responsive checks");
  await click("nav.view-tabs button:nth-child(1)");
}

async function launch() {
  const executable = values.packaged ? packagedExecutable() : createRequire(import.meta.url)("electron");
  const args = values.packaged ? [] : [desktop];
  args.push("--user-data-dir=" + userData, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0");
  if (values["no-sandbox"]) args.push("--no-sandbox");
  const environment = { ...process.env, XDG_CONFIG_HOME: configHome, APPDATA: configHome };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_RENDERER_URL;
  child = spawn(executable, args, {
    cwd: desktop,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  childClosed = new Promise((resolve) => {
    child.once("close", resolve);
    child.once("error", resolve);
  });
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("The application did not expose DevTools:\n" + transcript)),
      30000,
    );
    const receive = (chunk) => {
      transcript += chunk;
      const match = transcript.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      reject(new Error("Application exited before DevTools (" + code + "):\n" + transcript));
    });
  });
  const origin = new URL(endpoint);
  const deadline = Date.now() + 15000;
  let page;
  while (!page && Date.now() < deadline) {
    const targets = await fetch("http://" + origin.host + "/json/list").then((response) => response.json());
    page = targets.find((target) => target.type === "page" && target.url.startsWith("file:"));
    if (!page) await sleep(100);
  }
  assert.ok(page, "No application renderer was registered with DevTools");
  devtools = await DevTools.connect(page.webSocketDebuggerUrl);
  await devtools.send("Runtime.enable");
  await devtools.send("Page.enable");
  await devtools.send("Log.enable");
}

try {
  await launch();
  await poll(
    () => document.querySelector(".app-version")?.textContent && document.querySelector("#destination-folder")?.value,
    "application startup",
  );
  assert.equal(await devtools.evaluate(() => typeof window.tidy?.analyze), "function");
  assert.equal(await devtools.evaluate(() => typeof require + ":" + typeof process), "undefined:undefined");
  assert.equal(await devtools.evaluate(() => document.querySelector("#destination-folder").value), destDir);
  checks.push("real renderer, isolated preload, main process, and worker started");
  await viewport(1240, 860);

  await click("nav.view-tabs button:nth-child(1)");
  await key("Tab", "Tab");
  await key("Enter", "Enter");
  await poll(() => document.querySelector("h1")?.textContent === "Organization rules", "keyboard navigation to Rules");
  checks.push("Tab and Enter navigate the interface");
  const configPath = path.join(configHome, "tidy", "config.json");
  const savedConfig = fs.readFileSync(configPath, "utf8");
  const pickerValue = () => document.querySelector("#category-date .picker-value")?.textContent;
  const originalChoice = await devtools.evaluate(pickerValue);
  await devtools.evaluate(() => document.querySelector("#category-date").focus());
  await key("Enter", "Enter");
  await poll(
    () => document.querySelector("#category-date")?.getAttribute("aria-expanded") === "true",
    "keyboard-opened rule choices",
  );
  await key("ArrowDown", "ArrowDown");
  await key("Escape", "Escape");
  await poll(
    () => document.querySelector("#category-date")?.getAttribute("aria-expanded") === "false",
    "Escape dismissing rule choices",
  );
  assert.equal(await devtools.evaluate(pickerValue), originalChoice);
  await key("Enter", "Enter");
  await poll(
    () => document.querySelector("#category-date")?.getAttribute("aria-expanded") === "true",
    "reopened rule choices",
  );
  await key("End", "End");
  await key("Enter", "Enter");
  await poll(
    (originalChoice) => document.querySelector("#category-date .picker-value")?.textContent !== originalChoice,
    "keyboard choice selection",
    originalChoice,
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), savedConfig);
  assert.ok(!(await devtools.evaluate(() => Boolean(document.querySelector(".notice-success")))));
  await click(".editor-actions .button-secondary", "Discard changes");
  await poll(() => !document.querySelector(".unsaved-dot"), "discarding the unsaved keyboard choice");
  checks.push("Enter opens and selects rule choices; Escape preserves the value; selection does not save the form");
  await click("nav.view-tabs button:nth-child(1)");
  await type("#source-folder", sourceDir);
  await click(".setup-panel button[type=submit]");
  await poll(() => document.querySelectorAll(".file-table tbody tr").length === 4, "the four-file preview");
  const targetLabels = await devtools.evaluate(() =>
    [...document.querySelectorAll(".file-table tbody .destination-path")].map((element) => element.textContent),
  );
  assert.equal(targetLabels.length, 4);
  assert.ok(
    targetLabels.every((target) => !path.isAbsolute(target)),
    "Preview destinations should be relative to the selected archive: " + JSON.stringify(targetLabels),
  );
  assert.equal(await devtools.evaluate(() => document.querySelector("#destination-folder").value), destDir);
  checks.push("preview shows archive-relative destinations while preserving the selected input path");
  for (const [name, contents] of samples) assert.equal(fs.readFileSync(path.join(sourceDir, name), "utf8"), contents);
  assert.deepEqual(fs.readdirSync(destDir), []);
  checks.push("preview leaves all source files and destination unchanged");
  await layout("English wide layout");
  await screenshot("organize-en-wide");
  await responsiveLayouts();
  assert.equal(await devtools.evaluate(() => document.querySelectorAll(".file-table tbody tr").length), 4);
  await click(".file-name", "notes.txt");
  await poll(
    () => document.querySelector('[data-testid="similar-files"]')?.textContent.includes("notes copy.txt"),
    "similar-file details",
  );
  await click("button[lang='zh-CN']");
  await poll(() => document.documentElement.lang === "zh-CN", "Simplified Chinese");
  assert.equal(await devtools.evaluate(() => document.querySelector("#source-folder").value), sourceDir);
  assert.equal(await devtools.evaluate(() => document.querySelectorAll(".file-table tbody tr").length), 4);
  await screenshot("similar-zh-CN-wide");
  await viewport(760, 600);
  await layout("Chinese narrow layout");
  await devtools.evaluate(() =>
    document.querySelector('[data-testid="similar-files"]').scrollIntoView({ block: "start" }),
  );
  await executionVisible("Selected-file details keep the execution action visible at the native minimum");
  await screenshot("similar-zh-CN-narrow");
  checks.push("locale switching preserves folder inputs, preview, and similar-file details");

  await click(".execution-bar .button-primary");
  await poll(() => Boolean(document.querySelector(".notice-success")), "organization success");
  assert.deepEqual(fs.readdirSync(sourceDir), []);
  const runsDirectory = path.join(destDir, ".tidy", "runs");
  assert.equal(fs.readdirSync(runsDirectory).filter((name) => name.endsWith(".json")).length, 1);
  const similarReport = path.join(destDir, ".tidy", "similar.md");
  assert.match(fs.readFileSync(similarReport, "utf8"), /notes copy\.txt/);
  checks.push("UI execution moves files and persists undo and similar-file reports");

  const occupied = path.join(sourceDir, "notes.txt");
  fs.writeFileSync(occupied, "An independently created file that must not be overwritten.");
  await click("nav.view-tabs button:nth-child(3)");
  await poll(() => Boolean(document.querySelector(".last-run-content button")), "the persisted undo record");
  assert.ok(await devtools.evaluate(() => Boolean(document.querySelector('[data-testid="open-similar-report"]'))));
  await click(".last-run-content .button-secondary");
  await poll(() => Boolean(document.querySelector(".undo-confirmation")), "undo confirmation");
  await click(".undo-confirmation .button-primary");
  await poll(() => Boolean(document.querySelector('[data-testid="undo-failures"]')), "partial undo details");
  assert.equal(fs.readFileSync(occupied, "utf8"), "An independently created file that must not be overwritten.");
  assert.equal(fs.readdirSync(sourceDir).length, 4);
  await layout("Chinese partial-undo narrow layout");
  await devtools.evaluate(() =>
    document.querySelector('[data-testid="undo-failures"]').scrollIntoView({ block: "start" }),
  );
  await screenshot("undo-failures-zh-CN-narrow");
  fs.unlinkSync(occupied);
  await poll(() => {
    const retry = document.querySelector('[data-testid="undo-retry"]');
    return retry && !retry.disabled;
  }, "available undo retry");
  await click('[data-testid="undo-retry"]');
  await poll(() => Boolean(document.querySelector(".undo-confirmation")), "retry confirmation");
  await click(".undo-confirmation .button-primary");
  await poll(() => Boolean(document.querySelector(".notice-success")), "completed undo retry");
  for (const [name, contents] of samples) assert.equal(fs.readFileSync(path.join(sourceDir, name), "utf8"), contents);
  assert.equal(fs.readdirSync(runsDirectory).filter((name) => name.endsWith(".json")).length, 0);
  checks.push("partial undo preserves occupied files, explains failures, and retries the same record");

  const corrupt = path.join(runsDirectory, "9999-corrupt.json");
  fs.writeFileSync(corrupt, "{broken");
  const previousLoad = await devtools.evaluate(() => performance.timeOrigin);
  await devtools.send("Page.reload");
  await poll(
    (previousLoad) =>
      performance.timeOrigin !== previousLoad &&
      document.documentElement?.lang === "zh-CN" &&
      Boolean(document.querySelector(".app-version")?.textContent),
    "persisted language after reload",
    previousLoad,
  );
  await click("nav.view-tabs button:nth-child(3)");
  await poll(() => Boolean(document.querySelector('[data-testid="run-load-error"]')), "undo-record load error");
  await screenshot("activity-load-error-zh-CN-narrow");
  fs.unlinkSync(corrupt);
  await click('[data-testid="run-load-retry"]');
  await poll(
    () =>
      !document.querySelector('[data-testid="run-load-error"]') &&
      document.querySelector('[data-testid="run-load-state"]')?.dataset.state === "empty" &&
      Boolean(document.querySelector('[data-testid="run-empty"]')),
    "undo-record load retry",
  );
  checks.push("Activity distinguishes corrupt records from an empty history and retries loading");
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, "preferences.json"), "utf8")).locale, "zh-CN");
  await click("button[lang='en']");
  await poll(() => document.documentElement.lang === "en", "English language");
  await layout("English narrow layout");
  await screenshot("activity-en-narrow");
  assert.deepEqual(devtools.errors, [], "The renderer reported uncaught exceptions");
} catch (error) {
  failure = error;
  process.exitCode = 1;
  console.error(error);
  if (devtools) {
    await screenshot("failure").catch(() => {});
    const body = await devtools.evaluate(() => document.body.innerText).catch(() => "");
    fs.writeFileSync(path.join(output, "failure.txt"), String(error.stack || error) + "\n\n" + body);
  }
} finally {
  fs.writeFileSync(path.join(output, "application.log"), transcript);
  fs.writeFileSync(
    path.join(output, "renderer.log"),
    JSON.stringify({ errors: devtools?.errors ?? [], logs: devtools?.logs ?? [] }, null, 2) + "\n",
  );
  try {
    devtools?.socket.close();
    if (child?.pid) {
      if (process.platform === "win32") {
        await new Promise((resolve) =>
          execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { timeout: 5000 }, resolve),
        );
      } else {
        // A separate process group keeps cleanup restricted to this smoke run,
        // including renderers left behind if the main process exits early.
        for (const signal of ["SIGTERM", "SIGKILL"]) {
          try {
            process.kill(-child.pid, signal);
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
          if (signal === "SIGTERM") await closesWithin(childClosed, 3000);
        }
      }
      const closed = await closesWithin(childClosed, 5000);
      assert.ok(closed, "The smoke application did not terminate; temporary files were preserved at " + temporary);
    }
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    process.exitCode = 1;
    failure ??= error;
    console.error("Smoke cleanup failed:", error);
  }
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        ok: !failure,
        packaged: values.packaged,
        platform: process.platform,
        checks,
        ...(failure ? { error: String(failure) } : {}),
      },
      null,
      2,
    ) + "\n",
  );
  if (!failure) {
    for (const name of ["failure.png", "failure.txt"]) fs.rmSync(path.join(output, name), { force: true });
    console.log("Desktop smoke passed (" + checks.length + " checks). Artifacts: " + output);
  }
}
