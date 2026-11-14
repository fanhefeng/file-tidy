import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";

function harness(t, config = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tidy-desktop-")));
  const sourceDir = path.join(root, "source");
  const destDir = path.join(root, "archive");
  const configPath = path.join(root, "config.json");
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(destDir);
  fs.writeFileSync(configPath, JSON.stringify({ detect: false, ...config }));
  const worker = new Worker(new URL("../out/main/worker.js", import.meta.url), {
    workerData: { configPath, version: "test" },
  });
  let serial = 0;
  const pending = new Map();
  worker.on("message", (result) => {
    if (!result.id) return;
    const callback = pending.get(result.id);
    pending.delete(result.id);
    callback(result);
  });
  t.after(async () => {
    await worker.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const call = (method, input, locale = "en") =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, (result) => (result.ok ? resolve(result.value) : reject(new Error(result.error))));
      worker.postMessage({ id, method, input, locale });
    });
  return {
    root,
    sourceDir,
    destDir,
    configPath,
    call,
    preview: () => call("analyze", { sourceDir, destDir, inPlace: false, recursive: true }),
  };
}

test("desktop worker previews custom extensions, executes once, and undoes from the persisted record", async (t) => {
  const h = harness(t, { extensions: { blend: "Design" }, granularity: { Design: "none" } });
  const from = path.join(h.sourceDir, "scene.blend");
  fs.writeFileSync(from, "project data");
  const settings = await h.call("getSettings");
  assert.equal(settings.configPath, h.configPath);
  const plan = await h.preview();
  assert.equal(plan.destDir, fs.realpathSync(h.destDir));
  assert.equal(plan.counts.archive, 1);
  assert.equal(plan.entries[0].category, "Design");
  assert.ok(fs.existsSync(from));
  assert.deepEqual(fs.readdirSync(h.destDir), []);
  const result = await h.call("execute", plan.planId);
  assert.equal(result.moved, 1);
  assert.ok(fs.existsSync(result.manifestPath));
  assert.ok(fs.existsSync(plan.entries[0].to));
  assert.equal((await h.call("getLastRun", h.destDir)).moves, 1);
  await assert.rejects(h.call("execute", plan.planId), /expired/);
  assert.deepEqual(await h.call("undo", { destDir: h.destDir, manifestPath: result.manifestPath }), {
    restored: 1,
    failures: [],
  });
  assert.equal(fs.readFileSync(from, "utf8"), "project data");
  assert.equal(await h.call("getLastRun", h.destDir), null);
});

test("desktop rejects changed source files and modified rules after a preview", async (t) => {
  const h = harness(t);
  const from = path.join(h.sourceDir, "report.txt");
  fs.writeFileSync(from, "first");
  const plan = await h.preview();
  fs.writeFileSync(from, "different contents");
  await assert.rejects(h.call("execute", plan.planId), /changed/);
  assert.ok(fs.existsSync(from));
  const second = await h.preview();
  fs.writeFileSync(h.configPath, JSON.stringify({ detect: false, folderPrefix: "new_" }));
  await assert.rejects(h.call("execute", second.planId), /rules changed/i);
  assert.ok(fs.existsSync(from));
});

test("desktop rules validate before saving and invalidate the old preview", async (t) => {
  const h = harness(t);
  fs.writeFileSync(path.join(h.sourceDir, "report.txt"), "contents");
  const original = fs.readFileSync(h.configPath, "utf8");
  await assert.rejects(h.call("saveConfig", "{invalid}"), /valid JSON/);
  await assert.rejects(h.call("saveConfig", '{"folderPrefix":"../escape"}'), /Invalid rule/);
  assert.equal(fs.readFileSync(h.configPath, "utf8"), original);
  const plan = await h.preview();
  await h.call("saveConfig", JSON.stringify({ extensions: { xyz: "Custom" } }));
  await assert.rejects(h.call("execute", plan.planId), /expired/);
});

