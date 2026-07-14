/** Loose typings for the plain-JS core modules of file-tidy. */

declare module "file-tidy/src/config.js" {
  export interface TidyConfig {
    dest: string | null;
    categories: Record<string, string[]>;
    fallbackCategory: string;
    _created?: boolean;
    _path: string;
  }
  export function loadConfig(): TidyConfig;
  export function buildExtIndex(config: TidyConfig): Map<string, string>;
  export function expandTilde(p: string): string;
  export function isInsideDir(parent: string, child: string): boolean;
}

declare module "file-tidy/src/scan.js" {
  export interface SourceFile {
    path: string;
    name: string;
    ext: string;
    size: number;
    birthtime: Date;
    mtime: Date;
  }
  export function scanSource(
    sourceDir: string,
    opts?: { recursive?: boolean; excludeTopDirs?: Set<string> },
  ): SourceFile[];
  export function scanDest(destDir: string, opts?: { onlyDirs?: Set<string> }): SourceFile[];
}

declare module "file-tidy/src/dedup.js" {
  import type { SourceFile } from "file-tidy/src/scan.js";
  export interface DupInfo {
    keeper: { path: string; name: string };
    hash: string;
  }
  export function findDuplicates(
    sourceFiles: SourceFile[],
    destFiles: SourceFile[],
  ): Promise<Map<string, DupInfo>>;
}

declare module "file-tidy/src/plan.js" {
  import type { SourceFile } from "file-tidy/src/scan.js";
  import type { DupInfo } from "file-tidy/src/dedup.js";
  export interface PlanEntry {
    from: string;
    to: string;
    name: string;
    action: "archive" | "duplicate";
    category?: string;
    yearMonth?: string;
    dateSource?: "exif" | "fs";
    size: number;
    keeperPath?: string;
    hash?: string;
  }
  export function buildPlan(input: {
    sourceFiles: SourceFile[];
    duplicates: Map<string, DupInfo>;
    destDir: string;
    extIndex: Map<string, string>;
    fallbackCategory: string;
  }): Promise<PlanEntry[]>;
  export function formatSize(bytes: number): string;
}

declare module "file-tidy/src/execute.js" {
  import type { PlanEntry } from "file-tidy/src/plan.js";
  export function executePlan(
    entries: PlanEntry[],
    opts: { destDir: string; sourceDir: string },
  ): { moved: PlanEntry[]; manifestPath: string };
}

declare module "file-tidy/src/undo.js" {
  export function undoLastRun(destDir: string): void;
}
