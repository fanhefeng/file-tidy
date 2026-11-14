import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { analyze, executePlan, loadConfig, resolveConfig, saveConfig, undoLastRun } from "../src/core/index.js";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-validation-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceDir = path.join(dir, "source");
  const destDir = path.join(dir, "archive");
  const outside = path.join(dir, "outside");
  for (const folder of [sourceDir, destDir, outside]) fs.mkdirSync(folder);
  return { dir, sourceDir, destDir, outside };
}

function entry(from, to) {
  return { from, to, name: path.basename(from), action: "archive", size: fs.statSync(from).size };
}

test("execution rejects every escaping target before writing records or moving an earlier safe file", (t) => {
  const { sourceDir, destDir, outside } = fixture(t);
  const first = path.join(sourceDir, "first.txt");
  const second = path.join(sourceDir, "second.txt");
  fs.writeFileSync(first, "first");
  fs.writeFileSync(second, "second");
  fs.symlinkSync(outside, path.join(destDir, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () =>
      executePlan(
        [
          entry(first, path.join(destDir, "safe", "first.txt")),
          entry(second, path.join(destDir, "linked", "second.txt")),
        ],
        { sourceDir, destDir },
      ),
    { code: "PATH_ESCAPES", role: "destination" },
  );
  assert.equal(fs.readFileSync(first, "utf8"), "first");
  assert.equal(fs.readFileSync(second, "utf8"), "second");
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.ok(!fs.existsSync(path.join(destDir, ".tidy")));
  assert.ok(!fs.existsSync(path.join(destDir, "safe")));
});

test("an analyzed plan refuses edited source content before creating any records", async (t) => {
  const { sourceDir, destDir } = fixture(t);
  const source = path.join(sourceDir, "note.txt");
  fs.writeFileSync(source, "before");
  const analysis = await analyze({ sourceDir, destDir, config: resolveConfig({ detect: false }) });
  fs.writeFileSync(source, "after preview");
  assert.throws(() => executePlan(analysis.entries, { sourceDir, destDir, snapshot: analysis.snapshot }), {
    code: "PLAN_STALE",
    reason: "source",
    path: source,
  });
  assert.equal(fs.readFileSync(source, "utf8"), "after preview");
  assert.deepEqual(fs.readdirSync(destDir), []);
});

test("a duplicate cannot be quarantined after its archived keeper is removed", async (t) => {
  const { sourceDir, destDir } = fixture(t);
  const source = path.join(sourceDir, "copy.txt");
  const keeper = path.join(destDir, "kept.txt");
  fs.writeFileSync(source, "identical");
  fs.writeFileSync(keeper, "identical");
  const analysis = await analyze({ sourceDir, destDir, config: resolveConfig({ detect: false }) });
  assert.equal(analysis.entries[0].action, "duplicate");
  fs.unlinkSync(keeper);
  assert.throws(() => executePlan(analysis.entries, { sourceDir, destDir, snapshot: analysis.snapshot }), {
    code: "PLAN_STALE",
    reason: "keeper",
    path: keeper,
  });
  assert.equal(fs.readFileSync(source, "utf8"), "identical");
  assert.deepEqual(fs.readdirSync(destDir), []);
});

test("a loaded configuration changed before analysis cannot produce an executable plan", async (t) => {
  const { dir, sourceDir, destDir } = fixture(t);
  const source = path.join(sourceDir, "note.txt");
  fs.writeFileSync(source, "original");
  const configPath = path.join(dir, "rules.json");
  fs.writeFileSync(configPath, JSON.stringify({ detect: false }));
  const config = loadConfig(configPath);
  fs.writeFileSync(configPath, JSON.stringify({ detect: false, folderPrefix: "new_" }));
  await assert.rejects(() => analyze({ sourceDir, destDir, config }), {
    code: "PLAN_STALE",
    reason: "config",
    path: configPath,
  });
  assert.equal(fs.readFileSync(source, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(destDir), []);
});

for (const replacement of [false, true]) {
  test(`execution refuses ${replacement ? "atomic replacements" : "in-place edits"} with unchanged source size and mtime`, async (t) => {
    const { sourceDir, destDir } = fixture(t);
    const source = path.join(sourceDir, "note.txt");
    fs.writeFileSync(source, "before");
    fs.utimesSync(source, 1700000000, 1700000000);
    const analysis = await analyze({ sourceDir, destDir, config: resolveConfig({ detect: false }) });
    const before = fs.statSync(source);
    await delay(20);
    if (replacement) {
      const temporary = path.join(sourceDir, "replacement.tmp");
      fs.writeFileSync(temporary, "edited");
      fs.utimesSync(temporary, 1700000000, 1700000000);
      fs.renameSync(temporary, source);
    } else {
      fs.writeFileSync(source, "edited");
      fs.utimesSync(source, 1700000000, 1700000000);
    }
    const after = fs.statSync(source);
    assert.equal(before.size, after.size);
    assert.equal(before.mtimeMs, after.mtimeMs);
    assert.throws(() => executePlan(analysis.entries, { sourceDir, destDir, snapshot: analysis.snapshot }), {
      code: "PLAN_STALE",
      reason: "source",
    });
    assert.equal(fs.readFileSync(source, "utf8"), "edited");
    assert.deepEqual(fs.readdirSync(destDir), []);
  });
}

for (const reason of ["source", "keeper", "config"]) {
  test(`analysis rejects a ${reason} that changes while detection is running`, async (t) => {
    const { dir, sourceDir, destDir } = fixture(t);
    const source = path.join(sourceDir, "copy.txt");
    const keeper = path.join(destDir, "kept.txt");
    fs.writeFileSync(source, "identical");
    fs.writeFileSync(keeper, "identical");
    const configPath = path.join(dir, "rules.json");
    const config = saveConfig({ detect: false }, configPath);
    const target = { source, keeper, config: configPath }[reason];
    await assert.rejects(
      () =>
        analyze({
          sourceDir,
          destDir,
          config,
          onPhase: (phase) => {
            if (phase === "planning") fs.writeFileSync(target, reason === "config" ? "{}" : "changed");
          },
        }),
      { code: "PLAN_STALE", reason, path: target },
    );
    assert.ok(fs.existsSync(source));
    assert.ok(!fs.existsSync(path.join(destDir, ".tidy")));
  });
}

test("execution refuses rules changed after preview without leaking internal revisions to the config", async (t) => {
  const { dir, sourceDir, destDir } = fixture(t);
  fs.writeFileSync(path.join(sourceDir, "note.txt"), "content");
  const configPath = path.join(dir, "rules.json");
  const config = saveConfig({ detect: false }, configPath);
  const analysis = await analyze({ sourceDir, destDir, config });
  assert.ok(config._revision);
  assert.equal(
    Object.keys(JSON.parse(fs.readFileSync(configPath, "utf8"))).some((key) => key.startsWith("_")),
    false,
  );
  fs.writeFileSync(configPath, "{}");
  assert.throws(() => executePlan(analysis.entries, { sourceDir, destDir, snapshot: analysis.snapshot }), {
    code: "PLAN_STALE",
    reason: "config",
    path: configPath,
  });
  assert.deepEqual(fs.readdirSync(destDir), []);
});

test("a keeper in the same source batch may move without invalidating later duplicates", async (t) => {
  const { sourceDir, destDir } = fixture(t);
  fs.writeFileSync(path.join(sourceDir, "a.txt"), "identical");
  fs.writeFileSync(path.join(sourceDir, "z copy.txt"), "identical");
  const analysis = await analyze({ sourceDir, destDir, config: resolveConfig({ detect: false }) });
  assert.deepEqual(
    analysis.entries.map((item) => item.action),
    ["archive", "duplicate"],
  );
  const result = executePlan(analysis.entries, { sourceDir, destDir, snapshot: analysis.snapshot });
  assert.equal(result.moved.length, 2);
  assert.equal(undoLastRun(destDir).restored, 2);
});

test("execution permits directory links that stay inside the destination and remains undoable", async (t) => {
  const { sourceDir, destDir } = fixture(t);
  fs.writeFileSync(path.join(sourceDir, "note.txt"), "content");
  const real = path.join(destDir, "real");
  fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(destDir, "ft_Documents"), process.platform === "win32" ? "junction" : "dir");
  const analysis = await analyze({
    sourceDir,
    destDir,
    config: resolveConfig({ detect: false, granularity: { Documents: "none" } }),
  });
  executePlan(analysis.entries, { sourceDir, destDir, snapshot: analysis.snapshot });
  assert.equal(fs.readFileSync(path.join(real, "note.txt"), "utf8"), "content");
  assert.equal(undoLastRun(destDir).restored, 1);
  assert.equal(fs.readFileSync(path.join(sourceDir, "note.txt"), "utf8"), "content");
});

test("source links out of the selected tree are refused before records are created", (t) => {
  const { sourceDir, destDir, outside } = fixture(t);
  const foreign = path.join(outside, "foreign.txt");
  fs.writeFileSync(foreign, "foreign");
  // Directory junctions do not need elevated symlink privileges on Windows.
  fs.symlinkSync(outside, path.join(sourceDir, "linked"), process.platform === "win32" ? "junction" : "dir");
  const source = path.join(sourceDir, "linked", "foreign.txt");
  assert.throws(() => executePlan([entry(source, path.join(destDir, "foreign.txt"))], { sourceDir, destDir }), {
    code: "PATH_ESCAPES",
    role: "source",
  });
  assert.equal(fs.readFileSync(foreign, "utf8"), "foreign");
  assert.deepEqual(fs.readdirSync(destDir), []);
});

for (const reason of ["source", "destination"]) {
  test(`a selected ${reason} root redirected after preview makes the plan stale`, async (t) => {
    const { sourceDir, destDir, outside } = fixture(t);
    fs.writeFileSync(path.join(sourceDir, "note.txt"), "content");
    const analysis = await analyze({ sourceDir, destDir, config: resolveConfig({ detect: false }) });
    const root = reason === "source" ? sourceDir : destDir;
    const original = path.join(outside, "original");
    fs.renameSync(root, original);
    fs.symlinkSync(original, root, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => executePlan(analysis.entries, { sourceDir, destDir, snapshot: analysis.snapshot }), {
      code: "PLAN_STALE",
      reason,
    });
    assert.ok(!fs.existsSync(path.join(destDir, ".tidy")));
    assert.ok(fs.existsSync(path.join(sourceDir, "note.txt")));
  });
}

test("analysis notices a selected root redirected while scanning begins", async (t) => {
  const { sourceDir, destDir, outside } = fixture(t);
  fs.writeFileSync(path.join(sourceDir, "note.txt"), "content");
  await assert.rejects(
    () =>
      analyze({
        sourceDir,
        destDir,
        config: resolveConfig({ detect: false }),
        onPhase: (phase) => {
          if (phase !== "scanning") return;
          const original = path.join(outside, "original");
          fs.renameSync(sourceDir, original);
          fs.symlinkSync(original, sourceDir, process.platform === "win32" ? "junction" : "dir");
        },
      }),
    { code: "PLAN_STALE", reason: "source" },
  );
  assert.deepEqual(fs.readdirSync(destDir), []);
  assert.equal(fs.readFileSync(path.join(sourceDir, "note.txt"), "utf8"), "content");
});
