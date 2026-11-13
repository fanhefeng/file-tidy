import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("../bin/tidy.js", import.meta.url));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source");
  const dest = path.join(dir, "archive");
  const configPath = path.join(dir, "rules.json");
  fs.mkdirSync(source);
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(source, "scene.blend"), "custom-format-content");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      dest,
      detect: false,
      extensions: { blend: "Design" },
      granularity: { Design: "none" },
    }),
  );
  return { source, dest, configPath };
}

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: "pipe", timeout: 15000 });
}

test("CLI previews custom extension rules from the explicit JSON config without moving files", (t) => {
  const { source, dest, configPath } = fixture(t);
  const output = run([source, "--config", configPath, "--dry-run"]);
  assert.match(output, /ft_Design/);
  assert.match(output, /Dry run: nothing was moved/);
  assert.ok(fs.existsSync(path.join(source, "scene.blend")));
  assert.deepEqual(fs.readdirSync(dest), []);
});

test("CLI execution and undo both use the destination in the explicit JSON config", (t) => {
  const { source, dest, configPath } = fixture(t);
  run([source, "--config", configPath, "--yes"]);
  assert.ok(fs.existsSync(path.join(dest, "ft_Design", "scene.blend")));
  assert.ok(!fs.existsSync(path.join(source, "scene.blend")));
  const output = run(["undo", "--config", configPath]);
  assert.match(output, /Undid the run/);
  assert.equal(fs.readFileSync(path.join(source, "scene.blend"), "utf8"), "custom-format-content");
});

test("CLI rejects invalid rules from the explicit JSON config before moving files", (t) => {
  const { source, dest, configPath } = fixture(t);
  fs.writeFileSync(configPath, JSON.stringify({ dest, groupBy: { Audios: ["not-a-metadata-field"] } }));
  assert.throws(
    () => run([source, "--config", configPath, "--yes"]),
    (err) => {
      assert.match(err.stderr, /Invalid classification rule/);
      assert.match(err.stderr, /groupBy/);
      return true;
    },
  );
  assert.ok(fs.existsSync(path.join(source, "scene.blend")));
  assert.deepEqual(fs.readdirSync(dest), []);
});
