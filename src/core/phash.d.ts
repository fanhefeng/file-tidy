import type { SourceFile } from "./scan.js";

export interface PerceptualInfo {
  peers: string[];
  best: boolean;
  distance: number;
}
export function isHashableImage(file: SourceFile): boolean;
export function hashImages(
  files: SourceFile[],
  options?: { onProgress?: (done: number) => void },
): Promise<Map<string, bigint>>;
export function hammingDistance(a: bigint, b: bigint): number;
export function clusterByHash(
  hashes: Map<string, bigint>,
  filesByPath: Map<string, SourceFile>,
  threshold?: number,
): Map<string, PerceptualInfo>;
