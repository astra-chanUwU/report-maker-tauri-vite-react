/**
 * ISO 10816-3 vibration severity reference table.
 *
 * Data ported from the legacy ReportMaker `word/iso_table.py`
 * (which mirrors `assets/word/iso_10816_standards.docx`):
 * zone swatches per machinery group, band labels, RMS mm/s + eq-peak in/s.
 *
 * Grid (6 equal columns, like the legacy export):
 *   [G1+3 flexible swatch | band label over G1+3 rigid + G2+4 flexible (span 2) | G2+4 rigid swatch | RMS | peak]
 * Consecutive rows with the same band label and colour merge vertically.
 */

export const ISO_ZONE_FILL = {
  red: "FF0000",
  amber: "FFC000",
  yellow: "FFFF00",
  green: "00B050",
} as const;

export const ISO_ZONE_TEXT = {
  red: "FFFFFF",
  amber: "1B1B1B",
  yellow: "1B1B1B",
  green: "FFFFFF",
} as const;

export const ISO_HEADER_DARK = "1B5E20";
export const ISO_HEADER_MID = "2E7D32";
export const ISO_HEADER_LIGHT = "E8F5E9";
export const ISO_VALUE_ALT = "F1F8E9";

export type IsoZone = keyof typeof ISO_ZONE_FILL;

export const ISO_ZONE_ORDER: IsoZone[] = ["green", "yellow", "amber", "red"];

export interface IsoDataRow {
  /** [G1+3 flexible, band (G1+3 rigid / G2+4 flexible), unused legacy slot, G2+4 rigid] */
  zones: [IsoZone, IsoZone, IsoZone, IsoZone];
  label: string;
  rms: string;
  peak: string;
}

/** (zone colors × 4 group columns, band label, velocity RMS mm/s, eq-peak in/s) */
export const ISO_DATA_ROWS: IsoDataRow[] = [
  { zones: ["red", "red", "red", "red"], label: "DAMAGE OCCURS", rms: "11.0", peak: "0.61" },
  { zones: ["amber", "red", "red", "red"], label: "DAMAGE OCCURS", rms: "7.1", peak: "0.39" },
  {
    zones: ["yellow", "amber", "amber", "red"],
    label: "RESTRICTED OPERATION",
    rms: "4.5",
    peak: "0.25",
  },
  {
    zones: ["yellow", "yellow", "yellow", "amber"],
    label: "UNRESTRICTED OPERATION",
    rms: "3.5",
    peak: "0.19",
  },
  {
    zones: ["green", "yellow", "yellow", "amber"],
    label: "UNRESTRICTED OPERATION",
    rms: "2.8",
    peak: "0.16",
  },
  {
    zones: ["green", "yellow", "yellow", "yellow"],
    label: "UNRESTRICTED OPERATION",
    rms: "2.3",
    peak: "0.13",
  },
  {
    zones: ["green", "green", "green", "yellow"],
    label: "NEWLY COMMISSIONED MACHINERY",
    rms: "1.4",
    peak: "0.08",
  },
  {
    zones: ["green", "green", "green", "green"],
    label: "NEWLY COMMISSIONED MACHINERY",
    rms: "0.7",
    peak: "0.04",
  },
  {
    zones: ["green", "green", "green", "green"],
    label: "NEWLY COMMISSIONED MACHINERY",
    rms: "0.0",
    peak: "0.00",
  },
];

export const ISO_FOOTER = ["Flexible", "Rigid", "Flexible", "Rigid", "Rigid", "Foundation"];

/** Column widths (dxa) measured from the reference report; sum = A4 text width at 1 cm margins. */
export const ISO_COLUMN_DXA = [2220, 1233, 1842, 1381, 2039, 2057];

/** Editable copy of the reference rows (deep-cloned so edits never touch the constant). */
export function defaultIsoRows(): IsoDataRow[] {
  return ISO_DATA_ROWS.map((r) => ({ ...r, zones: [...r.zones] as IsoDataRow["zones"] }));
}

const ZONES = new Set<string>(ISO_ZONE_ORDER);

/** Validate a persisted table; anything malformed falls back to the reference. */
export function normalizeIsoRows(raw: unknown): IsoDataRow[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return defaultIsoRows();
  const out: IsoDataRow[] = [];
  for (const r of raw) {
    const z = (r as IsoDataRow)?.zones;
    if (!Array.isArray(z) || z.length !== 4 || !z.every((v) => ZONES.has(v))) {
      return defaultIsoRows();
    }
    out.push({
      zones: [...z] as IsoDataRow["zones"],
      label: String((r as IsoDataRow).label ?? ""),
      rms: String((r as IsoDataRow).rms ?? ""),
      peak: String((r as IsoDataRow).peak ?? ""),
    });
  }
  return out;
}

