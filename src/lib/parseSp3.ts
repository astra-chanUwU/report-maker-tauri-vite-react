import {
  detectJetMdb,
  parseSpecCsvFirstRow,
  rowToOverall,
  rowToSpectrum,
  sniffSpecCsv,
} from "./specdata";

export interface SpectraPoint {
  freq: number;
  amp: number;
}

export interface OverallValues {
  unit: string;
  measDate: string;
  pointId: string;
  directionId: string;
  bandWidth: number;
  noLines: number;
  freqRange: number;
  peakV: number;
  peakFreq: number;
  rmsD: number;
  rmsV: number;
  rmsA: number;
  peakD: number;
  peakA: number;
}

export interface Sp3Meta {
  filename: string;
  size: number;
  source: "text" | "binary" | "synthetic" | "spec-csv" | "mdb";
  overall?: OverallValues;
  /** Extra measurements in the file beyond the one shown (Spec CSV exports). */
  extraRows?: number;
  /** Temp CSV path from mdb-export conversion (Tauri only; for row re-reads). */
  csvPath?: string;
}

export interface Sp3Stats {
  spectra_points: number;
  freq_min: number;
  freq_max: number;
  amp_min: number;
  amp_max: number;
  peak: SpectraPoint;
}

export interface ParseResult {
  meta: Sp3Meta;
  spectra: SpectraPoint[];
  stats: Sp3Stats;
  warning?: string;
}

export interface ReportOptions {
  projectName: string;
  engineer: string;
  reportDate: string;
  units: string;
  norm: string;
  notes: string;
  templateId?: string;
  pointLimit?: number;
  /** Append the ISO 10816-3 severity reference table (default true). */
  includeIsoTable?: boolean;
  /** §3 equipment identity: name + technical specs + machine schematic. */
  equipmentName?: string;
  equipmentSpecs?: string;
  /** Schematic image (PNG/JPEG base64, no prefix). Null/undefined = none. */
  schematicBase64?: string | null;
  /** Per-equipment condition + AI editable fields (brochure p.5). */
  equipmentStatus?: string;
  equipmentLastReport?: string;
  equipmentProblems?: string;
  equipmentCorrective?: string;
  /** Multi-equipment TOC (brochure p.4). Default true when equipments supplied. */
  includeToc?: boolean;
  /** Export all points: FFT gallery + all trends (brochure p.6-7). Defaults true. */
  exportAllPoints?: boolean;
  fftAllPoints?: boolean;
  trendAllPoints?: boolean;
  /** Extra trend metrics beyond V/A (e.g. envelope). */
  trendMetrics?: string[];
  /** Localization: en (default) or fa. */
  language?: "en" | "fa";
  /** Jalali display date (auto-derived when language=fa). */
  jalaliDate?: string;
  /** Official letter fields. */
  letterNo?: string;
  clientName?: string;
  clientUnit?: string;
  addressBlock?: string;
}

export interface AiDraft {
  summary: string;
  methodology: string;
  observations: string;
  recommendations: string;
  conclusion: string;
}

export function computeStats(spectra: SpectraPoint[]): Sp3Stats {
  if (spectra.length === 0) {
    const peak = { freq: 0, amp: 0 };
    return { spectra_points: 0, freq_min: 0, freq_max: 0, amp_min: 0, amp_max: 0, peak };
  }
  let freq_min = Infinity;
  let freq_max = -Infinity;
  let amp_min = Infinity;
  let amp_max = -Infinity;
  let peak = spectra[0];
  for (const p of spectra) {
    if (p.freq < freq_min) freq_min = p.freq;
    if (p.freq > freq_max) freq_max = p.freq;
    if (p.amp < amp_min) amp_min = p.amp;
    if (p.amp > amp_max) amp_max = p.amp;
    if (p.amp > peak.amp) peak = p;
  }
  return { spectra_points: spectra.length, freq_min, freq_max, amp_min, amp_max, peak };
}

