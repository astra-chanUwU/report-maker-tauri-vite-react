import type { OverallValues, SpectraPoint } from "./parseSp3";

/**
 * Real-world format learned from the Elika Tejarat vibration database:
 *
 * - `.sp3` files are MS Access Jet databases (`Standard Jet DB` magic). They are
 *   NOT directly readable in a WebView. The supported path is a CSV export of the
 *   `Data` table (e.g. via `mdb-export file.sp3 Data`), which yields 38 columns
 *   including the `Specdata` spectrum blob.
 * - `Specdata` is a quoted field of octal escapes (`\ooo` per byte) holding
 *   `NoLines` float32-LE amplitudes.
 * - Frequency axis is NOT stored: `freq(i) = (i + 1) * BandWidth` (0-based i).
 *   Verified on 5 real rows: `argmax * BandWidth` matches `FreqPeakMaxV` and the
 *   decoded max matches `ValuePeakMaxV` exactly.
 * - `MeasDate`/`TransDate` are OLE Automation dates (days since 1899-12-30).
 */

export interface SpecRow {
  scalars: Record<string, string>;
  amplitudes: Float32Array;
  bandWidth: number;
  noLines: number;
}

const JET_MAGIC = "Standard Jet DB";

export type CsvEncoding = "utf8" | "utf16le";

export interface CsvEncodingInfo {
  enc: CsvEncoding;
  /** Bytes to skip (BOM). */
  skip: number;
}

/** mdb-export writes UTF-16LE + BOM; be liberal in what we accept. */
export function detectEncoding(bytes: Uint8Array): CsvEncodingInfo {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return { enc: "utf16le", skip: 2 };
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { enc: "utf8", skip: 3 };
  }
  return { enc: "utf8", skip: 0 };
}

export function detectJetMdb(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 64));
  return head.includes(JET_MAGIC);
}

/** True when the (possibly huge) buffer looks like a Data-table CSV export. */
export function sniffSpecCsv(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const { enc, skip } = detectEncoding(bytes);
  const end = Math.min(bytes.length, skip + 4096);
  const head = decodeSlice(bytes, skip, end, enc);
  return head.includes("Specdata") && head.includes("NoLines");
}

function decodeBytes(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("latin1").decode(b);
  }
}

function decodeSlice(bytes: Uint8Array, start: number, end: number, enc: CsvEncoding): string {
  const sub = bytes.subarray(start, Math.min(end, bytes.length));
  if (enc === "utf16le") return new TextDecoder("utf-16le").decode(sub);
  return decodeBytes(sub);
}

/** Decode a field of `\ooo` octal escapes into raw bytes (tolerant of strays). */
export function decodeOctalBlob(field: string): Uint8Array {
  let s = field.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 3 < s.length + 1) {
      const tri = s.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(tri)) {
        out.push(parseInt(tri, 8));
        i += 3;
        continue;
      }
      // `\"` / `\\` escapes
      const next = s[i + 1];
      if (next === '"' || next === "\\") {
        out.push(next.charCodeAt(0));
        i += 1;
        continue;
      }
      continue;
    }
    if (c === '"') continue;
    out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/** Minimal CSV line splitter honoring double quotes + `""` escapes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function findNewline(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) return i;
  }
  return -1;
}

/** Encoding-aware newline search. Returns the byte index of `\n`. */
function findLineEnd(bytes: Uint8Array, from: number, enc: CsvEncoding): number {
  if (enc === "utf8") return findNewline(bytes, from);
  // UTF-16LE: LF is 0A 00 on even alignment; scan pairs.
  let i = from;
  if (i % 2 === 1) i++;
  for (; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0x0a && bytes[i + 1] === 0x00) return i;
  }
  return -1;
}

function countRows(bytes: Uint8Array, enc: CsvEncoding): number {
  if (enc === "utf8") {
    let n = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) n++;
    return Math.max(0, n - 1); // minus header
  }
  let n = 0;
  const start = bytes.length > 0 && bytes[0] === 0xff ? 2 : 0;
  for (let i = start + (start % 2); i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0x0a && bytes[i + 1] === 0x00) n++;
  }
  return Math.max(0, n - 1);
}

