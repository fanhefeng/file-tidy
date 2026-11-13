import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, compileRules, resolveConfig } from "../../src/core/index.js";
import {
  getCategorySummaries,
  getRulesSnapshot,
  parseRuleDraft,
  serializeRuleDraft,
  setCategoryExtensions,
  setCategoryGranularity,
  setCategorySubRules,
  validateSubRule,
} from "../src/renderer/rule-model.ts";

const defaults = structuredClone(DEFAULT_CONFIG);
const classify = (raw, name) => compileRules(resolveConfig(raw))({ name, ext: name.split(".").at(-1) });

test("omitted maps show actual defaults while whole category maps replace them", () => {
  const snapshot = getRulesSnapshot("{}", defaults);
  assert.equal(Object.keys(snapshot.effective.categories).length, 9);
  assert.equal(snapshot.effective.granularity.Images, "month");
  assert.deepEqual(snapshot.effective.groupBy.Audios, ["artist", "album"]);
  assert.ok(snapshot.effective.subCategories.Documents.length > 0);
  assert.deepEqual(snapshot.effective.extensions, {});
  assert.deepEqual(snapshot.raw, {});
  const edited = getRulesSnapshot(
    '{"categories":{"Projects":["project"]},"subCategories":{},"groupBy":{"Audios":[]}}',
    defaults,
  );
  assert.deepEqual(edited.effective.categories, { Projects: ["project"] });
  assert.deepEqual(edited.effective.subCategories, {});
  assert.deepEqual(edited.effective.groupBy.Audios, []);
  assert.equal(edited.effective.granularity.Images, "month");
});

test("invalid JSON roots and malformed maps cannot be visually edited", () => {
  for (const draft of ["", "{", "null", "[]", '"text"']) {
    assert.equal(parseRuleDraft(draft), null);
    assert.equal(getRulesSnapshot(draft, defaults).effective, null);
  }
  for (const raw of [
    { categories: [] },
    { categories: { Images: "jpg" } },
    { granularity: { Images: "daily" } },
    { groupBy: { Audios: "artist" } },
    { subCategories: { Images: [null] } },
    { extensions: [] },
  ]) {
    const draft = serializeRuleDraft(raw);
    assert.deepEqual(getRulesSnapshot(draft, defaults).raw, raw);
    assert.equal(getRulesSnapshot(draft, defaults).effective, null);
  }
  assert.equal(getRulesSnapshot("{}", null).effective, null);
  assert.throws(() => setCategoryExtensions({ categories: [] }, "Images", ["png"], defaults));
  assert.throws(() => setCategorySubRules({ subCategories: [] }, "Images", [], defaults));
  assert.throws(() => setCategoryGranularity({ granularity: [] }, "Images", "month"));
  assert.throws(() => setCategoryExtensions({}, "Images", ["png"], null));
  assert.throws(() => setCategorySubRules({}, "Images", [], null));
});

test("removing draft keys returns to defaults rather than previously saved values", () => {
  const saved = { groupBy: { Audios: ["genre"] }, granularity: { Images: "none" }, subCategories: {} };
  const before = getRulesSnapshot(serializeRuleDraft(saved), defaults);
  assert.deepEqual(before.effective.groupBy.Audios, ["genre"]);
  assert.equal(before.effective.granularity.Images, "none");
  assert.deepEqual(before.effective.subCategories, {});
  const after = getRulesSnapshot("{}", defaults);
  assert.deepEqual(after.effective.groupBy.Audios, ["artist", "album"]);
  assert.equal(after.effective.granularity.Images, "month");
  assert.ok(after.effective.subCategories.Images.length > 0);
  const resolved = resolveConfig(after.raw);
  for (const key of ["categories", "granularity", "groupBy", "subCategories", "extensions", "fallbackCategory"])
    assert.deepEqual(after.effective[key], resolved[key]);
});

