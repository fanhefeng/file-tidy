import type { Options } from "exifr";

export function readExif(filePath: string, options?: Options): Promise<Record<string, unknown> | undefined>;
export function readExifThumbnail(filePath: string): Promise<Uint8Array | undefined>;
