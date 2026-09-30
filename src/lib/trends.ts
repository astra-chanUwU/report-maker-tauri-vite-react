/**
 * Vibration trend histories per measuring point.
 *
 * Mirrors the legacy ReportMaker trend model (`reporting/charts.py`):
 * one history per (PointID, DirectionID), samples ordered by MeasDate,
 * velocity (TotalRMSV) plus the default secondary metric, acceleration
 * (TotalRMSA), with alarm zone bands behind the curve.
 *
 * The analyst chooses the window: everything, or the last N samples
 * (legacy default: last 10).
 */

import type { CsvRowSummary } from "./mdb";
import { oleDateToISO } from "./specdata";
import { encodePng, line } from "./png";
import { toLimit, trendZoneBands, type ZoneLimits } from "./zones";

export interface TrendSample {
  dateNum: number;
  dateISO: string;
  rmsV: number | null;
  rmsA: number | null;
  /** Envelope overall, when EnvelopeData was joined. */
  envelope?: number | null;
}

export interface PointHistory {
  pointId: string;
  directionId: string;
  label: string;
  samples: TrendSample[];
}

/** Group export rows into per-point histories, oldest first. */
export function groupHistories(rows: CsvRowSummary[]): PointHistory[] {
  const map = new Map<string, PointHistory>();
  for (const r of rows) {
    const dateNum = Number(r.measDate);
    if (!Number.isFinite(dateNum) || dateNum <= 0) continue;
    const pointId = (r.pointId || "?").trim();
    const directionId = (r.directionId || "").trim();
    const key = `${pointId} ${directionId}`;
    let h = map.get(key);
    if (!h) {
      h = {
        pointId,
        directionId,
        label: directionId ? `${pointId} / ${directionId}` : pointId,
        samples: [],
      };
      map.set(key, h);
    }
    h.samples.push({
      dateNum,
      dateISO: oleDateToISO(dateNum) || String(dateNum),
      rmsV: toLimit(r.rmsV),
      rmsA: toLimit(r.rmsA),
      envelope: toLimit(r.envelopeRms ?? ""),
    });
  }
  const out = [...map.values()];
  for (const h of out) h.samples.sort((a, b) => a.dateNum - b.dateNum);
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

export interface HistoryStat {
  total: string;
  avg: string;
  prev: string;
  curr: string;
}

function fmtStat(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(3).replace(/\.?0+$/, "");
}

/** Brochure columns: Total = latest overall, Avg, Prev, Curr. */
export function historyStats(samples: TrendSample[], metric: "rmsV" | "rmsA" | "envelope"): HistoryStat {
  const vals = samples
    .map((s) => (metric === "envelope" ? (s.envelope ?? null) : s[metric]))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length === 0) return { total: "—", avg: "—", prev: "—", curr: "—" };
  const curr = vals[vals.length - 1];
  const prev = vals.length > 1 ? vals[vals.length - 2] : null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { total: fmtStat(curr), avg: fmtStat(avg), prev: fmtStat(prev), curr: fmtStat(curr) };
}

/** Window the history: "all" or the last N samples (legacy default 10). */
export function takeLastHistory(samples: TrendSample[], n: number | "all"): TrendSample[] {
  if (n === "all" || !Number.isFinite(n) || n <= 0) return samples;
  return samples.slice(Math.max(0, samples.length - Math.floor(n)));
}

/** Batch builder for "export all points" (brochure p.6): one V+A PNG pair per point. */
export function buildAllTrendSnapshots(
  histories: PointHistory[],
  limits: { velocity: ZoneLimits; acceleration: ZoneLimits; envelope?: ZoneLimits },
  window: number | "all",
  capPoints = 40,
  includeEnvelope = false
): {
  pointLabel: string;
  sampleCount: number;
  velocityPng: Uint8Array;
  accelPng: Uint8Array;
  envelopePng?: Uint8Array;
}[] {
  const out: {
    pointLabel: string;
    sampleCount: number;
    velocityPng: Uint8Array;
    accelPng: Uint8Array;
    envelopePng?: Uint8Array;
  }[] = [];
  for (const h of histories.slice(0, Math.max(1, capPoints))) {
    const samples = takeLastHistory(h.samples, window);
    if (samples.length === 0) continue;
    try {
      out.push({
        pointLabel: h.label,
        sampleCount: samples.length,
        velocityPng: renderTrendPng(samples, "rmsV", limits.velocity),
        accelPng: renderTrendPng(samples, "rmsA", limits.acceleration),
        envelopePng:
          includeEnvelope && samples.some((s) => s.envelope != null)
            ? renderTrendPng(samples, "envelope", limits.envelope ?? limits.acceleration)
            : undefined,
      });
    } catch {
      // skip undecodable histories — single-point export still works
    }
  }
  return out;
}

