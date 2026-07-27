import { buildExtIndex, buildFolderNamer, organizedDirNames, quarantineDirNames } from "./config.js";
import { findDuplicates } from "./dedup.js";
import { checkHealth } from "./health.js";
import { clusterByHash, hashImages, isHashableImage, loadHashCache, saveHashCache } from "./phash.js";
import { buildPlan } from "./plan.js";
import { buildSubIndex, scanDest, scanSource } from "./scan.js";
import { findSimilar } from "./similar.js";

/**
 * Scan, run every enabled detection pass, and build the plan — the whole
 * pipeline both adapters need, in one call, so CLI and Raycast can't drift
 * apart on which passes run or in what order.
 *
 * `onPhase(phase, info)` reports progress: "scanning" | "dedup" | "health" |
 * "similar" | "perceptual" | "planning". Adapters own the wording.
 *
 * Returns { entries, sourceFiles, organizedDirs, counts }.
 */
export async function analyze({ sourceDir, destDir, config, recursive = false, inPlace = false, onPhase = () => {} }) {
  const detect = config.detect ?? {};
  const organizedDirs = organizedDirNames(config);

  onPhase("scanning");
  const sourceFiles = scanSource(sourceDir, {
    recursive,
    excludeTopDirs: inPlace ? organizedDirs : undefined,
    includeJunk: detect.health !== false,
  });
  if (!sourceFiles.length) {
    return { entries: [], sourceFiles, organizedDirs, counts: emptyCounts() };
  }

  // Health first: junk and broken files are headed for review anyway, and they
  // must not participate in dedup — a byte-identical junk pair would otherwise
  // get one copy quarantined as a "duplicate" whose keeper lives in Review.
  // (It's also the cheaper pass: 16 bytes per file vs hashing.)
  let health = new Map();
  if (detect.health !== false) {
    onPhase("health", { files: sourceFiles.length });
    health = checkHealth(sourceFiles);
  }
  const sound = sourceFiles.filter((f) => !health.has(f.path));

  // Quarantine folders hold rejected copies — they must never act as keepers
  // for dedup, nor be rescanned as archived content, whichever prefix they
  // were created under.
  const destFiles = scanDest(destDir, {
    onlyDirs: inPlace ? organizedDirs : undefined,
    skipDirs: new Set([".tidy", ...quarantineDirNames(config)]),
  });

  onPhase("dedup", { files: sound.length });
  const duplicates = await findDuplicates(sound, destFiles);

  const healthy = sound.filter((f) => !duplicates.has(f.path));

  const sourcePaths = new Set(healthy.map((f) => f.path));

  let similar = new Map();
  if (detect.similar !== false) {
    onPhase("similar", { files: healthy.length });
    // Archived files join the comparison so a fresh download that restates
    // something already in the archive still gets flagged — but they're only
    // context: drop them from the result, since nothing in dest is being moved.
    similar = findSimilar([...healthy, ...destFiles]);
    for (const p of [...similar.keys()]) {
      if (!sourcePaths.has(p)) similar.delete(p);
    }
  }

  let perceptual = new Map();
  // Without a hashable source image the pass could only flag archive-vs-archive
  // pairs, all of which get filtered out below — skip the decoding entirely.
  const sourceImages = detect.perceptual !== false ? healthy.filter(isHashableImage) : [];
  if (sourceImages.length) {
    const images = [...sourceImages, ...destFiles.filter(isHashableImage)];
    onPhase("perceptual", { files: images.length });
    // The cache spares re-decoding the whole archive on every run — decode cost
    // would otherwise grow with the archive, not with the batch being tidied.
    const cache = loadHashCache(destDir);
    const hashes = await hashImages(images, {
      cache,
      onProgress: (done) => onPhase("perceptual", { files: images.length, done }),
    });
    saveHashCache(destDir, cache, images);
    if (hashes.size > 1) {
      const byPath = new Map(images.map((f) => [f.path, f]));
      perceptual = clusterByHash(hashes, byPath, config.perceptualThreshold ?? 5);
      for (const p of [...perceptual.keys()]) {
        if (!sourcePaths.has(p)) perceptual.delete(p);
      }
    }
  }

  onPhase("planning");
  const entries = await buildPlan({
    sourceFiles,
    duplicates,
    destDir,
    extIndex: buildExtIndex(config),
    fallbackCategory: config.fallbackCategory,
    folderName: buildFolderNamer(destDir, config),
    granularity: config.granularity,
    subIndex: buildSubIndex(config.subCategories),
    health,
    similar,
    perceptual,
  });

  return { entries, sourceFiles, organizedDirs, counts: countBy(entries) };
}

function emptyCounts() {
  return { archive: 0, duplicate: 0, review: 0, similar: 0, perceptual: 0 };
}

function countBy(entries) {
  const counts = emptyCounts();
  for (const e of entries) {
    counts[e.action] = (counts[e.action] ?? 0) + 1;
    if (e.similar) counts.similar++;
    if (e.perceptual) counts.perceptual++;
  }
  return counts;
}
