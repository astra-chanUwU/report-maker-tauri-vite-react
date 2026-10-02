import { defaultIsoRows, normalizeIsoRows, type IsoDataRow } from "./iso10816";

const KEY = "report-maker:iso-table:v1";

/** Analyst-edited ISO 10816-3 rows (falls back to the standard table). */
export function loadIsoRows(): IsoDataRow[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeIsoRows(JSON.parse(raw)) : defaultIsoRows();
  } catch {
    return defaultIsoRows();
  }
}

export function saveIsoRows(rows: IsoDataRow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // storage full / disabled: edits stay in memory for this session
  }
}