test("visual edits materialize defaults without changing unrelated advanced rules", () => {
  const raw = {
    extensions: { "tar.gz": { category: "Backups", groupBy: [], granularity: "year" } },
    groupBy: { Audios: ["genre", "album"] },
    detect: { similar: false },
    perceptualThreshold: 9,
  };
  const original = structuredClone(raw);
  const changed = setCategoryGranularity(
    setCategoryExtensions(raw, "Images", [".JPG", "png", "JPG"], defaults),
    "Images",
    "year",
  );
  assert.deepEqual(raw, original);
  assert.deepEqual(changed.categories.Images, ["jpg", "png"]);
  assert.deepEqual(changed.categories.Videos, defaults.categories.Videos);
  assert.deepEqual(changed.extensions, raw.extensions);
  assert.deepEqual(changed.groupBy, raw.groupBy);
  assert.deepEqual(changed.detect, raw.detect);
  assert.equal(changed.perceptualThreshold, 9);
  assert.equal(classify(changed, "photo.jpg").granularity, "year");
  assert.equal(classify(changed, "clip.mp4").category, "Videos");
  assert.equal(classify(changed, "backup.tar.gz").category, "Backups");
  assert.equal(classify(changed, "backup.tar.gz").granularity, "year");
});

test("custom categories remain intact and subrule order reaches the real classifier", () => {
  const raw = { categories: { Projects: ["project"] } };
  const changed = setCategorySubRules(
    raw,
    "Projects",
    [
      { name: "Urgent", match: ["urgent"] },
      { name: "All projects", exts: ["project"] },
    ],
    defaults,
  );
  assert.deepEqual(changed.categories, raw.categories);
  assert.deepEqual(changed.subCategories.Images, defaults.subCategories.Images);
  assert.equal(classify(changed, "urgent.project").subCategory, "Urgent");
  assert.equal(classify(changed, "normal.project").subCategory, "All projects");
  const noRules = setCategorySubRules(changed, "Projects", [], defaults);
  assert.equal(classify(noRules, "urgent.project").subCategory, null);
  assert.equal(classify(noRules, "photo.jpg").category, "Others");
});

test("constructor and prototype-like category keys are treated as own data", () => {
  const raw = JSON.parse(
    '{"categories":{"constructor":["ct"],"__proto__":["pt"]},"subCategories":{"__proto__":[{"name":"Tagged","match":["tag"]}]},"groupBy":{"constructor":[]}}',
  );
  const snapshot = getRulesSnapshot(serializeRuleDraft(raw), defaults);
  assert.deepEqual(Object.keys(snapshot.effective.categories), ["constructor", "__proto__"]);
  assert.deepEqual(snapshot.effective.categories.__proto__, ["pt"]);
  assert.deepEqual(snapshot.effective.groupBy.constructor, []);
  const changed = setCategoryGranularity(
    setCategoryExtensions(raw, "__proto__", ["new"], defaults),
    "constructor",
    "year",
  );
  assert.equal(classify(changed, "file.ct").category, "constructor");
  assert.equal(classify(changed, "file.ct").granularity, "year");
  assert.equal(classify(changed, "tag.new").category, "__proto__");
  assert.equal(classify(changed, "tag.new").subCategory, "Tagged");
  assert.equal(Object.getPrototypeOf(changed.categories), Object.prototype);
  assert.equal(Object.hasOwn(changed.categories, "__proto__"), true);
  assert.equal(Object.hasOwn(Object.prototype, "new"), false);
});

test("subrule validation normalizes extensions and validates each regular expression", () => {
  assert.deepEqual(validateSubRule("  Receipts  ", ".PDF, txt\nPDF", "receipt\n\n发票"), {
    errors: {},
    rule: { name: "Receipts", exts: ["pdf", "txt"], match: ["receipt", "发票"] },
  });
  assert.deepEqual(validateSubRule("", "", "").errors, { name: "requiredCategory", extensions: "requiredMatch" });
  assert.deepEqual(validateSubRule("Review", "pdf", "[").errors, {
    name: "reservedCategory",
    patterns: "invalidPattern",
  });
  assert.deepEqual(validateSubRule("Notes", "*.txt", "").errors, { extensions: "invalidExtension" });
  assert.equal(validateSubRule("Notes", "*.txt", "").rule, null);
  const valid = validateSubRule("Spaced names", "", "^ name $");
  assert.deepEqual(valid.rule.match, ["^ name $"]);
});

