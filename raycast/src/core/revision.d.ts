export interface FileRevision {
  canonical: string;
  size: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  digest: string;
}
export function fileRevision(target: string, contents?: string | Uint8Array): FileRevision;
