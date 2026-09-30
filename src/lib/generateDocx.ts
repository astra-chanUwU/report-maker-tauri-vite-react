import {
  AlignmentType,
  Bookmark,
  Document,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  Packer,
  PageReference,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
} from "docx";
import { computeStats, type ReportOptions, type SpectraPoint, type Sp3Meta } from "./parseSp3";
import { sectionTitle } from "./fa";
import { encodePng, drawCallout, line, setPixel } from "./png";
import { findDominantPeaks, formatPeakLabel } from "./spectra-peaks";
import { getTemplate } from "./templates";
import { buildIsoTableData, type IsoCell } from "./iso10816";
import {
  classifyZone,
  formatLimits,
  limitsShort,
  ZONE_FILL,
  ZONE_TEXT,
  type ZoneLimitSet,
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
    return new TextRun({ text: init, rightToLeft: true, language: { value: "fa-IR", bidirectional: "fa-IR" } });
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

/** Detect PNG vs JPEG from magic bytes (branding uploads lose their MIME). */
export function detectImageKind(bytes: Uint8Array): "png" | "jpg" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  return "png";
}

export interface MeasureRow {
  point: string;
  date: string;
  rms: string;
  rmsA: string;
  peak: string;
  peakFreq: string;
  /** Brochure Ver 2.32 stats (optional; default to rms / peak). */
  totalV?: string;
  avgV?: string;
  prevV?: string;
  currV?: string;
  totalA?: string;
  avgA?: string;
  prevA?: string;
  currA?: string;
  peakList?: string;
  sparkV?: Uint8Array;
  sparkA?: Uint8Array;
}

export interface MeasuringCell {
  text: string;
  fill?: string;
  color?: string;
  bold?: boolean;
  png?: Uint8Array;
}

