#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs, styleText } from "node:util";
import { analyze } from "../src/core/analyze.js";
import { canonicalPath, expandTilde, isInsideDir, loadConfig } from "../src/core/config.js";
import { executePlan } from "../src/core/execute.js";
import { bucketLabel, formatSize } from "../src/core/plan.js";
import { undoLastRun } from "../src/core/undo.js";

const HELP = `tidy — archive files, quarantine duplicates, set aside broken ones

Usage:
  tidy [source folder] [options]  Tidy a folder (opens a folder picker when omitted)
  tidy undo [--dest <dir>]        Undo the last run (for an in-place run, pass the source folder)

Options:
  --dest <dir>    Archive destination (asked at runtime when omitted; can also be fixed in the config)
  --in-place, -p  Tidy in place: category folders are created inside the source folder
  --create-dest   Allow creating a destination that doesn't exist (otherwise you're asked first)
  --yes, -y       Skip the confirmation (the "create destination" prompt is still asked)
  --dry-run, -n   Preview only, move nothing
  --recursive, -r Recurse into subfolders (only top-level files by default)
  --plain         Archive and byte-dedupe only: no near-duplicate, health or similar-image checks
  --help, -h      Show this help

Layout: <prefix><Category>/[Subcategory]/[date]/ — the default ft_ prefix keeps tidy's output
apart from folders you made yourself. Photos and videos are filed by year-month, documents by
year, installers not by date at all; all of it is configurable.

Config: ~/.config/tidy/config.json`;

// ---------- Copy: core returns codes only, every phrasing lives here ----------
// Declared above main() so the handlers it registers can't hit the TDZ.

const PHASE_TEXT = {
  scanning: () => "Scanning files…",
  dedup: ({ files }) => `Checking ${files} files for exact duplicates…`,
  health: () => "Looking for broken files and OS junk…",
  similar: () => "Looking for near-duplicates…",
  perceptual: ({ files, done }) => (done || !files ? null : `Comparing ${files} images…`),
  planning: () => "Building the plan…",
};

const ISSUE_TEXT = {
  empty: "zero-byte file",
  corrupt: "content doesn't match the extension",
  junk: "OS junk file",
};

const SIMILAR_TEXT = {
  versioned: "another version of the same release",
  "normalized-name": "the same thing under a different name",
  "same-stem": "the same name in another format",
};

main().catch((err) => {
  console.error(styleText("red", `Error: ${formatError(err)}`));
  process.exit(1);
});

