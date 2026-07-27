import path from "node:path";
import { DUPLICATES_DIR, REVIEW_DIR } from "./config.js";
import { classify, subClassify } from "./scan.js";
import { resolveDateBucket } from "./date.js";

/**
 * Build the move plan for all source files.
 *
 * Routing, in priority order:
 *   1. byte-identical duplicate  -> <prefix>Duplicates/
 *   2. health issue (junk/empty/corrupt) -> <prefix>Review/<issue>/
 *   3. everything else -> <prefix><Category>/[SubCategory]/[date bucket]/
 *
 * `similar` and `perceptual` never change the destination — they only annotate
 * entries, because both are name/pixel heuristics rather than proof.
 *
 * Targets may collide with each other or with existing files — execute.js
 * resolves final names with suffixes at move time.
 */
export async function buildPlan({
  sourceFiles,
  duplicates,
  destDir,
  extIndex,
  fallbackCategory,
  // Required, no identity fallback: a forgotten folderName would silently
  // archive into un-prefixed folders instead of failing loudly.
  folderName,
  granularity = {},
  subIndex = new Map(),
  health = new Map(),
  similar = new Map(),
  perceptual = new Map(),
}) {
  const entries = [];
  for (const file of sourceFiles) {
    const annotations = {
      similar: similar.get(file.path),
      perceptual: perceptual.get(file.path),
    };

    const dup = duplicates.get(file.path);
    if (dup) {
      entries.push({
        from: file.path,
        to: path.join(destDir, folderName(DUPLICATES_DIR), file.name),
        name: file.name,
        action: "duplicate",
        size: file.size,
        keeperPath: dup.keeper.path,
        hash: dup.hash,
        ...annotations,
      });
      continue;
    }

    const issue = health.get(file.path);
    if (issue) {
      entries.push({
        from: file.path,
        to: path.join(destDir, folderName(REVIEW_DIR), issue.issue, file.name),
        name: file.name,
        action: "review",
        issue: issue.issue,
        issueDetail: issue.detail,
        size: file.size,
        ...annotations,
      });
      continue;
    }

    const category = classify(file, extIndex, fallbackCategory);
    const subCategory = subClassify(file, category, subIndex);
    const { bucket, source: dateSource } = await resolveDateBucket(file, granularity[category] ?? "month");
    const segments = [destDir, folderName(category), subCategory, bucket, file.name].filter(Boolean);
    entries.push({
      from: file.path,
      to: path.join(...segments),
      name: file.name,
      action: "archive",
      category,
      subCategory,
      dateBucket: bucket,
      dateSource,
      size: file.size,
      ...annotations,
    });
  }
  return entries;
}

/**
 * Folder an entry lands in, relative to destDir — derived from the resolved
 * target rather than rebuilt from the parts, so previews show the real folder
 * name including the configured prefix.
 */
export function bucketLabel(entry, destDir) {
  return path.relative(destDir, path.dirname(entry.to));
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}${units[i]}`;
}
