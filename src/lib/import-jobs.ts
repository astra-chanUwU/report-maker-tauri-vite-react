export type ImportStage = "queued" | "exporting" | "catalog" | "ready" | "failed";

export interface ImportJob {
  id: string;
  path: string;
  filename: string;
  stage: ImportStage;
  progress?: string;
  error?: string;
  startedAt: number;
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
