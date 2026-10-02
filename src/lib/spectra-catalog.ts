/** SpectraPro identity tables (Plant / Machine / Point / Direction). Pure join + specs. */

import { STANDARD_G } from "./metrics";
import { deriveAlarmLimits, DEFAULT_ZONE_LIMITS, toLimit, type ZoneLimitSet } from "./zones";

/** Raw Direction alarm columns: velocity mm/s, acceleration g, envelope NarrowAL1/2. */
export interface DirectionAlarms {
  overallW: number | null;
  overallD: number | null;
  overallWg: number | null;
  overallDg: number | null;
  narrow1: number | null;
  narrow2: number | null;
}

export interface SpectraDirection {
  directionId: string;
  pointId: string;
  name: string;
  alarms?: DirectionAlarms;
}

export interface SpectraPoint {
  pointId: string;
  machineId: string;
  name: string;
  bearings: string[];
  directions: SpectraDirection[];
}

export interface SpectraMachine {
  machineId: string;
  plantId: string;
  plantName: string;
  name: string;
  rpm: string;
  rpmLabel: string;
  note: string;
  points: SpectraPoint[];
  /** Alarm limits from the Direction table (m/s² for acceleration), null when absent. */
  limits: ZoneLimitSet | null;
}

const scaleG = (v: number | null) => (v === null ? null : v * STANDARD_G);

/** Legacy derive: B = warning, U = round(danger, 1), C = U × 1.23. */
export function limitsFromAlarms(a: DirectionAlarms): ZoneLimitSet {
  const accel = deriveAlarmLimits(scaleG(a.overallWg), scaleG(a.overallDg));
  return {
    velocity: deriveAlarmLimits(a.overallW, a.overallD),
    acceleration: {
      ...accel,
      bottom: accel.bottom === null ? null : Math.round(accel.bottom * 100) / 100,
    },
    envelope: deriveAlarmLimits(a.narrow1, a.narrow2),
  };
}

/** Machine-level limits: the most common alarm set across its directions. */
export function machineLimits(points: SpectraPoint[]): ZoneLimitSet | null {
  const counts = new Map<string, { n: number; a: DirectionAlarms }>();
  for (const p of points) {
    for (const d of p.directions) {
      const a = d.alarms;
      if (!a || (a.overallW === null && a.overallWg === null)) continue;
      const key = JSON.stringify(a);
      const hit = counts.get(key);
      if (hit) hit.n++;
      else counts.set(key, { n: 1, a });
    }
  }
  let best: DirectionAlarms | null = null;
  let bestN = 0;
  for (const { n, a } of counts.values()) {
    if (n > bestN) {
      best = a;
      bestN = n;
    }
  }
  if (!best) return null;
  const lim = limitsFromAlarms(best);
  return {
    velocity: lim.velocity.bottom === null ? DEFAULT_ZONE_LIMITS.velocity : lim.velocity,
    acceleration:
      lim.acceleration.bottom === null ? DEFAULT_ZONE_LIMITS.acceleration : lim.acceleration,
    envelope: lim.envelope,
  };
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
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length === 0) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return { header, rows: lines.slice(1).map(splitCsvLine) };
}

function col(header: string[], cells: string[], name: string): string {
  const i = header.indexOf(name);
  return i >= 0 && i < cells.length ? cells[i].trim() : "";
}

function bearingsOf(header: string[], cells: string[]): string[] {
  const out: string[] = [];
  for (let n = 1; n <= 4; n++) {
    const producer = col(header, cells, `BearProducer${n}`);
    const type = col(header, cells, `BearType${n}`);
    if (!type || type === "-" || type === "0") continue;
    out.push([producer, type].filter((s) => s && s !== "-").join(" "));
  }
  return out;
}

/** Brochure point label: Point "P1" + Direction "V1" → "P1 V". */
export function pointAxisLabel(pointName: string, directionName: string): string {
  const p = pointName.trim() || "P";
  const d = directionName.trim();
  const axis = d.replace(/\d+$/, "").trim() || d;
  return axis ? `${p} ${axis}` : p;
}

