import type { MeasureRow } from "./generateDocx";
import type { CsvRowSummary } from "./mdb";
import { oleDateToISO } from "./specdata";
import {
  groupHistories,
  historyStats,
  renderTrendPng,
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

export function buildMeasureRows(
  rows: CsvRowSummary[],
  limits: ZoneLimitSet,
  window: number | "all" = 10,
  labels?: Record<string, string>,
  withSparks = true
): MeasureRow[] {
  const histories = groupHistories(rows);
  const byKey = new Map<string, PointHistory>(
    histories.map((h) => [`${h.pointId} ${h.directionId}`, h])
  );
  const latest = latestPerPoint(rows);
  return latest.map((r) => {
    const h = byKey.get(`${r.pointId} ${r.directionId}`);
    const samples = h ? takeLastHistory(h.samples, window) : [];
    const v = historyStats(samples, "rmsV");
    const a = historyStats(samples, "rmsA");
    let sparkV: Uint8Array | undefined;
    let sparkA: Uint8Array | undefined;
    if (withSparks && samples.length > 1) {
      try {
        sparkV = renderTrendPng(samples, "rmsV", limits.velocity, { sparkline: true });
        sparkA = renderTrendPng(samples, "rmsA", limits.acceleration, { sparkline: true });
      } catch {
        sparkV = undefined;
        sparkA = undefined;
      }
    }
    return {
      point: labelOf(r, labels),
      date: oleDateToISO(Number(r.measDate)) || "—",
      rms: r.rmsV,
      rmsA: r.rmsA,
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
      peakList: r.peakV || r.peakFreq ? `${r.peakV || "—"} @ ${r.peakFreq || "—"}` : "—",
      sparkV,
      sparkA,
    };
  });
}
