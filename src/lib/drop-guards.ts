export const INGEST_EXTS = new Set(["sp3", "mdb", "csv", "txt"]);
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

export function extOf(pathOrName: string): string {
  return pathOrName.split(".").pop()?.toLowerCase() ?? "";
}

export function isIngestPath(path: string): boolean {
  return INGEST_EXTS.has(extOf(path));
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extOf(path));
}

/** True if a native Tauri dropped path should be treated as an ingest open. */
export function shouldHandleNativeDrop(path: string): boolean {
  const ext = extOf(path);
  if (!ext) return false;
  if (IMAGE_EXTS.has(ext)) return false;
  return INGEST_EXTS.has(ext);
}
