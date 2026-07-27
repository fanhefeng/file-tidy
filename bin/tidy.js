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

const HELP = `tidy — 归档文件、去重、挑出坏文件

用法:
  tidy [源文件夹] [选项]     整理指定文件夹（不传则弹出文件夹选择框）
  tidy undo [--dest <dir>]  撤销上一次整理（就地整理时 --dest 传源文件夹）

选项:
  --dest <dir>    归档目标目录（不传则运行时询问，回车 = 当前目录；也可在配置文件里固定）
  --in-place, -p  就地整理：分类目录直接建在源文件夹内，不在其他位置新建目录
  --create-dest   目标目录不存在时允许新建（默认会先询问；非交互环境不询问直接中止）
  --yes, -y       跳过整理确认直接执行（不跳过"新建目标目录"的询问）
  --dry-run, -n   只预览，不移动任何文件
  --recursive, -r 递归整理子文件夹（默认只整理顶层文件）
  --plain         关闭疑似重复、坏文件、相似图片三项检测，只做基础归档与字节去重
  --help, -h      显示帮助

归档结构: <前缀><类别>/[子类]/[日期]/ —— 前缀默认 ft_，用来和你自己建的目录区分。
照片视频按年-月分，文档按年分，安装包不按日期分；这些都能在配置里改。

配置: ~/.config/tidy/config.json`;

// ---------- 中文文案表（core 只给 code，措辞都在这里；定义在 main() 之前避免 TDZ） ----------

const PHASE_TEXT = {
  scanning: () => "扫描文件…",
  dedup: ({ files }) => `字节级去重（${files} 个文件）…`,
  health: () => "检查坏文件与系统垃圾…",
  similar: () => "查找疑似重复…",
  perceptual: ({ files, done }) => (done || !files ? null : `比对相似图片（${files} 张）…`),
  planning: () => "生成整理计划…",
};

const ISSUE_TEXT = { empty: "0 字节空文件", corrupt: "内容与扩展名不符", junk: "系统垃圾文件" };

const SIMILAR_TEXT = {
  versioned: "同一软件的其他版本",
  "normalized-name": "换个名字的同一份东西",
  "same-stem": "同名的另一种格式",
};

main().catch((err) => {
  console.error(styleText("red", `出错了: ${zhError(err)}`));
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
    console.log(styleText("dim", `已生成默认配置: ${config._path}`));
  } else if (config._staleCategories?.length) {
    console.log(
      styleText(
        "yellow",
        `提示：新版新增了 ${config._staleCategories.join("、")} 类别，但你的配置文件里没有，` +
          `这些文件会落到 ${config.fallbackCategory}。想启用就在 ${config._path} 的 categories 里加上。`,
      ),
    );
  }
  if (positionals[0] === "undo") {
    const destDir = canonicalPath(expandTilde(flags.dest ?? config.dest ?? (await askDestDir("上次整理的归档目录？"))));
    reportUndo(undoLastRun(destDir), destDir);
    return;
  }

  const sourceDir = canonicalPath(expandTilde(positionals[0] ?? pickFolder()));
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`不是有效的文件夹: ${sourceDir}`);
  }
  const inPlace = flags["in-place"];
  // Canonicalize before the containment check so symlinked or differently
  // spelled paths (e.g. /var vs /private/var) can't sneak past it.
  const destDir = inPlace ? sourceDir : canonicalPath(expandTilde(flags.dest ?? config.dest ?? (await askDestDir())));
  if (!inPlace && (isInsideDir(sourceDir, destDir) || isInsideDir(destDir, sourceDir))) {
    throw new Error("源文件夹和归档目标不能互相包含；想在源文件夹内整理请用 --in-place");
  }

  if (flags.plain) config.detect = { similar: false, health: false, perceptual: false };

  const { entries, sourceFiles, counts } = await analyze({
    sourceDir,
    destDir,
    config,
    recursive: flags.recursive,
    inPlace,
    onPhase: reportPhase,
  });
  if (!sourceFiles.length) {
    console.log("没有需要整理的文件（隐藏文件和子文件夹会被跳过，递归请加 --recursive）。");
    return;
  }

  printPlan(entries, { destDir, fallbackCategory: config.fallbackCategory, counts });

  if (flags["dry-run"]) {
    console.log(styleText("dim", "dry-run 模式，未移动任何文件。"));
    return;
  }
  const destMissing = !fs.existsSync(destDir);
  if (destMissing && !flags["create-dest"]) {
    const ok = await confirm(
      `目标目录 ${destDir} 不存在，新建它并执行以上整理？`,
      "新建目录需要明确同意——加 --create-dest 允许新建，或用 --in-place 在源文件夹内整理",
    );
    if (!ok) {
      console.log("已取消，未新建目录、未移动任何文件。");
      return;
    }
  } else if (!flags.yes && !(await confirm("确认执行以上整理？"))) {
    console.log("已取消，未移动任何文件。");
    return;
  }

  const { moved, manifestPath } = executePlan(entries, { destDir, sourceDir, formatDupBlock: zhDupBlock });
  const done = tally(moved);
  console.log(
    styleText("green", `完成：归档 ${done.archive} 个，隔离重复 ${done.duplicate} 个，挑出待查 ${done.review} 个。`),
  );
  const firstDup = moved.find((e) => e.action === "duplicate");
  if (firstDup) console.log(`重复文件详情见 ${path.join(path.dirname(firstDup.to), "manifest.md")}`);
  console.log(styleText("dim", `本次记录: ${manifestPath}（可用 tidy undo 撤销）`));
}

