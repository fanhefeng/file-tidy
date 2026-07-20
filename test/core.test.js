import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildExtIndex, canonicalPath, isInsideDir } from "../src/core/config.js";
import { findDuplicates } from "../src/core/dedup.js";
import { executePlan } from "../src/core/execute.js";
import { buildPlan } from "../src/core/plan.js";
import { scanDest, scanSource } from "../src/core/scan.js";
import { undoLastRun } from "../src/core/undo.js";

const extIndex = buildExtIndex({ categories: { Images: ["jpg"], Documents: ["txt"] } });
const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tidy-test-"));
}

function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

async function plan(sourceDir, destDir, scanOpts = {}) {
  const sourceFiles = scanSource(sourceDir, scanOpts);
  const duplicates = await findDuplicates(sourceFiles, scanDest(destDir));
  return buildPlan({ sourceFiles, duplicates, destDir, extIndex, fallbackCategory: "Others" });
}

test("归档到 类型/年月 并写运行清单", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "a.txt", "aaa");
  write(src, "b.jpg", "not really a jpg");
  write(src, "c.xyz", "zz");

  const { manifestPath } = executePlan(await plan(src, dest), { destDir: dest, sourceDir: src });

  assert.ok(fs.existsSync(path.join(dest, "Documents", ym, "a.txt")));
  assert.ok(fs.existsSync(path.join(dest, "Images", ym, "b.jpg")));
  assert.ok(fs.existsSync(path.join(dest, "Others", ym, "c.xyz")));
  assert.ok(!fs.existsSync(path.join(src, "a.txt")));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.moves.length, 3);
  assert.equal(manifest.sourceDir, src);
  // 原子写不残留临时文件
  assert.equal(fs.readdirSync(path.dirname(manifestPath)).filter((f) => f.endsWith(".tmp")).length, 0);
});

test("同内容不同名的文件被隔离到 Duplicates 并写 manifest.md", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "photo.jpg", "SAMEBYTES");
  write(src, "photo copy.jpg", "SAMEBYTES");

  const entries = await plan(src, dest);
  const dup = entries.find((e) => e.action === "duplicate");
  assert.equal(dup.name, "photo copy.jpg"); // “copy”名字罚分，原名保留
  assert.ok(dup.keeperPath.endsWith("photo.jpg"));

  executePlan(entries, { destDir: dest, sourceDir: src });
  assert.ok(fs.existsSync(path.join(dest, "Images", ym, "photo.jpg")));
  assert.ok(fs.existsSync(path.join(dest, "Duplicates", "photo copy.jpg")));
  assert.match(fs.readFileSync(path.join(dest, "Duplicates", "manifest.md"), "utf8"), /photo copy\.jpg/);
});

test("与目标目录已归档文件重复的新文件被隔离", async () => {
  const src = tmp();
  const dest = tmp();
  const kept = write(dest, `Images/${ym}/x.jpg`, "CONTENT");
  write(src, "y.jpg", "CONTENT");

  const entries = await plan(src, dest);
  assert.equal(entries[0].action, "duplicate");
  assert.equal(entries[0].keeperPath, kept);
});

test("撤销：全部还原、清理空目录、清单退役；再次撤销返回 null", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "a.txt", "aaa");
  write(src, "b.jpg", "bbbb");
  executePlan(await plan(src, dest), { destDir: dest, sourceDir: src });

  const result = undoLastRun(dest);
  assert.equal(result.retired, true);
  assert.equal(result.restored, 2);
  assert.equal(result.failures.length, 0);
  assert.ok(result.removedDirs.length >= 2);
  assert.ok(fs.existsSync(path.join(src, "a.txt")));
  assert.ok(!fs.existsSync(path.join(dest, "Documents")));
  assert.ok(!fs.existsSync(path.join(dest, "Images")));

  assert.equal(undoLastRun(dest), null);
});

test("撤销：原位置被占时报 occupied，清单保留", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "a.txt", "aaa");
  executePlan(await plan(src, dest), { destDir: dest, sourceDir: src });
  write(src, "a.txt", "different now");

  const result = undoLastRun(dest);
  assert.equal(result.retired, false);
  assert.equal(result.failures[0].code, "occupied");
  assert.ok(fs.existsSync(result.manifestPath)); // 未退役，可重试
  assert.ok(fs.existsSync(path.join(dest, "Documents", ym, "a.txt")));
});

test("目标同名冲突时追加 ' (n)' 后缀", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "sub1/same.txt", "one");
  write(src, "sub2/same.txt", "two");

  executePlan(await plan(src, dest, { recursive: true }), { destDir: dest, sourceDir: src });
  assert.ok(fs.existsSync(path.join(dest, "Documents", ym, "same.txt")));
  assert.ok(fs.existsSync(path.join(dest, "Documents", ym, "same (1).txt")));
});

test("isInsideDir 与 canonicalPath", () => {
  const t = tmp();
  assert.equal(isInsideDir(t, t), true);
  assert.equal(isInsideDir(t, path.join(t, "sub")), true);
  assert.equal(isInsideDir(path.join(t, "sub"), t), false);
  // 不存在的路径：规范化最深的已存在祖先，再拼回剩余部分
  assert.equal(canonicalPath(path.join(t, "nope", "deep")), path.join(canonicalPath(t), "nope", "deep"));
});
