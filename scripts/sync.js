#!/usr/bin/env node
// Sync the single-source core into the Raycast extension copy, and optionally
// into the raycast/extensions fork checkout used for Store submission.
//
//   node scripts/sync.js            src/core -> raycast/src/core
//   node scripts/sync.js --check    verify the copies match (exit 1 on drift)
//   node scripts/sync.js --fork     also mirror raycast/ -> <fork>/extensions/file-tidy
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreSrc = path.join(root, "src", "core");
const coreCopy = path.join(root, "raycast", "src", "core");
const forkRepo = path.join(os.homedir(), ".config", "raycast", "public-extensions-fork");
const forkExt = path.join(forkRepo, "extensions", "file-tidy");
const SKIP = new Set(["node_modules", "dist"]);

if (process.argv.includes("--check")) {
  const drifted = diffDirs(coreSrc, coreCopy);
  if (drifted.length) {
    console.error(`raycast/src/core 与 src/core 不一致（跑 node scripts/sync.js 同步）:`);
    for (const f of drifted) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log("src/core 与 raycast/src/core 一致。");
  process.exit(0);
}

mirror(coreSrc, coreCopy);
console.log(`已同步 src/core -> ${path.relative(root, coreCopy)}`);

if (process.argv.includes("--fork")) {
  if (!fs.existsSync(forkRepo)) {
    console.error(`找不到 fork 检出: ${forkRepo}`);
    process.exit(1);
  }
  mirror(path.join(root, "raycast"), forkExt);
  console.log(`已同步 raycast/ -> ${forkExt}\n`);
  console.log(execFileSync("git", ["-C", forkRepo, "status", "--short"], { encoding: "utf8" }) || "(fork 无变更)");
  console.log("确认无误后在 fork 里 commit + push 即可更新 PR。");
}

/** Replace dest with an exact copy of src (skipping node_modules/dist). */
function mirror(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) });
}

/** File names whose presence or content differ between two directories. */
function diffDirs(a, b) {
  const names = new Set([...list(a), ...list(b)]);
  return [...names]
    .filter((name) => {
      const fa = path.join(a, name);
      const fb = path.join(b, name);
      if (!fs.existsSync(fa) || !fs.existsSync(fb)) return true;
      return !fs.readFileSync(fa).equals(fs.readFileSync(fb));
    })
    .sort();
}

function list(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}
