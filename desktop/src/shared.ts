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
  similar?: unknown;
  perceptual?: unknown;
}

export interface Analysis {
  planId: string;
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

export interface TidyBridge {
  getPreferences(): Promise<UiPreferences>;
  setLocale(locale: Locale): Promise<UiPreferences>;
  getSettings(): Promise<Settings>;
  getDefaults(): Promise<Record<string, unknown>>;
  chooseDirectory(): Promise<string | null>;
  analyze(input: AnalyzeInput): Promise<Analysis>;
  execute(planId: string): Promise<{ moved: number; manifestPath: string; reportErrors: string[] }>;
  getLastRun(destDir: string): Promise<LastRun | null>;
  undo(destDir: string, manifestPath: string): Promise<{ restored: number; failures: number } | null>;
  saveConfig(jsonText: string): Promise<Settings>;
  onProgress(callback: (progress: Progress) => void): () => void;
}

declare global {
  interface Window {
    tidy: TidyBridge;
  }
}
import type { Locale } from "./locale.js";

export interface UiPreferences {
  locale: Locale;
}
