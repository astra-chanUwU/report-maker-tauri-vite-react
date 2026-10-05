import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  InternalHyperlink,
  Packer,
  PageNumber,
  PageReference,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ITableCellBorders,
} from "docx";
import { ChartRun } from "docx/charts";
import { computeStats, type ReportOptions, type SpectraPoint, type Sp3Meta } from "./parseSp3";
import { sectionTitle } from "./fa";
import { encodePng, drawCallout, line, setPixel } from "./png";
import { applyWordRtl } from "./docx-rtl";
import { findDominantPeaks, formatPeakLabel } from "./spectra-peaks";
import { getTemplate, type DocTemplate } from "./templates";
import { buildIsoTableData, ISO_COLUMN_DXA, type IsoCell, type IsoDataRow } from "./iso10816";
import { secondaryLabels, secondaryLimits, type SecondaryMetric, type TrendMetric } from "./metrics";
import {
  classifyZone,
  DEFAULT_ZONE_LIMITS,
  formatLimits,
  limitsDisabled,
  limitsShort,
  resolveLimits,
  ZONE_FILL,
  ZONE_TEXT,
  type ZoneLimitSet,
  type ZoneLimits,
} from "./zones";

/** Persian reports set paragraph base direction and run language. Cleared at the start of each build. */
let paragraphRtl = false;

function docParagraph(init: string | IParagraphOptions): Paragraph {
  if (!paragraphRtl) return new Paragraph(init);
  if (typeof init === "string") {
    return new Paragraph({ text: init, bidirectional: true, alignment: AlignmentType.RIGHT });
  }
  return new Paragraph({
    ...init,
    bidirectional: true,
    alignment: init.alignment ?? AlignmentType.RIGHT,
  });
}

function docRun(init: string | IRunOptions): TextRun {
  if (!paragraphRtl) return new TextRun(init);
  if (typeof init === "string") {
    return new TextRun({
      text: init,
      rightToLeft: true,
      language: { value: "fa-IR", bidirectional: "fa-IR" },
    });
  }
  return new TextRun({
    ...init,
    rightToLeft: true,
    language: { value: "fa-IR", bidirectional: "fa-IR" },
  });
}

export interface BrandImage {
  data: Uint8Array;
  /** "png" | "jpg" — detected from magic bytes when omitted. */
  kind?: "png" | "jpg";
}

/** Pixel size from a PNG IHDR or JPEG SOF header; null when unreadable. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (sof) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
        };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Scale an image into a box without distorting it. */
function fitImage(
  bytes: Uint8Array,
  maxW: number,
  maxH: number
): { width: number; height: number } {
  const size = imageSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0)
    return { width: maxW, height: Math.round(maxW * 0.66) };
  const k = Math.min(maxW / size.width, maxH / size.height);
  return { width: Math.round(size.width * k), height: Math.round(size.height * k) };
}

/** Detect PNG vs JPEG from magic bytes (branding uploads lose their MIME). */
export function detectImageKind(bytes: Uint8Array): "png" | "jpg" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  return "png";
}

export interface MeasurePeak {
  /** Line frequency in RPM (Hz × 60). */
  rpm: string;
  amp: string;
}

export interface MeasureRow {
  /** "PointID DirectionID" — lets the exporter attach spectrum peaks later. */
  key?: string;
  point: string;
  date: string;
  rms: string;
  /** Current secondary-metric reading (m/s² for acceleration/BC, gEN for envelope). */
  rmsA: string;
  peak: string;
  peakFreq: string;
  /** Brochure Ver 2.32 stats (optional; default to rms / peak). */
  totalV?: string;
  avgV?: string;
  prevV?: string;
  currV?: string;
  /** Secondary-metric stats (acceleration, BC or envelope). */
  totalA?: string;
  avgA?: string;
  prevA?: string;
  currA?: string;
  /** Peak List column: strongest spectrum lines. */
  peaks?: MeasurePeak[];
  sparkV?: Uint8Array;
  sparkA?: Uint8Array;
}

export interface MeasuringCell {
  text: string;
  fill?: string;
  color?: string;
  bold?: boolean;
  png?: Uint8Array;
  /** Avg · Prev · Cur strip printed above a trend sparkline. */
  stats?: [string, string, string];
  /** Stacked values (peak list RPM / Amp). */
  lines?: string[];
  /** Font size in half-points. */
  size?: number;
}

export interface MeasuringHead {
  text: string;
  fill: string;
  color: string;
  span: number;
}

export interface MeasuringTableData {
  /** First header row: Measuring point (spans both rows) + metric groups. */
  groups: MeasuringHead[];
  /** Second header row, one entry per column (index 0 repeats the point label). */
  header: string[];
  headerFill: string[];
  body: MeasuringCell[][];
  /** Column widths in dxa (sum = A4 text width at 1 cm margins). */
  widths: number[];
}

export const TABLE_DXA = 10772;
const GREEN_DARK = "1B5E20";
const GREEN_MID = "2E7D32";
const GREEN_PEAK = "388E3C";
const GREEN_LIGHT = "4CAF50";
const HEAD_YELLOW = "FFEB3B";

/** Pure data builder for the measuring-results table (tested without unzipping). */
export function buildMeasuringTableData(
  rows: MeasureRow[],
  limits: ZoneLimitSet,
  lang: "en" | "fa" = "en",
  opts: { secondary?: SecondaryMetric; showSecondary?: boolean; envelopeUnit?: string } = {}
): MeasuringTableData {
  const secondary = opts.secondary ?? "acceleration";
  const show = opts.showSecondary !== false;
  const sec = secondaryLabels(secondary, lang, opts.envelopeUnit);
  const secLimits = secondaryLimits(limits, secondary);
  const zoneHead = (label: string, l: typeof secLimits) =>
    limitsDisabled(l) ? label : `${label} (${limitsShort(l)})`;
  const pointLabel = sectionTitle(lang, "measPointLong");
  const trend = sectionTitle(lang, "measTrend");
  const groups: MeasuringHead[] = [
    { text: pointLabel, fill: GREEN_DARK, color: "FFFFFF", span: 1 },
    { text: sectionTitle(lang, "measVelocity"), fill: GREEN_MID, color: "FFFFFF", span: 2 },
    { text: sectionTitle(lang, "measPeaks"), fill: GREEN_PEAK, color: "FFFFFF", span: 2 },
  ];
  const header = [
    pointLabel,
    trend,
    zoneHead(sectionTitle(lang, "measZoneV"), limits.velocity),
    "RPM",
    sectionTitle(lang, "amp"),
  ];
  const headerFill = [GREEN_DARK, GREEN_LIGHT, HEAD_YELLOW, HEAD_YELLOW, HEAD_YELLOW];
  if (show) {
    groups.push({ text: sec.group, fill: GREEN_MID, color: "FFFFFF", span: 2 });
    header.push(trend, sec.zone);
    headerFill.push(GREEN_LIGHT, HEAD_YELLOW);
  }
  const two = (s?: string) => {
    const n = Number(s);
    return s && s !== "—" && Number.isFinite(n) ? n.toFixed(2) : s;
  };
  const zoneCell = (value: string, l: typeof secLimits): MeasuringCell => {
    const z = classifyZone(value, l);
    return { text: z || "—", fill: ZONE_FILL[z], color: ZONE_TEXT[z], size: 32 };
  };
  const trendCell = (png: Uint8Array | undefined, avg?: string, prev?: string, cur?: string) => ({
    text: "",
    png,
    stats: [two(avg) || "—", two(prev) || "—", two(cur) || "—"] as [string, string, string],
  });
  const body = rows.map((r) => {
    const peaks = r.peaks?.length
      ? r.peaks.slice(0, 4)
      : r.peak || r.peakFreq
        ? [{ rpm: r.peakFreq || "—", amp: r.peak || "—" }]
        : [];
    const cells: MeasuringCell[] = [
      { text: r.point || "?", bold: true, size: 28 },
      trendCell(r.sparkV, r.avgV, r.prevV, r.currV || r.rms),
      zoneCell(r.currV || r.rms, limits.velocity),
      { text: "", lines: peaks.length ? peaks.map((p) => p.rpm) : ["—"], bold: true },
      { text: "", lines: peaks.length ? peaks.map((p) => two(p.amp) ?? p.amp) : ["—"], bold: true },
    ];
    if (show) {
      cells.push(
        trendCell(r.sparkA, r.avgA, r.prevA, r.currA || r.rmsA),
        zoneCell(r.currA || r.rmsA, secLimits)
      );
    }
    return cells;
  });
  const widths = show ? [1200, 3450, 660, 800, 560, 3450, 652] : [1300, 5800, 900, 1100, 1672];
  return { groups, header, headerFill, body, widths };
}