function tally(entries) {
  const counts = { archive: 0, duplicate: 0, review: 0 };
  for (const e of entries) counts[e.action]++;
  return counts;
}

function reportPhase(phase, info = {}) {
  const text = PHASE_TEXT[phase]?.(info);
  if (text) console.log(styleText("dim", text));
}

// ---------- 中文文案（core 只返回数据和错误码，措辞都在这里） ----------

function zhError(err) {
  switch (err.code) {
    case "CONFIG_PARSE":
      return `配置文件解析失败（${err.configPath}）：${err.cause?.message ?? ""}`;
    case "EXDEV_VERIFY":
      return `跨卷复制校验失败: ${err.path}`;
    default:
      return err.message;
  }
}

function zhDupBlock(dups) {
  const lines = [`\n## ${new Date().toLocaleString("zh-CN")}\n`];
  for (const d of dups) {
    lines.push(
      `- \`${path.basename(d.to)}\` 与已保留的 \`${d.keeperPath}\` 内容完全相同（SHA-256: ${d.hash.slice(0, 16)}…）`,
    );
  }
  return lines.join("\n") + "\n";
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

  console.log(styleText("bold", `\n整理计划（目标：${destDir}）\n`));
  for (const bucket of [...byBucket.keys()].sort()) {
    const items = byBucket.get(bucket);
    const isFallback = bucket.split(path.sep)[0].endsWith(fallbackCategory);
    console.log(`  ${styleText(isFallback ? "yellow" : "cyan", bucket)}  (${items.length} 个)`);
    for (const e of items) {
      console.log(`    ${e.name}  ${styleText("dim", `[${formatSize(e.size)}${dateTag(e)}]`)}`);
      for (const note of hints(e)) console.log(`      ${styleText("dim", note)}`);
    }
  }

  if (dups.length) {
    console.log(`\n  ${styleText("magenta", `重复文件（${dups.length} 个，内容完全相同，移入隔离区）`)}`);
    for (const e of dups) {
      console.log(`    ${e.name}  ${styleText("dim", `↳ 与之相同: ${e.keeperPath}`)}`);
    }
  }

  if (reviews.length) {
    console.log(`\n  ${styleText("red", `待查文件（${reviews.length} 个，移入待查区，不会删）`)}`);
    for (const e of reviews) {
      const why = ISSUE_TEXT[e.issue] ?? e.issue;
      const detail = e.issue === "corrupt" ? `（声称是 .${e.issueDetail}）` : "";
      console.log(`    ${e.name}  ${styleText("dim", `↳ ${why}${detail}`)}`);
    }
  }

  const parts = [`归档 ${archives.length} 个`, `重复 ${dups.length} 个`, `待查 ${reviews.length} 个`];
  console.log(styleText("bold", `\n共 ${entries.length} 个文件：${parts.join("，")}`));
  if (counts?.similar || counts?.perceptual) {
    const marks = [];
    if (counts.similar) marks.push(`${counts.similar} 个疑似重复`);
    if (counts.perceptual) marks.push(`${counts.perceptual} 个相似图片`);
    console.log(styleText("dim", `另有 ${marks.join("、")}（已标注，仍照常归档，请自行判断）`));
  }
  console.log("");
}

function dateTag(entry) {
  if (!entry.dateBucket) return "";
  return entry.dateSource === "exif" ? `, ${styleText("green", "EXIF")}` : ", 文件日期";
}

