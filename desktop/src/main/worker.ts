import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import {
  DEFAULT_CONFIG,
  analyze,
  canonicalPath,
  executePlan,
  getLastRun,
  isInsideDir,
  loadConfig,
  saveConfig,
  undoRun,
} from "../../../src/core/index.js";
import type { AnalyzeInput } from "../shared.js";
import { describeError, describeReportError, desktopError } from "./errors.js";
import { isLocale } from "../locale.js";

type AnalysisResult = Awaited<ReturnType<typeof analyze>>;
type Fingerprint = { size: number; mtime: number; ino: number; dev: number };
let preview: {
  id: string;
  sourceDir: string;
  destDir: string;
  configText: string;
  result: AnalysisResult;
  files: Map<string, Fingerprint>;
} | null = null;
let queue = Promise.resolve();
const configPath: string | undefined = workerData?.configPath;

function settings() {
  const config = loadConfig(configPath);
  const clean = cleanConfig(config);
  return { config: clean, configPath: config._path, version: workerData?.version ?? "0.5.3" };
}

function cleanConfig(config: object) {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith("_")));
}

function configFingerprint() {
  return JSON.stringify(settings().config);
}

function directory(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) {
    throw desktopError("PATH_ABSOLUTE", { label });
  }
  const resolved = canonicalPath(value);
  if (!fs.statSync(resolved).isDirectory()) throw desktopError("PATH_DIRECTORY", { label });
  return resolved;
}

function fingerprint(file: string): Fingerprint {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw desktopError("FILE_CHANGED");
  return { size: stat.size, mtime: stat.mtimeMs, ino: stat.ino, dev: stat.dev };
}

async function dispatch(method: string, input: unknown, locale: "zh-CN" | "en") {
  switch (method) {
    case "getSettings":
      return settings();
    case "getDefaults":
      return structuredClone(DEFAULT_CONFIG);
    case "saveConfig": {
      if (typeof input !== "string" || input.length > 1_000_000) throw desktopError("CONFIG_TOO_LARGE");
      let raw;
      try {
        raw = JSON.parse(input);
      } catch {
        throw desktopError("JSON_INVALID");
      }
      saveConfig(raw, configPath);
      preview = null;
      return settings();
    }
    case "getLastRun": {
      const run = getLastRun(directory(input, "destination"));
      return run
        ? { time: run.time, sourceDir: run.sourceDir, moves: run.moves.length, manifestPath: run.manifestPath }
        : null;
    }
    case "analyze": {
      preview = null;
      const request = input as AnalyzeInput;
      if (!request || typeof request.inPlace !== "boolean" || typeof request.recursive !== "boolean") {
        throw desktopError("INVALID_PREVIEW");
      }
      const sourceDir = directory(request.sourceDir, "source");
      const destDir = request.inPlace ? sourceDir : directory(request.destDir, "destination");
      if (!request.inPlace && (isInsideDir(sourceDir, destDir) || isInsideDir(destDir, sourceDir))) {
        throw desktopError("ROOTS_OVERLAP");
      }
      const config = loadConfig(configPath);
      const configText = JSON.stringify(cleanConfig(config));
      const result = await analyze({
        sourceDir,
        destDir,
        config,
        inPlace: request.inPlace,
        recursive: request.recursive,
        onPhase: (phase, info) => parentPort!.postMessage({ progress: { phase, ...info } }),
      });
      const files = new Map<string, Fingerprint>();
      for (const file of result.sourceFiles) {
        const current = fingerprint(file.path);
        if (
          current.size !== file.size ||
          current.mtime !== (file.mtimeMs ?? file.mtime.getTime()) ||
          current.ino !== file.ino ||
          current.dev !== file.dev
        )
          throw desktopError("FILE_CHANGED_ANALYSIS");
        files.set(file.path, current);
      }
      if (configFingerprint() !== configText) throw desktopError("CONFIG_CHANGED_ANALYSIS");
      const id = randomUUID();
      preview = {
        id,
        sourceDir,
        destDir,
        configText,
        result,
        files,
      };
      return { planId: id, entries: result.entries, counts: result.counts };
    }
    case "execute": {
      if (!preview || input !== preview.id) throw desktopError("PREVIEW_EXPIRED");
      const plan = preview;
      preview = null;
      if (configFingerprint() !== plan.configText) throw desktopError("CONFIG_CHANGED");
      for (const entry of plan.result.entries) {
        const before = plan.files.get(entry.from);
        const current = fingerprint(entry.from);
        if (JSON.stringify(before) !== JSON.stringify(current)) throw desktopError("FILE_CHANGED");
        if (
          !isInsideDir(plan.sourceDir, canonicalPath(entry.from)) ||
          !isInsideDir(plan.destDir, canonicalPath(entry.to))
        ) {
          throw desktopError("PATH_ESCAPES");
        }
      }
      if (!plan.result.entries.length) throw desktopError("PLAN_EMPTY");
      const result = executePlan(plan.result.entries, {
        sourceDir: plan.sourceDir,
        destDir: plan.destDir,
        hashCache: plan.result.hashCache,
      });
      return {
        moved: result.moved.length,
        manifestPath: result.manifestPath,
        reportErrors: result.reportErrors.map((e) => describeReportError(e.report, locale)),
      };
    }
    case "undo": {
      preview = null;
      const request = input as { destDir?: string; manifestPath?: string };
      if (!request || typeof request.manifestPath !== "string") throw desktopError("UNDO_SELECTION");
      const destDir = directory(request.destDir, "destination");
      const current = getLastRun(destDir);
      if (!current || current.manifestPath !== request.manifestPath) throw desktopError("UNDO_CHANGED");
      const result = undoRun(destDir, request.manifestPath);
      return result ? { restored: result.restored, failures: result.failures.length } : null;
    }
    default:
      throw desktopError("UNKNOWN_OPERATION");
  }
}

parentPort!.on("message", ({ id, method, input, locale: requestedLocale }) => {
  const locale = isLocale(requestedLocale) ? requestedLocale : "en";
  // Read requests from effects may arrive while a preview is awaiting metadata.
  // Serialize every operation so reads stay reliable and mutations never overlap.
  queue = queue.then(async () => {
    try {
      parentPort!.postMessage({ id, ok: true, value: await dispatch(method, input, locale) });
    } catch (error) {
      parentPort!.postMessage({ id, ok: false, error: describeError(error, locale) });
    }
  });
});
