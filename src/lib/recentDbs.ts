/** Recent .sp3 sources shown on step 1 when the user returns tomorrow.
 *  Stored locally — no temp CSV needed, we re-export via mdb-export on reopen.
 *  Mirrors history.ts storage pattern: localStorage + Tauri plugin-store.
 */

export interface RecentDb {
  /** Absolute disk path (Tauri) or filename (browser CSV shim). */
  path: string;
  filename: string;
  size?: number;
  source: string;
  rows?: number;
  lastOpenedAt: string;
}

const LS_KEY = "report-maker:recent-dbs:v1";
const STORE_FILE = "report-maker.dat";
const STORE_KEY = "recentDbs";
const MAX_RECENTS = 20;

function nowIso(): string {
  return new Date().toISOString();
}

function uidPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

async function tauriStore() {
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    return new LazyStore(STORE_FILE);
  } catch {
    return null;
  }
}

function loadFromLs(): RecentDb[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as RecentDb[];
    return Array.isArray(v) ? v.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveToLs(list: RecentDb[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    // ignore
  }
}

export async function loadRecentDbs(): Promise<RecentDb[]> {
  try {
    const store = await tauriStore();
    if (store) {
      const v = await store.get<RecentDb[]>(STORE_KEY);
      if (Array.isArray(v)) return v.slice(0, MAX_RECENTS);
    }
  } catch {
    // fall through
  }
  return loadFromLs();
}

export async function persistRecentDbs(list: RecentDb[]): Promise<void> {
  const capped = list.slice(0, MAX_RECENTS);
  saveToLs(capped);
  try {
    const store = await tauriStore();
    if (store) {
      await store.set(STORE_KEY, capped);
      await store.save();
    }
  } catch {
    // Tauri unavailable — LS already written
  }
}

export async function addRecentDb(
  entry: Omit<RecentDb, "lastOpenedAt"> & { lastOpenedAt?: string }
): Promise<RecentDb[]> {
  const current = await loadRecentDbs();
  const key = uidPath(entry.path);
  const next: RecentDb = {
    path: entry.path,
    filename: entry.filename,
    size: entry.size,
    source: entry.source,
    rows: entry.rows,
    lastOpenedAt: entry.lastOpenedAt ?? nowIso(),
  };
  const filtered = current.filter((r) => uidPath(r.path) !== key);
  const merged = [next, ...filtered].slice(0, MAX_RECENTS);
  await persistRecentDbs(merged);
  return merged;
}

export async function removeRecentDb(path: string): Promise<RecentDb[]> {
  const current = await loadRecentDbs();
  const key = uidPath(path);
  const next = current.filter((r) => uidPath(r.path) !== key);
  await persistRecentDbs(next);
  return next;
}

export async function clearRecentDbs(): Promise<RecentDb[]> {
  await persistRecentDbs([]);
  return [];
}
