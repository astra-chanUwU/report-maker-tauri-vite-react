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
} from "docx";
import { computeStats, type ReportOptions, type SpectraPoint, type Sp3Meta } from "./parseSp3";
import { sectionTitle } from "./fa";
import { encodePng, drawText, line, setPixel } from "./png";
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
  limits: ZoneLimitSet
): { header: string[]; body: MeasuringCell[][] } {
  const header = [
    "Point",
    "V",
    "Total",
    "Avg",
    "Prev",
    "Curr",
    `V Zone (${limitsShort(limits.velocity)})`,
    "Peak list",
    "A",
    "Total",
    "Avg",
    "Prev",
    "Curr",
    `A Zone (${limitsShort(limits.acceleration)})`,
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
  for (const peak of peaks) {
    const cx = px(peak.freq);
    const cy = py(peak.amp);
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy <= 16) setPixel(buf, w, CHART_H, cx + dx, cy + dy, 220, 38, 38);
      }
    const label = formatPeakLabel(peak.freq);
    drawText(buf, w, CHART_H, Math.min(cx + 4, w - 40), Math.max(2, cy - 16), label, [185, 28, 28], 1);
  }
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
function equipmentSection(eq?: BuildDocxInput["equipment"], lang: "en" | "fa" = "en"): (Paragraph | Table)[] {
  const name = eq?.name?.trim() ?? "";
  const specs = eq?.specs?.trim() ?? "";
  const schema = eq?.schematic?.data?.length ? eq.schematic : undefined;
  const status = eq?.status?.trim() ?? "";
  const lastReport = eq?.lastReport?.trim() ?? "";
  const problems = eq?.problems?.trim() ?? "";
  const corrective = eq?.corrective?.trim() ?? "";
  if (!name && !specs && !schema && !status && !lastReport && !problems && !corrective) return [];
  const out: (Paragraph | Table)[] = [
    new Paragraph({ text: sectionTitle(lang, "equipment"), heading: HeadingLevel.HEADING_1 }),
  ];
  if (name) {
    out.push(new Paragraph({ text: name, heading: HeadingLevel.HEADING_2 }));
  }
  if (status) {
    out.push(new Paragraph(`${sectionTitle(lang, "status")}: ${status}`));
  }
  if (specs) {
    out.push(new Paragraph({ text: sectionTitle(lang, "specs"), heading: HeadingLevel.HEADING_2 }));
    for (const para of specs.split(/\n\s*\n/)) {
      const t = para.trim();
      if (t) out.push(new Paragraph(t));
    }
  }
  if (lastReport) {
    out.push(new Paragraph({ text: sectionTitle(lang, "lastReport"), heading: HeadingLevel.HEADING_2 }));
    out.push(new Paragraph(lastReport));
  }
  if (problems) {
    out.push(new Paragraph({ text: sectionTitle(lang, "problems"), heading: HeadingLevel.HEADING_2 }));
    out.push(new Paragraph(problems));
  }
  if (corrective) {
    out.push(new Paragraph({ text: sectionTitle(lang, "actions"), heading: HeadingLevel.HEADING_2 }));
    out.push(new Paragraph(corrective));
  }
  if (schema) {
    out.push(
      new Paragraph({
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

/** Bookmark id for equipment N (1-based index in the TOC). Word names cannot contain spaces. */
export function equipmentBookmarkId(index: number): string {
  return `eq${index}`;
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
  equipments: { name?: string; status?: string }[],
  fa: boolean
): (Paragraph | Table)[] {
  if (equipments.length === 0) return [];
  const rows = buildTocRows(equipments);
  const cell = (children: Paragraph[]) => new TableCell({ children });
  const textCell = (t: string, bold = false) =>
    cell([new Paragraph({ children: [new TextRun({ text: t, bold })] })]);
  return [
    new Paragraph({ text: sectionTitle(fa ? "fa" : "en", "toc"), heading: HeadingLevel.HEADING_1 }),
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
        ...rows.map((r) => {
          const id = equipmentBookmarkId(r.index);
          return new TableRow({
            children: [
              textCell(String(r.index)),
              cell([
                new Paragraph({
                  children: [
                    new InternalHyperlink({
                      anchor: id,
                      children: [new TextRun({ text: r.name, style: "Hyperlink" })],
                    }),
                  ],
                }),
              ]),
              textCell(r.status),
              cell([
                new Paragraph({
                  children: [new PageReference(id, { hyperlink: true })],
                }),
              ]),
            ],
          });
        }),
      ],
    }),
    new Paragraph(
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
    out.push(new Paragraph({ children: [new TextRun({ text: addr, size: 16, color: "737373" })], alignment: align }));
  }
  const bits: string[] = [];
  if (o.reportDate) bits.push(fa && o.jalaliDate ? `تاریخ: ${o.jalaliDate}` : `Date: ${o.reportDate}`);
  if (!fa && o.jalaliDate) bits.push(`Jalali: ${o.jalaliDate}`);
  if (o.letterNo?.trim()) bits.push(fa ? `شماره: ${o.letterNo.trim()}` : `No: ${o.letterNo.trim()}`);
  if (bits.length > 0) out.push(new Paragraph({ children: [new TextRun(bits.join("    "))] , alignment: align}));
  const client = [o.clientName?.trim(), o.clientUnit?.trim()].filter(Boolean).join(" — ");
  if (client) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: fa ? `کارفرما: ${client}` : `Client: ${client}`, bold: true })],
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
  if (!signature || signature.data.length === 0) return [];
  const sigImg = (alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new Paragraph({
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
      new Paragraph({ text: "با سپاس", alignment: center }),
      sigImg(center),
      new Paragraph({ text: name, alignment: center }),
    ];
    if (role) out.push(new Paragraph({ text: role, alignment: center }));
    return out;
  }
  return [
    new Paragraph({ text: sectionTitle(lang, "approval"), heading: HeadingLevel.HEADING_1 }),
    sigImg(),
    new Paragraph(
      `Engineer: ${options.engineer || "—"}    Date: ${options.reportDate || "—"}`
    ),
  ];
}

export async function buildDocx(input: BuildDocxInput): Promise<Blob> {
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
      new Paragraph({
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
    new Paragraph({
      children: [
        new TextRun({
          text: input.options.projectName || "Untitled report",
          bold: true,
          size: 56,
          color: template.accentHex,
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: align,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${template.name} template · ${input.options.reportDate || "—"}`,
          color: template.accentHex,
        }),
      ],
      alignment: align,
    }),
    new Paragraph({
      children: [
        new TextRun(
          `Engineer: ${input.options.engineer || "—"}    Date: ${input.options.reportDate || "—"}    Units: ${input.options.units || "SI"}`
        ),
      ],
      alignment: align,
    }),
    new Paragraph({
      children: [
        new TextRun(
          `Source: ${input.meta.filename} (${input.meta.source}) · ${stats.spectra_points} points · peak ${stats.peak.amp} @ ${stats.peak.freq}`
        ),
      ],
      alignment: align,
    })
  );
  if (template.coverStyle === "minimal") {
    headerChildren.push(
      new Paragraph({
        children: [new TextRun({ text: "—", color: template.accentHex })],
        alignment: align,
      })
    );
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ["Freq", "Amp"].map(
          (t) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
            })
        ),
      }),
      ...rows.map(
        (p) =>
          new TableRow({
            children: [String(p.freq), String(p.amp)].map(
              (t) => new TableCell({ children: [new Paragraph(t)] })
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
        new Paragraph({
          children: [
            ...(c.png && c.png.length > 8
              ? [new ImageRun({ data: c.png, transformation: { width: 90, height: 28 }, type: "png" })]
              : []),
            ...(c.text ? [new TextRun({ text: c.text, bold: bold || c.bold, color: c.color })] : []),
          ],
        }),
      ],
    });
  const pushMeasuring = (limits: ZoneLimitSet, rows: MeasureRow[]) => {
    if (rows.length === 0) return;
    const { header, body } = buildMeasuringTableData(rows, limits);
    children.push(
      new Paragraph({ text: sectionTitle(lang, "measuring"), heading: HeadingLevel.HEADING_1 }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: header.map((t) => mcell({ text: t }, true)) }),
          ...body.map((r) => new TableRow({ children: r.map((c) => mcell(c)) })),
        ],
      })
    );
  };
  const pushTrends = (list: NonNullable<BuildDocxInput["allTrends"]>) => {
    if (list.length === 0) return;
    children.push(new Paragraph({ text: sectionTitle(lang, "trendsAll"), heading: HeadingLevel.HEADING_1 }));
    for (const t of list.slice(0, 40)) {
      children.push(
        new Paragraph({ text: `${t.pointLabel} · ${t.sampleCount} samples`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [new ImageRun({ data: t.velocityPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [new ImageRun({ data: t.accelPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        ...(t.envelopePng
          ? [
              new Paragraph({ text: sectionTitle(lang, "envelope"), heading: HeadingLevel.HEADING_2 }),
              new Paragraph({
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
  const pushFft = (list: NonNullable<BuildDocxInput["fftGallery"]>) => {
    if (list.length === 0) return;
    children.push(new Paragraph({ text: sectionTitle(lang, "fft"), heading: HeadingLevel.HEADING_1 }));
    for (const g of list.slice(0, 24)) {
      children.push(
        new Paragraph({ text: g.peak ? `${g.label} · peak ${g.peak}` : g.label, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [new ImageRun({ data: g.png, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        })
      );
    }
  };
  const perMachineVib = !!multi?.some((e) => e.vib && e.vib.rows.length > 0);
  if (multi) {
    multi.forEach((eq, i) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [
            new Bookmark({
              id: equipmentBookmarkId(i + 1),
              children: [new TextRun(`${sectionTitle(lang, "equipment")} ${i + 1}`)],
            }),
          ],
        })
      );
      children.push(...equipmentSection(eq, lang).slice(1));
      if (eq.vib) {
        pushMeasuring(eq.vib.limits, eq.vib.rows);
        if (eq.vib.trends) pushTrends(eq.vib.trends);
        if (eq.vib.fft) pushFft(eq.vib.fft);
      }
    });
  } else {
    children.push(...equipmentSection(input.equipment, lang));
  }
    children.push(
    new Paragraph({ text: sectionTitle(lang, "summary"), heading: HeadingLevel.HEADING_1 }),
    new Paragraph(
      d?.summary ?? `Peak ${stats.peak.amp} at ${stats.peak.freq}. ${stats.spectra_points} points.`
    ),
  );

  const overall = input.meta.overall;
  if (overall) {
    const cell = (t: string, bold = false) =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] });
    const extraRows: [string, string][] = [];
    if (input.zones) {
      extraRows.push(
        ["Velocity zone limits (B/U/C)", formatLimits(input.zones.limits.velocity)],
        ["Accel zone limits (B/U/C)", formatLimits(input.zones.limits.acceleration)],
        ["Envelope zone limits (B/U/C)", formatLimits(input.zones.limits.envelope)]
      );
    }
    children.push(
      new Paragraph({ text: sectionTitle(lang, "overall"), heading: HeadingLevel.HEADING_1 }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [cell("Metric", true), cell("Value", true)] }),
          ...[
            ["Unit", overall.unit || "—"],
            ["Measured", overall.measDate || "—"],
            ["Point / Direction", `${overall.pointId || "—"} / ${overall.directionId || "—"}`],
            ["RMS D / V / A", `${overall.rmsD} / ${overall.rmsV} / ${overall.rmsA}`],
            ["Peak D / V / A", `${overall.peakD} / ${overall.peakV} / ${overall.peakA}`],
            ["Peak freq", String(overall.peakFreq)],
            ["Freq range / lines", `${overall.freqRange} / ${overall.noLines}`],
            ...extraRows,
          ].map(([k, v]) => new TableRow({ children: [cell(k), cell(v)] })),
        ],
      })
    );
    if (input.zones) {
      const z = classifyZone(overall.rmsV, input.zones.limits.velocity);
      children.push(
        new Paragraph(
          `This measurement: velocity zone ${z || "—"} (RMS-V ${overall.rmsV} against ${formatLimits(input.zones.limits.velocity)}).`
        )
      );
    }
  }

  children.push(
    new Paragraph({ text: sectionTitle(lang, "spectra"), heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new ImageRun({ data: png, transformation: { width: 600, height: 300 }, type: "png" }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: `${sectionTitle(lang, "data")} (${rows.length})`, heading: HeadingLevel.HEADING_1 }),
    table
  );

  if (!perMachineVib && input.zones && input.zones.rows.length > 0) {
    pushMeasuring(input.zones.limits, input.zones.rows);
  }

  if (input.trends && input.trends.sampleCount > 0) {
    const t = input.trends;
    const trendImg = (data: Uint8Array) =>
      new Paragraph({
        children: [
          new ImageRun({ data, transformation: { width: 600, height: 300 }, type: "png" }),
        ],
        alignment: AlignmentType.CENTER,
      });
    children.push(
      new Paragraph({ text: sectionTitle(lang, "trends"), heading: HeadingLevel.HEADING_1 }),
      new Paragraph(`Point ${t.pointLabel} · ${t.window} · ${t.sampleCount} samples.`),
      new Paragraph({ text: sectionTitle(lang, "velocity"), heading: HeadingLevel.HEADING_2 }),
      trendImg(t.velocityPng),
      new Paragraph({ text: sectionTitle(lang, "acceleration"), heading: HeadingLevel.HEADING_2 }),
      trendImg(t.accelPng)
    );
  }

  if (!perMachineVib && input.allTrends && input.allTrends.length > 0) {
    children.push(
      new Paragraph({ text: sectionTitle(lang, "trendsAll"), heading: HeadingLevel.HEADING_1 })
    );
    for (const t of input.allTrends.slice(0, 40)) {
      children.push(
        new Paragraph({ text: `${t.pointLabel} · ${t.sampleCount} samples`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [new ImageRun({ data: t.velocityPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [new ImageRun({ data: t.accelPng, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        }),
        ...(t.envelopePng
          ? [
              new Paragraph({ text: sectionTitle(lang, "envelope"), heading: HeadingLevel.HEADING_2 }),
              new Paragraph({
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
      new Paragraph({ text: sectionTitle(lang, "fft"), heading: HeadingLevel.HEADING_1 })
    );
    for (const g of input.fftGallery.slice(0, 24)) {
      children.push(
        new Paragraph({ text: g.peak ? `${g.label} · peak ${g.peak}` : g.label, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [new ImageRun({ data: g.png, transformation: { width: 600, height: 300 }, type: "png" })],
          alignment: AlignmentType.CENTER,
        })
      );
    }
  }

  if (d) {
    children.push(
      new Paragraph({ text: sectionTitle(lang, "methodology"), heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.methodology),
      new Paragraph({ text: sectionTitle(lang, "observations"), heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.observations),
      new Paragraph({ text: sectionTitle(lang, "recommendations"), heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.recommendations),
      new Paragraph({ text: sectionTitle(lang, "conclusion"), heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.conclusion)
    );
  }
  if (input.options.notes) {
    children.push(
      new Paragraph({ text: sectionTitle(lang, "notes"), heading: HeadingLevel.HEADING_1 }),
      new Paragraph(input.options.notes)
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
              new Paragraph({
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
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: c.text, bold: bold || c.bold, color: c.color, size: 16 })],
        }),
      ],
    });
  return [
    new Paragraph({ text: sectionTitle(lang, "iso"), heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
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
