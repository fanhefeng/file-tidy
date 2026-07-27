import fs from "node:fs";

/**
 * Cheap integrity checks over the scanned files. Reads at most 16 bytes per
 * file, so this stays essentially free next to hashing.
 *
 * Returns Map<path, { issue: "empty"|"corrupt"|"junk", detail? }>.
 * Callers decide what to do with them; plan.js routes these to the review
 * folder rather than the normal archive.
 */
export function checkHealth(files) {
  const issues = new Map();
  for (const file of files) {
    if (isJunk(file.name)) {
      issues.set(file.path, { issue: "junk" });
      continue;
    }
    if (file.size === 0) {
      issues.set(file.path, { issue: "empty" });
      continue;
    }
    const expected = MAGIC[file.ext];
    if (!expected) continue;
    const head = readHead(file.path);
    if (head && !expected.some((sig) => matches(head, sig))) {
      issues.set(file.path, { issue: "corrupt", detail: file.ext });
    }
  }
  return issues;
}

/** OS/tooling debris that carries no user content. */
const JUNK_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".localized"]);

export function isJunk(name) {
  return JUNK_NAMES.has(name) || name.startsWith("._");
}

/**
 * Expected leading bytes per extension. `null` inside a signature means "any
 * byte here" — used for formats with a variable-length prefix (ftyp boxes).
 * Only formats with a stable, well-known magic number are listed: a missing
 * entry means "don't judge", never "broken".
 */
const S = (str) => [...str].map((c) => c.charCodeAt(0));
const MAGIC = {
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, ...S("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]],
  gif: [S("GIF87a"), S("GIF89a")],
  bmp: [S("BM")],
  webp: [[...S("RIFF"), null, null, null, null, ...S("WEBP")]],
  avif: [[null, null, null, null, ...S("ftyp")]],
  heic: [[null, null, null, null, ...S("ftyp")]],
  heif: [[null, null, null, null, ...S("ftyp")]],
  tiff: [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
  ],
  tif: [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
  ],
  mp4: [[null, null, null, null, ...S("ftyp")]],
  m4v: [[null, null, null, null, ...S("ftyp")]],
  mov: [
    [null, null, null, null, ...S("ftyp")],
    [null, null, null, null, ...S("moov")],
  ],
  mkv: [[0x1a, 0x45, 0xdf, 0xa3]],
  webm: [[0x1a, 0x45, 0xdf, 0xa3]],
  avi: [[...S("RIFF"), null, null, null, null, ...S("AVI ")]],
  flv: [S("FLV")],
  mp3: [S("ID3"), [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2]],
  flac: [S("fLaC")],
  wav: [[...S("RIFF"), null, null, null, null, ...S("WAVE")]],
  ogg: [S("OggS")],
  m4a: [[null, null, null, null, ...S("ftyp")]],
  aiff: [[...S("FORM"), null, null, null, null, ...S("AIFF")]],
  pdf: [S("%PDF")],
  // Every OOXML/ODF/epub/jar is a zip underneath.
  zip: [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
  docx: [[0x50, 0x4b, 0x03, 0x04]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],
  pptx: [[0x50, 0x4b, 0x03, 0x04]],
  epub: [[0x50, 0x4b, 0x03, 0x04]],
  rar: [S("Rar!")],
  "7z": [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  gz: [[0x1f, 0x8b]],
  bz2: [S("BZh")],
  xz: [[0xfd, ...S("7zXZ"), 0x00]],
};

function matches(head, signature) {
  if (head.length < signature.length) return false;
  return signature.every((byte, i) => byte === null || head[i] === byte);
}

function readHead(filePath, bytes = 16) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read);
  } catch {
    // Unreadable file — not our job to diagnose here; skip the check.
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
