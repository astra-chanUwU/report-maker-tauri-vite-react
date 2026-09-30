/**
 * ISO 10816-3 vibration severity reference table.
 *
 * Data ported from the legacy ReportMaker `word/iso_table.py`
 * (which mirrors `assets/word/iso_10816_standards.docx`):
 * zone swatches per machinery group, band labels, RMS mm/s + eq-peak in/s.
 *
 * Layout here is simplified for the `docx` JS lib: horizontal merges only
 * (no vertical label merges, no nil-border seaming) — same content, same
 * colors, slightly plainer grid.
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

export interface IsoDataRow {
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

export interface IsoCell {
  text: string;
  fill?: string;
  color?: string;
  bold?: boolean;
  /** Horizontal merge width (1 = single cell). */
  span?: number;
}

export interface IsoTableData {
  rows: IsoCell[][];
}

/**
 * Pure data builder for the ISO table (tested without unzipping a .docx).
 * Row layout: 6 columns —
 * [swatch | band label (span 2) | swatch | RMS mm/s | eq-peak in/s].
 */
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
  "RMS mm/s": "RMS mm/s",
  "eq. Peak in/s": "eq. Peak in/s",
  Flexible: "انعطاف‌پذیر",
  Rigid: "صلب",
  Foundation: "فونداسیون",
};

export function buildIsoTableData(opts?: {
  groups?: IsoGroups;
  language?: "en" | "fa";
}): IsoTableData {
  const h = (text: string, span = 1): IsoCell => ({
    text,
    fill: ISO_HEADER_DARK,
    color: "FFFFFF",
    bold: true,
    span,
  });
  const rows: IsoCell[][] = [
    [h("Machinery Groups 1 and 3", 2), h("Machinery Groups 2 and 4", 2), h("ISO 10816 - 3", 2)],
    [h("Rated Power", 4), h("Velocity", 2)],
    [
      {
        text: "Group1: 300 KW ≤ 50 MW / Group3: above 15 kW",
        fill: ISO_HEADER_LIGHT,
        color: ISO_HEADER_DARK,
        bold: true,
        span: 2,
      },
      {
        text: "15 kW - 300 kW",
        fill: ISO_HEADER_LIGHT,
        color: ISO_HEADER_DARK,
        bold: true,
        span: 2,
      },
      { text: "RMS mm/s", fill: ISO_HEADER_LIGHT, color: ISO_HEADER_DARK, bold: true },
      { text: "eq. Peak in/s", fill: ISO_HEADER_LIGHT, color: ISO_HEADER_DARK, bold: true },
    ],
  ];
  ISO_DATA_ROWS.forEach((r, i) => {
    const valueFill = i % 2 === 1 ? ISO_VALUE_ALT : "FFFFFF";
    rows.push([
      { text: "", fill: ISO_ZONE_FILL[r.zones[0]], color: ISO_ZONE_TEXT[r.zones[0]] },
      {
        text: r.label,
        fill: ISO_ZONE_FILL[r.zones[1]],
        color: ISO_ZONE_TEXT[r.zones[1]],
        bold: true,
        span: 2,
      },
      { text: "", fill: ISO_ZONE_FILL[r.zones[3]], color: ISO_ZONE_TEXT[r.zones[3]] },
      { text: r.rms, fill: valueFill, color: ISO_HEADER_DARK, bold: true },
      { text: r.peak, fill: valueFill, color: ISO_HEADER_DARK, bold: true },
    ]);
  });
  rows.push(
    ISO_FOOTER.map((t) => ({ text: t, fill: ISO_HEADER_DARK, color: "FFFFFF", bold: true }))
  );
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
