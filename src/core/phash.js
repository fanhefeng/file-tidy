import fs from "node:fs";
import exifr from "exifr";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/**
 * Perceptual (difference) hashing for images — catches copies byte-level
 * dedup structurally cannot: burst shots, re-exports at another resolution,
 * a messenger's re-compressed version of a photo you also have at full size.
 *
 * Pipeline: decode -> greyscale -> 9x8 box-downsample -> compare each pixel
 * with its right neighbour -> 64-bit hash. Two images are near-identical when
 * the Hamming distance between their hashes is small.
 *
 * Decoding is pure JS on purpose (jpeg-js / pngjs, no native modules) so the
 * Raycast extension stays self-contained. Formats those two can't read (HEIC,
 * RAW, …) fall back to the embedded EXIF thumbnail, which is a JPEG — that
 * covers iPhone/camera libraries. Anything still undecodable is skipped, never
 * fatal: this pass is advisory.
 */

const DIRECT_EXTS = new Set(["jpg", "jpeg", "png"]);
const THUMB_EXTS = new Set(["heic", "heif", "dng", "raw", "tiff", "tif", "avif", "webp", "cr2", "nef", "arw"]);
const HASH_W = 9;
const HASH_H = 8;
/** Skip absurdly large files: a full decode of those costs more than it's worth. */
const MAX_DECODE_BYTES = 80 * 1024 * 1024;

export function isHashableImage(file) {
  return DIRECT_EXTS.has(file.ext) || THUMB_EXTS.has(file.ext);
}

/**
 * Hash every hashable image. Returns Map<path, bigint>; files that couldn't be
 * decoded are simply absent.
 */
export async function hashImages(files, { onProgress } = {}) {
  const hashes = new Map();
  let done = 0;
  for (const file of files) {
    if (!isHashableImage(file)) continue;
    const hash = await hashImage(file);
    if (hash !== null) hashes.set(file.path, hash);
    onProgress?.(++done);
  }
  return hashes;
}

async function hashImage(file) {
  const pixels = await decodeGrey(file);
  return pixels ? dHash(pixels) : null;
}

/** { data: Uint8Array (greyscale), width, height } or null. */
async function decodeGrey(file) {
  if (DIRECT_EXTS.has(file.ext) && file.size <= MAX_DECODE_BYTES) {
    const direct = decodeBuffer(fs.readFileSync(file.path), file.ext);
    if (direct) return direct;
  }
  // HEIC/RAW/etc, or a JPEG/PNG that failed to decode: try the EXIF thumbnail.
  try {
    const thumb = await exifr.thumbnail(file.path);
    if (thumb) return decodeBuffer(Buffer.from(thumb), "jpg");
  } catch {
    // No thumbnail or unreadable container — give up on this file.
  }
  return null;
}

function decodeBuffer(buf, ext) {
  try {
    if (ext === "png") {
      const png = PNG.sync.read(buf);
      return toGrey(png.data, png.width, png.height, 4);
    }
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
    return toGrey(img.data, img.width, img.height, 4);
  } catch {
    return null;
  }
}

/** Rec. 601 luma, the standard weighting for perceptual greyscale. */
function toGrey(data, width, height, channels) {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += channels, p++) {
    out[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return { data: out, width, height };
}

/**
 * Box-average down to 9x8, then set one bit per horizontal neighbour pair.
 * Averaging (rather than nearest-neighbour sampling) is what makes the hash
 * survive rescaling and JPEG recompression.
 */
function dHash({ data, width, height }) {
  const small = new Float64Array(HASH_W * HASH_H);
  for (let y = 0; y < HASH_H; y++) {
    const y0 = Math.floor((y * height) / HASH_H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / HASH_H));
    for (let x = 0; x < HASH_W; x++) {
      const x0 = Math.floor((x * width) / HASH_W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / HASH_W));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          sum += data[yy * width + xx];
          n++;
        }
      }
      small[y * HASH_W + x] = sum / n;
    }
  }
  let hash = 0n;
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      hash <<= 1n;
      if (small[y * HASH_W + x] > small[y * HASH_W + x + 1]) hash |= 1n;
    }
  }
  return hash;
}

export function hammingDistance(a, b) {
  let diff = a ^ b;
  let count = 0;
  while (diff) {
    diff &= diff - 1n;
    count++;
  }
  return count;
}

/**
 * Cluster images whose hashes are within `threshold` bits of each other.
 * Single-link clustering over a small set — image counts here are in the
 * thousands at most, so the pairwise scan is fine.
 *
 * Returns Map<path, { peers: string[], best: boolean, distance: number }>,
 * where `best` marks the largest file in the cluster (usually the original,
 * least-recompressed copy).
 */
export function clusterByHash(hashes, filesByPath, threshold = 5) {
  const paths = [...hashes.keys()];
  const parent = new Map(paths.map((p) => [p, p]));
  const find = (p) => {
    while (parent.get(p) !== p) {
      parent.set(p, parent.get(parent.get(p)));
      p = parent.get(p);
    }
    return p;
  };
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra, rb);
  };

  const nearest = new Map();
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const d = hammingDistance(hashes.get(paths[i]), hashes.get(paths[j]));
      if (d > threshold) continue;
      union(paths[i], paths[j]);
      for (const [a, b] of [
        [paths[i], paths[j]],
        [paths[j], paths[i]],
      ]) {
        if (!nearest.has(a) || nearest.get(a).d > d) nearest.set(a, { d, peer: b });
      }
    }
  }

  const clusters = new Map();
  for (const p of paths) {
    const root = find(p);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(p);
  }

  const result = new Map();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const best = members.reduce((a, b) => ((filesByPath.get(b)?.size ?? 0) > (filesByPath.get(a)?.size ?? 0) ? b : a));
    for (const p of members) {
      result.set(p, {
        peers: members.filter((m) => m !== p),
        best: p === best,
        distance: nearest.get(p)?.d ?? 0,
      });
    }
  }
  return result;
}
