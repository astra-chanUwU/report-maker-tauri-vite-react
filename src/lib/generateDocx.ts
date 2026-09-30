import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { computeStats, type ReportOptions, type SpectraPoint, type Sp3Meta } from "./parseSp3";
import { encodePng, line, setPixel } from "./png";
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
}

export interface MeasuringCell {
  text: string;
  fill?: string;
  color?: string;
  bold?: boolean;
}

/** Pure data builder for the measuring-results table (tested without unzipping). */
export function buildMeasuringTableData(
  rows: MeasureRow[],
  limits: ZoneLimitSet
): { header: string[]; body: MeasuringCell[][] } {
  const header = [
    "Point",
    "Date",
    "RMS-V",
    `V Zone (${limitsShort(limits.velocity)})`,
    "RMS-A",
    `A Zone (${limitsShort(limits.acceleration)})`,
    "Peak",
    "@ Freq",
  ];
  const body = rows.map((r) => {
    const zoneV = classifyZone(r.rms, limits.velocity);
    const zoneA = classifyZone(r.rmsA, limits.acceleration);
    return [
      { text: r.point || "?" },
      { text: r.date || "—" },
      { text: r.rms || "—" },
      { text: zoneV || "—", fill: ZONE_FILL[zoneV], color: ZONE_TEXT[zoneV], bold: true },
      { text: r.rmsA || "—" },
      { text: zoneA || "—", fill: ZONE_FILL[zoneA], color: ZONE_TEXT[zoneA], bold: true },
      { text: r.peak || "—" },
      { text: r.peakFreq || "—" },
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
  };
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
  let peak = pts[0];
  for (const p of pts) if (p.amp > peak.amp) peak = p;
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
  const cx = px(peak.freq);
  const cy = py(peak.amp);
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy <= 16) setPixel(buf, w, CHART_H, cx + dx, cy + dy, 220, 38, 38);
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

/** §3 equipment page: name + technical specs + machine schematic (when provided). */
function equipmentSection(eq?: BuildDocxInput["equipment"]): (Paragraph | Table)[] {
  const name = eq?.name?.trim() ?? "";
  const specs = eq?.specs?.trim() ?? "";
  const schema = eq?.schematic?.data?.length ? eq.schematic : undefined;
  if (!name && !specs && !schema) return [];
  const out: (Paragraph | Table)[] = [
    new Paragraph({ text: "Equipment", heading: HeadingLevel.HEADING_1 }),
  ];
  if (name) {
    out.push(new Paragraph({ text: name, heading: HeadingLevel.HEADING_2 }));
  }
  if (specs) {
    out.push(new Paragraph({ text: "Technical specifications", heading: HeadingLevel.HEADING_2 }));
    for (const para of specs.split(/\n\s*\n/)) {
      const t = para.trim();
      if (t) out.push(new Paragraph(t));
    }
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

  const children: (Paragraph | Table)[] = [
    ...headerChildren,
    ...equipmentSection(input.equipment),
    new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
    new Paragraph(
      d?.summary ?? `Peak ${stats.peak.amp} at ${stats.peak.freq}. ${stats.spectra_points} points.`
    ),
  ];

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
      new Paragraph({ text: "Overall vibration", heading: HeadingLevel.HEADING_1 }),
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
    new Paragraph({ text: "Spectra chart", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new ImageRun({ data: png, transformation: { width: 600, height: 300 }, type: "png" }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: `Data (first ${rows.length})`, heading: HeadingLevel.HEADING_1 }),
    table
  );

  if (input.zones && input.zones.rows.length > 0) {
    const { header, body } = buildMeasuringTableData(input.zones.rows, input.zones.limits);
    const mcell = (c: MeasuringCell, bold = false) =>
      new TableCell({
        ...(c.fill ? { shading: { type: ShadingType.CLEAR, fill: c.fill, color: "auto" } } : {}),
        children: [
          new Paragraph({
            children: [new TextRun({ text: c.text, bold: bold || c.bold, color: c.color })],
          }),
        ],
      });
    children.push(
      new Paragraph({ text: "Measuring results", heading: HeadingLevel.HEADING_1 }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: header.map((t) => mcell({ text: t }, true)) }),
          ...body.map((r) => new TableRow({ children: r.map((c) => mcell(c)) })),
        ],
      })
    );
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
      new Paragraph({ text: "Vibration trends", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(`Point ${t.pointLabel} · ${t.window} · ${t.sampleCount} samples.`),
      new Paragraph({ text: "Velocity RMS trend", heading: HeadingLevel.HEADING_2 }),
      trendImg(t.velocityPng),
      new Paragraph({ text: "Acceleration RMS trend", heading: HeadingLevel.HEADING_2 }),
      trendImg(t.accelPng)
    );
  }

  if (d) {
    children.push(
      new Paragraph({ text: "Methodology", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.methodology),
      new Paragraph({ text: "Observations", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.observations),
      new Paragraph({ text: "Recommendations", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.recommendations),
      new Paragraph({ text: "Conclusion", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(d.conclusion)
    );
  }
  if (input.options.notes) {
    children.push(
      new Paragraph({ text: "Notes", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(input.options.notes)
    );
  }

  if (input.options.includeIsoTable !== false) {
    children.push(...buildIsoSection());
  }

  if (input.branding?.signature && input.branding.signature.data.length > 0) {
    const sig = input.branding.signature;
    children.push(
      new Paragraph({ text: "Approval", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new ImageRun({
            data: sig.data,
            transformation: { width: 200, height: 200 },
            type: sig.kind ?? detectImageKind(sig.data),
          }),
        ],
      }),
      new Paragraph(
        `Engineer: ${input.options.engineer || "—"}    Date: ${input.options.reportDate || "—"}`
      )
    );
  }

  const doc = input.branding?.cover?.data?.length
    ? new Document({
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
    : new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

/** ISO 10816-3 severity reference table (mirrors the legacy appendix). */
function buildIsoSection(): (Paragraph | Table)[] {
  const { rows } = buildIsoTableData();
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
    new Paragraph({ text: "ISO 10816-3 standards", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Vibration severity limits by machinery group, mounting, and rated power",
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