test("desktop rejects changed or missing duplicate keepers before moving any file", async (t) => {
  for (const change of ["replace", "remove"]) {
    await t.test(change, async (t) => {
      const h = harness(t);
      const source = path.join(h.sourceDir, "copy.txt");
      const keeper = path.join(h.destDir, "original.txt");
      fs.writeFileSync(source, "matching contents");
      fs.writeFileSync(keeper, "matching contents");
      const plan = await h.preview();
      assert.equal(plan.counts.duplicate, 1);
      if (change === "replace") fs.writeFileSync(keeper, "different content");
      else fs.unlinkSync(keeper);

      await assert.rejects(h.call("execute", plan.planId), /kept copy changed or is no longer available/);
      assert.equal(fs.readFileSync(source, "utf8"), "matching contents");
      assert.ok(!fs.existsSync(path.join(h.destDir, ".tidy")));
      await assert.rejects(h.call("execute", plan.planId), /expired/);
    });
  }
});

test("desktop localizes stale shared snapshots and keeps failed execution single-use", async (t) => {
  const h = harness(t);
  const source = path.join(h.sourceDir, "report.txt");
  fs.writeFileSync(source, "original contents");
  const plan = await h.preview();
  fs.unlinkSync(source);
  await assert.rejects(h.call("execute", plan.planId, "zh-CN"), /预览中的文件已发生变化或不存在/);
  assert.ok(!fs.existsSync(path.join(h.destDir, ".tidy")));
  await assert.rejects(h.call("execute", plan.planId, "zh-CN"), /预览已失效/);
});

test("desktop refuses overlapping roots and destination symlinks escaping after preview", async (t) => {
  const h = harness(t);
  const nested = path.join(h.sourceDir, "nested");
  fs.mkdirSync(nested);
  await assert.rejects(
    h.call("analyze", { sourceDir: h.sourceDir, destDir: nested, inPlace: false, recursive: true }),
    /separate folders/,
  );
  const from = path.join(h.sourceDir, "report.txt");
  fs.writeFileSync(from, "contents");
  const plan = await h.preview();
  const outside = path.join(h.root, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(h.destDir, "ft_Documents"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(h.call("execute", plan.planId), /leaves the selected folders/);
  assert.ok(fs.existsSync(from));
});

test("desktop undo stays bound to the run the user reviewed", async (t) => {
  const h = harness(t);
  fs.writeFileSync(path.join(h.sourceDir, "first.txt"), "first file");
  const first = await h.call("execute", (await h.preview()).planId);
  fs.writeFileSync(path.join(h.sourceDir, "second.txt"), "second file");
  const second = await h.call("execute", (await h.preview()).planId);
  await assert.rejects(
    h.call("undo", { destDir: h.destDir, manifestPath: first.manifestPath }),
    /latest organization record changed/,
  );
  assert.deepEqual(await h.call("undo", { destDir: h.destDir, manifestPath: second.manifestPath }), {
    restored: 1,
    failures: [],
  });
  assert.ok(fs.existsSync(path.join(h.sourceDir, "second.txt")));
  assert.ok(!fs.existsSync(path.join(h.sourceDir, "first.txt")));
});

test("desktop serializes concurrent startup reads without dropping a request", async (t) => {
  const h = harness(t);
  const results = await Promise.all([h.call("getSettings"), h.call("getSettings"), h.call("getDefaults")]);
  assert.equal(results[0].version, "test");
  assert.equal(results[1].configPath, h.configPath);
  assert.ok(results[2].categories.Audios.includes("mp3"));
});

test("desktop returns actionable undo failures and retries only the recorded run", async (t) => {
  const h = harness(t);
  const source = path.join(h.sourceDir, "report.txt");
  fs.writeFileSync(source, "original contents");
  const plan = await h.preview();
  const organized = await h.call("execute", plan.planId);
  fs.writeFileSync(source, "keep this new file");

  const partial = await h.call("undo", { destDir: h.destDir, manifestPath: organized.manifestPath });
  assert.deepEqual(partial, {
    restored: 0,
    failures: [{ from: source, to: plan.entries[0].to, code: "occupied" }],
  });
  assert.equal(fs.readFileSync(source, "utf8"), "keep this new file");
  assert.equal(fs.readFileSync(plan.entries[0].to, "utf8"), "original contents");
  assert.equal((await h.call("getLastRun", h.destDir)).manifestPath, organized.manifestPath);

  fs.unlinkSync(source);
  assert.deepEqual(await h.call("undo", { destDir: h.destDir, manifestPath: organized.manifestPath }), {
    restored: 1,
    failures: [],
  });
  assert.equal(fs.readFileSync(source, "utf8"), "original contents");
});

test("desktop reports corrupt organization records instead of treating them as absent", async (t) => {
  const h = harness(t);
  const runs = path.join(h.destDir, ".tidy", "runs");
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, "2026-11-13.json"), "{broken");
  await assert.rejects(h.call("getLastRun", h.destDir), /record cannot be read/);
  await assert.rejects(h.call("getLastRun", h.destDir, "zh-CN"), /无法读取最近一次整理的记录/);
});

