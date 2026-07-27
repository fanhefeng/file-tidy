import type { SourceFile } from "./scan.js";

export interface SimilarInfo {
  reason: "versioned" | "normalized-name" | "same-stem";
  best: boolean;
  peers: string[];
}
export function findSimilar(files: SourceFile[]): Map<string, SimilarInfo>;
