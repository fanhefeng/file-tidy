import crypto from "node:crypto";
import fs from "node:fs";

/** Include the exact parsed/saved bytes, so a later stat cannot bless different configuration content. */
export function fileRevision(target, contents) {
  const stat = fs.statSync(target);
  return {
    canonical: fs.realpathSync(target),
    size: stat.size,
    dev: stat.dev,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    digest: crypto
      .createHash("sha256")
      .update(contents ?? fs.readFileSync(target))
      .digest("hex"),
  };
}
