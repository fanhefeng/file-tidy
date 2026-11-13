import type { MetadataField } from "./config.js";
import type { SourceFile } from "./scan.js";

export type AudioMetadata = Partial<Record<MetadataField, string>>;
export interface MetadataResult {
  tags: AudioMetadata;
  status: "read" | "missing" | "unreadable";
}
export function readAudioMetadata(
  files: SourceFile[],
  options?: {
    concurrency?: number;
    onProgress?: (done: number) => void;
  },
): Promise<Map<string, MetadataResult>>;
