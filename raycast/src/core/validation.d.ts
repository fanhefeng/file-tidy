import type { FileRevision } from "./revision.js";
import type { TidyConfig } from "./config.js";
import type { DupInfo } from "./dedup.js";
import type { PlanEntry } from "./plan.js";
import type { SourceFile } from "./scan.js";

export type PlanStaleReason = "source" | "keeper" | "config" | "destination";

/** Read-only evidence for the file identities and selected roots used by analyze(). */
export interface PlanSnapshot {
  sourceRoot: string;
  destinationRoot: string;
  config?: { path: string; revision: FileRevision };
  files: {
    path: string;
    canonical: string;
    reason: "source" | "keeper";
    size: number;
    dev: number;
    ino: number;
    mtimeMs: number;
    ctimeMs: number;
  }[];
}

export function stalePlan(
  target: string,
  reason: PlanStaleReason,
): Error & {
  code: "PLAN_STALE";
  path: string;
  reason: PlanStaleReason;
};
export function createSnapshot(input: { sourceDir: string; destDir: string; config: TidyConfig }): PlanSnapshot;
export function trackSources(snapshot: PlanSnapshot, sourceFiles: SourceFile[]): void;
export function trackKeepers(snapshot: PlanSnapshot, duplicates: Map<string, DupInfo>): void;
export function validateSnapshot(
  snapshot: PlanSnapshot | null | undefined,
  roots: { sourceDir: string; destDir: string },
): void;
export function validatePaths(
  entries: Pick<PlanEntry, "from" | "to">[],
  roots: { sourceRoot: string; destinationRoot: string },
): void;
