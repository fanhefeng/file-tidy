import path from 'node:path';
import { styleText } from 'node:util';
import { classify } from './scan.js';
import { resolveYearMonth } from './date.js';

/**
 * Build the move plan for all source files.
 * Each entry: { from, to, name, action: 'archive'|'duplicate', category,
 *               yearMonth, dateSource, size, keeperPath?, hash? }
 * Targets may collide with each other or with existing files — execute.js
 * resolves final names with suffixes at move time.
 */
export async function buildPlan({ sourceFiles, duplicates, destDir, extIndex, fallbackCategory }) {
  const entries = [];
  for (const file of sourceFiles) {
    const dup = duplicates.get(file.path);
    if (dup) {
      entries.push({
        from: file.path,
        to: path.join(destDir, 'Duplicates', file.name),
        name: file.name,
        action: 'duplicate',
        size: file.size,
        keeperPath: dup.keeper.path,
        hash: dup.hash,
      });
      continue;
    }
    const category = classify(file, extIndex, fallbackCategory);
    const { yearMonth, source: dateSource } = await resolveYearMonth(file);
    entries.push({
      from: file.path,
      to: path.join(destDir, category, yearMonth, file.name),
      name: file.name,
      action: 'archive',
      category,
      yearMonth,
      dateSource,
      size: file.size,
    });
  }
  return entries;
}

export function printPlan(entries, { destDir, fallbackCategory }) {
  const archives = entries.filter((e) => e.action === 'archive');
  const dups = entries.filter((e) => e.action === 'duplicate');

  const byBucket = new Map();
  for (const e of archives) {
    const bucket = `${e.category}/${e.yearMonth}`;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(e);
  }

  console.log(styleText('bold', `\n整理计划（目标：${destDir}）\n`));
  for (const bucket of [...byBucket.keys()].sort()) {
    const items = byBucket.get(bucket);
    const isFallback = bucket.startsWith(`${fallbackCategory}/`);
    const label = isFallback ? styleText('yellow', bucket) : styleText('cyan', bucket);
    console.log(`  ${label}  (${items.length} 个)`);
    for (const e of items) {
      const dateTag = e.dateSource === 'exif' ? styleText('green', 'EXIF') : '文件日期';
      console.log(`    ${e.name}  ${styleText('dim', `[${formatSize(e.size)}, ${dateTag}]`)}`);
    }
  }

  if (dups.length) {
    console.log(`\n  ${styleText('magenta', `Duplicates（${dups.length} 个重复文件，移入隔离区）`)}`);
    for (const e of dups) {
      console.log(`    ${e.name}  ${styleText('dim', `↳ 与之相同: ${e.keeperPath}`)}`);
    }
  }

  console.log(styleText('bold', `\n共 ${entries.length} 个文件：归档 ${archives.length} 个，重复 ${dups.length} 个\n`));
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}${units[i]}`;
}
