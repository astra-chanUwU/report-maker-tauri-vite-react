/**
 * Integrated perf thresholds + tiny harness.
 * Documents the tunables introduced by the 4-track perf work and exposes
 * a `timed` helper so future work can log before/after without duplication.
 */

export const PERF_THRESHOLDS = {
  /** File.size > 50 MiB → CSV parse offloaded to Worker (src/lib/mdb.ts, src/workers/csv-worker.ts). */
  csvWorkerThresholdBytes: 50 * 1024 * 1024,
  /** Worker hangs → terminate after 30s. */
  csvWorkerTimeoutMs: 30_000,
  /** Rust export_mdb_csv progress Channel throttled to ~250ms / 2 MiB (src-tauri/src/mdb.rs). */
  mdbProgressThrottleMs: 250,
  mdbProgressThrottleBytes: 2 * 1024 * 1024,
  /** Measuring table switches to virtualized window when rows > 100 (src/components/measuring-table.tsx). */
  virtualThresholdRows: 100,
  virtualOverscanRows: 8,
  /** Head preview limit for 1.5 GiB guard in csv-stream. */
  csvMaxBytes: 1536 * 1024 * 1024,
} as const;

export interface TimedResult<T> {
  result: T;
  elapsedMs: number;
}

export async function timed<T>(fn: () => Promise<T> | T): Promise<TimedResult<T>> {
  const t0 = performance.now();
  const result = await fn();
  return { result, elapsedMs: performance.now() - t0 };
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
