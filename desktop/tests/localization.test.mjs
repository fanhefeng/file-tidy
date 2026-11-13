import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { build } from "vite";

test("desktop language preferences and errors are independent of classification settings", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-locale-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, "locale.ts");
  const source = fileURLToPath(new URL("../src/", import.meta.url));
  fs.writeFileSync(
    entry,
    ["main/preferences.ts", "main/errors.ts", "locale.ts"]
      .map((file) => `export * from ${JSON.stringify(path.join(source, file))};`)
      .join("\n"),
  );
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: entry,
      outDir: path.join(root, "built"),
      rollupOptions: { output: { entryFileNames: "locale.mjs" } },
    },
  });
  const { readPreferences, writePreferences, resolveLocale, describeError, desktopError, describeReportError } =
    await import(pathToFileURL(path.join(root, "built/locale.mjs")));
  const preferencesPath = path.join(root, "preferences.json");

  await t.test("system locale provides the first-run default and a saved choice wins", () => {
    assert.equal(resolveLocale("zh-Hans-CN"), "zh-CN");
    assert.equal(resolveLocale("en-GB"), "en");
    assert.equal(resolveLocale("fr-FR"), "en");
    assert.deepEqual(readPreferences(preferencesPath, "zh-Hans-CN"), { locale: "zh-CN" });
    assert.ok(!fs.existsSync(preferencesPath));
    writePreferences(preferencesPath, "en");
    assert.deepEqual(readPreferences(preferencesPath, "zh-CN"), { locale: "en" });
    writePreferences(preferencesPath, "zh-CN");
    assert.deepEqual(readPreferences(preferencesPath, "en-US"), { locale: "zh-CN" });
  });

  await t.test("bad preference changes preserve the saved value and damaged files use the system default", () => {
    const before = fs.readFileSync(preferencesPath, "utf8");
    assert.throws(() => writePreferences(preferencesPath, "fr"), { code: "LOCALE_INVALID" });
    assert.equal(fs.readFileSync(preferencesPath, "utf8"), before);
    assert.deepEqual(
      fs.readdirSync(root).filter((name) => name.endsWith(".tmp")),
      [],
    );
    fs.writeFileSync(preferencesPath, "{broken");
    assert.deepEqual(readPreferences(preferencesPath, "en-US"), { locale: "en" });
    assert.equal(fs.readFileSync(preferencesPath, "utf8"), "{broken");
  });

  await t.test("preference write errors and core validation messages have localized recovery text", () => {
    const parentFile = path.join(root, "plain-file");
    fs.writeFileSync(parentFile, "unchanged");
    assert.throws(() => writePreferences(path.join(parentFile, "preferences.json"), "en"), {
      code: "PREFERENCES_WRITE",
    });
    assert.equal(fs.readFileSync(parentFile, "utf8"), "unchanged");
    const invalid = {
      code: "CONFIG_INVALID",
      field: "groupBy.Audios",
      reason: "must be a list of unique metadata fields: artist, albumArtist, album, title, genre, year",
    };
    assert.match(describeError(invalid, "zh-CN"), /规则字段 groupBy\.Audios 无效/);
    assert.ok(!describeError(invalid, "zh-CN").includes("must be"));
    assert.match(describeError(invalid, "en"), /Invalid rule/);
    assert.match(describeError(desktopError("PREVIEW_EXPIRED"), "zh-CN"), /预览已失效/);
    assert.match(describeError(desktopError("PREVIEW_EXPIRED"), "en"), /expired/);
    assert.match(describeReportError("duplicates", "zh-CN"), /重复文件报告/);
  });
});

test("worker errors use the language of each request without changing the rules file", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-worker-locale-"));
  const configPath = path.join(root, "config.json");
  const original = JSON.stringify({ detect: false });
  fs.writeFileSync(configPath, original);
  const worker = new Worker(new URL("../out/main/worker.js", import.meta.url), { workerData: { configPath } });
  t.after(async () => {
    await worker.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let serial = 0;
  const call = (locale, method, input) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const receive = (message) => {
        if (message.id !== id) return;
        worker.off("message", receive);
        message.ok ? resolve(message.value) : reject(new Error(message.error));
      };
      worker.on("message", receive);
      worker.postMessage({ id, locale, method, input });
    });
  await assert.rejects(call("zh-CN", "execute", "missing"), /此预览已失效/);
  await assert.rejects(call("en", "execute", "missing"), /expired/);
  await assert.rejects(call("zh-CN", "saveConfig", "{invalid}"), /不是有效的 JSON/);
  await assert.rejects(call("zh-CN", "saveConfig", '{"folderPrefix":"../bad"}'), /规则字段 folderPrefix 无效/);
  assert.equal(fs.readFileSync(configPath, "utf8"), original);
});
