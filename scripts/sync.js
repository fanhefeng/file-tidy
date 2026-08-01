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
// The Store copy carries the suite too (the Raycast reviewer added it there
// and runs `npm test` in the extension folder). Both spell their imports
// "../src/core/…", so the files copy over verbatim.
const testSrc = path.join(root, "test");
const testCopy = path.join(root, "raycast", "tests");
const forkRepo = path.join(os.homedir(), ".config", "raycast", "public-extensions-fork");
const forkExt = path.join(forkRepo, "extensions", "file-tidy");
const SKIP = new Set(["node_modules", "dist"]);

const PAIRS = [
  [coreSrc, coreCopy],
  [testSrc, testCopy],
];

if (process.argv.includes("--check")) {
  let ok = true;
  for (const [src, copy] of PAIRS) {
    const drifted = diffDirs(src, copy);
    if (!drifted.length) continue;
    ok = false;
    console.error(
      `${path.relative(root, copy)} has drifted from ${path.relative(root, src)} (run: node scripts/sync.js):`,
    );
    for (const f of drifted) console.error(`  ${f}`);
  }
  if (!ok) process.exit(1);
  console.log("The Raycast copies of src/core and test are in sync.");
  process.exit(0);
}

for (const [src, copy] of PAIRS) {
  mirror(src, copy);
  console.log(`Synced ${path.relative(root, src)} -> ${path.relative(root, copy)}`);
}

if (process.argv.includes("--fork")) {
  if (!fs.existsSync(forkRepo)) {
    console.error(`Fork checkout not found: ${forkRepo}`);
    process.exit(1);
  }
  mirror(path.join(root, "raycast"), forkExt);
  console.log(`Synced raycast/ -> ${forkExt}\n`);
  console.log(execFileSync("git", ["-C", forkRepo, "status", "--short"], { encoding: "utf8" }) || "(fork unchanged)");
  console.log("Review the diff, then commit and push in the fork to update the PR.");
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
