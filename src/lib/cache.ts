export interface CacheStatus {
  entries: number;
  totalBytes: number;
}

export async function getCacheStatus(): Promise<CacheStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CacheStatus>("cache_status");
}

export async function clearExportCache(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("clear_export_cache");
}

export async function isCached(path: string): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("is_cached", { path });
  } catch {
    return false;
  }
}

export interface CacheEntryInfo {
  key: string;
  csvPath: string;
  bytes: number;
  rows: number;
  cachedAtMs: number;
  mtimeMs: number;
  size: number;
}

export async function listCacheEntries(): Promise<CacheEntryInfo[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<CacheEntryInfo[]>("list_cache_entries");
  } catch {
    return [];
  }
}

export function formatCacheBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