/** Advisory annotations — these never changed where the file goes. */
function hints(entry) {
  const out = [];
  if (entry.similar) {
    const what = SIMILAR_TEXT[entry.similar.reason] ?? entry.similar.reason;
    const peers = entry.similar.peers.map((p) => path.basename(p)).join("、");
    out.push(`↳ ${what}：${peers}${entry.similar.best ? "（这份看着更完整）" : ""}`);
  }
  if (entry.perceptual) {
    const peers = entry.perceptual.peers.map((p) => path.basename(p)).join("、");
    out.push(`↳ 画面几乎相同：${peers}${entry.perceptual.best ? "（这份分辨率/体积最大）" : ""}`);
  }
  return out;
}

const UNDO_FAILURE_TEXT = { missing: "归档后的文件已不在原位", occupied: "原位置已有同名文件" };

function reportUndo(result, destDir) {
  if (!result) {
    console.log("没有可撤销的整理记录。");
    return;
  }
  const { time, sourceDir, restored, failures, removedDirs } = result;
  if (!failures.length) {
    console.log(styleText("green", `已撤销 ${time} 的整理：${restored} 个文件移回 ${sourceDir}`));
  } else {
    console.log(
      styleText("yellow", `部分撤销：${restored} 个成功，${failures.length} 个失败（清单保留，未标记为已撤销）：`),
    );
    for (const f of failures) {
      console.log(`  ${f.to} → ${f.from}：${UNDO_FAILURE_TEXT[f.code] ?? f.message ?? f.code}`);
    }
  }
  if (removedDirs.length) {
    console.log(
      styleText(
        "dim",
        `已清理 ${removedDirs.length} 个空目录：${removedDirs
          .map((d) => path.relative(destDir, d))
          .sort()
          .join("、")}`,
      ),
    );
  }
  reportLeftover(destDir);
}

function reportLeftover(destDir) {
  if (!fs.existsSync(destDir)) return;
  const leftover = fs.readdirSync(destDir).filter((n) => n !== ".DS_Store");
  if (!leftover.length || leftover.every((n) => n === ".tidy")) {
    console.log(`目标目录 ${destDir} 现在只剩 .tidy 整理记录，不再需要的话可以整个删除（我不会自动删）。`);
  }
}

// ---------- 交互 ----------

/** Native folder picker: osascript / PowerShell / zenity·kdialog by platform. */
function pickFolder() {
  console.log("未指定文件夹，弹出选择框…（如果没看到，检查一下是否被其他窗口挡住）");
  const picked = pickFolderNative();
  if (!picked) {
    throw new Error("未选择文件夹（也可以直接指定路径：tidy ~/Downloads）");
  }
  return picked;
}

function pickFolderNative() {
  if (process.platform === "darwin") {
    const script = `
      tell application "System Events" to activate
      POSIX path of (choose folder with prompt "选择要整理的文件夹")`;
    return runPicker("osascript", ["-e", script]);
  }
  if (process.platform === "win32") {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $d = New-Object System.Windows.Forms.FolderBrowserDialog
      $d.Description = '选择要整理的文件夹'
      $d.ShowNewFolderButton = $false
      if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`;
    return runPicker("powershell", ["-NoProfile", "-STA", "-NonInteractive", "-Command", script]);
  }
  // Linux: use whichever common dialog tool is installed.
  if (hasCommand("zenity")) {
    return runPicker("zenity", ["--file-selection", "--directory", "--title=选择要整理的文件夹"]);
  }
  if (hasCommand("kdialog")) {
    return runPicker("kdialog", ["--getexistingdirectory", process.cwd(), "--title", "选择要整理的文件夹"]);
  }
  throw new Error("没有可用的图形选择框（需要 zenity 或 kdialog）：请直接指定路径，如 tidy ~/Downloads");
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
async function askDestDir(question = "归档到哪个目录？") {
  if (!process.stdin.isTTY) {
    throw new Error("未指定归档目标目录：非交互环境请用 --dest <dir> 指定，或在配置文件里设置 dest");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [回车 = 当前目录 ${process.cwd()}] `)).trim();
  rl.close();
  return answer || process.cwd();
}

async function confirm(question, nonInteractiveHint) {
  if (!process.stdin.isTTY) {
    const hint = nonInteractiveHint ?? "请加 --yes 直接执行，或在终端窗口里运行";
    console.log(styleText("yellow", `当前是非交互环境，无法回答确认提示：${hint}。未移动任何文件。`));
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}
