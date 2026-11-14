import fs from "node:fs";
import path from "node:path";
import { isJunk } from "./health.js";

/**
 * List regular files to organize under sourceDir.
 * Skips hidden files, symlinks and (unless recursive) subdirectories.
 * excludeTopDirs: top-level dir names to skip entirely (in-place mode keeps
 * its category folders out of the source scan this way).
 * Returns [{ path, name, ext, size, birthtime, mtime }]
 */
export function scanSource(sourceDir, { recursive = false, excludeTopDirs, includeJunk = false } = {}) {
  const files = [];
  walk(sourceDir, files, recursive, excludeTopDirs, includeJunk);
  return files;
}

function walk(dir, out, recursive, excludeDirs, includeJunk) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Hidden entries stay out of scope — except the handful of known OS junk
    // names, which the health pass exists to sweep up.
    if (entry.name.startsWith(".") && !(includeJunk && isJunk(entry.name))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (excludeDirs?.has(entry.name)) continue;
      if (recursive) walk(full, out, recursive, undefined, includeJunk);
      continue;
    }
    if (!entry.isFile()) continue;
    const file = toSourceFile(full, entry.name);
    if (file) out.push(file);
  }
}

/**
 * The one place the file record shape is built — walk and scanDest drifted
 * apart when each spelled it out. Returns null when the entry is gone or
 * unreadable by the time it's stat'ed: a browser finishing a download renames
 * its temp file mid-scan, and that must not abort the scan of everything else.
 */
function toSourceFile(full, name) {
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  return {
    path: full,
    name,
    ext: path.extname(name).slice(1).toLowerCase(),
    size: stat.size,
    ino: stat.ino,
    dev: stat.dev,
    birthtime: realBirthtime(stat),
    mtime: stat.mtime,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

/**
 * Recursively list already-archived files in destDir (for cross-run dedup).
 * skipDirs: top-level dir names to exclude — callers MUST pass every
 * quarantine spelling (see quarantineDirNames in config.js), or rejected
 * copies get rescanned as archived content; only dot-dirs are skipped
 * unconditionally.
 * onlyDirs: restrict to these top-level dirs and ignore loose files —
 * in-place mode uses this so unorganized source files aren't counted as
 * already archived (they'd otherwise dedup against themselves).
 */
export function scanDest(destDir, { onlyDirs, skipDirs } = {}) {
  const files = [];
  if (!fs.existsSync(destDir)) return files;
  const skip = skipDirs ?? new Set();
  for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
    const full = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (onlyDirs && !onlyDirs.has(entry.name)) continue;
      walk(full, files, true);
    } else if (entry.isFile()) {
      if (onlyDirs) continue;
      const file = toSourceFile(full, entry.name);
      if (file) files.push(file);
    }
  }
  return files;
}

/** Filesystems without creation-time support report epoch 0 — fall back to mtime. */
function realBirthtime(stat) {
  return stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime;
}

export { classify, buildSubIndex, subClassify } from "./rules.js";
