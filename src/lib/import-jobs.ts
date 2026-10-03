export type ImportStage = "queued" | "exporting" | "catalog" | "indexing" | "ready" | "failed";

export interface ImportJob {
  id: string;
  path: string;
  filename: string;
  stage: ImportStage;
  progress?: string;
  /** 0–100 staged: Export 5–60, Catalog 60–85, Index 85–100. */
  percent?: number;
  bytes?: number;
  rows?: number;
  /** MB/s during export, for ETA/speed display. */
  speedMbs?: number;
  /** Seconds elapsed since start. */
  elapsedSec?: number;
  error?: string;
  startedAt: number;
}

/** Map streaming export bytes → staged 5–60% (Export Data phase). */
export function stagedExportPercent(bytes: number): number {
  if (bytes <= 0) return 5;
  // 10 MiB≈12%, 50 MiB≈28%, 200 MiB≈48%, 500 MiB≈58%, cap 60 for catalog/index headroom.
  const mb = bytes / (1024 * 1024);
  const pct = 5 + 55 * (1 - Math.exp(-mb / 70));
  return Math.min(60, Math.round(pct));
}

/** Legacy alias — prefer stagedExportPercent for 3-stage bar. */
export function softExportPercent(bytes: number): number {
  return stagedExportPercent(bytes);
}

export function catalogPercent(step: number, total: number): number {
  // step 0..total maps 60→85
  const frac = total > 0 ? Math.min(1, step / total) : 0;
  return Math.round(60 + 25 * frac);
}

export function formatEta(elapsedSec: number, bytes: number, totalBytesHint?: number): string | null {
  if (elapsedSec <= 1 || bytes <= 0) return null;
  const speed = bytes / elapsedSec;
  if (!Number.isFinite(speed) || speed <= 0) return null;
  if (totalBytesHint && totalBytesHint > bytes) {
    const remaining = totalBytesHint - bytes;
    const sec = remaining / speed;
    if (sec > 1 && sec < 3600) return `${sec.toFixed(0)}s left`;
  }
  return `${(speed / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export function filenameOf(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function makeJob(path: string): ImportJob {
  return {
    id: uid(),
    path,
    filename: filenameOf(path),
    stage: "queued",
    startedAt: Date.now(),
  };
}

export function basename(path: string | null | undefined): string {
  if (!path) return "";
  return path.split(/[/\\]/).pop() || path;
}

/** Group equipment items by their source DB filename. */
export function groupByDb<T extends { sp3Path?: string | null }>(
  items: T[]
): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const key = basename(it.sp3Path) || "(manual)";
    const list = m.get(key);
    if (list) list.push(it);
    else m.set(key, [it]);
  }
  return m;
}
