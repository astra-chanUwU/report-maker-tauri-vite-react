import type { MeasurePeak, MeasureRow } from "./generateDocx";
import type { CsvRowSummary } from "./mdb";
import { SECONDARY_SERIES, type SecondaryMetric } from "./metrics";
import { oleDateToISO } from "./specdata";
import type { SpectraPoint } from "./parseSp3";
import { findDominantPeaks } from "./spectra-peaks";
import {
  groupHistories,
  historyStats,
  sampleValue,
  takeLastHistory,
  type PointHistory,
} from "./trends";
import type { ZoneLimitSet } from "./zones";

export function rowsForPoints(
  rows: CsvRowSummary[],
  pointIds: string[] | undefined
): CsvRowSummary[] {
  if (!pointIds || pointIds.length === 0) return rows;
  const set = new Set(pointIds.map(String));
  return rows.filter((r) => set.has(String(r.pointId)));
}

/** One row per point+direction: the latest MeasDate. */
export function latestPerPoint(rows: CsvRowSummary[]): CsvRowSummary[] {
  const best = new Map<string, CsvRowSummary>();
  for (const r of rows) {
    const key = `${r.pointId} ${r.directionId}`;
    const prev = best.get(key);
    if (!prev || Number(r.measDate) >= Number(prev.measDate)) best.set(key, r);
  }
  return [...best.values()];
}

function labelOf(row: CsvRowSummary, labels?: Record<string, string>): string {
  const key = `${row.pointId} ${row.directionId}`.trim();
  return labels?.[key] || `${row.pointId || "?"}${row.directionId ? ` / ${row.directionId}` : ""}`;
}

function fmt(v: number, digits: number): string {
  return v.toFixed(digits).replace(/\.?0+$/, "") || "0";
}

/** Peak List column: the strongest spectrum lines as RPM (Hz × 60) + amplitude. */
export function peaksFromSpectrum(spectra: SpectraPoint[], count = 4): MeasurePeak[] {
  // Below ~3 Hz is sensor drift / DC leakage, not a machine line
  return findDominantPeaks(spectra, count, 3)
    .sort((a, b) => b.amp - a.amp)
    .map((p) => ({ rpm: String(Math.round(p.freq * 60)), amp: fmt(p.amp, 3) }));
}

/** FFT caption: "0.47 mm/s @ 1500 RPM". */
export function formatSpectrumPeak(peak: { freq: number; amp: number }, unit = "mm/s"): string {
  if (!Number.isFinite(peak.amp) || !Number.isFinite(peak.freq) || peak.amp <= 0) return "";
  return `${peak.amp.toFixed(2)} ${unit} @ ${Math.round(peak.freq * 60)} RPM`;
}

/** Fallback when the spectrum blob was not loaded: the DB's max-peak columns. */
function peakFromSummary(r: CsvRowSummary): MeasurePeak[] {
  const hz = Number(r.peakFreq);
  const amp = Number(r.peakV);
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(amp)) return [];
  return [{ rpm: String(Math.round(hz * 60)), amp: fmt(amp, 3) }];
}

export interface MeasureRowOpts {
  /** Second metric beside velocity (default acceleration). */
  secondary?: SecondaryMetric;
  /** Retained for compatibility with the preview/table callers (default on). */
  bands?: boolean;
}

const _bmWeak = new WeakMap<CsvRowSummary[], Map<string, MeasureRow[]>>();
const _bmMap = new Map<string, MeasureRow[]>();
const _BM_MAX = 24;

function bmCacheKey(rows: CsvRowSummary[], limits: ZoneLimitSet, window: number | "all", withSparks: boolean, opts: MeasureRowOpts, labels?: Record<string, string>): string {
  const first = rows[0];
  const last = rows[rows.length - 1];
  return `${rows.length}|${window}|${withSparks}|${opts.secondary ?? "acceleration"}|${opts.bands ?? true}|${JSON.stringify(limits)}|${first?.pointId ?? ""}:${first?.measDate ?? ""}|${last?.pointId ?? ""}:${last?.measDate ?? ""}|${labels ? Object.keys(labels).length : 0}`;
}

export function buildMeasureRows(
  rows: CsvRowSummary[],
  limits: ZoneLimitSet,
  window: number | "all" = 10,
  labels?: Record<string, string>,
  withSparks = true,
  opts: MeasureRowOpts = {}
): MeasureRow[] {
  const secondary = opts.secondary ?? "acceleration";
  const series = SECONDARY_SERIES[secondary];
  const _cacheKey = bmCacheKey(rows, limits, window, withSparks, opts, labels);
  const _weakInner = _bmWeak.get(rows);
  if (_weakInner?.has(_cacheKey)) return _weakInner.get(_cacheKey)!;
  if (_bmMap.has(_cacheKey)) return _bmMap.get(_cacheKey)!;
  const histories = groupHistories(rows);
  const byKey = new Map<string, PointHistory>(
    histories.map((h) => [`${h.pointId} ${h.directionId}`, h])
  );
  // Database order (P1 V, P1 H, P1 A, P2 V …), like the Spectra tree and the legacy report
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : Infinity);
  const latest = latestPerPoint(rows).sort(
    (a, b) =>
      num(a.pointId) - num(b.pointId) ||
      num(a.directionId) - num(b.directionId) ||
      labelOf(a, labels).localeCompare(labelOf(b, labels))
  );
  const _result = latest.map((r) => {
    const h = byKey.get(`${r.pointId} ${r.directionId}`);
    const samples = h ? takeLastHistory(h.samples, window) : [];
    const v = historyStats(samples, "rmsV");
    const a = historyStats(samples, series);
    // Keep the source samples as data. The DOCX builder turns these into
    // native Word charts; raster sparklines cannot be edited in Word.
    const trendCategories = samples.length > 1 ? samples.map((s) => s.dateISO) : undefined;
    const trendValuesV = trendCategories
      ? samples.map((s) => sampleValue(s, "rmsV"))
      : undefined;
    const trendValuesA = trendCategories
      ? samples.map((s) => sampleValue(s, series))
      : undefined;
    const peaks = peakFromSummary(r);
    return {
      key: `${r.pointId} ${r.directionId}`,
      point: labelOf(r, labels),
      date: oleDateToISO(Number(r.measDate)) || "—",
      rms: r.rmsV,
      rmsA: a.curr === "—" ? "" : a.curr,
      peak: r.peakV,
      peakFreq: r.peakFreq,
      totalV: v.total,
      avgV: v.avg,
      prevV: v.prev,
      currV: v.curr,
      totalA: a.total,
      avgA: a.avg,
      prevA: a.prev,
      currA: a.curr,
      peaks,
      trendCategories,
      trendValuesV,
      trendValuesA,
    };
  });
  let _inner = _bmWeak.get(rows);
  if (!_inner) { _inner = new Map(); _bmWeak.set(rows, _inner); }
  _inner.set(_cacheKey, _result);
  _bmMap.set(_cacheKey, _result);
  if (_bmMap.size > _BM_MAX) { const _first = _bmMap.keys().next().value as string | undefined; if (_first) _bmMap.delete(_first); }
  return _result;
}