export interface BuildDocxInput {
  meta: Sp3Meta;
  spectra: SpectraPoint[];
  options: ReportOptions;
  aiDraft?: {
    summary: string;
    methodology: string;
    observations: string;
    recommendations: string;
    conclusion: string;
  };
  branding?: { logoPng?: Uint8Array; cover?: BrandImage; signature?: BrandImage };
  templateId?: string;
  /** §3 equipment identity (name + specs + schematic), when provided. */
  equipment?: {
    name?: string;
    specs?: string;
    schematic?: BrandImage;
    status?: string;
    lastReport?: string;
    problems?: string;
    corrective?: string;
  };
  /** Multi-equipment report (brochure p.4): one section per item + auto TOC. */
  equipments?: {
    name?: string;
    /** Plant / area from the Spectra tree, printed in the identity block. */
    plant?: string;
    specs?: string;
    schematic?: BrandImage;
    status?: string;
    lastReport?: string;
    problems?: string;
    corrective?: string;
    /** Per-machine condition narrative. Headings print only when that field has text. */
    summary?: string;
    methodology?: string;
    observations?: string;
    recommendations?: string;
    conclusion?: string;
    /** Vib slice for this machine (filtered PointIDs). */
    vib?: {
      limits: ZoneLimitSet;
      rows: MeasureRow[];
      trends?: NonNullable<BuildDocxInput["allTrends"]>;
      fft?: NonNullable<BuildDocxInput["fftGallery"]>;
    };
  }[];
  /** Measuring-results table (all export rows) + alarm limits, when available. */
  zones?: {
    limits: ZoneLimitSet;
    rows: MeasureRow[];
  };
  /** Rendered trend charts (velocity + acceleration) for one point. */
  trends?: {
    pointLabel: string;
    sampleCount: number;
    window: string;
    /** Preview sparklines used by the app UI; never used for DOCX trend rendering. */
    velocityPng: Uint8Array;
    /** Preview sparklines used by the app UI; never used for DOCX trend rendering. */
    accelPng: Uint8Array;
    /** Real chart data — actual dates and values with null gaps preserved. */
    velocityCategories?: (string | number)[];
    velocityValues?: (number | null)[];
    accelCategories?: (string | number)[];
    accelValues?: (number | null)[];
    secondaryMetric?: SecondaryMetric | TrendMetric;
    velocityLimits?: ZoneLimits;
    accelLimits?: ZoneLimits;
  };
  /** All-points trends (brochure p.6): V+A PNG pair per point. */
  allTrends?: {
    pointLabel: string;
    sampleCount: number;
    window: string;
    secondaryMetric?: SecondaryMetric | TrendMetric;
    /** Preview sparklines used by the app UI; never used for DOCX trend rendering. */
    velocityPng: Uint8Array;
    /** Preview sparklines used by the app UI; never used for DOCX trend rendering. */
    accelPng: Uint8Array;
    envelopePng?: Uint8Array;
    /** Real chart data. */
    velocityCategories?: (string | number)[];
    velocityValues?: (number | null)[];
    accelCategories?: (string | number)[];
    accelValues?: (number | null)[];
    envelopeCategories?: (string | number)[];
    envelopeValues?: (number | null)[];
    velocityLimits?: ZoneLimits;
    accelLimits?: ZoneLimits;
    envelopeLimits?: ZoneLimits;
  }[];
  /** FFT gallery for all points (brochure p.7). */
  fftGallery?: {
    label: string;
    png: Uint8Array;
    peak?: string;
    /** Optional raw spectra for editable chart; if present, native chart is used. */
    spectra?: SpectraPoint[];
  }[];
  /** Analyst-edited ISO 10816-3 rows (printed when options.useCustomIso). */
  isoRows?: IsoDataRow[];
  /** Envelope unit from EnvelopeData (default gEN). */
  envelopeUnit?: string;
}

export { encodePng, line } from "./png";

const CHART_W = 800;
const CHART_H = 400;

export function renderChartPng(
  spectra: SpectraPoint[],
  width = CHART_W,
  height = CHART_H
): Uint8Array {
  const w = width;
  const h = height;
  void h;
  const buf = new Uint8Array(w * CHART_H * 3);
  buf.fill(255);
  // grid
  for (let gx = 0; gx <= w; gx += 80)
    line(buf, w, CHART_H, gx, 0, gx, CHART_H - 1, [229, 231, 235]);
  for (let gy = 0; gy < CHART_H; gy += 40) line(buf, w, CHART_H, 0, gy, w - 1, gy, [229, 231, 235]);
  // axes
  line(buf, w, CHART_H, 40, 0, 40, CHART_H - 30, [17, 24, 39]);
  line(buf, w, CHART_H, 40, CHART_H - 30, w - 10, CHART_H - 30, [17, 24, 39]);

  const pts = downsample(spectra, 400);
  if (pts.length < 2) return encodePng(buf, w, CHART_H);
  let fMin = Infinity;
  let fMax = -Infinity;
  let aMin = Infinity;
  let aMax = -Infinity;
  for (const p of pts) {
    if (p.freq < fMin) fMin = p.freq;
    if (p.freq > fMax) fMax = p.freq;
    if (p.amp < aMin) aMin = p.amp;
    if (p.amp > aMax) aMax = p.amp;
  }
  if (fMax === fMin) fMax = fMin + 1;
  if (aMax === aMin) aMax = aMin + 1;
  const px = (f: number) => Math.round(40 + ((f - fMin) / (fMax - fMin)) * (w - 60));
  const py = (a: number) =>
    Math.round(CHART_H - 30 - ((a - aMin) / (aMax - aMin)) * (CHART_H - 50));
  for (let i = 1; i < pts.length; i++) {
    line(
      buf,
      w,
      CHART_H,
      px(pts[i - 1].freq),
      py(pts[i - 1].amp),
      px(pts[i].freq),
      py(pts[i].amp),
      [37, 99, 235]
    );
  }
  const peaks = findDominantPeaks(pts, 5);
  peaks.forEach((peak, i) => {
    const cx = px(peak.freq);
    const cy = py(peak.amp);
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy <= 16) setPixel(buf, w, CHART_H, cx + dx, cy + dy, 220, 38, 38);
      }
    drawCallout(buf, w, CHART_H, cx, cy, formatPeakLabel(peak.freq), 22 + (i % 3) * 16);
  });
  return encodePng(buf, w, CHART_H);
}

function downsample(spectra: SpectraPoint[], max: number): SpectraPoint[] {
  if (spectra.length <= max) return spectra;
  const step = spectra.length / max;
  const out: SpectraPoint[] = [];
  for (let i = 0; i < max; i++) out.push(spectra[Math.floor(i * step)]);
  return out;
}

// ── Native editable charts (docx ChartRun) ──────────────────────────────
// Keep the existing PNG helpers for sparklines/small inline images.
// Full-size charts become editable Word objects via these helpers.

const CHART_COLOR_SPECTRUM = "1B4F72"; // navy — spectrum line
const CHART_COLOR_VEL = "1B5E20"; // dark green — velocity
const CHART_COLOR_ACC = "1976D2"; // blue — acceleration
const CHART_COLOR_ENVELOPE = "2E7D32";

export function spectrumChartRun(
  spectra: SpectraPoint[],
  opts: { title?: string; width?: number; height?: number; lang?: "en" | "fa"; unit?: string } = {}
): ChartRun {
  const pts = downsample(spectra, 400);
  const safe = pts.length > 0 ? pts : [{ freq: 0, amp: 0 }];
  const lang = opts.lang ?? "en";
  const unit = opts.unit ?? "";
  const xTitle = lang === "fa" ? sectionTitle(lang, "freq") + " (Hz)" : "Frequency (Hz)";
  const yLabel = sectionTitle(lang, "amp");
  const yTitle = unit ? `${yLabel} (${unit})` : yLabel;
  const seriesName = lang === "fa" ? "دامنه" : "Amplitude";
  return new ChartRun({
    type: "scatter",
    title: opts.title ? { text: opts.title } : undefined,
    series: [
      {
        name: seriesName,
        color: CHART_COLOR_SPECTRUM,
        points: safe.map((p) => ({ x: p.freq, y: p.amp })),
      },
    ],
    lines: "straight",
    markers: { shape: "circle", size: 5 },
    xAxis: { title: { text: xTitle }, gridlines: true },
    yAxis: { title: { text: yTitle }, gridlines: true },
    legend: false,
    transformation: { width: opts.width ?? 600, height: opts.height ?? 300 },
  });
}

