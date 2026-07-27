import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import jpeg from "jpeg-js";
import { analyze } from "../src/core/analyze.js";
import { buildFolderNamer, organizedDirNames } from "../src/core/config.js";
import { executePlan } from "../src/core/execute.js";
import { checkHealth } from "../src/core/health.js";
import { clusterByHash, hashImages } from "../src/core/phash.js";
import { buildSubIndex, scanSource, subClassify } from "../src/core/scan.js";
import { findSimilar } from "../src/core/similar.js";

const BASE = {
  dest: null,
  categories: {
    Images: ["jpg", "jpeg", "png"],
    Documents: ["pdf", "epub", "txt", "xlsx"],
    Archives: ["dmg", "zip"],
  },
  fallbackCategory: "Others",
  folderPrefix: "ft_",
  granularity: { Images: "month", Documents: "year", Archives: "none", Others: "none" },
  subCategories: {
    Images: [{ name: "Screenshots", match: ["screen ?shot", "截屏"] }],
    Documents: [{ name: "Ebooks", exts: ["epub"] }],
    Archives: [{ name: "Installers", exts: ["dmg"] }],
  },
  detect: { similar: false, health: false, perceptual: false },
  perceptualThreshold: 5,
  _path: "(test)",
};

const cfg = (over = {}) => ({ ...structuredClone(BASE), ...over });
const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const yr = String(now.getFullYear());

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tidy-smart-"));
}
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function rel(entry, destDir) {
  return path.relative(destDir, entry.to);
}

// ---------- 目录前缀 ----------

test("前缀：新目标目录下所有生成目录都带 ft_", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "a.txt", "aaa");
  write(src, "b.jpg", "bbb");

  const { entries } = await analyze({ sourceDir: src, destDir: dest, config: cfg() });
  const paths = entries.map((e) => rel(e, dest)).sort();
  assert.deepEqual(paths, [path.join("ft_Documents", yr, "a.txt"), path.join("ft_Images", ym, "b.jpg")]);
});

test("前缀：目标目录已有无前缀的旧归档目录时沿用旧的，不分裂", async () => {
  const src = tmp();
  const dest = tmp();
  fs.mkdirSync(path.join(dest, "Images", "2020-01"), { recursive: true });
  write(src, "b.jpg", "bbb");
  write(src, "a.txt", "aaa");

  const { entries } = await analyze({ sourceDir: src, destDir: dest, config: cfg() });
  const byName = Object.fromEntries(entries.map((e) => [e.name, rel(e, dest)]));
  // Images 已存在（无前缀）-> 沿用；Documents 不存在 -> 用新前缀
  assert.equal(byName["b.jpg"], path.join("Images", ym, "b.jpg"));
  assert.equal(byName["a.txt"], path.join("ft_Documents", yr, "a.txt"));
});

test("前缀：folderPrefix 为空时行为与旧版一致", () => {
  const dest = tmp();
  const name = buildFolderNamer(dest, cfg({ folderPrefix: "" }));
  assert.equal(name("Images"), "Images");
});

test("organizedDirNames 同时包含带前缀与不带前缀两种写法", () => {
  const names = organizedDirNames(cfg());
  for (const n of [
    "Images",
    "ft_Images",
    "Duplicates",
    "ft_Duplicates",
    "Review",
    "ft_Review",
    "Others",
    "ft_Others",
  ]) {
    assert.ok(names.has(n), `缺少 ${n}`);
  }
});

