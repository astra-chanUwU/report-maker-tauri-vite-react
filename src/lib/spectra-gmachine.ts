/** Spectra line schematic (GMachine / GDirection). Elika plants often have zero rows; the renderer is still used when coordinates exist. */

import { drawText, encodePng, line } from "./png";

export interface GLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  labelX: number;
  labelY: number;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

function rowsOf(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { header: [], rows: [] };
  return { header: splitCsvLine(lines[0]).map((h) => h.trim()), rows: lines.slice(1).map(splitCsvLine) };
}

function col(header: string[], cells: string[], names: string[]): string {
  for (const name of names) {
    const i = header.indexOf(name);
    if (i >= 0 && i < cells.length) return cells[i].trim();
  }
  return "";
}

function num(raw: string): number | null {
  if (!raw || raw === "-") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function asciiLabel(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9AHPV .-]/g, "").slice(0, 8);
}

function lineFrom(
  header: string[],
  cells: string[],
  prefix: "GM" | "GD",
  nameCol: string
): GLine | null {
  const x1 = num(col(header, cells, [`${prefix}LineX1`]));
  const x2 = num(col(header, cells, [`${prefix}Linex2`, `${prefix}LineX2`]));
  const y1 = num(col(header, cells, [`${prefix}LineY1`]));
  const y2 = num(col(header, cells, [`${prefix}LineY2`]));
  if (x1 == null || x2 == null || y1 == null || y2 == null) return null;
  if (x1 === x2 && y1 === y2) return null;
  const label = asciiLabel(col(header, cells, [nameCol]));
  const labelX = num(col(header, cells, [`${prefix}LabelLeft`])) ?? (x1 + x2) / 2;
  const labelY = num(col(header, cells, [`${prefix}LabelTop`])) ?? (y1 + y2) / 2;
  return { x1, y1, x2, y2, label, labelX, labelY };
}

/** Lines stored on the machine, plus direction ticks that share those GMIDs. */
export function linesForMachine(gmachineCsv: string, gdirectionCsv: string, machineId: string): GLine[] {
  const machines = rowsOf(gmachineCsv);
  const gmIds = new Set<string>();
  const lines: GLine[] = [];
  for (const r of machines.rows) {
    if (col(machines.header, r, ["MachineID"]) !== machineId) continue;
    gmIds.add(col(machines.header, r, ["GMID"]));
    const drawn = lineFrom(machines.header, r, "GM", "GMName");
    if (drawn) lines.push(drawn);
  }
  const dirs = rowsOf(gdirectionCsv);
  for (const r of dirs.rows) {
    if (!gmIds.has(col(dirs.header, r, ["GMID"]))) continue;
    const drawn = lineFrom(dirs.header, r, "GD", "GDName");
    if (drawn) lines.push(drawn);
  }
  return lines;
}

const W = 720;
const H = 240;
const INK: [number, number, number] = [17, 24, 39];

/** Map Spectra screen coordinates onto a white PNG. Y increases downward, as in Access. */
export function renderGMachinePng(lines: GLine[]): Uint8Array | null {
  if (lines.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of lines) {
    for (const x of [l.x1, l.x2, l.labelX]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    for (const y of [l.y1, l.y2, l.labelY]) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX === minX) maxX = minX + 1;
  if (maxY === minY) maxY = minY + 1;
  const pad = 24;
  const sx = (x: number) => Math.round(pad + ((x - minX) / (maxX - minX)) * (W - pad * 2));
  const sy = (y: number) => Math.round(pad + ((y - minY) / (maxY - minY)) * (H - pad * 2));
  const buf = new Uint8Array(W * H * 3);
  buf.fill(255);
  for (const l of lines) {
    line(buf, W, H, sx(l.x1), sy(l.y1), sx(l.x2), sy(l.y2), INK);
    if (l.label) drawText(buf, W, H, sx(l.labelX), Math.max(2, sy(l.labelY) - 10), l.label, INK, 1);
  }
  return encodePng(buf, W, H);
}

/** Brochure order: stored JPEG, then GMachine vectors, then the point-and-shaft drawing. */
export function chooseSchematic(
  jpeg: Uint8Array | null | undefined,
  gmachinePng: Uint8Array | null | undefined,
  pointPng: Uint8Array | null | undefined
): Uint8Array | null {
  if (jpeg && jpeg.length > 8 && jpeg[0] === 0xff && jpeg[1] === 0xd8) return jpeg;
  if (gmachinePng && gmachinePng.length > 8) return gmachinePng;
  return pointPng && pointPng.length > 8 ? pointPng : null;
}
