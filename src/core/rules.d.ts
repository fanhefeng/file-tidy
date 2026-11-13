import type { TidyConfig, Granularity, MetadataField } from "./config.js";
import type { SourceFile } from "./scan.js";
import type { AudioMetadata } from "./metadata.js";
export interface FileClassification {
  category: string;
  subCategory: string | null;
  groupBy: MetadataField[];
  granularity: Granularity;
  matchedExtension: string | null;
}
export function compileRules(config: TidyConfig): (file: SourceFile) => FileClassification;
export function buildExtensionIndex(config: TidyConfig): Map<string, string>;
export { classify, buildSubIndex, subClassify } from "./scan.js";
export function metadataSegment(value: unknown, fallback: string): string;
export function groupingSegments(file: SourceFile, fields: MetadataField[], metadata?: AudioMetadata): string[];
