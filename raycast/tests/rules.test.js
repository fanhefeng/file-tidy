import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  analyze,
  compileRules,
  DEFAULT_CONFIG,
  executePlan,
  loadConfig,
  metadataSegment,
  organizedDirNames,
  resolveConfig,
  saveConfig,
  undoLastRun,
} from "../src/core/index.js";
import { scanSource } from "../src/core/scan.js";

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-rules-"));
  tempDirs.push(dir);
  return dir;
}
function write(dir, name, bytes) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

test("scan identities distinguish an atomic replacement with unchanged size and mtime", () => {
  const dir = temp();
  const target = write(dir, "note.txt", "first");
  const [before] = scanSource(dir);
  const replacement = write(dir, "replacement.tmp", "other");
  fs.utimesSync(replacement, before.mtime, before.mtime);
  fs.renameSync(replacement, target);
  const [after] = scanSource(dir);
  assert.equal(before.size, after.size);
  assert.ok(Math.abs(before.mtime.getTime() - after.mtime.getTime()) <= 1);
  assert.equal(before.dev, after.dev);
  assert.notEqual(before.ino, after.ino);
  const stat = fs.statSync(target);
  assert.equal(after.ino, stat.ino);
  assert.equal(after.dev, stat.dev);
  assert.equal(after.mtimeMs, stat.mtimeMs);
});

function chunk(name, bytes) {
  const header = Buffer.alloc(8);
  header.write(name);
  header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])]);
}