export function trendChartRun(
  categories: (string | number)[],
  values: (number | null)[],
  opts: {
    title?: string;
    seriesName?: string;
    color?: string;
    width?: number;
    height?: number;
    lang?: "en" | "fa";
    unit?: string;
    limits?: ZoneLimits;
  } = {}
): ChartRun {
  const cats = categories.length > 0 ? categories : ["—"];
  const vals = values.length > 0 ? values : [null];
  const safeVals = cats.map((_, i) => (i < vals.length ? vals[i] : null));
  const lang = opts.lang ?? "en";
  const unit = opts.unit ?? "";
  const seriesName = opts.seriesName ?? (lang === "fa" ? "مقدار" : "Value");
  const xTitle = lang === "fa" ? "تاریخ" : "Date";
  const yTitle = unit ? `${seriesName} (${unit})` : seriesName;
  const series: { name: string; values: (number | null)[]; color?: string; markers?: boolean; line?: { color?: string; dash?: "dash" | "dot"; width?: number } }[] = [
    {
      name: seriesName,
      values: safeVals,
      color: opts.color ?? CHART_COLOR_VEL,
      markers: true,
    },
  ];
  // Threshold lines as editable series (dashed)
  if (opts.limits && !limitsDisabled(opts.limits)) {
    const lim = resolveLimits(opts.limits);
    const thresholds: [string, number | null, string][] = [
      [lang === "fa" ? `حد B (${lim.bottom ?? "—"})` : `B Threshold (${lim.bottom ?? "—"})`, lim.bottom, "FFEB3B"],
      [lang === "fa" ? `حد U (${lim.mid ?? "—"})` : `U Threshold (${lim.mid ?? "—"})`, lim.mid, "F57C00"],
      [lang === "fa" ? `حد C (${lim.top ?? "—"})` : `C Threshold (${lim.top ?? "—"})`, lim.top, "D32F2F"],
    ];
    for (const [name, val, col] of thresholds) {
      if (val !== null && val > 0) {
        const thrVals = cats.map(() => val);
        series.push({ name, values: thrVals, color: col, markers: false, line: { color: col, dash: "dash", width: 1 } } as never);
      }
    }
  }
  return new ChartRun({
    type: "line",
    title: opts.title ? { text: opts.title } : undefined,
    categories: cats,
    series: series as never,
    categoryAxis: { title: { text: xTitle }, gridlines: false },
    valueAxis: { title: { text: yTitle }, gridlines: true },
    markers: true,
    legend: series.length > 1 ? { position: "bottom" } : false,
    transformation: { width: opts.width ?? 600, height: opts.height ?? 300 },
  });
}

export function createVelocityTrendChart(
  categories: string[],
  values: (number | null)[]
): ChartRun {
  return trendChartRun(categories, values, {
    seriesName: "Velocity",
    color: CHART_COLOR_VEL,
  });
}

export function createAccelTrendChart(
  categories: string[],
  values: (number | null)[]
): ChartRun {
  return trendChartRun(categories, values, {
    seriesName: "Acceleration",
    color: CHART_COLOR_ACC,
  });
}

function trendChartParagraph(
  categories: (string | number)[] | undefined,
  values: (number | null)[] | undefined,
  color: string,
  seriesName: string,
  lang: "en" | "fa" = "en",
  unit?: string,
  limits?: ZoneLimits
): Paragraph | null {
  if (categories && values && categories.length > 0 && values.length > 0) {
    return docParagraph({
      children: [
        trendChartRun(categories, values, {
          seriesName,
          color,
          width: 600,
          height: 300,
          lang,
          unit,
          limits,
        }),
      ],
      alignment: AlignmentType.CENTER,
    });
  }
  const msg = lang === "fa" ? "داده روند موجود نیست" : "No trend data available";
  return docParagraph({ children: [docRun({ text: msg, italics: true, color: "737373" })], alignment: AlignmentType.CENTER });
}

/** §3 equipment page: name + technical specs + machine schematic + status/AI fields. */
function headingWithBookmark(
  text: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel],
  bookmarkId?: string
): Paragraph {
  if (!bookmarkId) return docParagraph({ text, heading: level });
  return docParagraph({
    heading: level,
    children: [new Bookmark({ id: bookmarkId, children: [docRun(text)] })],
  });
}

function equipmentSection(
  eq?: BuildDocxInput["equipment"],
  lang: "en" | "fa" = "en",
  marks?: {
    status?: string;
    specs?: string;
    schematic?: string;
    description?: string;
    problems?: string;
    actions?: string;
  },
  skipName = false,
  limits?: ZoneLimitSet
): (Paragraph | Table)[] {
  const name = eq?.name?.trim() ?? "";
  const specs = eq?.specs?.trim() ?? "";
  const schema = eq?.schematic?.data?.length ? eq.schematic : undefined;
  const status = eq?.status?.trim() ?? "";
  const lastReport = eq?.lastReport?.trim() ?? "";
  const problems = eq?.problems?.trim() ?? "";
  const corrective = eq?.corrective?.trim() ?? "";
  if (!name && !specs && !schema && !status && !lastReport && !problems && !corrective && !limits)
    return [];
  const out: (Paragraph | Table)[] = [
    docParagraph({ text: sectionTitle(lang, "equipment"), heading: HeadingLevel.HEADING_1 }),
  ];
  if (name && !skipName) {
    out.push(docParagraph({ text: name, heading: HeadingLevel.HEADING_2 }));
  }
  if (status) {
    out.push(
      headingWithBookmark(sectionTitle(lang, "status"), HeadingLevel.HEADING_2, marks?.status)
    );
    out.push(docParagraph(status));
  }
  if (schema) {
    out.push(
      headingWithBookmark(
        sectionTitle(lang, "schematic"),
        HeadingLevel.HEADING_2,
        marks?.schematic
      ),
      docParagraph({
        children: [
          new ImageRun({
            data: schema.data,
            transformation: fitImage(schema.data, 560, 400),
            type: schema.kind ?? detectImageKind(schema.data),
          }),
        ],
        alignment: AlignmentType.CENTER,
      })
    );
  }
  if (specs || limits) {
    out.push(
      headingWithBookmark(sectionTitle(lang, "specs"), HeadingLevel.HEADING_2, marks?.specs)
    );
    // "Key: value" lines become the brochure specs table; free text stays as paragraphs
    const specLines = specs
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const kvRows = specLines
      .filter((l) => /^[^:]{1,40}:/.test(l))
      .map((l) => {
        const idx = l.indexOf(":");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()] as [string, string];
      })
      .filter(([, v]) => v.length > 0);
    const bare = specLines.filter((l) => !/^[^:]{1,40}:\s*\S/.test(l));
    const tableRows = [...kvRows, ...(limits ? limitRows(limits, lang) : [])];
    if (tableRows.length > 0) out.push(specsTable(tableRows));
    for (const t of bare) out.push(docParagraph(t));
  }
  if (lastReport) {
    out.push(
      headingWithBookmark(
        sectionTitle(lang, "description"),
        HeadingLevel.HEADING_2,
        marks?.description
      )
    );
    out.push(docParagraph(lastReport));
  }
  if (problems) {
    out.push(
      headingWithBookmark(sectionTitle(lang, "problems"), HeadingLevel.HEADING_2, marks?.problems)
    );
    out.push(docParagraph(problems));
  }
  if (corrective) {
    out.push(
      headingWithBookmark(sectionTitle(lang, "actions"), HeadingLevel.HEADING_2, marks?.actions)
    );
    out.push(docParagraph(corrective));
  }
  return out;
}

const NARRATIVE_KEYS = [
  "summary",
  "methodology",
  "observations",
  "recommendations",
  "conclusion",
] as const;

type NarrativeSource = {
  summary?: string;
  methodology?: string;
  observations?: string;
  recommendations?: string;
  conclusion?: string;
};

function narrativeFilled(src?: NarrativeSource | null): boolean {
  if (!src) return false;
  return NARRATIVE_KEYS.some((key) => (src[key] ?? "").trim().length > 0);
}

/** Headings print only for fields that have text. Keys match sectionTitle() so Farsi stays translated. */
function appendConditionNarrative(
  out: (Paragraph | Table)[],
  src: NarrativeSource | null | undefined,
  lang: "en" | "fa"
): void {
  if (!src) return;
  for (const key of NARRATIVE_KEYS) {
    const text = (src[key] ?? "").trim();
    if (!text) continue;
    out.push(
      docParagraph({ text: sectionTitle(lang, key), heading: HeadingLevel.HEADING_2 }),
      docParagraph(text)
    );
  }
}

/** Bookmark id for equipment N (1-based index in the TOC). Word names cannot contain spaces. */
export function equipmentBookmarkId(index: number): string {
  return `eq${index}`;
}

