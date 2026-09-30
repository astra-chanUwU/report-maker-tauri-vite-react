/** SpectraPro identity tables (Plant / Machine / Point / Direction). Pure join + specs. */

export interface SpectraDirection {
  directionId: string;
  pointId: string;
  name: string;
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
    const d: SpectraDirection = {
      directionId: col(dirs.header, r, "DirectionID"),
      pointId,
      name: col(dirs.header, r, "Name"),
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
    out.push({
      machineId,
      plantId,
      plantName: plantName.get(plantId) ?? "",
      name: col(machines.header, r, "Name"),
      rpm,
      rpmLabel: col(machines.header, r, "LblRPM") || "Primary RPM",
      note: col(machines.header, r, "Note"),
      points: pointsByMachine.get(machineId) ?? [],
    });
  }
  return out;
}

/** Brochure specs block: RPM, note, bearing list per point. */
export function buildMachineSpecs(machine: SpectraMachine): string {
  const lines: string[] = [];
  if (machine.rpm) {
    const rpm = Number(machine.rpm);
    const shown = Number.isFinite(rpm) ? String(Math.round(rpm * 60)) : machine.rpm;
    lines.push(`${machine.rpmLabel || "Primary RPM"}: ${shown} RPM (${machine.rpm} Hz)`);
  }
  if (machine.note.trim()) lines.push(`Note: ${machine.note.trim()}`);
  const bearings = machine.points
    .filter((p) => p.bearings.length)
    .map((p) => `${p.name || p.pointId}: ${p.bearings.join(", ")}`);
  if (bearings.length) {
    lines.push("Bearings:");
    lines.push(...bearings);
  }
  const axes = machine.points.flatMap((p) =>
    p.directions.map((d) => pointAxisLabel(p.name || `P${p.pointId}`, d.name))
  );
  if (axes.length) lines.push(`Directions: ${axes.join(", ")}`);
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
