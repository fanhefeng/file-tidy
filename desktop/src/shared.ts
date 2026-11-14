import type { SimilarInfo } from "../../src/core/similar.js";
import type { PerceptualInfo } from "../../src/core/phash.js";
import type { UndoFailure } from "../../src/core/undo.js";
import type { Locale } from "./locale.js";
export type { UndoFailure } from "../../src/core/undo.js";

export interface Settings {
  config: Record<string, unknown>;
  configPath: string;
  version: string;
}

export interface AnalyzeInput {
  sourceDir: string;
  destDir: string;
  inPlace: boolean;
  recursive: boolean;
}

export interface PlanEntry {
  from: string;
  to: string;
  name: string;
  action: "archive" | "duplicate" | "review";
  size: number;
  category?: string;
  subCategory?: string | null;
  dateBucket?: string | null;
  grouping?: string[];
  metadata?: Record<string, string>;
  metadataStatus?: "read" | "missing" | "unreadable";
  issue?: string;
  issueDetail?: string;
  similar?: SimilarInfo;
  perceptual?: PerceptualInfo;
}

export interface Analysis {
  planId: string;
  destDir: string;
  entries: PlanEntry[];
  counts: { archive: number; duplicate: number; review: number; similar: number; perceptual: number };
}

export interface Progress {
  phase: string;
  files?: number;
  done?: number;
}

export interface LastRun {
  time: string;
  sourceDir: string;
  moves: number;
  manifestPath: string;
}

export interface ReportReference {
  id: string;
  path: string;
}

export interface TidyBridge {
  getPreferences(): Promise<UiPreferences>;
  setLocale(locale: Locale): Promise<UiPreferences>;
  getSettings(): Promise<Settings>;
  getDefaults(): Promise<Record<string, unknown>>;
  chooseDirectory(): Promise<string | null>;
  analyze(input: AnalyzeInput): Promise<Analysis>;
  execute(planId: string): Promise<{
    moved: number;
    manifestPath: string;
    similarReport: ReportReference | null;
    reportErrors: string[];
  }>;
  openReport(reportId: string): Promise<null>;
  getLastRun(destDir: string): Promise<LastRun | null>;
  undo(destDir: string, manifestPath: string): Promise<{ restored: number; failures: UndoFailure[] } | null>;
  saveConfig(jsonText: string): Promise<Settings>;
  onProgress(callback: (progress: Progress) => void): () => void;
}

declare global {
  interface Window {
    tidy: TidyBridge;
  }
}
export interface UiPreferences {
  locale: Locale;
}