export type TocPart =
  | "status"
  | "schematic"
  | "specs"
  | "description"
  | "problems"
  | "actions"
  | "measuring"
  | "trends"
  | "fft";

/** Bookmark for a subsection under equipment N, e.g. eq1measuring. */
export function sectionBookmarkId(index: number, part: TocPart): string {
  return `eq${index}${part}`;
}

/** Subsections that actually exist on this machine, in brochure order. */
export function tocPartsFor(eq: {
  status?: string;
  specs?: string;
  schematic?: { data?: Uint8Array };
  lastReport?: string;
  description?: string;
  problems?: string;
  corrective?: string;
  vib?: { rows?: unknown[]; trends?: unknown[]; fft?: unknown[] };
}): TocPart[] {
  const parts: TocPart[] = [];
  if (eq.status?.trim()) parts.push("status");
  if (eq.schematic?.data?.length) parts.push("schematic");
  if (eq.specs?.trim()) parts.push("specs");
  if (eq.description?.trim() || eq.lastReport?.trim()) parts.push("description");
  if (eq.problems?.trim()) parts.push("problems");
  if (eq.corrective?.trim()) parts.push("actions");
  if (eq.vib?.rows?.length) parts.push("measuring");
  if (eq.vib?.trends?.length) parts.push("trends");
  if (eq.vib?.fft?.length) parts.push("fft");
  return parts;
}

/** Pure TOC rows for tests: index + name + status. */
export function buildTocRows(
  equipments: { name?: string; status?: string }[]
): { index: number; name: string; status: string }[] {
  return equipments.map((e, i) => ({
    index: i + 1,
    name: e.name?.trim() || `Equipment ${i + 1}`,
    status: e.status?.trim() || "—",
  }));
}

function tocSection(
  equipments: NonNullable<BuildDocxInput["equipments"]>,
  fa: boolean
): (Paragraph | Table)[] {
  if (equipments.length === 0) return [];
  const lang: "en" | "fa" = fa ? "fa" : "en";
  const rows = buildTocRows(equipments);
  const cell = (children: Paragraph[]) =>
    new TableCell({ children, margins: headerCellPad });
  const textCell = (t: string, bold = false) =>
    cell([docParagraph({ children: [docRun({ text: t, bold })] })]);
  const linkCell = (label: string, anchor: string, indent = false) =>
    cell([
      docParagraph({
        indent: indent ? { left: fa ? 0 : 360, right: fa ? 360 : 0 } : undefined,
        children: [
          new InternalHyperlink({
            anchor,
            children: [docRun({ text: label, style: "Hyperlink" })],
          }),
        ],
      }),
    ]);
  const pageCell = (anchor: string) =>
    cell([docParagraph({ children: [new PageReference(anchor, { hyperlink: true })] })]);
  return [
    docParagraph({ text: sectionTitle(lang, "toc"), heading: HeadingLevel.HEADING_1 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            textCell("#", true),
            textCell(fa ? "تجهیز" : "Equipment", true),
            textCell(fa ? "وضعیت" : "Status", true),
            textCell(fa ? "صفحه" : "Page", true),
          ],
        }),
        ...rows.flatMap((r, i) => {
          const id = equipmentBookmarkId(r.index);
          const eq = equipments[i];
          const main = new TableRow({
            children: [
              textCell(String(r.index)),
              linkCell(r.name, id),
              textCell(r.status),
              pageCell(id),
            ],
          });
          const subs = tocPartsFor(eq).map(
            (part) =>
              new TableRow({
                children: [
                  textCell(""),
                  linkCell(sectionTitle(lang, part), sectionBookmarkId(r.index, part), true),
                  textCell(""),
                  pageCell(sectionBookmarkId(r.index, part)),
                ],
              })
          );
          return [main, ...subs];
        }),
      ],
    }),
    docParagraph(
      fa
        ? "شماره صفحات با باز شدن فایل در Word به‌روز می‌شود."
        : "Page numbers update when the file is opened in Word."
    ),
  ];
}

function letterheadSection(input: BuildDocxInput, fa: boolean): Paragraph[] {
  const o = input.options;
  const out: Paragraph[] = [];
  const align = fa ? AlignmentType.RIGHT : AlignmentType.LEFT;
  const addr = o.addressBlock?.trim();
  if (addr) {
    out.push(
      docParagraph({
        children: [docRun({ text: addr, size: 16, color: "737373" })],
        alignment: align,
      })
    );
  }
  const bits: string[] = [];
  if (o.reportDate)
    bits.push(fa && o.jalaliDate ? `تاریخ: ${o.jalaliDate}` : `Date: ${o.reportDate}`);
  if (!fa && o.jalaliDate) bits.push(`Jalali: ${o.jalaliDate}`);
  if (o.letterNo?.trim())
    bits.push(fa ? `شماره: ${o.letterNo.trim()}` : `No: ${o.letterNo.trim()}`);
  if (bits.length > 0)
    out.push(docParagraph({ children: [docRun(bits.join("    "))], alignment: align }));
  const client = [o.clientName?.trim(), o.clientUnit?.trim()].filter(Boolean).join(" — ");
  if (client) {
    out.push(
      docParagraph({
        children: [docRun({ text: fa ? `کارفرما: ${client}` : `Client: ${client}`, bold: true })],
        alignment: align,
      })
    );
  }
  return out;
}

/** Signature/approval block: en (Approval + Engineer/Date) or fa (centered با سپاس + stamp + name/role). */
export function buildSignatureBlock(
  options: ReportOptions,
  signature?: BrandImage
): (Paragraph | Table)[] {
  paragraphRtl = options.language === "fa";
  if (!signature || signature.data.length === 0) return [];
  const sigImg = (alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    docParagraph({
      ...(alignment ? { alignment } : {}),
      children: [
        new ImageRun({
          data: (signature as BrandImage).data,
          transformation: { width: 200, height: 200 },
          type: signature.kind ?? detectImageKind(signature.data),
        }),
      ],
    });
  const lang: "en" | "fa" = options.language === "fa" ? "fa" : "en";
  if (options.signatureLayout === "fa") {
    const name = options.signatureName?.trim() || options.engineer || "—";
    const role = options.signatureRole?.trim() || "";
    const center = AlignmentType.CENTER;
    const out: Paragraph[] = [
      docParagraph({ text: "با سپاس", alignment: center }),
      sigImg(center),
      docParagraph({ text: name, alignment: center }),
    ];
    if (role) out.push(docParagraph({ text: role, alignment: center }));
    return out;
  }
  return [
    docParagraph({ text: sectionTitle(lang, "approval"), heading: HeadingLevel.HEADING_1 }),
    sigImg(),
    docParagraph(`Engineer: ${options.engineer || "—"}    Date: ${options.reportDate || "—"}`),
  ];
}

const GRID_LINE = { style: BorderStyle.SINGLE, size: 6, color: GREEN_MID };
const NO_LINE = { style: BorderStyle.NIL, size: 0, color: "FFFFFF" };
const GRID_BORDERS = {
  top: GRID_LINE,
  bottom: GRID_LINE,
  left: GRID_LINE,
  right: GRID_LINE,
  insideHorizontal: GRID_LINE,
  insideVertical: GRID_LINE,
};
const SEAMLESS: ITableCellBorders = {
  top: NO_LINE,
  bottom: NO_LINE,
  left: NO_LINE,
  right: NO_LINE,
};
const shade = (fill?: string) =>
  fill ? { shading: { type: ShadingType.CLEAR, fill, color: "auto" } } : {};
const tight = { top: 60, bottom: 60, left: 120, right: 120 };
const paddedCell = { top: 80, bottom: 80, left: 150, right: 150 };
const headerCellPad = { top: 60, bottom: 60, left: 130, right: 130 };

function centered(text: string, run: IRunOptions = {}): Paragraph {
  const parts = text.split("\n");
  return docParagraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: parts.map((t, i) => docRun({ ...run, text: t, break: i > 0 ? 1 : undefined })),
  });
}

