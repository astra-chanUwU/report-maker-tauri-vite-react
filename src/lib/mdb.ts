import { computeStats, type ParseResult } from "./parseSp3";
import { loadMdbToolPath } from "./settings";
import {
  detectEncoding,
  parseSpecCsvFirstRow,
  parseSpecRowCells,
  rowToOverall,
  rowToSpectrum,
  splitCsvLine,
} from "./specdata";

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
  const filename = picked.split(/[/\\]/).pop() || "export.sp3";
  const result = assembleRow(preview.row, {
    filename,
    size: res.bytes,
    source: "mdb",
    extraRows: Math.max(0, res.rows - 1),
    csvPath: res.csvPath,
  });
  if (!result) throw new Error("Export produced no readable measurement rows.");
  if (result.meta.extraRows && result.meta.extraRows > 0) {
    const pid = result.meta.overall?.pointId || "?";
    result.warning = `${res.rows} measurements converted from ${filename} — showing first (Point ${pid}).`;
  }
  return result;
}

export interface CsvRowSummary {
  index: number;
  pointId: string;
  directionId: string;
  measDate: string;
  peakV: string;
  peakFreq: string;
  rmsV: string;
  rmsA: string;
  peakA: string;
  unit: string;
  noLines: string;
}

export interface CsvRowList {
  header: string[];
  rows: CsvRowSummary[];
}

function summarize(header: string[], cells: string[], index: number): CsvRowSummary {
  const get = (name: string): string => {
    const i = header.indexOf(name);
    return i >= 0 && i < cells.length ? cells[i] : "";
  };
  return {
    index,
    pointId: get("PointID").trim(),
    directionId: get("DirectionID").trim(),
    measDate: get("MeasDate").trim(),
    peakV: get("ValuePeakMaxV").trim(),
    peakFreq: get("FreqPeakMaxV").trim(),
    rmsV: get("TotalRMSV").trim(),
    rmsA: get("TotalRMSA").trim(),
    peakA: get("TotalPeakA").trim(),
    unit: get("Unit").replace(/^"|"$/g, "").trim(),
    noLines: get("NoLines").trim(),
  };
}

/** Assemble an already-parsed SpecRow into a full ParseResult. */
function assembleRow(
  row: {
    scalars: Record<string, string>;
    amplitudes: Float32Array;
    bandWidth: number;
    noLines: number;
  },
  opts: {
    filename: string;
    size: number;
    source: "mdb" | "spec-csv";
    extraRows: number;
    csvPath?: string;
  }
): ParseResult | null {
  const spectra = rowToSpectrum(row);
  const overall = rowToOverall(row);
  return {
    meta: {
      filename: opts.filename,
      size: opts.size,
      source: opts.source,
      overall,
      extraRows: opts.extraRows,
      csvPath: opts.csvPath,
    },
    spectra,
    stats: computeStats(spectra),
    warning: undefined,
  };
}

function assembleCells(
  header: string[],
  cells: string[],
  opts: {
    filename: string;
    size: number;
    source: "mdb" | "spec-csv";
    extraRows: number;
    csvPath?: string;
  }
): ParseResult | null {
  const row = parseSpecRowCells(header, cells);
  if (!row) return null;
  return assembleRow(row, opts);
}

/** Tauri: list all measurement summaries of a converted CSV. */
export async function listTauriRows(csvPath: string): Promise<CsvRowList> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CsvRowList>("list_csv_rows", { path: csvPath, limit: null });
}

/** Tauri: load one measurement row of a converted CSV by 0-based index. */
export async function loadTauriRow(
  csvPath: string,
  index: number,
  filename: string,
  totalRows: number
): Promise<ParseResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{ header: string[]; cells: string[] }>("read_csv_row", {
    path: csvPath,
    index,
  });
  const result = assembleCells(res.header, res.cells, {
    filename,
    size: 0,
    source: "mdb",
    extraRows: Math.max(0, totalRows - 1),
    csvPath,
  });
  if (!result) throw new Error(`Row ${index + 1} failed to parse.`);
  return result;
}

const FILE_CHUNK = 1 << 20;

async function streamLines(
  file: Blob,
  onLine: (line: string, isHeader: boolean) => boolean | void,
  stopAfterBytes = 1536 * 1024 * 1024
): Promise<{ header: string[] | null; bytes: number }> {
  const prefix = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const { enc, skip } = detectEncoding(prefix);
  const decoder = new TextDecoder(enc === "utf16le" ? "utf-16le" : "utf-8");
  let offset = skip;
  let carry = "";
  let header: string[] | null = null;
  let stopped = false;
  while (offset < file.size && !stopped) {
    if (offset > stopAfterBytes) throw new Error("File larger than 1.5 GiB is not supported.");
    const buf = new Uint8Array(await file.slice(offset, offset + FILE_CHUNK).arrayBuffer());
    if (buf.length === 0) break;
    offset += buf.length;
    carry += decoder.decode(buf, { stream: true });
    const parts = carry.split("\n");
    carry = parts.pop() ?? "";
    for (const raw of parts) {
      const line = raw.replace(/\r$/, "");
      if (!header) {
        if (!line.trim()) continue;
        header = splitCsvLine(line);
        const done = onLine(line, true);
        if (done === true) stopped = true;
        continue;
      }
      if (!line.trim()) continue;
      if (onLine(line, false) === true) {
        stopped = true;
        break;
      }
    }
  }
  if (!stopped) {
    carry += decoder.decode();
    for (const raw of carry.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (!header) {
        if (!line.trim()) continue;
        header = splitCsvLine(line);
        onLine(line, true);
        continue;
      }
      if (!line.trim()) continue;
      onLine(line, false);
    }
  }
  return { header, bytes: offset };
}

/** Browser: list measurement summaries by streaming a dropped CSV File. */
export async function listFileRows(file: File): Promise<CsvRowList> {
  let header: string[] = [];
  const rows: CsvRowSummary[] = [];
  let index = 0;
  const res = await streamLines(file, (line, isHeader) => {
    if (isHeader) {
      header = splitCsvLine(line);
      if (!header.includes("Specdata"))
        throw new Error("Not a Data-table export (no Specdata column).");
      return;
    }
    const cells = splitCsvLine(line);
    rows.push(summarize(header, cells, index++));
  });
  if (!res.header || !res.header.includes("Specdata")) {
    throw new Error("Not a Data-table export (no Specdata column).");
  }
  return { header, rows };
}

/** Browser: load one measurement row of a dropped CSV File by 0-based index. */
export async function loadFileRow(
  file: File,
  filename: string,
  index: number,
  totalRows: number
): Promise<ParseResult> {
  let header: string[] = [];
  let target: string[] | null = null;
  let seen = 0;
  await streamLines(file, (line, isHeader) => {
    if (isHeader) {
      header = splitCsvLine(line);
      return;
    }
    if (seen === index) {
      target = splitCsvLine(line);
      return true;
    }
    seen++;
  });
  if (!target) throw new Error(`Row ${index + 1} not found.`);
  const result = assembleCells(header, target, {
    filename,
    size: file.size,
    source: "spec-csv",
    extraRows: Math.max(0, totalRows - 1),
  });
  if (!result) throw new Error(`Row ${index + 1} failed to parse.`);
  return result;
}
