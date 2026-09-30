import type { ReportOptions } from "./parseSp3";

export interface HistoryEntry {
  id: string;
  projectName: string;
  engineer: string;
  date: string;
  filename: string;
  savedPath: string | null;
  sourceFile: string;
  source: string;
  spectraPoints: number;
  peak: { freq: number; amp: number };
  options: ReportOptions;
  createdAt: string;
}

const LS_KEY = "report-maker:history:v1";
const STORE_FILE = "report-maker.dat";
const STORE_KEY = "history";
const MAX_ENTRIES = 100;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export function makeEntry(input: {
  projectName: string;
  engineer: string;
  date: string;
  filename: string;
  savedPath: string | null;
  sourceFile: string;
  source: string;
  spectraPoints: number;
  peak: { freq: number; amp: number };
  options: ReportOptions;
}): HistoryEntry {
  return {
    id: uid(),
    projectName: input.projectName,
    engineer: input.engineer,
    date: input.date,
    filename: input.filename,
    savedPath: input.savedPath,
    sourceFile: input.sourceFile,
    source: input.source,
    spectraPoints: input.spectraPoints,
    peak: input.peak,
    options: input.options,
    createdAt: new Date().toISOString(),
  };
}

async function tauriStore() {
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    return new LazyStore(STORE_FILE);
  } catch {
    return null;
  }
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  // Tauri store first, localStorage fallback (vite dev)
  try {
    const store = await tauriStore();
    if (store) {
      const v = await store.get<HistoryEntry[]>(STORE_KEY);
      if (Array.isArray(v)) return v.slice(0, MAX_ENTRIES);
    }
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(v) ? v.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export async function persistHistory(entries: HistoryEntry[]): Promise<void> {
  const capped = entries.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(capped));
  } catch {
    // ignore
  }
  try {
    const store = await tauriStore();
    if (store) {
      await store.set(STORE_KEY, capped);
      await store.save();
    }
  } catch {
    // Tauri store unavailable (web) — localStorage already written
  }
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<HistoryEntry[]> {
  const current = await loadHistory();
  const next = [entry, ...current].slice(0, MAX_ENTRIES);
  await persistHistory(next);
  return next;
}

export async function deleteHistoryEntry(id: string): Promise<HistoryEntry[]> {
  const current = await loadHistory();
  const next = current.filter((e) => e.id !== id);
  await persistHistory(next);
  return next;
}

export async function clearHistory(): Promise<HistoryEntry[]> {
  await persistHistory([]);
  return [];
}

/** Last report summary for one equipment name (brochure p.5: "last sent report"). */
export async function findLastReportFor(equipmentName: string): Promise<HistoryEntry | null> {
  const name = equipmentName.trim().toLowerCase();
  if (!name) return null;
  const all = await loadHistory();
  for (const e of all) {
    const optName = (e.options.equipmentName ?? "").trim().toLowerCase();
    if (optName && (optName === name || optName.includes(name) || name.includes(optName))) return e;
  }
  return null;
}