/** Reference measuring-results table: grouped two-row header + one tall row per point. */
function measuringTable(data: MeasuringTableData): Table {
  const { groups, header, headerFill, body, widths } = data;
  const dxa = (n: number) => ({ size: n, type: WidthType.DXA });
  const spanWidth = (start: number, span: number) =>
    widths.slice(start, start + span).reduce((a, b) => a + b, 0);
  let col = 0;
  const groupCells = groups.map((g, i) => {
    const start = col;
    col += g.span;
    return new TableCell({
      width: dxa(spanWidth(start, g.span)),
      columnSpan: g.span > 1 ? g.span : undefined,
      verticalMerge: i === 0 ? VerticalMergeType.RESTART : undefined,
      verticalAlign: VerticalAlign.CENTER,
      margins: tight,
      ...shade(g.fill),
      children: [centered(g.text, { bold: true, color: g.color, size: 17 })],
    });
  });
  const subCells = header.map((t, i) => {
    const dark = headerFill[i] !== HEAD_YELLOW;
    return new TableCell({
      width: dxa(widths[i]),
      verticalMerge: i === 0 ? VerticalMergeType.CONTINUE : undefined,
      verticalAlign: VerticalAlign.CENTER,
      margins: tight,
      ...shade(headerFill[i]),
      children: [
        i === 0
          ? centered("")
          : centered(t, { bold: true, size: 15, color: dark ? "FFFFFF" : "1B1B1B" }),
      ],
    });
  });
  const bodyCell = (c: MeasuringCell, i: number) => {
    const paras: Paragraph[] = [];
    if (c.stats) {
      paras.push(
        docParagraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 20 },
          children: [
            docRun({ text: c.stats[0], size: 14, color: "616161" }),
            docRun({ text: "  ·  ", size: 14, color: "9E9E9E" }),
            docRun({ text: c.stats[1], size: 14, color: "616161" }),
            docRun({ text: "  ·  ", size: 14, color: "9E9E9E" }),
            docRun({ text: c.stats[2], size: 15, bold: true, color: GREEN_DARK }),
          ],
        })
      );
      const imgW = Math.round((widths[i] / 1440) * 96) - 10;
      paras.push(
        c.png && c.png.length > 8
          ? docParagraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 0 },
              children: [
                new ImageRun({
                  data: c.png,
                  transformation: { width: imgW, height: Math.round(imgW * 0.42) },
                  type: "png",
                }),
              ],
            })
          : centered("—", { color: "9E9E9E", size: 16 })
      );
    } else if (c.lines) {
      for (const l of c.lines) paras.push(centered(l, { bold: c.bold, size: 17 }));
    } else {
      paras.push(centered(c.text, { bold: c.bold, color: c.color, size: c.size ?? 18 }));
    }
    return new TableCell({
      width: dxa(widths[i]),
      verticalAlign: VerticalAlign.CENTER,
      margins: tight,
      ...shade(c.fill),
      children: paras,
    });
  };
  return new Table({
    width: dxa(TABLE_DXA),
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: GRID_BORDERS,
    rows: [
      new TableRow({ tableHeader: true, children: groupCells }),
      new TableRow({ tableHeader: true, children: subCells }),
      ...body.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            height: { value: 1700, rule: HeightRule.ATLEAST },
            children: r.map(bodyCell),
          })
      ),
    ],
  });
}

/** Machine specifications (label | value) with the alarm limit rows appended. */
function specsTable(rows: [string, string][]): Table {
  const label = Math.round(TABLE_DXA * 0.32);
  const cell = (t: string, isLabel: boolean) =>
    new TableCell({
      width: { size: isLabel ? label : TABLE_DXA - label, type: WidthType.DXA },
      margins: paddedCell,
      ...shade(isLabel ? "F1F8E9" : undefined),
      children: [
        docParagraph({
          spacing: { before: 0, after: 0 },
          children: [
            docRun({ text: t, bold: isLabel, size: 18, color: isLabel ? GREEN_DARK : undefined }),
          ],
        }),
      ],
    });
  return new Table({
    width: { size: TABLE_DXA, type: WidthType.DXA },
    columnWidths: [label, TABLE_DXA - label],
    layout: TableLayoutType.FIXED,
    borders: GRID_BORDERS,
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v, false)] })),
  });
}

/** Machine identity block under the machine heading (label fill E8F5E9, like the reference). */
function identityTable(rows: [string, string][]): Table {
  const label = Math.round(TABLE_DXA * 0.32);
  const cell = (t: string, isLabel: boolean) =>
    new TableCell({
      width: { size: isLabel ? label : TABLE_DXA - label, type: WidthType.DXA },
      margins: paddedCell,
      ...shade(isLabel ? "E8F5E9" : undefined),
      children: [
        docParagraph({
          spacing: { before: 0, after: 0 },
          children: [
            docRun({ text: t, bold: isLabel, size: 20, color: isLabel ? GREEN_DARK : undefined }),
          ],
        }),
      ],
    });
  return new Table({
    width: { size: TABLE_DXA, type: WidthType.DXA },
    columnWidths: [label, TABLE_DXA - label],
    layout: TableLayoutType.FIXED,
    borders: GRID_BORDERS,
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v, false)] })),
  });
}

/** Alarm limits as printed under the specs (velocity, acceleration/BC, envelope when enabled). */
export function limitRows(limits: ZoneLimitSet, lang: "en" | "fa" = "en"): [string, string][] {
  const out: [string, string][] = [
    [sectionTitle(lang, "zoneVLimits"), formatLimits(limits.velocity)],
    [sectionTitle(lang, "zoneALimits"), formatLimits(limits.acceleration)],
  ];
  if (!limitsDisabled(limits.envelope)) {
    out.push([sectionTitle(lang, "zoneELimits"), formatLimits(limits.envelope)]);
  }
  return out;
}

/** Horizontal accent bar used on covers and under titles. */
function accentBar(color: string, heightDxa = 120): Table {
  return new Table({
    width: { size: TABLE_DXA, type: WidthType.DXA },
    columnWidths: [TABLE_DXA],
    rows: [
      new TableRow({
        height: { value: heightDxa, rule: HeightRule.EXACT },
        children: [
          new TableCell({
            width: { size: TABLE_DXA, type: WidthType.DXA },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            shading: { type: ShadingType.CLEAR, fill: color },
            children: [docParagraph({ children: [] })],
          }),
        ],
      }),
    ],
  });
}

function metaPairTable(
  pairs: [string, string][],
  template: DocTemplate,
  fa: boolean
): Table {
  const col = Math.floor(TABLE_DXA / 2);
  const labelColor = template.accentHex;
  return new Table({
    width: { size: TABLE_DXA, type: WidthType.DXA },
    columnWidths: [col, col],
    rows: pairs.map(
      ([k, v]) =>
        new TableRow({
          children: [k, v].map((text, i) =>
            new TableCell({
              width: { size: col, type: WidthType.DXA },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: template.accentSoft },
                left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              },
              margins: { top: 70, bottom: 70, left: 130, right: 130 },
              children: [
                docParagraph({
                  alignment: fa ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: [
                    docRun({
                      text,
                      bold: i === 0,
                      size: i === 0 ? 16 : 20,
                      color: i === 0 ? labelColor : "333333",
                    }),
                  ],
                }),
              ],
            })
          ),
        })
    ),
  });
}