async function main() {
  const { values: flags, positionals } = parseArgs({
    options: {
      dest: { type: "string" },
      "in-place": { type: "boolean", short: "p", default: false },
      "create-dest": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "dry-run": { type: "boolean", short: "n", default: false },
      recursive: { type: "boolean", short: "r", default: false },
      plain: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (flags.help) {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  if (config._created) {
    console.log(styleText("dim", `Wrote a default config: ${config._path}`));
  } else if (config._staleCategories?.length) {
    console.log(
      styleText(
        "yellow",
        `Note: this version adds the ${config._staleCategories.join(", ")} categories, but your config ` +
          `doesn't have them, so those files will land in ${config.fallbackCategory}. ` +
          `Add them under "categories" in ${config._path} to enable them.`,
      ),
    );
  }
  if (positionals[0] === "undo") {
    const destDir = canonicalPath(
      expandTilde(flags.dest ?? config.dest ?? (await askDestDir("Which folder did the last run archive into?"))),
    );
    reportUndo(undoLastRun(destDir), destDir);
    return;
  }

  const sourceDir = canonicalPath(expandTilde(positionals[0] ?? pickFolder()));
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Not a folder: ${sourceDir}`);
  }
  const inPlace = flags["in-place"];
  // Canonicalize before the containment check so symlinked or differently
  // spelled paths (e.g. /var vs /private/var) can't sneak past it.
  const destDir = inPlace ? sourceDir : canonicalPath(expandTilde(flags.dest ?? config.dest ?? (await askDestDir())));
  if (!inPlace && (isInsideDir(sourceDir, destDir) || isInsideDir(destDir, sourceDir))) {
    throw new Error("Source and destination can't contain each other; use --in-place to tidy inside the source folder");
  }

  if (flags.plain) config.detect = false;

  const { entries, sourceFiles, counts } = await analyze({
    sourceDir,
    destDir,
    config,
    recursive: flags.recursive,
    inPlace,
    onPhase: reportPhase,
  });
  if (!sourceFiles.length) {
    console.log("Nothing to tidy (hidden files and subfolders are skipped; add --recursive to recurse).");
    return;
  }

  printPlan(entries, { destDir, fallbackCategory: config.fallbackCategory, counts });

  if (flags["dry-run"]) {
    console.log(styleText("dim", "Dry run: nothing was moved."));
    return;
  }
  const destMissing = !fs.existsSync(destDir);
  if (destMissing && !flags["create-dest"]) {
    const ok = await confirm(
      `Destination ${destDir} doesn't exist. Create it and run this plan?`,
      "creating a folder needs explicit consent — pass --create-dest, or --in-place to tidy inside the source folder",
    );
    if (!ok) {
      console.log("Cancelled: no folder created, nothing moved.");
      return;
    }
  } else if (!flags.yes && !(await confirm("Run this plan?"))) {
    console.log("Cancelled: nothing moved.");
    return;
  }

  const { moved, manifestPath } = executePlan(entries, { destDir, sourceDir });
  console.log(
    styleText(
      "green",
      `Done: ${counts.archive} archived, ${plural(counts.duplicate, "duplicate")} quarantined, ` +
        `${counts.review} set aside for review.`,
    ),
  );
  const firstDup = moved.find((e) => e.action === "duplicate");
  if (firstDup) console.log(`Duplicate details: ${path.join(path.dirname(firstDup.to), "manifest.md")}`);
  console.log(styleText("dim", `Run recorded at ${manifestPath} (undo with: tidy undo)`));
}

function reportPhase(phase, info = {}) {
  const text = PHASE_TEXT[phase]?.(info);
  if (text) console.log(styleText("dim", text));
}

// ---------- Copy: formatters ----------

function formatError(err) {
  switch (err.code) {
    case "CONFIG_PARSE":
      return `Failed to parse the config file (${err.configPath}): ${err.cause?.message ?? ""}`;
    case "EXDEV_VERIFY":
      return `Cross-volume copy verification failed: ${err.path}`;
    case "MANIFEST_CORRUPT":
      return `This tidy record is unusable, so it can't be undone (${err.manifestPath}): ${err.cause?.message ?? ""}`;
    default:
      return err.message;
  }
}

function printPlan(entries, { destDir, fallbackCategory, counts }) {
  const archives = entries.filter((e) => e.action === "archive");
  const dups = entries.filter((e) => e.action === "duplicate");
  const reviews = entries.filter((e) => e.action === "review");

  const byBucket = new Map();
  for (const e of archives) {
    const bucket = bucketLabel(e, destDir);
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(e);
  }

  console.log(styleText("bold", `\nTidy plan (destination: ${destDir})\n`));
  for (const bucket of [...byBucket.keys()].sort()) {
    const items = byBucket.get(bucket);
    // Judged by the entry's recorded category rather than by parsing the folder
    // name, so a custom category called "MyOthers" isn't tinted as the fallback.
    const isFallback = items[0].category === fallbackCategory;
    console.log(`  ${styleText(isFallback ? "yellow" : "cyan", bucket)}  (${plural(items.length, "file")})`);
    for (const e of items) {
      // The name it will actually land under: the plan already resolved
      // " (n)" suffixes, so the preview matches what ends up on disk.
      console.log(`    ${path.basename(e.to)}  ${styleText("dim", `[${formatSize(e.size)}${dateTag(e)}]`)}`);
      for (const note of hints(e)) console.log(`      ${styleText("dim", note)}`);
    }
  }

  if (dups.length) {
    console.log(
      `\n  ${styleText("magenta", `Duplicates (${plural(dups.length, "file")}, identical content, quarantined)`)}`,
    );
    for (const e of dups) {
      console.log(`    ${path.basename(e.to)}  ${styleText("dim", `↳ identical to: ${e.keeperPath}`)}`);
    }
  }

  if (reviews.length) {
    console.log(
      `\n  ${styleText("red", `Needs review (${plural(reviews.length, "file")}, moved aside, never deleted)`)}`,
    );
    for (const e of reviews) {
      const why = ISSUE_TEXT[e.issue] ?? e.issue;
      const detail = e.issue === "corrupt" ? ` (claims to be .${e.issueDetail})` : "";
      console.log(`    ${path.basename(e.to)}  ${styleText("dim", `↳ ${why}${detail}`)}`);
    }
  }

  const parts = [`${archives.length} archived`, plural(dups.length, "duplicate"), `${reviews.length} to review`];
  console.log(styleText("bold", `\n${plural(entries.length, "file")} in total: ${parts.join(", ")}`));
  if (counts?.similar || counts?.perceptual) {
    const marks = [];
    if (counts.similar) marks.push(plural(counts.similar, "near-duplicate"));
    if (counts.perceptual) marks.push(`${counts.perceptual} visually similar`);
    console.log(styleText("dim", `Also flagged: ${marks.join(", ")} — still archived normally, your call.`));
  }
  console.log("");
}

function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function dateTag(entry) {
  if (!entry.dateBucket) return "";
  return entry.dateSource === "exif" ? `, ${styleText("green", "EXIF")}` : ", file date";
}

/** Advisory annotations — these never changed where the file goes. */
function hints(entry) {
  const out = [];
  if (entry.similar) {
    const what = SIMILAR_TEXT[entry.similar.reason] ?? entry.similar.reason;
    const peers = entry.similar.peers.map((p) => path.basename(p)).join(", ");
    out.push(`↳ ${what}: ${peers}${entry.similar.best ? " (this one looks the most complete)" : ""}`);
  }
  if (entry.perceptual) {
    const peers = entry.perceptual.peers.map((p) => path.basename(p)).join(", ");
    out.push(`↳ looks nearly identical to: ${peers}${entry.perceptual.best ? " (largest of the set)" : ""}`);
  }
  return out;
}

const UNDO_FAILURE_TEXT = {
  missing: "the archived file is no longer there",
  occupied: "the original location is taken",
};

function reportUndo(result, destDir) {
  if (!result) {
    console.log("No tidy run to undo.");
    return;
  }
  const { time, sourceDir, restored, failures, removedDirs } = result;
  if (!failures.length) {
    console.log(
      styleText("green", `Undid the run from ${time}: ${plural(restored, "file")} moved back to ${sourceDir}`),
    );
  } else {
    console.log(
      styleText("yellow", `Partial undo: ${restored} restored, ${failures.length} failed (the record is kept):`),
    );
    for (const f of failures) {
      console.log(`  ${f.to} → ${f.from}: ${UNDO_FAILURE_TEXT[f.code] ?? f.message ?? f.code}`);
    }
  }
  if (removedDirs.length) {
    console.log(
      styleText(
        "dim",
        `Removed ${plural(removedDirs.length, "empty folder")}: ${removedDirs
          .map((d) => path.relative(destDir, d))
          .sort()
          .join(", ")}`,
      ),
    );
  }
  reportLeftover(destDir);
}

function reportLeftover(destDir) {
  if (!fs.existsSync(destDir)) return;
  const leftover = fs.readdirSync(destDir).filter((n) => n !== ".DS_Store");
  if (!leftover.length || leftover.every((n) => n === ".tidy")) {
    console.log(`${destDir} now holds nothing but the .tidy records — delete it yourself if you don't need them.`);
  }
}

// ---------- Interaction ----------

/** Native folder picker: osascript / PowerShell / zenity·kdialog by platform. */
function pickFolder() {
  console.log("No folder given, opening a picker… (check behind other windows if you don't see it)");
  const picked = pickFolderNative();
  if (!picked) {
    throw new Error("No folder selected (you can also pass a path: tidy ~/Downloads)");
  }
  return picked;
}

function pickFolderNative() {
  if (process.platform === "darwin") {
    const script = `
      tell application "System Events" to activate
      POSIX path of (choose folder with prompt "Choose the folder to tidy")`;
    return runPicker("osascript", ["-e", script]);
  }
  if (process.platform === "win32") {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $d = New-Object System.Windows.Forms.FolderBrowserDialog
      $d.Description = 'Choose the folder to tidy'
      $d.ShowNewFolderButton = $false
      if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`;
    return runPicker("powershell", ["-NoProfile", "-STA", "-NonInteractive", "-Command", script]);
  }
  // Linux: use whichever common dialog tool is installed.
  if (hasCommand("zenity")) {
    return runPicker("zenity", ["--file-selection", "--directory", "--title=Choose the folder to tidy"]);
  }
  if (hasCommand("kdialog")) {
    return runPicker("kdialog", ["--getexistingdirectory", process.cwd(), "--title", "Choose the folder to tidy"]);
  }
  throw new Error("No graphical folder picker available (needs zenity or kdialog): pass a path, e.g. tidy ~/Downloads");
}

function hasCommand(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Run a picker command; null when cancelled or the tool is missing. */
function runPicker(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** Ask for the destination dir when neither --dest nor config sets one. */
async function askDestDir(question = "Archive into which folder?") {
  if (!process.stdin.isTTY) {
    throw new Error('No destination given: pass --dest <dir>, or set "dest" in the config file');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [Enter = current directory ${process.cwd()}] `)).trim();
  rl.close();
  return answer || process.cwd();
}

async function confirm(question, nonInteractiveHint) {
  if (!process.stdin.isTTY) {
    const hint = nonInteractiveHint ?? "pass --yes to run without confirming, or run this in a terminal";
    console.log(styleText("yellow", `Non-interactive shell, can't ask for confirmation: ${hint}. Nothing was moved.`));
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}
