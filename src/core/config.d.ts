export type Granularity = "month" | "year" | "none";
export type MetadataField = "artist" | "albumArtist" | "album" | "title" | "genre" | "year";
export interface ExtensionRule {
  category: string;
  groupBy?: MetadataField[];
  granularity?: Granularity;
}

export interface SubCategoryRule {
  name: string;
  match?: string[];
  exts?: string[];
}

export interface TidyConfig {
  dest: string | null;
  categories: Record<string, string[]>;
  extensions: Record<string, string | ExtensionRule>;
  groupBy: Record<string, MetadataField[]>;
  fallbackCategory: string;
  folderPrefix: string;
  granularity: Record<string, Granularity>;
  subCategories: Record<string, SubCategoryRule[]>;
  /** Per-pass switches, or `false` to turn every detection pass off (current and future). */
  detect: { similar: boolean; health: boolean; perceptual: boolean } | false;
  perceptualThreshold: number;
  _created?: boolean;
  /** Default categories missing from the user's config file (added in a later version). */
  _staleCategories?: string[];
  _path?: string;
}
export const DEFAULT_CONFIG: TidyConfig;
export const METADATA_FIELDS: MetadataField[];
export const DUPLICATES_DIR: string;
export const REVIEW_DIR: string;
export const TIDY_DIR: string;
export function resolveConfigPath(): string;
export function resolveConfig(raw?: unknown): TidyConfig;
export function loadConfig(configPath?: string): TidyConfig & { _path: string };
export function saveConfig(raw: unknown, configPath?: string): TidyConfig & { _path: string };
export function tidyPath(destDir: string, ...sub: string[]): string;
export function buildExtIndex(config: TidyConfig): Map<string, string>;
export function buildFolderNamer(destDir: string, config: TidyConfig): (base: string) => string;
export function organizedDirNames(config: TidyConfig): Set<string>;
export function quarantineDirNames(config: TidyConfig): Set<string>;
export function canonicalPath(p: string): string;
export function isInsideDir(parent: string, child: string): boolean;