/** Title page / cover block for the chosen template. */
function buildCoverChildren(
  input: BuildDocxInput,
  template: DocTemplate,
  stats: ReturnType<typeof computeStats>,
  fa: boolean
): (Paragraph | Table)[] {
  const project = input.options.projectName || (fa ? "گزارش بدون عنوان" : "Untitled report");
  const subtitle = fa ? "گزارش آنالیز ارتعاشات" : "Vibration Condition Monitoring Report";
  const engineer = input.options.engineer || "—";
  const date =
    fa && input.options.jalaliDate
      ? input.options.jalaliDate
      : input.options.reportDate || "—";
  const client = [input.options.clientName?.trim(), input.options.clientUnit?.trim()]
    .filter(Boolean)
    .join(" — ");
  const logo =
    input.branding?.logoPng && input.branding.logoPng.length > 0
      ? docParagraph({
          alignment:
            template.coverStyle === "classic" || template.coverStyle === "industrial"
              ? AlignmentType.CENTER
              : fa
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT,
          spacing: { after: 200 },
          children: [
            new ImageRun({
              data: input.branding.logoPng,
              transformation: { width: 140, height: 70 },
              type: "png",
            }),
          ],
        })
      : null;

  const metaPairs: [string, string][] = [
    [fa ? "مهندس" : "Engineer", engineer],
    [fa ? "تاریخ" : "Date", date],
    [fa ? "واحدها" : "Units", input.options.units || "SI"],
  ];
  if (client) metaPairs.push([fa ? "کارفرما" : "Client", client]);
  if (!input.equipments?.length) {
    metaPairs.push([
      fa ? "منبع" : "Source",
      `${input.meta.filename} · ${stats.spectra_points} pts · peak ${stats.peak.amp}`,
    ]);
  } else {
    metaPairs.push([
      fa ? "تجهیزات" : "Machines",
      String(input.equipments.length),
    ]);
  }

  const out: (Paragraph | Table)[] = [];

  if (template.coverStyle === "modern") {
    out.push(
      new Table({
        width: { size: TABLE_DXA, type: WidthType.DXA },
        columnWidths: [TABLE_DXA],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: TABLE_DXA, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: template.accentHex },
                borders: {
                  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                },
                margins: { top: 200, bottom: 200, left: 200, right: 200 },
                children: [
                  docParagraph({
                    children: [
                      docRun({
                        text: subtitle.toUpperCase(),
                        color: "FFFFFF",
                        size: 18,
                        bold: true,
                      }),
                    ],
                  }),
                  docParagraph({
                    spacing: { before: 80 },
                    children: [
                      docRun({
                        text: project,
                        color: "FFFFFF",
                        size: template.titleSize,
                        bold: true,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      docParagraph({ spacing: { before: 200, after: 120 }, children: [] })
    );
    if (logo) out.push(logo);
    out.push(metaPairTable(metaPairs, template, fa));
    return out;
  }

  if (template.coverStyle === "minimal") {
    if (logo) out.push(logo);
    out.push(
      docParagraph({
        spacing: { before: 400, after: 80 },
        children: [
          docRun({
            text: subtitle.toUpperCase(),
            size: 18,
            color: "737373",
          }),
        ],
        alignment: fa ? AlignmentType.RIGHT : AlignmentType.LEFT,
      }),
      docParagraph({
        spacing: { after: 120 },
        children: [
          docRun({
            text: project,
            bold: true,
            size: template.titleSize,
            color: template.headingHex,
          }),
        ],
        heading: HeadingLevel.TITLE,
        alignment: fa ? AlignmentType.RIGHT : AlignmentType.LEFT,
      }),
      accentBar(template.accentHex, 40),
      docParagraph({ spacing: { before: 200 }, children: [] }),
      metaPairTable(metaPairs, template, fa)
    );
    return out;
  }

  if (template.coverStyle === "industrial") {
    out.push(accentBar(template.accentHex, 180));
    if (logo) out.push(logo);
    out.push(
      docParagraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 40 },
        children: [
          docRun({
            text: subtitle.toUpperCase(),
            size: 18,
            color: template.accentHex,
            bold: true,
          }),
        ],
      }),
      docParagraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          docRun({
            text: project,
            bold: true,
            size: template.titleSize,
            color: template.headingHex,
          }),
        ],
        heading: HeadingLevel.TITLE,
      }),
      accentBar(template.accentSoft, 60),
      docParagraph({ spacing: { before: 200 }, children: [] }),
      metaPairTable(metaPairs, template, fa),
      docParagraph({ spacing: { before: 200 }, children: [] }),
      accentBar(template.accentHex, 80)
    );
    return out;
  }

  // classic
  if (logo) out.push(logo);
  out.push(
    docParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 280, after: 60 },
      children: [
        docRun({
          text: subtitle,
          size: 20,
          color: template.accentHex,
          italics: true,
        }),
      ],
    }),
    docParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        docRun({
          text: project,
          bold: true,
          size: template.titleSize,
          color: template.headingHex,
        }),
      ],
      heading: HeadingLevel.TITLE,
    }),
    accentBar(template.accentHex, 90),
    docParagraph({ spacing: { before: 240 }, children: [] }),
    metaPairTable(metaPairs, template, fa)
  );
  return out;
}