/** Pure data builder for the measuring-results table (tested without unzipping). */
export function buildMeasuringTableData(
  rows: MeasureRow[],
  limits: ZoneLimitSet,
  lang: "en" | "fa" = "en"
): { header: string[]; body: MeasuringCell[][] } {
  const header = [
    sectionTitle(lang, "measPoint"),
    "V",
    sectionTitle(lang, "measTotal"),
    sectionTitle(lang, "measAvg"),
    sectionTitle(lang, "measPrev"),
    sectionTitle(lang, "measCurr"),
    `${sectionTitle(lang, "measZoneV")} (${limitsShort(limits.velocity)})`,
    sectionTitle(lang, "measPeaks"),
    "A",
    sectionTitle(lang, "measTotal"),
    sectionTitle(lang, "measAvg"),
    sectionTitle(lang, "measPrev"),
    sectionTitle(lang, "measCurr"),
    `${sectionTitle(lang, "measZoneA")} (${limitsShort(limits.acceleration)})`,
  ];
  const body = rows.map((r) => {
    const zoneV = classifyZone(r.currV || r.rms, limits.velocity);
    const zoneA = classifyZone(r.currA || r.rmsA, limits.acceleration);
    const peakList = r.peakList || (r.peak || r.peakFreq ? `${r.peak || "—"} @ ${r.peakFreq || "—"}` : "—");
    return [
      { text: r.point || "?" },
      { text: "", png: r.sparkV },
      { text: r.totalV || r.rms || "—" },
      { text: r.avgV || "—" },
      { text: r.prevV || "—" },
      { text: r.currV || r.rms || "—" },
      { text: zoneV || "—", fill: ZONE_FILL[zoneV], color: ZONE_TEXT[zoneV], bold: true },
      { text: peakList },
      { text: "", png: r.sparkA },
      { text: r.totalA || r.rmsA || "—" },
      { text: r.avgA || "—" },
      { text: r.prevA || "—" },
      { text: r.currA || r.rmsA || "—" },
      { text: zoneA || "—", fill: ZONE_FILL[zoneA], color: ZONE_TEXT[zoneA], bold: true },
    ];
  });
  return { header, body };
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
    velocityPng: Uint8Array;
    accelPng: Uint8Array;
  };
  /** All-points trends (brochure p.6): V+A PNG pair per point. */
  allTrends?: {
    pointLabel: string;
    sampleCount: number;
    velocityPng: Uint8Array;
    accelPng: Uint8Array;
    envelopePng?: Uint8Array;
  }[];
  /** FFT gallery for all points (brochure p.7). */
  fftGallery?: { label: string; png: Uint8Array; peak?: string }[];
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
  marks?: { status?: string; specs?: string; schematic?: string },
  skipName = false
): (Paragraph | Table)[] {
  const name = eq?.name?.trim() ?? "";
  const specs = eq?.specs?.trim() ?? "";
  const schema = eq?.schematic?.data?.length ? eq.schematic : undefined;
  const status = eq?.status?.trim() ?? "";
  const lastReport = eq?.lastReport?.trim() ?? "";
  const problems = eq?.problems?.trim() ?? "";
  const corrective = eq?.corrective?.trim() ?? "";
  if (!name && !specs && !schema && !status && !lastReport && !problems && !corrective) return [];
  const out: (Paragraph | Table)[] = [
    docParagraph({ text: sectionTitle(lang, "equipment"), heading: HeadingLevel.HEADING_1 }),
  ];
  if (name && !skipName) {
    out.push(docParagraph({ text: name, heading: HeadingLevel.HEADING_2 }));
  }
  if (status) {
    out.push(headingWithBookmark(sectionTitle(lang, "status"), HeadingLevel.HEADING_2, marks?.status));
    out.push(docParagraph(status));
  }
  if (specs) {
    out.push(headingWithBookmark(sectionTitle(lang, "specs"), HeadingLevel.HEADING_2, marks?.specs));
    for (const para of specs.split(/\n\s*\n/)) {
      const t = para.trim();
      if (t) out.push(docParagraph(t));
    }
  }
  if (lastReport) {
    out.push(docParagraph({ text: sectionTitle(lang, "lastReport"), heading: HeadingLevel.HEADING_2 }));
    out.push(docParagraph(lastReport));
  }
  if (problems) {
    out.push(docParagraph({ text: sectionTitle(lang, "problems"), heading: HeadingLevel.HEADING_2 }));
    out.push(docParagraph(problems));
  }
  if (corrective) {
    out.push(docParagraph({ text: sectionTitle(lang, "actions"), heading: HeadingLevel.HEADING_2 }));
    out.push(docParagraph(corrective));
  }
  if (schema) {
    out.push(headingWithBookmark(sectionTitle(lang, "schematic"), HeadingLevel.HEADING_2, marks?.schematic));
    out.push(
      docParagraph({
        children: [
          new ImageRun({
            data: schema.data,
            transformation: { width: 600, height: 400 },
            type: schema.kind ?? detectImageKind(schema.data),
          }),
        ],
        alignment: AlignmentType.CENTER,
      })
    );
  }
  return out;
}

const NARRATIVE_KEYS = ["summary", "methodology", "observations", "recommendations", "conclusion"] as const;

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

export type TocPart = "status" | "schematic" | "specs" | "measuring" | "trends" | "fft";

/** Bookmark for a subsection under equipment N, e.g. eq1measuring. */
export function sectionBookmarkId(index: number, part: TocPart): string {
  return `eq${index}${part}`;
}

/** Subsections that actually exist on this machine, in brochure order. */
export function tocPartsFor(eq: {
  status?: string;
  specs?: string;
  schematic?: { data?: Uint8Array };
  vib?: { rows?: unknown[]; trends?: unknown[]; fft?: unknown[] };
}): TocPart[] {
  const parts: TocPart[] = [];
  if (eq.status?.trim()) parts.push("status");
  if (eq.schematic?.data?.length) parts.push("schematic");
  if (eq.specs?.trim()) parts.push("specs");
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
  const cell = (children: Paragraph[]) => new TableCell({ children });
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
            children: [textCell(String(r.index)), linkCell(r.name, id), textCell(r.status), pageCell(id)],
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
    out.push(docParagraph({ children: [docRun({ text: addr, size: 16, color: "737373" })], alignment: align }));
  }
  const bits: string[] = [];
  if (o.reportDate) bits.push(fa && o.jalaliDate ? `تاریخ: ${o.jalaliDate}` : `Date: ${o.reportDate}`);
  if (!fa && o.jalaliDate) bits.push(`Jalali: ${o.jalaliDate}`);
  if (o.letterNo?.trim()) bits.push(fa ? `شماره: ${o.letterNo.trim()}` : `No: ${o.letterNo.trim()}`);
  if (bits.length > 0) out.push(docParagraph({ children: [docRun(bits.join("    "))] , alignment: align}));
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
    docParagraph(
      `Engineer: ${options.engineer || "—"}    Date: ${options.reportDate || "—"}`
    ),
  ];
}

