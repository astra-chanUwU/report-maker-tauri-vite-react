import { computeStats, type ParseResult } from "./parseSp3";
import { loadMdbToolPath } from "./settings";
import { parseSpecCsvFirstRow, rowToOverall, rowToSpectrum } from "./specdata";

export interface MdbToolStatus {
  found: boolean;
  path?: string | null;
  version: string;
}

interface MdbExportIpc {
  csvPath: string;
  rows: number;
  bytes: number;
  head: number[];
}

/** True only inside the Tauri WebView (never in `vite dev` / browser). */
export async function isTauriRuntime(): Promise<boolean> {
  try {
    await import("@tauri-apps/api/core");
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}

export async function mdbToolStatus(): Promise<MdbToolStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  const overridePath = loadMdbToolPath().trim();
  return invoke<MdbToolStatus>("mdb_tool_status", { overridePath: overridePath || null });
}

/**
 * Raw `.sp3` → CSV via the backend `mdb-export` integration:
 * file picker (real disk path, no giant IPC) → streaming export to temp →
 * preview-parse the returned head. Throws `Error("cancelled")` when the user
 * dismisses the picker.
 */
export async function convertSp3FromDisk(): Promise<ParseResult> {
  const [{ open }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const picked = await open({
    filters: [{ name: "SP3 / MDB", extensions: ["sp3", "mdb"] }],
    multiple: false,
  });
  if (!picked || Array.isArray(picked)) throw new Error("cancelled");
  const overridePath = loadMdbToolPath().trim();
  const res = await invoke<MdbExportIpc>("export_mdb_csv", {
    input: picked,
    table: "Data",
    tool: overridePath || null,
  });
  const head = new Uint8Array(res.head);
  const preview = parseSpecCsvFirstRow(head);
  if (!preview) throw new Error("Export produced no readable measurement rows.");
  const spectra = rowToSpectrum(preview.row);
  const overall = rowToOverall(preview.row);
  const filename = picked.split(/[/\\]/).pop() || "export.sp3";
  const extra = Math.max(0, res.rows - 1);
  return {
    meta: {
      filename,
      size: res.bytes,
      source: "mdb",
      overall,
      extraRows: extra,
      csvPath: res.csvPath,
    },
    spectra,
    stats: computeStats(spectra),
    warning:
      extra > 0
        ? `${res.rows} measurements converted from ${filename} — showing first (Point ${overall.pointId || "?"}).`
        : undefined,
  };
}