export async function buildDocx(input: BuildDocxInput): Promise<Blob> {
  paragraphRtl = input.options.language === "fa";
  const stats = computeStats(input.spectra);
  const limit = input.options.pointLimit ?? 120;
  const rows = input.spectra.slice(0, Math.max(1, Math.min(limit, input.spectra.length)));
  void renderChartPng; // kept for sparklines; main spectrum now uses editable chart
  const d = input.aiDraft;
  const templateId = input.templateId ?? input.options.templateId ?? "classic";
  const template = getTemplate(templateId);
  const headerChildren = buildCoverChildren(input, template, stats, input.options.language === "fa");

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          sectionTitle(input.options.language === "fa" ? "fa" : "en", "freq"),
          sectionTitle(input.options.language === "fa" ? "fa" : "en", "amp"),
        ].map(
          (t) =>
            new TableCell({
              margins: paddedCell,
              children: [docParagraph({ children: [docRun({ text: t, bold: true })] })],
            })
        ),
      }),
      ...rows.map(
        (p) =>
          new TableRow({
            children: [String(p.freq), String(p.amp)].map(
              (t) => new TableCell({ children: [docParagraph(t)], margins: tight })
            ),
          })
      ),
    ],
  });

  const fa = input.options.language === "fa";
  const children: (Paragraph | Table)[] = [...letterheadSection(input, fa), ...headerChildren];
  const multi = input.equipments && input.equipments.length > 0 ? input.equipments : null;
  if (multi && input.options.includeToc !== false) {
    children.push(...tocSection(multi, fa));
  }
  const isoPosition =
    input.options.includeIsoTable === false ? "off" : (input.options.isoPosition ?? "end");
  const isoRows = input.options.useCustomIso ? input.isoRows : undefined;
  if (isoPosition === "afterToc") {
    children.push(...buildIsoSection(fa ? "fa" : "en", input.options.isoGroups, isoRows));
  }
  const lang: "en" | "fa" = fa ? "fa" : "en";
  const tableOpts = {
    secondary: input.options.secondaryMetric,
    showSecondary: input.options.showSecondary,
    envelopeUnit: input.envelopeUnit,
  };
  const pushMeasuring = (limits: ZoneLimitSet, rows: MeasureRow[], bookmarkId?: string) => {
    if (rows.length === 0) return;
    children.push(
      headingWithBookmark(sectionTitle(lang, "measuring"), HeadingLevel.HEADING_1, bookmarkId),
      measuringTable(buildMeasuringTableData(rows, limits, lang, tableOpts))
    );
  };
  const pushTrends = (list: NonNullable<BuildDocxInput["allTrends"]>, bookmarkId?: string) => {
    if (list.length === 0) return;
    children.push(
      headingWithBookmark(sectionTitle(lang, "trendsAll"), HeadingLevel.HEADING_1, bookmarkId)
    );
    for (const t of list.slice(0, 40)) {
      const secMetric = (t.secondaryMetric ?? input.options.secondaryMetric ?? "acceleration") as SecondaryMetric;
      const secLabel = secondaryLabels(secMetric, lang, input.envelopeUnit);
      children.push(
        docParagraph({
          text: `${t.pointLabel} · ${t.sampleCount} samples`,
          heading: HeadingLevel.HEADING_2,
        }),
        trendChartParagraph(t.velocityCategories, t.velocityValues, CHART_COLOR_VEL, sectionTitle(lang, "velocity"), lang, "mm/s", t.velocityLimits ?? input.zones?.limits.velocity)!,
        trendChartParagraph(t.accelCategories, t.accelValues, CHART_COLOR_ACC, secLabel.short, lang, secLabel.unit, t.accelLimits ?? secondaryLimits(input.zones?.limits ?? DEFAULT_ZONE_LIMITS, secMetric))!,
        ...(t.envelopePng
          ? [
              docParagraph({
                text: sectionTitle(lang, "envelope"),
                heading: HeadingLevel.HEADING_2,
              }),
              trendChartParagraph(t.envelopeCategories, t.envelopeValues, CHART_COLOR_ENVELOPE, sectionTitle(lang, "envelope"), lang, t.envelopeLimits ? secondaryLabels("envelope", lang, input.envelopeUnit).unit : secLabel.unit, t.envelopeLimits ?? input.zones?.limits.envelope)!,
            ]
          : [])
      );
    }
  };
  const pushFft = (
    list: NonNullable<BuildDocxInput["fftGallery"]>,
    level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1,
    bookmarkId?: string
  ) => {
    if (list.length === 0) return;
    children.push(headingWithBookmark(sectionTitle(lang, "fft"), level, bookmarkId));
    // Brochure p.7: 2 spectra per row in a bordered grid
    const items = list.slice(0, 24);
    const half = TABLE_DXA / 2;
    const fftCell = (g: { label: string; png: Uint8Array; peak?: string; spectra?: SpectraPoint[] }) =>
      new TableCell({
        width: { size: half, type: WidthType.DXA },
        margins: tight,
        children: [
          docParagraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 40 },
            shading: { type: ShadingType.CLEAR, fill: "F1F8E9", color: "auto" },
            children: [
              docRun({ text: g.label, bold: true, size: 18, color: GREEN_DARK }),
              ...(g.peak ? [docRun({ text: `   ${g.peak}`, size: 15, color: "616161" })] : []),
            ],
          }),
          g.spectra && g.spectra.length > 0
            ? docParagraph({
                children: [spectrumChartRun(g.spectra, { width: 340, height: 170, lang, unit: input.meta.overall?.unit || input.options.units || "" })],
                alignment: AlignmentType.CENTER,
              })
            : g.png && g.png.length > 0
              ? docParagraph({
                  children: [new ImageRun({ data: g.png, transformation: { width: 340, height: 170 }, type: "png" })],
                  alignment: AlignmentType.CENTER,
                })
              : docParagraph({
                  children: [docRun({ text: lang === "fa" ? "داده طیف موجود نیست" : "No spectrum data", italics: true, color: "737373" })],
                  alignment: AlignmentType.CENTER,
                }),
        ],
      });
    const rows: TableRow[] = [];
    for (let i = 0; i < items.length; i += 2) {
      const left = items[i];
      const right = items[i + 1];
      rows.push(
        new TableRow({
          cantSplit: true,
          children: right
            ? [fftCell(left), fftCell(right)]
            : [
                fftCell(left),
                new TableCell({
                  width: { size: half, type: WidthType.DXA },
                  margins: tight,
                  children: [docParagraph("")],
                }),
              ],
        })
      );
    }
    children.push(
      new Table({
        width: { size: TABLE_DXA, type: WidthType.DXA },
        columnWidths: [half, half],
        layout: TableLayoutType.FIXED,
        borders: GRID_BORDERS,
        rows,
      })
    );
  };
  const perMachineVib = !!multi?.some((e) => e.vib && e.vib.rows.length > 0);
  const soleMachine = multi?.length === 1 ? multi[0] : undefined;
  const placeSharedOnSole = !!soleMachine && !narrativeFilled(soleMachine) && narrativeFilled(d);
  const omitSharedNarrative = !!soleMachine && (narrativeFilled(soleMachine) || placeSharedOnSole);
  if (multi) {
    multi.forEach((eq, i) => {
      const n = i + 1;
      const marks = {
        status: sectionBookmarkId(n, "status"),
        specs: sectionBookmarkId(n, "specs"),
        schematic: sectionBookmarkId(n, "schematic"),
        description: sectionBookmarkId(n, "description"),
        problems: sectionBookmarkId(n, "problems"),
        actions: sectionBookmarkId(n, "actions"),
      };
      const name = eq.name?.trim() || `${sectionTitle(lang, "equipment")} ${n}`;
      children.push(
        docParagraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: i > 0 || input.options.includeToc !== false,
          children: [
            new Bookmark({
              id: equipmentBookmarkId(n),
              children: [docRun(`${sectionTitle(lang, "machineName")}: ${name}`)],
            }),
          ],
        })
      );
      const measured = (eq.vib?.rows ?? [])
        .map((r) => r.date)
        .filter((dt) => /^\d{4}-\d{2}-\d{2}/.test(dt))
        .sort()
        .pop();
      children.push(
        identityTable([
          [sectionTitle(lang, "machineName"), name],
          ...(eq.plant?.trim()
            ? [[sectionTitle(lang, "plant"), eq.plant.trim()] as [string, string]]
            : []),
          [sectionTitle(lang, "measured"), measured || input.options.reportDate || "—"],
        ])
      );
      children.push(...equipmentSection(eq, lang, marks, true, eq.vib?.limits).slice(1));
      if (eq.vib) {
        pushMeasuring(eq.vib.limits, eq.vib.rows, sectionBookmarkId(n, "measuring"));
        if (eq.vib.trends) pushTrends(eq.vib.trends, sectionBookmarkId(n, "trends"));
        if (eq.vib.fft) pushFft(eq.vib.fft, HeadingLevel.HEADING_2, sectionBookmarkId(n, "fft"));
      }
      appendConditionNarrative(children, placeSharedOnSole ? d : eq, lang);
    });
  } else {
    children.push(...equipmentSection(input.equipment, lang));
  }
  const sharedSummary = d?.summary?.trim()
    ? d.summary
    : multi
      ? ""
      : `Peak ${stats.peak.amp} at ${stats.peak.freq}. ${stats.spectra_points} points.`;
  if (!omitSharedNarrative && sharedSummary) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "summary"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(sharedSummary)
    );
  }

  // Featured single-spectrum sections only make sense for a one-measurement report;
  // a machine report already carries its readings, trends and spectra per machine.
  const overall = multi ? undefined : input.meta.overall;
  if (overall) {
    const cell = (t: string, bold = false) =>
      new TableCell({ children: [docParagraph({ children: [docRun({ text: t, bold })] })], margins: paddedCell });
    const extraRows: [string, string][] = [];
    if (input.zones) {
      extraRows.push(
        [sectionTitle(lang, "zoneVLimits"), formatLimits(input.zones.limits.velocity)],
        [sectionTitle(lang, "zoneALimits"), formatLimits(input.zones.limits.acceleration)],
        [sectionTitle(lang, "zoneELimits"), formatLimits(input.zones.limits.envelope)]
      );
    }
    children.push(
      docParagraph({ text: sectionTitle(lang, "overall"), heading: HeadingLevel.HEADING_1 }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              cell(sectionTitle(lang, "metric"), true),
              cell(sectionTitle(lang, "value"), true),
            ],
          }),
          ...[
            [sectionTitle(lang, "unit"), overall.unit || "—"],
            [sectionTitle(lang, "measured"), overall.measDate || "—"],
            [
              sectionTitle(lang, "pointDir"),
              `${overall.pointId || "—"} / ${overall.directionId || "—"}`,
            ],
            [sectionTitle(lang, "rmsDva"), `${overall.rmsD} / ${overall.rmsV} / ${overall.rmsA}`],
            [
              sectionTitle(lang, "peakDva"),
              `${overall.peakD} / ${overall.peakV} / ${overall.peakA}`,
            ],
            [sectionTitle(lang, "peakFreq"), String(overall.peakFreq)],
            [sectionTitle(lang, "freqLines"), `${overall.freqRange} / ${overall.noLines}`],
            ...extraRows,
          ].map(([k, v]) => new TableRow({ children: [cell(k), cell(v)] })),
        ],
      })
    );
    if (input.zones) {
      const z = classifyZone(overall.rmsV, input.zones.limits.velocity);
      children.push(
        docParagraph(
          fa
            ? `این اندازه‌گیری: ناحیه سرعت ${z || "—"} (RMS-V ${overall.rmsV} نسبت به ${formatLimits(input.zones.limits.velocity)}).`
            : `This measurement: velocity zone ${z || "—"} (RMS-V ${overall.rmsV} against ${formatLimits(input.zones.limits.velocity)}).`
        )
      );
    }
  }

  if (!multi) {
    const specUnit = input.meta.overall?.unit || input.options.units || "";
    children.push(
      docParagraph({ text: sectionTitle(lang, "spectra"), heading: HeadingLevel.HEADING_1 }),
      docParagraph({
        children: [spectrumChartRun(input.spectra, { width: 600, height: 300, lang, unit: specUnit })],
        alignment: AlignmentType.CENTER,
      }),
      docParagraph({
        text: `${sectionTitle(lang, "data")} (${rows.length})`,
        heading: HeadingLevel.HEADING_1,
      }),
      table
    );
  }

  if (!perMachineVib && input.zones && input.zones.rows.length > 0) {
    pushMeasuring(input.zones.limits, input.zones.rows);
  }

  if (input.trends && input.trends.sampleCount > 0) {
    const t = input.trends;
    const secMetric = (t.secondaryMetric ?? input.options.secondaryMetric ?? "acceleration") as SecondaryMetric;
    const secLabel = secondaryLabels(secMetric, lang, input.envelopeUnit);
    children.push(
      docParagraph({ text: sectionTitle(lang, "trends"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(`Point ${t.pointLabel} · ${t.window} · ${t.sampleCount} samples.`),
      docParagraph({ text: sectionTitle(lang, "velocity"), heading: HeadingLevel.HEADING_2 }),
      trendChartParagraph(t.velocityCategories, t.velocityValues, CHART_COLOR_VEL, sectionTitle(lang, "velocity"), lang, "mm/s", t.velocityLimits ?? input.zones?.limits.velocity)!,
      docParagraph({ text: secLabel.group, heading: HeadingLevel.HEADING_2 }),
      trendChartParagraph(t.accelCategories, t.accelValues, CHART_COLOR_ACC, secLabel.short, lang, secLabel.unit, t.accelLimits ?? secondaryLimits(input.zones?.limits ?? DEFAULT_ZONE_LIMITS, secMetric))!
    );
  }

  if (!perMachineVib && input.allTrends && input.allTrends.length > 0) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "trendsAll"), heading: HeadingLevel.HEADING_1 })
    );
    for (const t of input.allTrends.slice(0, 40)) {
      const secMetric = (t.secondaryMetric ?? input.options.secondaryMetric ?? "acceleration") as SecondaryMetric;
      const secLabel = secondaryLabels(secMetric, lang, input.envelopeUnit);
      children.push(
        docParagraph({
          text: `${t.pointLabel} · ${t.sampleCount} samples`,
          heading: HeadingLevel.HEADING_2,
        }),
        trendChartParagraph(t.velocityCategories, t.velocityValues, CHART_COLOR_VEL, sectionTitle(lang, "velocity"), lang, "mm/s", t.velocityLimits ?? input.zones?.limits.velocity)!,
        trendChartParagraph(t.accelCategories, t.accelValues, CHART_COLOR_ACC, secLabel.short, lang, secLabel.unit, t.accelLimits ?? secondaryLimits(input.zones?.limits ?? DEFAULT_ZONE_LIMITS, secMetric))!,
        ...(t.envelopePng
          ? [
              docParagraph({
                text: sectionTitle(lang, "envelope"),
                heading: HeadingLevel.HEADING_2,
              }),
              trendChartParagraph(t.envelopeCategories, t.envelopeValues, CHART_COLOR_ENVELOPE, sectionTitle(lang, "envelope"), lang, t.envelopeLimits ? secondaryLabels("envelope", lang, input.envelopeUnit).unit : secLabel.unit, t.envelopeLimits ?? input.zones?.limits.envelope)!,
            ]
          : [])
      );
    }
  }

  if (
    input.fftGallery &&
    input.fftGallery.length > 0 &&
    !multi?.some((e) => e.vib?.fft && e.vib.fft.length > 0)
  ) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "fft"), heading: HeadingLevel.HEADING_1 })
    );
    for (const g of input.fftGallery.slice(0, 24)) {
      children.push(
        docParagraph({
          text: g.peak ? `${g.label} · peak ${g.peak}` : g.label,
          heading: HeadingLevel.HEADING_2,
        }),
        g.spectra && g.spectra.length > 0
          ? docParagraph({
              children: [spectrumChartRun(g.spectra, { width: 600, height: 300, lang, unit: input.meta.overall?.unit || input.options.units || "" })],
              alignment: AlignmentType.CENTER,
            })
          : g.png && g.png.length > 0
            ? docParagraph({
                children: [new ImageRun({ data: g.png, transformation: { width: 600, height: 300 }, type: "png" })],
                alignment: AlignmentType.CENTER,
              })
            : docParagraph({
                children: [docRun({ text: lang === "fa" ? "داده طیف موجود نیست" : "No spectrum data", italics: true, color: "737373" })],
                alignment: AlignmentType.CENTER,
              })
      );
    }
  }

  if (d && !omitSharedNarrative) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "methodology"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(d.methodology),
      docParagraph({ text: sectionTitle(lang, "observations"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(d.observations),
      docParagraph({
        text: sectionTitle(lang, "recommendations"),
        heading: HeadingLevel.HEADING_1,
      }),
      docParagraph(d.recommendations),
      docParagraph({ text: sectionTitle(lang, "conclusion"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(d.conclusion)
    );
  }
  if (input.options.notes) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "notes"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(input.options.notes)
    );
  }

  if (isoPosition === "end") {
    children.push(...buildIsoSection(lang, input.options.isoGroups, isoRows));
  }

  if (input.branding?.signature && input.branding.signature.data.length > 0) {
    children.push(...buildSignatureBlock(input.options, input.branding.signature));
  }

  // Brochure-style running header/footer (vendor info + page number) on every content page
  const headerText = input.options.projectName
    ? `${input.options.projectName} — ${input.options.reportDate || ""}`.trim()
    : "Report";
  const footerText =
    input.options.addressBlock?.trim() ||
    (fa ? "یزد، اردکان — بلوار شهید بهشتی" : "SEPAS SANAT FARTAK Co");
  const contentHeader = new Header({
    children: [
      docParagraph({
        alignment: fa ? AlignmentType.RIGHT : AlignmentType.LEFT,
        indent: { left: 150, right: 150 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 12, color: template.accentHex, space: 8 },
        },
        spacing: { after: 80 },
        children: [
          docRun({ text: headerText, size: 16, color: template.headingHex, bold: true }),
        ],
      }),
    ],
  });
  const contentFooter = new Footer({
    children: [
      docParagraph({
        alignment: AlignmentType.CENTER,
        indent: { left: 150, right: 150 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, color: template.accentSoft, space: 6 },
        },
        spacing: { before: 60 },
        children: [
          docRun({ text: `${footerText}    `, size: 16, color: "737373" }),
          docRun({ children: [PageNumber.CURRENT], size: 16, color: template.accentHex }),
          docRun({ text: " / ", size: 16, color: "737373" }),
          docRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "737373" }),
        ],
      }),
    ],
  });
  const contentSection = {
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1000, bottom: 900, left: 567, right: 567, header: 400, footer: 400 },
      },
    },
    headers: { default: contentHeader },
    footers: { default: contentFooter },
    children,
  };
  // Persian keeps Word's default complex-script font; Latin uses the template face.
  const font = fa ? {} : { font: template.font };
  const styles = {
    default: {
      document: { run: { ...font, size: 20 } },
      title: { run: { ...font, color: template.headingHex, bold: true } },
      heading1: {
        run: { ...font, size: 30, bold: true, color: template.headingHex },
        paragraph: {
          spacing: { before: 280, after: 120 },
          keepNext: true,
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 8, color: template.accentSoft, space: 4 },
          },
        },
      },
      heading2: {
        run: { ...font, size: 24, bold: true, color: template.accentHex },
        paragraph: { spacing: { before: 200, after: 80 }, keepNext: true },
      },
      heading3: {
        run: { ...font, size: 20, bold: true, color: template.accentHex },
        paragraph: { spacing: { before: 80, after: 40 }, keepNext: true },
      },
    },
  };
  const doc = input.branding?.cover?.data?.length
    ? new Document({
        styles,
        features: { updateFields: true },
        sections: [
          {
            properties: {
              page: { margin: { top: 400, bottom: 400, left: 400, right: 400 } },
            },
            children: [
              docParagraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: input.branding.cover.data,
                    transformation: { width: 540, height: 764 },
                    type: input.branding.cover.kind ?? detectImageKind(input.branding.cover.data),
                  }),
                ],
              }),
            ],
          },
          contentSection,
        ],
      })
    : new Document({ styles, features: { updateFields: true }, sections: [contentSection] });
  const blob = await Packer.toBlob(doc);
  return fa ? applyWordRtl(blob) : blob;
}