export function isoRowsEqual(a: IsoDataRow[], b: IsoDataRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Next colour when the analyst clicks a swatch. */
export function cycleIsoZone(z: IsoZone): IsoZone {
  return ISO_ZONE_ORDER[(ISO_ZONE_ORDER.indexOf(z) + 1) % ISO_ZONE_ORDER.length];
}

export interface IsoCell {
  text: string;
  fill?: string;
  color?: string;
  bold?: boolean;
  /** Horizontal merge width (1 = single cell). */
  span?: number;
  /** Vertical merge: "restart" starts a block, "continue" joins the cell above. */
  vMerge?: "restart" | "continue";
  /** Zone swatch / band cell: no inner borders so colours read as one block. */
  seamless?: boolean;
  align?: "center" | "right";
  /** Font size in half-points. */
  size?: number;
}

export interface IsoTableData {
  rows: IsoCell[][];
}

export type IsoGroups = "all" | "1+3" | "2+4";

const FA_LABEL: Record<string, string> = {
  "DAMAGE OCCURS": "آسیب",
  "RESTRICTED OPERATION": "کارکرد محدود",
  "UNRESTRICTED OPERATION": "کارکرد نامحدود",
  "NEWLY COMMISSIONED MACHINERY": "ماشین نو",
  "Machinery Groups 1 and 3": "گروه‌های ۱ و ۳",
  "Machinery Groups 2 and 4": "گروه‌های ۲ و ۴",
  "ISO 10816 - 3": "ISO 10816-3",
  "Rated Power": "توان نامی",
  Velocity: "سرعت",
  "mm/sec RMS": "RMS mm/s",
  "in/sec eq. Peak": "eq. Peak in/s",
  Flexible: "انعطاف‌پذیر",
  Rigid: "صلب",
  Foundation: "فونداسیون",
};

export function buildIsoTableData(opts?: {
  groups?: IsoGroups;
  language?: "en" | "fa";
  rows?: IsoDataRow[];
}): IsoTableData {
  const data = opts?.rows && opts.rows.length > 0 ? opts.rows : ISO_DATA_ROWS;
  const h = (text: string, span = 1, fill = ISO_HEADER_DARK): IsoCell => ({
    text,
    fill,
    color: "FFFFFF",
    bold: true,
    span,
    size: 18,
  });
  const light = (text: string, span = 1): IsoCell => ({
    text,
    fill: ISO_HEADER_LIGHT,
    color: ISO_HEADER_DARK,
    bold: true,
    span,
    size: 16,
  });
  const rows: IsoCell[][] = [
    [h("Machinery Groups 1 and 3", 2), h("Machinery Groups 2 and 4", 2), h("ISO 10816 - 3", 2)],
    [h("Rated Power", 4, ISO_HEADER_MID), h("Velocity", 2, ISO_HEADER_MID)],
    [
      light("Group1: 300 KW ≤ 50 MW\nGroup3: Above 15 kW", 2),
      light("15 kW - 300 kW", 2),
      light("mm/sec RMS"),
      light("in/sec eq. Peak"),
    ],
  ];
  data.forEach((r, i) => {
    const valueFill = i % 2 === 1 ? ISO_VALUE_ALT : "FFFFFF";
    const above = data[i - 1];
    const continues = !!above && above.label === r.label && above.zones[1] === r.zones[1];
    const below = data[i + 1];
    const startsBlock =
      !continues && !!below && below.label === r.label && below.zones[1] === r.zones[1];
    const swatch = (z: IsoZone): IsoCell => ({
      text: "",
      fill: ISO_ZONE_FILL[z],
      color: ISO_ZONE_TEXT[z],
      seamless: true,
    });
    rows.push([
      swatch(r.zones[0]),
      {
        text: continues ? "" : r.label,
        fill: ISO_ZONE_FILL[r.zones[1]],
        color: ISO_ZONE_TEXT[r.zones[1]],
        bold: true,
        span: 2,
        seamless: true,
        size: 16,
        ...(continues
          ? { vMerge: "continue" as const }
          : startsBlock
            ? { vMerge: "restart" as const }
            : {}),
      },
      swatch(r.zones[3]),
      {
        text: r.rms,
        fill: valueFill,
        color: ISO_HEADER_DARK,
        bold: true,
        align: "right",
        size: 18,
      },
      {
        text: r.peak,
        fill: valueFill,
        color: ISO_HEADER_DARK,
        bold: true,
        align: "right",
        size: 18,
      },
    ]);
  });
  rows.push(ISO_FOOTER.map((t) => h(t)));
  const groups = opts?.groups ?? "all";
  if (groups === "1+3" && rows[0]?.[1]) rows[0][1].text = "—";
  if (groups === "2+4" && rows[0]?.[0]) rows[0][0].text = "—";
  if (opts?.language === "fa") {
    for (const row of rows) {
      for (const cell of row) {
        if (FA_LABEL[cell.text]) cell.text = FA_LABEL[cell.text];
      }
    }
  }
  return { rows };
}
