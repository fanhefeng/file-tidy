import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";

function harness(t, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-desktop-"));
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
  const call = (method, input) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, (result) => (result.ok ? resolve(result.value) : reject(new Error(result.error))));
      worker.postMessage({ id, method, input });
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
    failures: 0,
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
  fs.symlinkSync(outside, path.join(h.destDir, "ft_Documents"), "dir");
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
    failures: 0,
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