/** ISO 10816-3 severity reference table (mirrors the legacy appendix). */
function buildIsoSection(
  lang: "en" | "fa" = "en",
  groups?: "all" | "1+3" | "2+4",
  isoRows?: IsoDataRow[]
): (Paragraph | Table)[] {
  const { rows } = buildIsoTableData({ language: lang, groups, rows: isoRows });
  const widths = ISO_COLUMN_DXA;
  const cell = (c: IsoCell, start: number) => {
    const span = c.span ?? 1;
    const w = widths.slice(start, start + span).reduce((a, b) => a + b, 0);
    const right = c.align === "right";
    return new TableCell({
      width: { size: w, type: WidthType.DXA },
      columnSpan: span > 1 ? span : undefined,
      verticalMerge:
        c.vMerge === "restart"
          ? VerticalMergeType.RESTART
          : c.vMerge === "continue"
            ? VerticalMergeType.CONTINUE
            : undefined,
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 30, bottom: 30, left: 130, right: 130 },
      ...(c.seamless ? { borders: SEAMLESS } : {}),
      ...shade(c.fill),
      children: [
        docParagraph({
          alignment: right ? AlignmentType.RIGHT : AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: c.text.split("\n").map((t, i) =>
            docRun({
              text: t,
              bold: c.bold,
              color: c.color,
              size: c.size ?? 16,
              break: i > 0 ? 1 : undefined,
            })
          ),
        }),
      ],
    });
  };
  return [
    docParagraph({
      text: sectionTitle(lang, "iso"),
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
    }),
    docParagraph({
      spacing: { after: 120 },
      children: [
        docRun({ text: sectionTitle(lang, "isoBlurb"), italics: true, size: 18, color: GREEN_MID }),
      ],
    }),
    new Table({
      width: { size: TABLE_DXA, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: GRID_BORDERS,
      rows: rows.map((r) => {
        let col = 0;
        return new TableRow({
          height: { value: 280, rule: HeightRule.ATLEAST },
          cantSplit: true,
          children: r.map((c) => {
            const out = cell(c, col);
            col += c.span ?? 1;
            return out;
          }),
        });
      }),
    }),
  ];
}

/** Minimal zip central-directory listing (for tests — validates .docx is a real zip). */
export function listZipFilenames(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(off, true) !== 0x02014b50) break;
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    names.push(dec.decode(zip.subarray(off + 46, off + 46 + nameLen)));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
