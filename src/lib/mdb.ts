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
  return convertSp3Path(picked, invoke);
}

/** Convert a known on-disk `.sp3`/`.mdb` path (e.g. from a native window drop). */
export async function convertSp3Path(
  picked: string,
  invokeFn?: typeof import("@tauri-apps/api/core").invoke
): Promise<ParseResult> {
  const invoke = invokeFn ?? (await import("@tauri-apps/api/core")).invoke;
  const overridePath = loadMdbToolPath().trim();
  const res = await invoke<MdbExportIpc>("export_mdb_csv", {
    input: picked,
    table: "Data",
    tool: overridePath || null,
  });
  const head = new Uint8Array(res.head);
  const preview = parseSpecCsvFirstRow(head);
  if (!preview) {
    const hint = head.length < 1024 ? " Is the Data table empty?" : "";
    throw new Error(
      `Export produced no readable measurement rows.${hint} Head was ${head.length} bytes.`
    );
  }
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
  /** Bearing condition overall, stored in g like TotalRMSA. */
  bc?: string;
  unit: string;
  noLines: string;
  /** Joined from EnvelopeData when the metric is enabled. */
  envelopeRms?: string;
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
    bc: get("BC").trim(),
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

/** Tauri: open a Data-table CSV that already sits on disk (native drop). */
export async function loadTauriCsvPath(path: string): Promise<ParseResult> {
  const list = await listTauriRows(path);
  if (list.rows.length === 0) throw new Error("CSV has no measurement rows.");
  const filename = path.split(/[/\\]/).pop() || "data.csv";
  return loadTauriRow(path, 0, filename, list.rows.length);
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

export interface SpectraCatalogCsv {
  plantCsv: string;
  machineCsv: string;
  pointCsv: string;
  directionCsv: string;
  /** GMachine line rows. Empty header-only export when Spectra stored no vectors. */
  gmachineCsv?: string;
  gdirectionCsv?: string;
}

/** Tauri: export Plant/Machine/Point/Direction as stripped CSV (no OLE). */
export async function fetchSpectraCatalog(sp3Path: string): Promise<SpectraCatalogCsv> {
  const { invoke } = await import("@tauri-apps/api/core");
  const overridePath = loadMdbToolPath().trim();
  return invoke<SpectraCatalogCsv>("list_spectra_catalog", {
    input: sp3Path,
    tool: overridePath || null,
  });
}

/** Tauri: JPEG bytes of one machine schematic (MachPicture), or throws. */
export async function fetchMachinePicture(sp3Path: string, machineId: string): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  const overridePath = loadMdbToolPath().trim();
  const bytes = await invoke<number[]>("extract_machine_picture", {
    input: sp3Path,
    machineId,
    tool: overridePath || null,
  });
  return new Uint8Array(bytes);
}

/** Pick an .sp3 and return its disk path (Tauri). Throws Error("cancelled"). */
export async function pickSp3Path(): Promise<string> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    filters: [{ name: "SP3 / MDB", extensions: ["sp3", "mdb"] }],
    multiple: false,
  });
  if (!picked || Array.isArray(picked)) throw new Error("cancelled");
  return picked;
}

export interface EnvelopeSample {
  pointId: string;
  directionId?: string;
  measDate: string;
  rms: string;
  unit?: string;
}

export async function fetchEnvelopeSamples(sp3Path: string): Promise<EnvelopeSample[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const overridePath = loadMdbToolPath().trim();
  return invoke("list_envelope_samples", { input: sp3Path, tool: overridePath || null });
}

const positive = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0;

/** Envelope samples from an EnvelopeData CSV (strip mode). Spectra keeps the overall in TotalRMSA. */
export function indexEnvelopeCsv(csv: string): EnvelopeSample[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const at = (cells: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (cells[i] ?? "").replace(/"/g, "").trim() : "";
  };
  const out: EnvelopeSample[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const rms = ["TotalRMSA", "TotalRMSV", "TotalRMSD"].map((c) => at(cells, c)).find(positive);
    const pointId = at(cells, "PointID");
    const measDate = at(cells, "MeasDate");
    if (!rms || !measDate) continue;
    out.push({
      pointId,
      directionId: at(cells, "DirectionID") || undefined,
      measDate,
      rms,
      unit: at(cells, "Unit") || undefined,
    });
  }
  return out;
}

/**
 * Write envelope RMS onto measuring rows taken at the same direction and MeasDate
 * (falls back to point + date for samples without a DirectionID). Returns rows filled.
 */
export function applyEnvelopeSamples(
  rows: { pointId: string; directionId?: string; measDate: string; envelopeRms?: string }[],
  samples: EnvelopeSample[]
): number {
  const idx = new Map<string, string>();
  // Samples without a DirectionID (old exports) can only be matched by point.
  for (const e of samples) {
    const key = e.directionId ? `d${e.directionId}|${e.measDate}` : `p${e.pointId}|${e.measDate}`;
    if (!idx.has(key)) idx.set(key, e.rms);
  }
  let n = 0;
  for (const row of rows) {
    const v =
      (row.directionId ? idx.get(`d${row.directionId}|${row.measDate}`) : undefined) ??
      idx.get(`p${row.pointId}|${row.measDate}`);
    if (v == null || !Number.isFinite(Number(v))) continue;
    row.envelopeRms = v;
    n++;
  }
  return n;
}
