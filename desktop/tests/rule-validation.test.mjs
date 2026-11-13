import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeExtension, validateFileTypeRule } from "../src/renderer/rule-validation.ts";
import { ruleText } from "../src/renderer/rule-copy.ts";

test("empty and whitespace fields each receive a required error", () => {
  for (const value of ["", "   ", "\t"]) {
    assert.deepEqual(validateFileTypeRule(value, value, {}), {
      extension: "requiredExtension",
      category: "requiredCategory",
    });
  }
});

test("file extensions normalize without confusing built-ins with custom duplicates", () => {
  assert.equal(normalizeExtension(" .MP3 "), "mp3");
  assert.equal(normalizeExtension(" Tar.Gz "), "tar.gz");
  assert.deepEqual(validateFileTypeRule(" .MP3 ", "音频", {}), {});
  assert.deepEqual(validateFileTypeRule("tar.gz", "Projects", { ".TAR.GZ": "Archives" }), {
    extension: "duplicateExtension",
  });
});

test("malformed extensions are explained independently of folder errors", () => {
  for (const extension of [".", "*.mp3", "my file", "../mp3", "mp3/", "tar..gz"]) {
    assert.deepEqual(validateFileTypeRule(extension, "Projects", {}), { extension: "invalidExtension" });
  }
  assert.deepEqual(validateFileTypeRule("*.mp3", "../Projects", {}), {
    extension: "invalidExtension",
    category: "invalidCategory",
  });
});

test("folder errors distinguish unsafe characters, reserved names, and trailing periods", () => {
  for (const category of ["a/b", "a\\b", "a*b", "a\u0000b", "a\u200bb"])
    assert.equal(validateFileTypeRule("mp3", category, {}).category, "invalidCategory");
  for (const category of [".", "..", ".tidy", "Duplicates", "Review", "CON", "aux.txt", "LPT9"])
    assert.equal(validateFileTypeRule("mp3", category, {}).category, "reservedCategory");
  assert.equal(validateFileTypeRule("mp3", "Projects.", {}).category, "invalidCategoryEnding");
  assert.deepEqual(validateFileTypeRule("mp3", "  项目资料 Projects  ", {}), {});
});

test("corrections remove errors without losing a valid value in the other field", () => {
  assert.deepEqual(validateFileTypeRule("mp3", "", {}), { category: "requiredCategory" });
  assert.deepEqual(validateFileTypeRule("mp3", "Audios", {}), {});
  assert.deepEqual(validateFileTypeRule("mp3", "Audios", { mp3: "Old folder" }), {
    extension: "duplicateExtension",
  });
  assert.deepEqual(validateFileTypeRule("flac", "Audios", { mp3: "Old folder" }), {});
});

test("every field validation message is available in Chinese and English", () => {
  for (const key of [
    "requiredExtension",
    "requiredCategory",
    "invalidExtension",
    "invalidCategory",
    "reservedCategory",
    "invalidCategoryEnding",
    "duplicateExtension",
  ]) {
    const chinese = ruleText("zh-CN", key);
    const english = ruleText("en", key);
    assert.ok(chinese.length > 0 && english.length > 0);
    assert.notEqual(chinese, english);
    assert.ok(!/Please fill out this field/.test(chinese + english));
  }
});
