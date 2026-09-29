import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { computeStats, type ReportOptions, type SpectraPoint, type Sp3Meta } from "./parseSp3";
import { getTemplate } from "./templates";

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
  branding?: { logoPng?: Uint8Array };
  templateId?: string;
}

const CHART_W = 800;
const CHART_H = 400;

function setPixel(
  buf: Uint8Array,
  w: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number
) {
  if (x < 0 || y < 0 || x >= w || y >= CHART_H) return;
  const i = (y * w + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

function line(
  buf: Uint8Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number]
) {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(buf, w, x, y, rgb[0], rgb[1], rgb[2]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

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
  for (let gx = 0; gx <= w; gx += 80) line(buf, w, gx, 0, gx, CHART_H - 1, [229, 231, 235]);
  for (let gy = 0; gy < CHART_H; gy += 40) line(buf, w, 0, gy, w - 1, gy, [229, 231, 235]);
  // axes
  line(buf, w, 40, 0, 40, CHART_H - 30, [17, 24, 39]);
  line(buf, w, 40, CHART_H - 30, w - 10, CHART_H - 30, [17, 24, 39]);

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
      if (dx * dx + dy * dy <= 16) setPixel(buf, w, cx + dx, cy + dy, 220, 38, 38);
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

/** Pure-JS PNG encoder (single IDAT, stored deflate — no zlib dep, WebView-safe). */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  // zlib wrapper with stored (uncompressed) blocks
  const blocks: number[] = [0x78, 0x01];
  let pos = 0;
  while (pos < raw.length) {
    const n = Math.min(65535, raw.length - pos);
    const final = pos + n >= raw.length ? 1 : 0;
    blocks.push(final); // BFINAL + BTYPE 00
    blocks.push(n & 0xff, (n >>> 8) & 0xff, ~n & 0xff, (~n >>> 8) & 0xff);
    for (let i = 0; i < n; i++) blocks.push(raw[pos + i]);
    pos += n;
  }
  const ad = adler32(raw);
  blocks.push((ad >>> 24) & 0xff, (ad >>> 16) & 0xff, (ad >>> 8) & 0xff, ad & 0xff);
  const zlib = new Uint8Array(blocks);

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
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
    new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
    new Paragraph(
      d?.summary ?? `Peak ${stats.peak.amp} at ${stats.peak.freq}. ${stats.spectra_points} points.`
    ),
  ];

  const overall = input.meta.overall;
  if (overall) {
    const cell = (t: string, bold = false) =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] });
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
          ].map(([k, v]) => new TableRow({ children: [cell(k), cell(v)] })),
        ],
      })
    );
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

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
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
