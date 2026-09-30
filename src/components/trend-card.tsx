import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import type { CsvRowSummary } from "../lib/mdb";
import { groupHistories, renderTrendPng, takeLastHistory } from "../lib/trends";
import { limitsShort, type ZoneLimitSet } from "../lib/zones";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";

export interface TrendSnapshot {
  pointLabel: string;
  sampleCount: number;
  window: string;
  velocityPng: Uint8Array;
  accelPng: Uint8Array;
}

const WINDOWS = [10, 25, 50, "all"] as const;
type Window = (typeof WINDOWS)[number];

function usePngUrl(png: Uint8Array | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!png) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [png]);
  return url;
}

/**
 * Per-point vibration trends (velocity + acceleration) with alarm zone bands.
 * Works off the export row summaries — no spectrum decode needed.
 * Reports rendered PNGs upward so export can embed them in the .docx.
 */
export function TrendCard({
  rows,
  limits,
  onSnapshot,
}: {
  rows: CsvRowSummary[];
  limits: ZoneLimitSet;
  onSnapshot?: (snap: TrendSnapshot | null) => void;
}) {
  const histories = useMemo(() => groupHistories(rows), [rows]);
  const [label, setLabel] = useState<string>("");
  const [window, setWindow] = useState<Window>(10);

  const activeLabel = label || histories[0]?.label || "";
  const history = histories.find((h) => h.label === activeLabel) ?? histories[0];
  const samples = useMemo(
    () => (history ? takeLastHistory(history.samples, window) : []),
    [history, window]
  );
  const velocityPng = useMemo(
    () => (samples.length ? renderTrendPng(samples, "rmsV", limits.velocity) : null),
    [samples, limits.velocity]
  );
  const accelPng = useMemo(
    () => (samples.length ? renderTrendPng(samples, "rmsA", limits.acceleration) : null),
    [samples, limits.acceleration]
  );
  const velUrl = usePngUrl(velocityPng);
  const accUrl = usePngUrl(accelPng);

  useEffect(() => {
    if (!history || !velocityPng || !accelPng) {
      onSnapshot?.(null);
      return;
    }
    onSnapshot?.({
      pointLabel: history.label,
      sampleCount: samples.length,
      window: window === "all" ? "all data" : `last ${window}`,
      velocityPng,
      accelPng,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history?.label, samples.length, velocityPng, accelPng, window]);

  if (histories.length === 0) return null;
  const first = samples[0]?.dateISO ?? "—";
  const last = samples[samples.length - 1]?.dateISO ?? "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Vibration trends
        </CardTitle>
        <CardDescription>
          {history?.label} · {samples.length} samples · {first} → {last}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="grid gap-1">
            <Label htmlFor="trend-point">Measuring point</Label>
            <select
              id="trend-point"
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              value={activeLabel}
              onChange={(e) => setLabel(e.target.value)}
            >
              {histories.map((h) => (
                <option key={h.label} value={h.label}>
                  {h.label} ({h.samples.length})
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="trend-window">Window</Label>
            <select
              id="trend-window"
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              value={String(window)}
              onChange={(e) =>
                setWindow(e.target.value === "all" ? "all" : (Number(e.target.value) as Window))
              }
            >
              {WINDOWS.map((w) => (
                <option key={String(w)} value={String(w)}>
                  {w === "all" ? "All data" : `Last ${w}`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <figure className="grid gap-1">
          <figcaption className="text-sm font-medium">
            Velocity RMS (mm/s) · zones {limitsShort(limits.velocity)}
          </figcaption>
          {velUrl ? (
            <img
              src={velUrl}
              alt={`Velocity trend for ${history?.label}`}
              className="w-full rounded border bg-white"
            />
          ) : null}
        </figure>
        <figure className="grid gap-1">
          <figcaption className="text-sm font-medium">
            Acceleration RMS · zones {limitsShort(limits.acceleration)}
          </figcaption>
          {accUrl ? (
            <img
              src={accUrl}
              alt={`Acceleration trend for ${history?.label}`}
              className="w-full rounded border bg-white"
            />
          ) : null}
        </figure>
      </CardContent>
    </Card>
  );
}