test("desktop preserves filesystem error codes and details for undo recovery", async (t) => {
  const h = harness(t);
  const parent = path.join(h.sourceDir, "nested");
  fs.mkdirSync(parent);
  const source = path.join(parent, "report.txt");
  fs.writeFileSync(source, "original contents");
  const plan = await h.preview();
  const organized = await h.call("execute", plan.planId);
  fs.rmdirSync(parent);
  fs.writeFileSync(parent, "keep this blocking file");

  const partial = await h.call("undo", { destDir: h.destDir, manifestPath: organized.manifestPath });
  assert.equal(partial.restored, 0);
  assert.equal(partial.failures.length, 1);
  assert.equal(partial.failures[0].from, source);
  assert.equal(partial.failures[0].to, plan.entries[0].to);
  assert.equal(partial.failures[0].code, "error");
  assert.ok(["EEXIST", "ENOTDIR"].includes(partial.failures[0].errorCode));
  assert.equal(typeof partial.failures[0].message, "string");
  assert.equal(fs.readFileSync(parent, "utf8"), "keep this blocking file");
  assert.equal(fs.readFileSync(plan.entries[0].to, "utf8"), "original contents");
});

test("desktop exposes similar groups and restricts report access to issued, unchanged report paths", async (t) => {
  const h = harness(t, { detect: { health: false, similar: true, perceptual: false } });
  const first = path.join(h.sourceDir, "notes.txt");
  const second = path.join(h.sourceDir, "notes copy.txt");
  fs.writeFileSync(first, "first version");
  fs.writeFileSync(second, "another version of these notes");
  const plan = await h.preview();
  assert.equal(plan.counts.similar, 2);
  assert.deepEqual(plan.entries.find((entry) => entry.from === first).similar.peers, [second]);
  assert.equal(plan.entries.find((entry) => entry.from === first).similar.reason, "normalized-name");

  const result = await h.call("execute", plan.planId);
  const report = result.similarReport;
  assert.ok(report.id && report.path.endsWith("similar.md"));
  assert.equal(await h.call("resolveReport", report.id), fs.realpathSync(report.path));
  await assert.rejects(h.call("resolveReport", report.path), /report is no longer available/);
  await assert.rejects(h.call("resolveReport", "unknown-report"), /report is no longer available/);

  fs.unlinkSync(report.path);
  await assert.rejects(h.call("resolveReport", report.id, "zh-CN"), /这份说明已不存在或位置发生了变化/);
  fs.renameSync(path.dirname(report.path), path.join(h.destDir, ".tidy-original"));
  const outside = path.join(h.root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "similar.md"), "do not open this substituted report");
  fs.symlinkSync(outside, path.dirname(report.path), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(h.call("resolveReport", report.id), /report is no longer available/);
});