test("category summaries follow actual extension override ownership and include custom fallback folders", () => {
  const config = resolveConfig({
    categories: { Images: [".JPG", "jpg", "png"], Documents: ["png", "PDF"] },
    extensions: {
      ".PNG": "Artwork",
      custom: { category: "Projects", groupBy: ["year"], granularity: "year" },
      "tar.gz": "Unsorted",
    },
    fallbackCategory: "Unsorted",
    groupBy: { Projects: ["title"] },
    granularity: { Projects: "none" },
    subCategories: { Artwork: [{ name: "Icons", match: ["icon"] }] },
  });
  const summaries = getCategorySummaries(config);
  assert.deepEqual(
    summaries.map((summary) => summary.name),
    ["Images", "Documents", "Artwork", "Projects", "Unsorted"],
  );
  assert.deepEqual(
    summaries.map((summary) => summary.extensions),
    [["jpg"], ["pdf"], ["png"], ["custom"], ["tar.gz"]],
  );
  assert.equal(summaries.find((summary) => summary.name === "Artwork").subRuleCount, 1);
  assert.deepEqual(summaries.find((summary) => summary.name === "Projects").groupBy, ["title"]);
  assert.equal(summaries.find((summary) => summary.name === "Projects").granularity, "none");
  assert.deepEqual(
    summaries.filter((summary) => summary.isFallback).map((summary) => summary.name),
    ["Unsorted"],
  );
  const compiled = compileRules(config);
  for (const summary of summaries) {
    for (const ext of summary.extensions)
      assert.equal(compiled({ name: `sample.${ext}`, ext: ext.split(".").at(-1) }).category, summary.name);
  }
  assert.equal(compiled({ name: "no-known-format", ext: "" }).category, "Unsorted");
  const defaultSummaries = getCategorySummaries(resolveConfig({}));
  assert.equal(defaultSummaries.length, 10);
  assert.deepEqual(defaultSummaries.at(-1), {
    name: "Others",
    extensions: [],
    groupBy: [],
    granularity: "none",
    subRuleCount: 0,
    isFallback: true,
  });
});

test("summary maps keep prototype-like folder names as own values", () => {
  const config = resolveConfig(
    JSON.parse(
      '{"categories":{"constructor":["ct"],"__proto__":["pt"]},"extensions":{".PT":"constructor","p":{"category":"prototype"}},"fallbackCategory":"__proto__","groupBy":{"constructor":["album"]},"granularity":{"__proto__":"year"},"subCategories":{"constructor":[{"name":"Tagged","match":["tag"]}]}}',
    ),
  );
  const summaries = getCategorySummaries(config);
  assert.deepEqual(
    summaries.map((summary) => summary.name),
    ["constructor", "__proto__", "prototype"],
  );
  assert.deepEqual(summaries[0].extensions, ["ct", "pt"]);
  assert.deepEqual(summaries[0].groupBy, ["album"]);
  assert.equal(summaries[0].subRuleCount, 1);
  assert.deepEqual(summaries[1].extensions, []);
  assert.deepEqual(summaries[1].groupBy, []);
  assert.equal(summaries[1].granularity, "year");
  assert.equal(summaries[1].isFallback, true);
  assert.equal(summaries[2].granularity, "none");
  assert.equal(compileRules(config)({ name: "file.pt", ext: "pt" }).category, summaries[0].name);
  assert.equal(compileRules(config)({ name: "file.p", ext: "p" }).category, summaries[2].name);
});

test("malformed summary shapes return an empty list without throwing", () => {
  for (const config of [
    null,
    [],
    {},
    { categories: [], fallbackCategory: "Others" },
    { categories: { Images: "png" }, fallbackCategory: "Others" },
    { categories: {}, extensions: { png: {} }, fallbackCategory: "Others" },
    { categories: {}, groupBy: { Images: "artist" }, fallbackCategory: "Others" },
  ])
    assert.deepEqual(getCategorySummaries(config), []);
});
