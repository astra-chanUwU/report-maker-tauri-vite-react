export type ImportStage = "queued" | "exporting" | "indexing" | "ready" | "failed";

export interface ImportJob {
  id: string;
  path: string;
  filename: string;
  stage: ImportStage;
  progress?: string;
  /** Soft percent 0–100 while exporting (bytes grow without a known total). */
  percent?: number;
  bytes?: number;
  rows?: number;
  error?: string;
  startedAt: number;
}

/** Map streaming export bytes → a soft 5–90% bar (no known total for Jet dumps). */
export function softExportPercent(bytes: number): number {
  if (bytes <= 0) return 5;
  // Log-ish growth: 1 MiB≈35%, 10 MiB≈55%, 50 MiB≈70%, 200 MiB≈82%, asymptote ~90.
  const mb = bytes / (1024 * 1024);
  const pct = 5 + 85 * (1 - Math.exp(-mb / 18));
  return Math.min(90, Math.round(pct));
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