function num(v: string | undefined, fallback = 0): number {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

export function parseSpecRowCells(header: string[], cells: string[]): SpecRow | null {
  if (!header.includes("Specdata") || !header.includes("NoLines") || !header.includes("BandWidth"))
    return null;
  const get = (name: string): string => {
    const idx = header.indexOf(name);
    return idx >= 0 && idx < cells.length ? cells[idx] : "";
  };
  if (get("Specdata").length < 16) return null;
  const noLines = Math.max(1, Math.floor(num(get("NoLines"), 0)));
  if (noLines <= 0 || noLines > 100000) return null;
  const bandWidth = num(get("BandWidth"), 0);
  if (!(bandWidth > 0)) return null;
  const bytes = decodeOctalBlob(get("Specdata"));
  if (bytes.byteLength < noLines * 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const amplitudes = new Float32Array(noLines);
  for (let i = 0; i < noLines; i++) amplitudes[i] = view.getFloat32(i * 4, true);
  const scalars: Record<string, string> = {};
  for (let i = 0; i < header.length && i < cells.length; i++) scalars[header[i]] = cells[i];
  return { scalars, amplitudes, bandWidth, noLines };
}

export interface SpecCsvPreview {
  row: SpecRow;
  rowCount: number;
}

/**
 * Parse only the header + FIRST data row of a (potentially hundreds-of-MB)
 * Data-table CSV without decoding the whole file.
 */
export function parseSpecCsvFirstRow(bytes: Uint8Array): SpecCsvPreview | null {
  const { enc, skip } = detectEncoding(bytes);
  const hEnd = findLineEnd(bytes, skip, enc);
  if (hEnd < 0) return null;
  const header = splitCsvLine(decodeSlice(bytes, skip, hEnd, enc).replace(/\r$/, ""));
  if (!header.includes("Specdata") || !header.includes("NoLines")) return null;
  const rowStart = enc === "utf8" ? hEnd + 1 : hEnd + 2;
  const rEnd = findLineEnd(bytes, rowStart, enc);
  if (rEnd < 0) return null;
  const cells = splitCsvLine(decodeSlice(bytes, rowStart, rEnd, enc).replace(/\r$/, ""));
  const row = parseSpecRowCells(header, cells);
  if (!row) return null;
  return { row, rowCount: countRows(bytes, enc) };
}

/** 0-based sample index → Hz. Verified against FreqPeakMaxV on real rows. */
export function freqOf(index0: number, bandWidth: number): number {
  return (index0 + 1) * bandWidth;
}

export function rowToSpectrum(row: SpecRow): SpectraPoint[] {
  const out: SpectraPoint[] = new Array(row.noLines);
  for (let i = 0; i < row.noLines; i++) {
    out[i] = { freq: Math.round(freqOf(i, row.bandWidth) * 1000) / 1000, amp: row.amplitudes[i] };
  }
  return out;
}

/** OLE Automation date (days since 1899-12-30) → `yyyy-mm-dd`. */
export function oleDateToISO(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

export function rowToOverall(row: SpecRow): OverallValues {
  const s = row.scalars;
  return {
    unit: (s["Unit"] ?? "").replace(/^"|"$/g, ""),
    measDate: oleDateToISO(num(s["MeasDate"])),
    pointId: (s["PointID"] ?? "").trim(),
    directionId: (s["DirectionID"] ?? "").trim(),
    bandWidth: row.bandWidth,
    noLines: row.noLines,
    freqRange: num(s["XV_FreqRange"]),
    peakV: num(s["ValuePeakMaxV"]),
    peakFreq: num(s["FreqPeakMaxV"]),
    rmsD: num(s["TotalRMSD"]),
    rmsV: num(s["TotalRMSV"]),
    rmsA: num(s["TotalRMSA"]),
    peakD: num(s["TotalPeakD"]),
    peakA: num(s["TotalPeakA"]),
  };
}
