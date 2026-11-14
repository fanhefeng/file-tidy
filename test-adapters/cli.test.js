import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

async function confirmAfterChange(t, args, dir, change) {
  // Pipes make the confirmation deterministic while this preload supplies the
  // terminal capability that the CLI requires before asking its question.
  const preload = path.join(dir, "terminal.mjs");
  fs.writeFileSync(preload, 'Object.defineProperty(process.stdin, "isTTY", { value: true });');
  const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, cli, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stdout = "";
  let stderr = "";
  let confirmed = false;
  let changeError;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (confirmed || !stdout.includes("Run this plan? [y/N]")) return;
    confirmed = true;
    try {
      change();
      child.stdin.end("y\n");
    } catch (err) {
      changeError = err;
      child.kill();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI confirmation timed out: ${stdout}\n${stderr}`));
    }, 10000);
    child.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
  if (changeError) throw changeError;
  assert.ok(confirmed, `The CLI did not ask for confirmation: ${stdout}\n${stderr}`);
  return result;
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

test("CLI rejects a source file changed while its preview awaits confirmation", async (t) => {
  const { source, dest, configPath } = fixture(t);
  const sourceFile = path.join(source, "scene.blend");
  const result = await confirmAfterChange(t, [source, "--config", configPath], path.dirname(source), () => {
    fs.writeFileSync(sourceFile, "edited after preview");
  });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /plan.*changed|changed.*plan/i);
  assert.match(result.stderr, /preview/i);
  assert.equal(fs.readFileSync(sourceFile, "utf8"), "edited after preview");
  assert.deepEqual(fs.readdirSync(dest), []);
});

test("CLI rejects a duplicate keeper changed while its preview awaits confirmation", async (t) => {
  const { source, dest, configPath } = fixture(t);
  const category = path.join(dest, "ft_Design");
  fs.mkdirSync(category);
  const keeper = path.join(category, "kept.blend");
  fs.writeFileSync(keeper, "custom-format-content");
  const result = await confirmAfterChange(t, [source, "--config", configPath], path.dirname(source), () => {
    fs.writeFileSync(keeper, "edited keeper after preview");
  });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /plan.*changed|changed.*plan/i);
  assert.match(result.stderr, /preview/i);
  assert.equal(fs.readFileSync(path.join(source, "scene.blend"), "utf8"), "custom-format-content");
  assert.equal(fs.readFileSync(keeper, "utf8"), "edited keeper after preview");
  assert.deepEqual(fs.readdirSync(dest), ["ft_Design"]);
});

test("CLI rejects rules changed while its preview awaits confirmation", async (t) => {
  const { source, dest, configPath } = fixture(t);
  const result = await confirmAfterChange(t, [source, "--config", configPath], path.dirname(source), () => {
    const rules = JSON.parse(fs.readFileSync(configPath, "utf8"));
    rules.folderPrefix = "new_";
    fs.writeFileSync(configPath, JSON.stringify(rules));
  });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /plan.*changed|changed.*plan/i);
  assert.match(result.stderr, /preview/i);
  assert.ok(fs.existsSync(path.join(source, "scene.blend")));
  assert.deepEqual(fs.readdirSync(dest), []);
});

test("CLI refuses a category symlink that would archive files outside the destination", (t) => {
  const { source, dest, configPath } = fixture(t);
  const outside = path.join(path.dirname(source), "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(dest, "ft_Design"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => run([source, "--config", configPath, "--yes"]),
    (err) => {
      assert.match(err.stderr, /outside.*destination|destination.*outside/i);
      return true;
    },
  );
  assert.equal(fs.readFileSync(path.join(source, "scene.blend"), "utf8"), "custom-format-content");
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual(fs.readdirSync(dest), ["ft_Design"]);
});