// A tiny PCM file with genuine RIFF INFO metadata, without an encoder dependency.
function wav(tags = {}, sample = 0) {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4);
  format.writeUInt32LE(16000, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const info = Buffer.concat([
    Buffer.from("INFO"),
    ...Object.entries(tags).map(([name, value]) => chunk(name, Buffer.from(`${value}\0`))),
  ]);
  const body = Buffer.concat([
    Buffer.from("WAVE"),
    chunk("fmt ", format),
    chunk("LIST", info),
    chunk("data", Buffer.from([sample, 0, 0, 0])),
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

test("partial config extends built-ins and longest normalized extension overrides win", () => {
  const config = resolveConfig({
    extensions: {
      ".WAV": { category: "Music", groupBy: ["album"], granularity: "none" },
      custom: "Projects",
      "tar.gz": "Backups",
    },
  });
  const classify = compileRules(config);
  assert.equal(classify({ name: "image.jpg", ext: "jpg" }).category, "Images");
  assert.deepEqual(classify({ name: "track.WAV", ext: "wav" }), {
    category: "Music",
    subCategory: null,
    groupBy: ["album"],
    granularity: "none",
    matchedExtension: "wav",
  });
  assert.equal(classify({ name: "project.custom", ext: "custom" }).category, "Projects");
  assert.equal(classify({ name: "backup.TAR.GZ", ext: "gz" }).category, "Backups");
  assert.ok(organizedDirNames(config).has("ft_Projects"));
  assert.equal(classify({ name: "no-extension", ext: "" }).category, "Others");
});

test("legacy category maps replace defaults and scalar files retain old fallback behavior", () => {
  const config = resolveConfig({ categories: { Notes: ["note"] } });
  assert.deepEqual(Object.keys(config.categories), ["Notes"]);
  assert.equal(compileRules(config)({ name: "song.mp3", ext: "mp3" }).category, "Others");
  assert.ok(config._staleCategories.includes("Audios"));
  for (const raw of [null, false, 0, "", "text", []])
    assert.deepEqual(resolveConfig(raw).categories, DEFAULT_CONFIG.categories);
});

test("resolved configurations do not share mutable defaults or caller data", () => {
  const raw = { groupBy: { Audios: ["title"] }, categories: { Notes: ["note"] } };
  const config = resolveConfig(raw);
  config.categories.Notes.push("other");
  config.groupBy.Audios.push("album");
  assert.deepEqual(raw.groupBy.Audios, ["title"]);
  assert.deepEqual(raw.categories.Notes, ["note"]);
  assert.deepEqual(resolveConfig().groupBy.Audios, ["artist", "album"]);
  assert.deepEqual(DEFAULT_CONFIG.groupBy.Audios, ["artist", "album"]);
});

test("invalid rules identify their field before any configuration is written", () => {
  const configPath = path.join(temp(), "config.json");
  saveConfig({ groupBy: { Audios: [] } }, configPath);
  const previous = fs.readFileSync(configPath, "utf8");
  const cases = [
    [{ groupBy: { Audios: ["singer"] } }, "groupBy.Audios"],
    [{ groupBy: { Audios: ["artist", "artist"] } }, "groupBy.Audios"],
    [{ extensions: { "../bad": "Projects" } }, "extensions.../bad"],
    [{ extensions: { jpg: "../Images" } }, "extensions.jpg"],
    [{ extensions: { jpg: "Review" } }, "extensions.jpg"],
    [{ extensions: { jpg: "CON" } }, "extensions.jpg"],
    [{ extensions: { MP3: "Music", ".mp3": "Songs" } }, "extensions..mp3"],
    [{ extensions: { mp3: { category: "Music", granularity: "weekly" } } }, "extensions.mp3.granularity"],
    [{ subCategories: { Images: [{ name: "Shots", match: ["["] }] } }, "subCategories.Images[0].match"],
    [{ categories: { Images: "jpg" } }, "categories.Images"],
    [{ granularity: { Images: "daily" } }, "granularity.Images"],
    [{ detect: { health: "yes" } }, "detect.health"],
    [{ perceptualThreshold: 65 }, "perceptualThreshold"],
    [{ groupby: {} }, "groupby"],
    [JSON.parse('{"toString":"bad"}'), "toString"],
    [JSON.parse('{"__proto__":{}}'), "__proto__"],
  ];
  for (const [raw, field] of cases) {
    assert.throws(
      () => saveConfig(raw, configPath),
      (err) => err.code === "CONFIG_INVALID" && err.field === field,
      field,
    );
    assert.equal(fs.readFileSync(configPath, "utf8"), previous);
  }
});

test("prototype-like category names are ordinary classification data", () => {
  for (const category of ["constructor", "toString", "__proto__"]) {
    const config = resolveConfig({ extensions: { custom: category } });
    const result = compileRules(config)({ name: "a.custom", ext: "custom" });
    assert.equal(result.category, category);
    assert.deepEqual(result.groupBy, []);
    assert.equal(result.granularity, "none");
  }
});

test("long Unicode metadata segments fit filesystem byte limits", () => {
  const segment = metadataSegment("音乐🎧".repeat(100), "Unknown");
  assert.ok(Buffer.byteLength(segment) <= 200);
  assert.ok(segment.length > 0);
  assert.equal(segment.includes("�"), false);
});

test("configuration writes are atomic and omit internal state", () => {
  const configPath = path.join(temp(), "nested", "config.json");
  const created = loadConfig(configPath);
  assert.equal(created._created, true);
  const saved = saveConfig({ ...created, extensions: { song: "Audios" }, groupBy: { Audios: ["title"] } }, configPath);
  assert.equal(saved._path, configPath);
  const json = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(
    Object.keys(json).some((key) => key.startsWith("_")),
    false,
  );
  assert.deepEqual(loadConfig(configPath).groupBy.Audios, ["title"]);
  assert.deepEqual(fs.readdirSync(path.dirname(configPath)), ["config.json"]);
});

test("invalid JSON and failed config writes have adapter-readable errors", () => {
  const dir = temp();
  const configPath = write(dir, "config.json", "{");
  assert.throws(
    () => loadConfig(configPath),
    (err) => err.code === "CONFIG_PARSE" && err.configPath === configPath,
  );
  assert.throws(
    () => saveConfig({}, configPath + "/child"),
    (err) => err.code === "CONFIG_WRITE",
  );
});

test("real tags drive default artist/album grouping and the run remains undoable", async () => {
  const sourceDir = temp();
  const destDir = path.join(temp(), "archive");
  const from = write(
    sourceDir,
    "track.wav",
    wav({ IART: "Nina Simone", IPRD: "Pastel Blues", INAM: "Sinnerman", IGNR: "Jazz", ICRD: "1965" }),
  );
  const phases = [];
  const result = await analyze({
    sourceDir,
    destDir,
    config: resolveConfig({ detect: false }),
    onPhase: (phase) => phases.push(phase),
  });
  assert.equal(fs.existsSync(destDir), false);
  assert.equal(fs.existsSync(from), true);
  const [entry] = result.entries;
  assert.equal(entry.to, path.join(destDir, "ft_Audios", "Nina Simone", "Pastel Blues", "track.wav"));
  assert.deepEqual(entry.metadata, {
    artist: "Nina Simone",
    album: "Pastel Blues",
    title: "Sinnerman",
    genre: "Jazz",
    year: "1965",
  });
  assert.equal(entry.metadataStatus, "read");
  assert.ok(phases.includes("metadata"));
  executePlan(result.entries, { destDir, sourceDir, hashCache: result.hashCache });
  assert.equal(fs.existsSync(entry.to), true);
  assert.equal(undoLastRun(destDir).restored, 1);
  assert.equal(fs.existsSync(from), true);
});

test("per-extension grouping overrides category grouping and uses the song title", async () => {
  const sourceDir = temp();
  const destDir = temp();
  write(sourceDir, "song.wav", wav({ IART: "Artist", IPRD: "Album", INAM: "Song" }));
  const result = await analyze({
    sourceDir,
    destDir,
    config: resolveConfig({
      detect: false,
      extensions: { wav: { category: "Music", groupBy: ["title"], granularity: "none" } },
    }),
  });
  assert.equal(result.entries[0].to, path.join(destDir, "ft_Music", "Song", "song.wav"));
});

test("empty grouping skips tag parsing and keeps audio folders flat", async () => {
  const sourceDir = temp();
  const destDir = temp();
  write(sourceDir, "song.wav", wav({ IART: "Artist", IPRD: "Album" }));
  const phases = [];
  const result = await analyze({
    sourceDir,
    destDir,
    config: resolveConfig({ detect: false, groupBy: { Audios: [] } }),
    onPhase: (phase) => phases.push(phase),
  });
  assert.equal(result.entries[0].to, path.join(destDir, "ft_Audios", "song.wav"));
  assert.equal(phases.includes("metadata"), false);
  assert.equal(result.entries[0].metadata, undefined);
});

test("missing or unreadable tags use stable folders and the filename as title", async () => {
  const sourceDir = temp();
  const destDir = temp();
  write(sourceDir, "untagged.wav", wav());
  write(sourceDir, "broken.mp3", "broken tag data");
  const result = await analyze({
    sourceDir,
    destDir,
    config: resolveConfig({ detect: false, groupBy: { Audios: ["artist", "album", "title"] } }),
  });
  for (const entry of result.entries) {
    assert.equal(
      entry.to,
      path.join(destDir, "ft_Audios", "Unknown Artist", "Unknown Album", path.parse(entry.name).name, entry.name),
    );
    assert.ok(["missing", "unreadable"].includes(entry.metadataStatus));
  }
});

test("hostile tag values stay inside safe folders and preview resolves collisions", async () => {
  const sourceDir = temp();
  const destDir = temp();
  write(sourceDir, "a/track.wav", wav({ IART: "../../escape\\artist", IPRD: "CON", INAM: "One" }, 1));
  write(sourceDir, "b/track.wav", wav({ IART: "../../escape\\artist", IPRD: "CON", INAM: "Two" }, 2));
  const result = await analyze({ sourceDir, destDir, recursive: true, config: resolveConfig({ detect: false }) });
  assert.deepEqual(
    result.entries.map((entry) => path.basename(entry.to)),
    ["track.wav", "track (1).wav"],
  );
  for (const entry of result.entries) {
    assert.deepEqual(entry.grouping, ["_.._escape_artist", "_CON"]);
    assert.equal(path.relative(destDir, entry.to).startsWith(".."), false);
  }
});

test("health and dedup take priority and rejected audio tags are not parsed", async () => {
  const sourceDir = temp();
  const destDir = temp();
  write(sourceDir, "bad.mp3", "broken");
  const bytes = wav({ IART: "Artist", IPRD: "Album" });
  write(sourceDir, "song.wav", bytes);
  write(sourceDir, "song copy.wav", bytes);
  const phases = [];
  const result = await analyze({
    sourceDir,
    destDir,
    config: resolveConfig({ detect: { perceptual: false, similar: false } }),
    onPhase: (phase, info) => {
      if (phase === "metadata") phases.push(info.files);
    },
  });
  assert.deepEqual(result.counts, { archive: 1, duplicate: 1, review: 1, similar: 0, perceptual: 0 });
  assert.ok(phases.length > 0 && phases.every((count) => count === 1));
  assert.equal(result.entries.find((entry) => entry.action === "duplicate").metadata, undefined);
  assert.equal(result.entries.find((entry) => entry.action === "review").metadata, undefined);
});

test("custom categories are excluded from a second in-place recursive run", async () => {
  const sourceDir = temp();
  write(sourceDir, "project.custom", "project content");
  const config = resolveConfig({ extensions: { custom: "Projects" }, detect: false });
  const result = await analyze({ sourceDir, destDir: sourceDir, inPlace: true, recursive: true, config });
  executePlan(result.entries, { sourceDir, destDir: sourceDir });
  const next = await analyze({ sourceDir, destDir: sourceDir, inPlace: true, recursive: true, config });
  assert.equal(next.entries.length, 0);
});