/** Y-axis top: data headroom plus room for thresholds (mirrors trend_chart_y_limits). */
export function trendYMax(values: (number | null)[], limits: ZoneLimits): number {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const dataMax = finite.length ? Math.max(...finite) : 0;
  const cands = [0.1, dataMax * 1.1];
  for (const t of [limits.bottom, limits.mid, limits.top]) {
    if (t !== null && t > 0) cands.push(t * 1.05);
  }
  return Math.max(...cands);
}

function hexRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** Mix a zone color toward white (our RGB PNG has no alpha). */
function lighten(hex: string, towardWhite: number): [number, number, number] {
  const [r, g, b] = hexRgb(hex);
  const m = (c: number) => Math.round(c + (255 - c) * towardWhite);
  return [m(r), m(g), m(b)];
}

export interface TrendChartOpts {
  width?: number;
  height?: number;
  /** Tight margins, no grid — for the measuring-table sparkline. */
  sparkline?: boolean;
}

/**
 * Render a trend PNG: zone bands + RMS polyline + sample dots.
 * Gaps (null samples) break the line, like the legacy exporter.
 */
export function renderTrendPng(
  samples: TrendSample[],
  metric: "rmsV" | "rmsA" | "envelope",
  limits: ZoneLimits,
  opts: TrendChartOpts = {}
): Uint8Array {
  const spark = opts.sparkline === true;
  const w = opts.width ?? (spark ? 120 : 800);
  const h = opts.height ?? (spark ? 36 : 400);
  const buf = new Uint8Array(w * h * 3);
  buf.fill(255);
  const L = spark ? 2 : 46;
  const R = spark ? 2 : 12;
  const T = spark ? 2 : 12;
  const B = spark ? 2 : 34;
  const plotW = w - L - R;
  const plotH = h - T - B;

  const values = samples.map((s) => (metric === "envelope" ? (s.envelope ?? null) : s[metric]));
  const yMax = trendYMax(values, limits);
  const bands = trendZoneBands(limits, 0, yMax);
  const px = (i: number) =>
    samples.length < 2 ? L + plotW / 2 : Math.round(L + (i / (samples.length - 1)) * plotW);
  const py = (v: number) => Math.round(T + plotH - (Math.min(v, yMax) / yMax) * plotH);

  for (const b of bands) {
    const y0 = py(Math.min(b.y1, yMax));
    const y1 = py(Math.max(b.y0, 0));
    const [r, g, bl] = lighten(b.color, 0.72);
    for (let y = y0; y <= y1; y++) line(buf, w, h, L, y, w - R - 1, y, [r, g, bl]);
  }
  if (!spark) {
    for (let gx = 0; gx <= plotW; gx += 80)
      line(buf, w, h, L + gx, T, L + gx, T + plotH, [229, 231, 235]);
    for (let gy = 0; gy <= plotH; gy += 40)
      line(buf, w, h, L, T + gy, w - R - 1, T + gy, [229, 231, 235]);
    line(buf, w, h, L, T, L, T + plotH, [17, 24, 39]);
    line(buf, w, h, L, T + plotH, w - R - 1, T + plotH, [17, 24, 39]);
  }
  // date ticks: first / middle / last
  if (!spark && samples.length > 0) {
    for (const i of [0, Math.floor((samples.length - 1) / 2), samples.length - 1]) {
      const x = px(i);
      line(buf, w, h, x, T + plotH, x, T + plotH + 5, [17, 24, 39]);
    }
  }
  // polyline with gaps
  const ink: [number, number, number] =
    metric === "rmsV" ? [37, 99, 235] : metric === "envelope" ? [22, 163, 74] : [180, 83, 9];
  let prev: { x: number; y: number } | null = null;
  samples.forEach((s, i) => {
    const v = metric === "envelope" ? (s.envelope ?? null) : s[metric];
    if (v === null) {
      prev = null;
      return;
    }
    const x = px(i);
    const y = py(v);
    if (prev) line(buf, w, h, prev.x, prev.y, x, y, ink);
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 9) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = (yy * w + xx) * 3;
        buf[k] = ink[0];
        buf[k + 1] = ink[1];
        buf[k + 2] = ink[2];
      }
    prev = { x, y };
  });
  return encodePng(buf, w, h);
}