export function joinCatalog(input: {
  plantCsv: string;
  machineCsv: string;
  pointCsv: string;
  directionCsv: string;
}): SpectraMachine[] {
  const plants = rowsOf(input.plantCsv);
  const plantName = new Map<string, string>();
  for (const r of plants.rows) {
    plantName.set(col(plants.header, r, "PlantID"), col(plants.header, r, "Name"));
  }
  const dirs = rowsOf(input.directionCsv);
  const dirsByPoint = new Map<string, SpectraDirection[]>();
  for (const r of dirs.rows) {
    const pointId = col(dirs.header, r, "PointID");
    const num = (name: string) => toLimit(col(dirs.header, r, name));
    const d: SpectraDirection = {
      directionId: col(dirs.header, r, "DirectionID"),
      pointId,
      name: col(dirs.header, r, "Name"),
      alarms: {
        overallW: num("OverallW"),
        overallD: num("OverallD"),
        overallWg: num("OverallWg"),
        overallDg: num("OverallDg"),
        narrow1: num("NarrowAL1"),
        narrow2: num("NarrowAL2"),
      },
    };
    const list = dirsByPoint.get(pointId) ?? [];
    list.push(d);
    dirsByPoint.set(pointId, list);
  }
  const points = rowsOf(input.pointCsv);
  const pointsByMachine = new Map<string, SpectraPoint[]>();
  for (const r of points.rows) {
    const machineId = col(points.header, r, "MachineID");
    const pointId = col(points.header, r, "PointID");
    const p: SpectraPoint = {
      pointId,
      machineId,
      name: col(points.header, r, "Name"),
      bearings: bearingsOf(points.header, r),
      directions: dirsByPoint.get(pointId) ?? [],
    };
    const list = pointsByMachine.get(machineId) ?? [];
    list.push(p);
    pointsByMachine.set(machineId, list);
  }
  const machines = rowsOf(input.machineCsv);
  const out: SpectraMachine[] = [];
  for (const r of machines.rows) {
    const machineId = col(machines.header, r, "MachineID");
    if (!machineId) continue;
    const plantId = col(machines.header, r, "PlantID");
    const rpm = col(machines.header, r, "ValueRPM");
    const pts = pointsByMachine.get(machineId) ?? [];
    out.push({
      machineId,
      plantId,
      plantName: plantName.get(plantId) ?? "",
      name: col(machines.header, r, "Name"),
      rpm,
      rpmLabel: col(machines.header, r, "LblRPM") || "Primary RPM",
      note: col(machines.header, r, "Note"),
      points: pts,
      limits: machineLimits(pts),
    });
  }
  return out;
}

/** Brochure specs block ("Key: value" lines → Specifications table): speed, bearings, note. */
export function buildMachineSpecs(machine: SpectraMachine): string {
  const lines: string[] = [];
  if (machine.rpm) {
    const hz = Number(machine.rpm);
    const shown = Number.isFinite(hz) && hz > 0 ? `${Math.round(hz * 60)} RPM (${hz} Hz)` : "";
    if (shown) lines.push(`Motor speed: ${shown}`);
  }
  const byBearing = new Map<string, string[]>();
  for (const p of machine.points) {
    for (const b of p.bearings) {
      const list = byBearing.get(b) ?? [];
      list.push(p.name || `P${p.pointId}`);
      byBearing.set(b, list);
    }
  }
  if (byBearing.size) {
    const list = [...byBearing.entries()].map(([b, pts]) => `${b} (${pts.join(", ")})`);
    lines.push(`Bearing list: ${list.join("; ")}`);
  }
  if (machine.note.trim()) lines.push(`Note: ${machine.note.trim().replace(/\s*\n\s*/g, " ")}`);
  return lines.join("\n");
}

/** Map "pointId directionId" → "P1 V" for a machine. */
export function machineLabelMap(machine: SpectraMachine): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of machine.points) {
    for (const d of p.directions) {
      map[`${p.pointId} ${d.directionId}`] = pointAxisLabel(p.name || `P${p.pointId}`, d.name);
    }
  }
  return map;
}

/** Decode a hex MachPicture field that starts with JPEG FFD8. */
export function extractJpegFromHex(hexField: string): Uint8Array | null {
  const hex = hexField.replace(/[^0-9a-fA-F]/g, "");
  const i = hex.toLowerCase().indexOf("ffd8");
  if (i < 0 || i % 2 !== 0) {
    const i2 = hex.toLowerCase().indexOf("ffd8");
    if (i2 < 0) return null;
  }
  const start = hex.toLowerCase().indexOf("ffd8");
  if (start < 0) return null;
  const aligned = start - (start % 2);
  const slice = hex.slice(aligned);
  if (slice.length < 8 || slice.length % 2 !== 0) return null;
  const out = new Uint8Array(slice.length / 2);
  for (let n = 0; n < out.length; n++) out[n] = parseInt(slice.slice(n * 2, n * 2 + 2), 16);
  if (out[0] !== 0xff || out[1] !== 0xd8) return null;
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
