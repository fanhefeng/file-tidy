import assert from "node:assert/strict";
import { test } from "node:test";
import { english, chinese, translate, categoryLabel, dateLabel } from "../src/renderer/i18n.ts";
import { ruleText, ruleCategoryLabel } from "../src/renderer/rule-copy.ts";

const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test("Chinese and English interface messages have identical keys and interpolation values", () => {
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    assert.ok(chinese[key].trim());
    assert.deepEqual(placeholders(chinese[key]), placeholders(english[key]), key);
    const values = Object.fromEntries(placeholders(english[key]).map((name) => [name, 12]));
    for (const locale of ["zh-CN", "en"]) assert.ok(!/\{\w+\}/.test(translate(locale, key, values)), key);
  }
});

test("translated category labels never change custom user data or JSON identifiers", () => {
  assert.equal(categoryLabel("zh-CN", "Audios"), "音频");
  assert.equal(categoryLabel("en", "Audios"), "Audio");
  for (const locale of ["zh-CN", "en"]) {
    assert.equal(categoryLabel(locale, "我的项目 Projects"), "我的项目 Projects");
    assert.equal(categoryLabel(locale, "constructor"), "constructor");
    assert.equal(ruleCategoryLabel(locale, "我的项目 Projects"), "我的项目 Projects");
  }
  assert.notEqual(dateLabel("zh-CN", "2026-11-13T06:00:00Z"), dateLabel("en", "2026-11-13T06:00:00Z"));
  assert.equal(ruleText("zh-CN", "save"), "保存规则");
  assert.equal(ruleText("en", "save"), "Save rules");
});

test("English file counts use singular grammar for one file", () => {
  assert.equal(translate("en", "execute", { count: 1 }), "Organize 1 file");
  assert.equal(translate("en", "execute", { count: 2 }), "Organize 2 files");
  assert.equal(translate("en", "recordedFiles", { count: "1" }), "This record contains 1 file");
  assert.equal(translate("zh-CN", "execute", { count: 1 }), "整理 1 个文件");
});
