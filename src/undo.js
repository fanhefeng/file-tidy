import fs from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';

/** Revert the most recent run by moving every file back, then retire the manifest. */
export function undoLastRun(destDir) {
  const runsDir = path.join(destDir, '.tidy', 'runs');
  if (!fs.existsSync(runsDir)) {
    console.log('没有可撤销的整理记录。');
    return;
  }
  const runs = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort();
  if (!runs.length) {
    console.log('没有可撤销的整理记录。');
    return;
  }
  const latest = path.join(runsDir, runs.at(-1));
  const { moves, sourceDir, time } = JSON.parse(fs.readFileSync(latest, 'utf8'));

  let restored = 0;
  const failures = [];
  for (const { from, to } of moves) {
    try {
      if (!fs.existsSync(to)) throw new Error('归档后的文件已不在原位');
      fs.mkdirSync(path.dirname(from), { recursive: true });
      if (fs.existsSync(from)) throw new Error('原位置已有同名文件');
      fs.renameSync(to, from);
      restored++;
    } catch (err) {
      failures.push({ to, from, reason: err.message });
    }
  }

  if (!failures.length) {
    fs.renameSync(latest, `${latest}.undone`);
    console.log(styleText('green', `已撤销 ${time} 的整理：${restored} 个文件移回 ${sourceDir}`));
  } else {
    console.log(styleText('yellow', `部分撤销：${restored} 个成功，${failures.length} 个失败（清单保留，未标记为已撤销）：`));
    for (const f of failures) console.log(`  ${f.to} → ${f.from}：${f.reason}`);
  }

  const removedDirs = cleanupEmptyDirs(moves, destDir);
  if (removedDirs.length) {
    console.log(styleText('dim', `已清理 ${removedDirs.length} 个空目录：${removedDirs.map((d) => path.relative(destDir, d)).sort().join('、')}`));
  }
  reportLeftover(destDir);
}

/**
 * After files move back, remove now-empty directories this run had created:
 * walk up from each move target toward destDir, rmdir-ing truly empty dirs.
 * Never touches destDir itself, never deletes files (rmdir fails on non-empty).
 */
function cleanupEmptyDirs(moves, destDir) {
  const removed = [];
  for (const { to } of moves) {
    let dir = path.dirname(to);
    while (dir.startsWith(destDir + path.sep)) {
      if (fs.existsSync(dir)) {
        if (fs.readdirSync(dir).length) break;
        fs.rmdirSync(dir);
        removed.push(dir);
      }
      dir = path.dirname(dir);
    }
  }
  return removed;
}

function reportLeftover(destDir) {
  if (!fs.existsSync(destDir)) return;
  const leftover = fs.readdirSync(destDir).filter((n) => n !== '.DS_Store');
  if (!leftover.length || leftover.every((n) => n === '.tidy')) {
    console.log(`目标目录 ${destDir} 现在只剩 .tidy 整理记录，不再需要的话可以整个删除（我不会自动删）。`);
  }
}