function syntheticSpectra(n = 80): SpectraPoint[] {
  const out: SpectraPoint[] = [];
  for (let i = 0; i < n; i++) {
    const freq = 50 + i * 10;
    const amp = 0.5 + 0.3 * Math.sin(i / 6) + 2.2 * Math.exp(-Math.pow(i - n * 0.62, 2) / 40);
    out.push({ freq, amp: Math.round(amp * 1000) / 1000 });
  }
  return out;
}

function tryParseText(bytes: Uint8Array): SpectraPoint[] | null {
  // Guard: giant Spec-CSV exports are handled by the Spec path below; never
  // decode multi-MB buffers as generic text.
  if (bytes.byteLength > 2 * 1024 * 1024) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (!/[0-9]/.test(text)) return null;
  const lines = text.split(/\r?\n/);
  const pts: SpectraPoint[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(";")) continue;
    const parts = t.split(/[,;\t ]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const freq = Number(parts[0]);
    const amp = Number(parts[1]);
    if (!Number.isFinite(freq) || !Number.isFinite(amp)) continue;
    pts.push({ freq, amp });
    if (pts.length > 20000) break;
  }
  return pts.length >= 2 ? pts : null;
}

function tryParseBinaryFloat32LE(bytes: Uint8Array): SpectraPoint[] | null {
  if (bytes.byteLength < 16 || bytes.byteLength % 4 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / 8);
  if (count < 2 || count > 20000) return null;
  // Heuristic: whole buffer must be pairs; reject if trailing garbage would remain
  if (count * 8 !== bytes.byteLength) return null;
  const pts: SpectraPoint[] = [];
  for (let i = 0; i < count; i++) {
    const freq = view.getFloat32(i * 8, true);
    const amp = view.getFloat32(i * 8 + 4, true);
    if (!Number.isFinite(freq) || !Number.isFinite(amp)) return null;
    if (Math.abs(freq) > 1e9 || Math.abs(amp) > 1e9) return null;
    pts.push({ freq, amp });
  }
  if (pts.length < 2) return null;
  return pts;
}

export function parseSp3(input: Uint8Array | ArrayBuffer, filename: string): ParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const size = bytes.byteLength;

  if (detectJetMdb(bytes)) {
    const spectra = syntheticSpectra();
    return {
      meta: { filename, size, source: "mdb" },
      spectra,
      stats: computeStats(spectra),
      warning:
        "Jet MDB database detected (.sp3 is MS Access format) — browsers can't read it directly. In the desktop app use 'Open .sp3 file' to convert automatically, or export the Data table to CSV (mdb-export file.sp3 Data > data.csv) and drop the CSV instead. Showing synthetic preview.",
    };
  }

  if (sniffSpecCsv(bytes)) {
    const preview = parseSpecCsvFirstRow(bytes);
    if (preview) {
      const spectra = rowToSpectrum(preview.row);
      const overall = rowToOverall(preview.row);
      const extra = Math.max(0, preview.rowCount - 1);
      return {
        meta: { filename, size, source: "spec-csv", overall, extraRows: extra },
        spectra,
        stats: computeStats(spectra),
        warning:
          extra > 0
            ? `${preview.rowCount} measurements in this export — showing first (Point ${overall.pointId || "?"}). Split one row per file for separate reports.`
            : undefined,
      };
    }
    const spectra = syntheticSpectra();
    return {
      meta: { filename, size, source: "synthetic" },
      spectra,
      stats: computeStats(spectra),
      warning:
        "Specdata column found but the first row failed to parse — using synthetic demo data.",
    };
  }

  const textPts = tryParseText(bytes);
  if (textPts) {
    const stats = computeStats(textPts);
    return { meta: { filename, size, source: "text" }, spectra: textPts, stats };
  }

  const binPts = tryParseBinaryFloat32LE(bytes);
  if (binPts) {
    const stats = computeStats(binPts);
    return { meta: { filename, size, source: "binary" }, spectra: binPts, stats };
  }

  const spectra = syntheticSpectra();
  const stats = computeStats(spectra);
  return {
    meta: { filename, size, source: "synthetic" },
    spectra,
    stats,
    warning: "Empty or unrecognized file — using synthetic demo data.",
  };
}
