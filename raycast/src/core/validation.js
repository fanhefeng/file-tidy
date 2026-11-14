import fs from "node:fs";
import { canonicalPath, isInsideDir } from "./config.js";
import { fileRevision } from "./revision.js";

const IDENTITY_FIELDS = ["size", "dev", "ino", "mtimeMs", "ctimeMs"];

function scannedIdentity(file, reason) {
  return {
    path: file.path,
    canonical: canonicalPath(file.path),
    reason,
    ...Object.fromEntries(IDENTITY_FIELDS.map((key) => [key, file[key]])),
  };
}

export function stalePlan(target, reason) {
  const err = new Error(`The ${reason} changed after the plan was prepared: ${target}`);
  err.code = "PLAN_STALE";
  err.path = target;
  err.reason = reason;
  return err;
}

/** Scan records carry the identity from before any asynchronous detection work. */
export function createSnapshot({ sourceDir, destDir, config }) {
  let configuration;
  if (config?._path) {
    try {
      configuration = { path: config._path, revision: config._revision ?? fileRevision(config._path) };
    } catch {
      throw stalePlan(config._path, "config");
    }
  }
  return {
    sourceRoot: canonicalPath(sourceDir),
    destinationRoot: canonicalPath(destDir),
    files: [],
    config: configuration,
  };
}

export function trackSources(snapshot, sourceFiles) {
  for (const file of sourceFiles) snapshot.files.push(scannedIdentity(file, "source"));
}

export function trackKeepers(snapshot, duplicates) {
  const tracked = new Set(snapshot.files.map((file) => file.path));
  for (const { keeper } of duplicates.values()) {
    if (tracked.has(keeper.path)) continue;
    snapshot.files.push(scannedIdentity(keeper, "keeper"));
    tracked.add(keeper.path);
  }
}

export function validateSnapshot(snapshot, { sourceDir, destDir }) {
  if (!snapshot) return;
  if (canonicalPath(sourceDir) !== snapshot.sourceRoot) throw stalePlan(sourceDir, "source");
  if (canonicalPath(destDir) !== snapshot.destinationRoot) throw stalePlan(destDir, "destination");
  if (snapshot.config) {
    const { path: target, revision } = snapshot.config;
    try {
      const current = fileRevision(target);
      if (Object.keys(revision).some((key) => revision[key] !== current[key])) throw stalePlan(target, "config");
    } catch {
      throw stalePlan(target, "config");
    }
  }
  for (const file of snapshot.files) {
    let current;
    try {
      current = fs.lstatSync(file.path);
      if (!current.isFile() || canonicalPath(file.path) !== file.canonical) throw stalePlan(file.path, file.reason);
    } catch {
      throw stalePlan(file.path, file.reason);
    }
    if (IDENTITY_FIELDS.some((key) => current[key] !== file[key])) throw stalePlan(file.path, file.reason);
  }
}

/** Resolve existing ancestors too: a safe-looking category can be a link out of the archive. */
export function validatePaths(entries, { sourceRoot, destinationRoot }) {
  for (const entry of entries) {
    for (const [target, root, role] of [
      [entry.from, sourceRoot, "source"],
      [entry.to, destinationRoot, "destination"],
    ]) {
      if (!isInsideDir(root, canonicalPath(target))) {
        const err = new Error(`The ${role} path resolves outside its selected folder: ${target}`);
        err.code = "PATH_ESCAPES";
        err.path = target;
        err.root = root;
        err.role = role;
        throw err;
      }
    }
  }
}