export async function buildDocx(input: BuildDocxInput): Promise<Blob> {
  paragraphRtl = input.options.language === "fa";
  const stats = computeStats(input.spectra);
  const limit = input.options.pointLimit ?? 120;
  const rows = input.spectra.slice(0, Math.max(1, Math.min(limit, input.spectra.length)));
  const png = renderChartPng(input.spectra);
  const d = input.aiDraft;
  const templateId = input.templateId ?? input.options.templateId ?? "classic";
  const template = getTemplate(templateId);
  const align =
    template.coverStyle === "modern"
      ? AlignmentType.LEFT
      : template.coverStyle === "minimal"
        ? AlignmentType.LEFT
        : AlignmentType.CENTER;

  const headerChildren: Paragraph[] = [];
  if (input.branding?.logoPng && input.branding.logoPng.length > 0) {
    headerChildren.push(
      docParagraph({
        children: [
          new ImageRun({
            data: input.branding.logoPng,
            transformation: { width: 120, height: 60 },
            type: "png",
          }),
        ],
        alignment: align,
      })
    );
  }
  headerChildren.push(
    docParagraph({
      children: [
        docRun({
          text: input.options.projectName || "Untitled report",
          bold: true,
          size: 56,
          color: template.accentHex,
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: align,
    }),
    docParagraph({
      children: [
        docRun({
          text: `${template.name} template · ${input.options.reportDate || "—"}`,
          color: template.accentHex,
        }),
      ],
      alignment: align,
    }),
    docParagraph({
      children: [
        docRun(
          `Engineer: ${input.options.engineer || "—"}    Date: ${input.options.reportDate || "—"}    Units: ${input.options.units || "SI"}`
        ),
      ],
      alignment: align,
    }),
    docParagraph({
      children: [
        docRun(
          `Source: ${input.meta.filename} (${input.meta.source}) · ${stats.spectra_points} points · peak ${stats.peak.amp} @ ${stats.peak.freq}`
        ),
      ],
      alignment: align,
    })
  );
  if (template.coverStyle === "minimal") {
    headerChildren.push(
      docParagraph({
        children: [docRun({ text: "—", color: template.accentHex })],
        alignment: align,
      })
    );
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [sectionTitle(input.options.language === "fa" ? "fa" : "en", "freq"), sectionTitle(input.options.language === "fa" ? "fa" : "en", "amp")].map(
          (t) =>
            new TableCell({
              children: [docParagraph({ children: [docRun({ text: t, bold: true })] })],
            })
        ),
      }),
      ...rows.map(
        (p) =>
          new TableRow({
            children: [String(p.freq), String(p.amp)].map(
              (t) => new TableCell({ children: [docParagraph(t)] })
            ),
          })
      ),
    ],
  });

  const fa = input.options.language === "fa";
  const children: (Paragraph | Table)[] = [
    ...letterheadSection(input, fa),
    ...headerChildren,
  ];
  const multi = input.equipments && input.equipments.length > 0 ? input.equipments : null;
  if (multi && input.options.includeToc !== false) {
    children.push(...tocSection(multi, fa));
  }
  const lang: "en" | "fa" = fa ? "fa" : "en";
  const mcell = (c: MeasuringCell, bold = false) =>
    new TableCell({
      ...(c.fill ? { shading: { type: ShadingType.CLEAR, fill: c.fill, color: "auto" } } : {}),
      children: [
        docParagraph({
          children: [
            ...(c.png && c.png.length > 8
              ? [new ImageRun({ data: c.png, transformation: { width: 90, height: 28 }, type: "png" })]
              : []),
            ...(c.text ? [docRun({ text: c.text, bold: bold || c.bold, color: c.color })] : []),
          ],
        }),
      ],
    });
  const pushMeasuring = (limits: ZoneLimitSet, rows: MeasureRow[], bookmarkId?: string) => {
    if (rows.length === 0) return;
    const { header, body } = buildMeasuringTableData(rows, limits, lang);
    children.push(
      headingWithBookmark(sectionTitle(lang, "measuring"), HeadingLevel.HEADING_1, bookmarkId),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: header.map((t) => mcell({ text: t }, true)) }),
          ...body.map((r) => new TableRow({ children: r.map((c) => mcell(c)) })),
        ],
      })
    );
  };
  const pushTrends = (list: NonNullable<BuildDocxInput["allTrends"]>, bookmarkId?: string) => {
    if (list.length === 0) return;
    children.push(headingWithBookmark(sectionTitle(lang, "trendsAll"), HeadingLevel.HEADING_1, bookmarkId));
    for (const t of list.slice(0, 40)) {
      children.push(
        docParagraph({ text: `${t.pointLabel} · ${t.sampleCount} samples`, heading: HeadingLevel.HEADING_2 }),
        docParagraph({
          children: [new ImageRun({ data: t.velocityPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        docParagraph({
          children: [new ImageRun({ data: t.accelPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        ...(t.envelopePng
          ? [
              docParagraph({ text: sectionTitle(lang, "envelope"), heading: HeadingLevel.HEADING_2 }),
              docParagraph({
                children: [
                  new ImageRun({ data: t.envelopePng, transformation: { width: 600, height: 300 }, type: "png" }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ]
          : [])
      );
    }
  };
  const pushFft = (list: NonNullable<BuildDocxInput["fftGallery"]>, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1, bookmarkId?: string) => {
    if (list.length === 0) return;
    children.push(headingWithBookmark(sectionTitle(lang, "fft"), level, bookmarkId));
    for (const g of list.slice(0, 24)) {
      children.push(
        docParagraph({ text: g.peak ? `${g.label} · peak ${g.peak}` : g.label, heading: HeadingLevel.HEADING_2 }),
        docParagraph({
          children: [new ImageRun({ data: g.png, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        })
      );
    }
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
      };
      children.push(
        docParagraph({
          heading: HeadingLevel.HEADING_1,
          children: [
            new Bookmark({
              id: equipmentBookmarkId(n),
              children: [docRun(eq.name?.trim() || `${sectionTitle(lang, "equipment")} ${n}`)],
            }),
          ],
        })
      );
      children.push(...equipmentSection(eq, lang, marks, true).slice(1));
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
  if (!omitSharedNarrative) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "summary"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(
        d?.summary ?? `Peak ${stats.peak.amp} at ${stats.peak.freq}. ${stats.spectra_points} points.`
      )
    );
  }

  const overall = input.meta.overall;
  if (overall) {
    const cell = (t: string, bold = false) =>
      new TableCell({ children: [docParagraph({ children: [docRun({ text: t, bold })] })] });
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
          new TableRow({ children: [cell(sectionTitle(lang, "metric"), true), cell(sectionTitle(lang, "value"), true)] }),
          ...[
            [sectionTitle(lang, "unit"), overall.unit || "—"],
            [sectionTitle(lang, "measured"), overall.measDate || "—"],
            [sectionTitle(lang, "pointDir"), `${overall.pointId || "—"} / ${overall.directionId || "—"}`],
            [sectionTitle(lang, "rmsDva"), `${overall.rmsD} / ${overall.rmsV} / ${overall.rmsA}`],
            [sectionTitle(lang, "peakDva"), `${overall.peakD} / ${overall.peakV} / ${overall.peakA}`],
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

  children.push(
    docParagraph({ text: sectionTitle(lang, "spectra"), heading: HeadingLevel.HEADING_1 }),
    docParagraph({
      children: [
        new ImageRun({ data: png, transformation: { width: 600, height: 300 }, type: "png" }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    docParagraph({ text: `${sectionTitle(lang, "data")} (${rows.length})`, heading: HeadingLevel.HEADING_1 }),
    table
  );

  if (!perMachineVib && input.zones && input.zones.rows.length > 0) {
    pushMeasuring(input.zones.limits, input.zones.rows);
  }

  if (input.trends && input.trends.sampleCount > 0) {
    const t = input.trends;
    const trendImg = (data: Uint8Array) =>
      docParagraph({
        children: [
          new ImageRun({ data, transformation: { width: 600, height: 300 }, type: "png" }),
        ],
        alignment: AlignmentType.CENTER,
      });
    children.push(
      docParagraph({ text: sectionTitle(lang, "trends"), heading: HeadingLevel.HEADING_1 }),
      docParagraph(`Point ${t.pointLabel} · ${t.window} · ${t.sampleCount} samples.`),
      docParagraph({ text: sectionTitle(lang, "velocity"), heading: HeadingLevel.HEADING_2 }),
      trendImg(t.velocityPng),
      docParagraph({ text: sectionTitle(lang, "acceleration"), heading: HeadingLevel.HEADING_2 }),
      trendImg(t.accelPng)
    );
  }

  if (!perMachineVib && input.allTrends && input.allTrends.length > 0) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "trendsAll"), heading: HeadingLevel.HEADING_1 })
    );
    for (const t of input.allTrends.slice(0, 40)) {
      children.push(
        docParagraph({ text: `${t.pointLabel} · ${t.sampleCount} samples`, heading: HeadingLevel.HEADING_2 }),
        docParagraph({
          children: [new ImageRun({ data: t.velocityPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        docParagraph({
          children: [new ImageRun({ data: t.accelPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        ...(t.envelopePng
          ? [
              docParagraph({ text: sectionTitle(lang, "envelope"), heading: HeadingLevel.HEADING_2 }),
              docParagraph({
                children: [
                  new ImageRun({ data: t.envelopePng, transformation: { width: 600, height: 300 }, type: "png" }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ]
          : [])
      );
    }
  }

  if (input.fftGallery && input.fftGallery.length > 0 && !multi?.some((e) => e.vib?.fft && e.vib.fft.length > 0)) {
    children.push(
      docParagraph({ text: sectionTitle(lang, "fft"), heading: HeadingLevel.HEADING_1 })
    );
    for (const g of input.fftGallery.slice(0, 24)) {
      children.push(
        docParagraph({ text: g.peak ? `${g.label} · peak ${g.peak}` : g.label, heading: HeadingLevel.HEADING_2 }),
        docParagraph({
          children: [new ImageRun({ data: g.png, transformation: { width: 600, height: 300 }, type: "png" })],
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
      docParagraph({ text: sectionTitle(lang, "recommendations"), heading: HeadingLevel.HEADING_1 }),
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

  if (input.options.includeIsoTable !== false) {
    children.push(...buildIsoSection(lang, input.options.isoGroups));
  }

  if (input.branding?.signature && input.branding.signature.data.length > 0) {
    children.push(...buildSignatureBlock(input.options, input.branding.signature));
  }

  const doc = input.branding?.cover?.data?.length
    ? new Document({
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
          { children },
        ],
      })
    : new Document({ features: { updateFields: true }, sections: [{ children }] });
  return Packer.toBlob(doc);
}

/** ISO 10816-3 severity reference table (mirrors the legacy appendix). */
function buildIsoSection(lang: "en" | "fa" = "en", groups?: "all" | "1+3" | "2+4"): (Paragraph | Table)[] {
  const { rows } = buildIsoTableData({ language: lang, groups });
  const cell = (c: IsoCell, bold = false) =>
    new TableCell({
      ...(c.span && c.span > 1 ? { columnSpan: c.span } : {}),
      ...(c.fill ? { shading: { type: ShadingType.CLEAR, fill: c.fill, color: "auto" } } : {}),
      children: [
        docParagraph({
          alignment: AlignmentType.CENTER,
          children: [docRun({ text: c.text, bold: bold || c.bold, color: c.color, size: 16 })],
        }),
      ],
    });
  return [
    docParagraph({ text: sectionTitle(lang, "iso"), heading: HeadingLevel.HEADING_1 }),
    docParagraph({
      children: [
        docRun({
          text: sectionTitle(lang, "isoBlurb"),
          italics: true,
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map((r, i) => new TableRow({ children: r.map((c) => cell(c, i < 3)) })),
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