test("旧配置缺少新版类别时被标记出来，但不会被自动补进去", async () => {
  const home = tmp();
  const cfgPath = path.join(home, "tidy", "config.json");
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  // 模拟旧版本写下的配置：只有 5 个类别，没有 Fonts
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      dest: null,
      categories: { Images: ["jpg"], Videos: ["mp4"], Audios: ["mp3"], Documents: ["pdf"], Archives: ["zip"] },
      fallbackCategory: "Others",
    }),
  );

  // config.js 在模块加载时就定下路径，所以用子进程带着改过的 XDG_CONFIG_HOME 跑
  const { execFileSync } = await import("node:child_process");
  const script = `
    import { loadConfig } from ${JSON.stringify(new URL("../src/core/config.js", import.meta.url).href)};
    const c = loadConfig();
    console.log(JSON.stringify({ stale: c._staleCategories, cats: Object.keys(c.categories) }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, XDG_CONFIG_HOME: home },
    encoding: "utf8",
  });
  const { stale, cats } = JSON.parse(out.trim().split("\n").pop());
  assert.deepEqual(stale, ["Fonts"]); // 报出来
  assert.ok(!cats.includes("Fonts")); // 但没有擅自加进去
});

// ---------- 归档粒度 ----------

test("归档粒度：month / year / none 三档各自生效", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "p.jpg", "img");
  write(src, "d.txt", "doc");
  write(src, "z.zip", "arc");

  const { entries } = await analyze({ sourceDir: src, destDir: dest, config: cfg() });
  const byName = Object.fromEntries(entries.map((e) => [e.name, rel(e, dest)]));
  assert.equal(byName["p.jpg"], path.join("ft_Images", ym, "p.jpg")); // month
  assert.equal(byName["d.txt"], path.join("ft_Documents", yr, "d.txt")); // year
  assert.equal(byName["z.zip"], path.join("ft_Archives", "z.zip")); // none
});

// ---------- 二级主题分类 ----------

test("二级分类：按扩展名和按文件名两种规则都生效，落在日期层之上", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "Screenshot 2026-07-27.jpg", "shot");
  write(src, "novel.epub", "book");
  write(src, "Tool-1.0.0.dmg", "installer");
  write(src, "plain.jpg", "photo");

  const { entries } = await analyze({ sourceDir: src, destDir: dest, config: cfg() });
  const byName = Object.fromEntries(entries.map((e) => [e.name, rel(e, dest)]));
  assert.equal(
    byName["Screenshot 2026-07-27.jpg"],
    path.join("ft_Images", "Screenshots", ym, "Screenshot 2026-07-27.jpg"),
  );
  assert.equal(byName["novel.epub"], path.join("ft_Documents", "Ebooks", yr, "novel.epub"));
  assert.equal(byName["Tool-1.0.0.dmg"], path.join("ft_Archives", "Installers", "Tool-1.0.0.dmg"));
  assert.equal(byName["plain.jpg"], path.join("ft_Images", ym, "plain.jpg")); // 无子分类
});

test("二级分类：坏正则被跳过，同规则里的其余部分仍生效", () => {
  const index = buildSubIndex({ Documents: [{ name: "X", match: ["([bad"], exts: ["epub"] }] });
  const file = { name: "a.epub", ext: "epub" };
  assert.equal(subClassify(file, "Documents", index), "X");
});

// ---------- 疑似重复 ----------

test("疑似重复：版本号包只保留最新一个为 best", () => {
  const files = [
    { path: "/a/App-1.0.5.dmg", name: "App-1.0.5.dmg", ext: "dmg", size: 100 },
    { path: "/a/App-1.0.6.dmg", name: "App-1.0.6.dmg", ext: "dmg", size: 100 },
    { path: "/a/App-1.0.10.dmg", name: "App-1.0.10.dmg", ext: "dmg", size: 100 },
  ];
  const found = findSimilar(files);
  assert.equal(found.size, 3);
  assert.equal(found.get("/a/App-1.0.10.dmg").best, true); // 1.0.10 > 1.0.6，非字典序
  assert.equal(found.get("/a/App-1.0.5.dmg").best, false);
  assert.equal(found.get("/a/App-1.0.5.dmg").reason, "versioned");
});

test("疑似重复：剥离来源水印与副本标记后同名的判为一组，保留最大的一份", () => {
  const files = [
    { path: "/a/CSS权威指南 第3版.pdf", name: "CSS权威指南 第3版.pdf", ext: "pdf", size: 900 },
    {
      path: "/a/CSS权威指南（第3版）(jb51.net).pdf",
      name: "CSS权威指南（第3版）(jb51.net).pdf",
      ext: "pdf",
      size: 500,
    },
  ];
  const found = findSimilar(files);
  assert.equal(found.size, 2);
  assert.equal(found.get("/a/CSS权威指南 第3版.pdf").best, true);
  assert.equal(found.get("/a/CSS权威指南 第3版.pdf").reason, "normalized-name");
});

test("疑似重复：同名不同格式判为 same-stem", () => {
  const files = [
    { path: "/a/report.pdf", name: "report.pdf", ext: "pdf", size: 900 },
    { path: "/a/report.epub", name: "report.epub", ext: "epub", size: 100 },
  ];
  const found = findSimilar(files);
  assert.equal(found.get("/a/report.pdf").reason, "same-stem");
  assert.equal(found.get("/a/report.pdf").best, true);
});

test("疑似重复：名字太短不成组，避免误判", () => {
  const files = [
    { path: "/a/a.pdf", name: "a.pdf", ext: "pdf", size: 1 },
    { path: "/a/b.pdf", name: "b.pdf", ext: "pdf", size: 1 },
  ];
  assert.equal(findSimilar(files).size, 0);
});

test("疑似重复：只标注不改归档去向", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "Guide-1.0.0.zip", "one");
  write(src, "Guide-2.0.0.zip", "two");

  const { entries, counts } = await analyze({
    sourceDir: src,
    destDir: dest,
    config: cfg({ detect: { similar: true, health: false, perceptual: false } }),
  });
  assert.equal(counts.similar, 2);
  assert.ok(entries.every((e) => e.action === "archive")); // 仍然正常归档
  assert.ok(entries.every((e) => rel(e, dest).startsWith("ft_Archives")));
});

// ---------- 健康检查 ----------

test("健康检查：0 字节、魔数不符、系统垃圾三类都能识别", () => {
  const dir = tmp();
  const empty = write(dir, "empty.pdf", "");
  const fake = write(dir, "fake.pdf", "this is definitely not a pdf");
  const real = write(dir, "real.pdf", "%PDF-1.7\nreal enough");
  const junk = write(dir, ".DS_Store", "junk");
  const unknown = write(dir, "thing.xyz", "whatever");

  const files = [empty, fake, real, junk, unknown].map((p) => ({
    path: p,
    name: path.basename(p),
    ext: path.extname(p).slice(1).toLowerCase(),
    size: fs.statSync(p).size,
  }));
  const issues = checkHealth(files);
  assert.equal(issues.get(empty).issue, "empty");
  assert.equal(issues.get(fake).issue, "corrupt");
  assert.equal(issues.has(real), false);
  assert.equal(issues.get(junk).issue, "junk");
  assert.equal(issues.has(unknown), false); // 未知扩展名不下判断
});

test("健康检查：问题文件进 ft_Review/<类别>/，正常文件不受影响", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "ok.txt", "fine");
  write(src, "empty.pdf", "");
  write(src, ".DS_Store", "junk");

  const { entries, counts } = await analyze({
    sourceDir: src,
    destDir: dest,
    config: cfg({ detect: { similar: false, health: true, perceptual: false } }),
  });
  const byName = Object.fromEntries(entries.map((e) => [e.name, rel(e, dest)]));
  assert.equal(counts.review, 2);
  assert.equal(byName["empty.pdf"], path.join("ft_Review", "empty", "empty.pdf"));
  assert.equal(byName[".DS_Store"], path.join("ft_Review", "junk", ".DS_Store"));
  assert.equal(byName["ok.txt"], path.join("ft_Documents", yr, "ok.txt"));
});

test("健康检查关闭时，.DS_Store 不进扫描范围", async () => {
  const src = tmp();
  const dest = tmp();
  write(src, "ok.txt", "fine");
  write(src, ".DS_Store", "junk");

  const { entries } = await analyze({ sourceDir: src, destDir: dest, config: cfg() });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "ok.txt");
});

test("scanSource 默认不收隐藏文件，includeJunk 只额外收已知垃圾名", () => {
  const src = tmp();
  write(src, ".DS_Store", "junk");
  write(src, ".env", "SECRET=1"); // 隐藏但不是垃圾，任何时候都不该被收
  write(src, "a.txt", "a");

  assert.deepEqual(
    scanSource(src)
      .map((f) => f.name)
      .sort(),
    ["a.txt"],
  );
  assert.deepEqual(
    scanSource(src, { includeJunk: true })
      .map((f) => f.name)
      .sort(),
    [".DS_Store", "a.txt"],
  );
});

// ---------- 感知哈希 ----------

/**
 * 生成一张渐变图。坐标按宽高归一化，所以同一 shift 下不同分辨率画出的是
 * 同一幅图——正是感知哈希该认出来的"换个尺寸重新导出"。
 */
function makeJpeg(dir, name, { width = 64, height = 64, shift = 0, quality = 90 }) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const u = x / width;
      const v = y / height;
      data[i] = Math.round((u * 200 + shift) % 256);
      data[i + 1] = Math.round(v * 200);
      data[i + 2] = Math.round(((u + v) / 2) * 200);
      data[i + 3] = 255;
    }
  }
  const { data: jpg } = jpeg.encode({ data, width, height }, quality);
  return write(dir, name, jpg);
}

test("感知哈希：同一图像的不同尺寸/质量导出被聚为一簇，保留最大的一份", async () => {
  const dir = tmp();
  const big = makeJpeg(dir, "orig.jpg", { width: 128, height: 128, quality: 95 });
  const small = makeJpeg(dir, "resized.jpg", { width: 64, height: 64, quality: 60 });
  const other = makeJpeg(dir, "different.jpg", { width: 64, height: 64, shift: 128, quality: 90 });

  const files = [big, small, other].map((p) => ({
    path: p,
    name: path.basename(p),
    ext: "jpg",
    size: fs.statSync(p).size,
  }));
  const hashes = await hashImages(files);
  assert.equal(hashes.size, 3);

  const clusters = clusterByHash(hashes, new Map(files.map((f) => [f.path, f])), 5);
  assert.equal(clusters.has(big), true);
  assert.equal(clusters.has(small), true);
  assert.equal(clusters.get(big).best, true); // 最大的那份
  assert.equal(clusters.has(other), false); // 内容不同，不入簇
});

test("感知哈希：不可解码的文件被跳过而不是报错", async () => {
  const dir = tmp();
  const broken = write(dir, "broken.jpg", "not a jpeg at all");
  const hashes = await hashImages([{ path: broken, name: "broken.jpg", ext: "jpg", size: 17 }]);
  assert.equal(hashes.size, 0);
});

test("感知哈希：只标注不改归档去向", async () => {
  const src = tmp();
  const dest = tmp();
  makeJpeg(src, "a.jpg", { width: 128, height: 128, quality: 95 });
  makeJpeg(src, "b.jpg", { width: 64, height: 64, quality: 60 });

  const { entries, counts } = await analyze({
    sourceDir: src,
    destDir: dest,
    config: cfg({ detect: { similar: false, health: false, perceptual: true } }),
  });
  assert.equal(counts.perceptual, 2);
  assert.ok(entries.every((e) => e.action === "archive"));
});

// ---------- 端到端 ----------

test("端到端：四类去向同时出现，执行后落盘位置正确且可撤销", async () => {
  const src = tmp();
  const dest = tmp();
  // 真实 JPEG 字节：否则会先被健康检查判成 corrupt，走不到去重那步
  const realJpeg = fs.readFileSync(makeJpeg(tmp(), "seed.jpg", {}));
  write(src, "photo.jpg", realJpeg);
  write(src, "photo copy.jpg", realJpeg); // 字节重复
  write(src, "broken.pdf", ""); // 0 字节
  write(src, "novel.epub", "PK\x03\x04fake-but-valid-magic");
  write(src, "App-1.0.0.dmg", "v1");
  write(src, "App-1.1.0.dmg", "v2"); // 疑似重复（版本）

  const config = cfg({ detect: { similar: true, health: true, perceptual: false } });
  const { entries, counts } = await analyze({ sourceDir: src, destDir: dest, config });
  assert.equal(counts.duplicate, 1);
  assert.equal(counts.review, 1);
  assert.equal(counts.similar, 2);

  executePlan(entries, { destDir: dest, sourceDir: src });
  assert.ok(fs.existsSync(path.join(dest, "ft_Images", ym, "photo.jpg")));
  assert.ok(fs.existsSync(path.join(dest, "ft_Duplicates", "photo copy.jpg")));
  // 清单里的 keeper 必须指向它归档后的真实位置，而不是已经不存在的源路径
  const manifest = fs.readFileSync(path.join(dest, "ft_Duplicates", "manifest.md"), "utf8");
  assert.match(manifest, /ft_Images/);
  assert.ok(!manifest.includes(path.join(src, "photo.jpg")));
  assert.ok(fs.existsSync(path.join(dest, "ft_Review", "empty", "broken.pdf")));
  assert.ok(fs.existsSync(path.join(dest, "ft_Documents", "Ebooks", yr, "novel.epub")));
  assert.ok(fs.existsSync(path.join(dest, "ft_Archives", "Installers", "App-1.1.0.dmg")));
});

test("端到端：隔离区里的文件不会被当成归档内容再次参与去重", async () => {
  const src = tmp();
  const dest = tmp();
  // 上一轮被隔离的重复文件
  write(dest, path.join("ft_Duplicates", "old.jpg"), "SHARED");
  write(src, "new.jpg", "SHARED");

  const { entries } = await analyze({ sourceDir: src, destDir: dest, config: cfg() });
  // 若隔离区被当作 keeper，这里会变成 duplicate
  assert.equal(entries[0].action, "archive");
});
