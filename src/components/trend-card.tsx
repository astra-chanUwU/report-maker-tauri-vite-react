import React, { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import type { CsvRowSummary } from "../lib/mdb";
import { groupHistories, renderTrendPng, takeLastHistory } from "../lib/trends";
import { limitsShort, type ZoneLimitSet } from "../lib/zones";
import { Panel } from "./ui/card";
import { Segmented, Select } from "./ui/form";
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
  const prevRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!png) {
      if (prevRef.current) {
        URL.revokeObjectURL(prevRef.current);
        prevRef.current = null;
      }
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    const prev = prevRef.current;
    prevRef.current = next;
    setUrl(next);
    if (prev) URL.revokeObjectURL(prev);
  }, [png]);
  useEffect(() => {
    return () => {
      if (prevRef.current) {
        URL.revokeObjectURL(prevRef.current);
        prevRef.current = null;
      }
    };
  }, []);
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
  }, [history?.label, samples.length, velocityPng, accelPng, window]);

  if (histories.length === 0) return null;
  const first = samples[0]?.dateISO ?? "—";
  const last = samples[samples.length - 1]?.dateISO ?? "—";

  return (
    <Panel
      icon={<TrendingUp />}
      title="Vibration trends"
      description={`${history?.label} · ${samples.length} samples · ${first} → ${last}. The selected point and window go into the report.`}
      actions={
        <>
          <Label htmlFor="trend-point" className="sr-only">
            Measuring point
          </Label>
          <Select
            id="trend-point"
            className="w-auto min-w-40"
            value={activeLabel}
            onChange={(e) => setLabel(e.target.value)}
          >
            {histories.map((h) => (
              <option key={h.label} value={h.label}>
                {h.label} ({h.samples.length})
              </option>
            ))}
          </Select>
          <Segmented
            ariaLabel="Trend window"
            value={String(window)}
            onChange={(v) => setWindow(v === "all" ? "all" : (Number(v) as Window))}
            options={WINDOWS.map((w) => ({
              value: String(w),
              label: w === "all" ? "All" : `Last ${w}`,
            }))}
          />
        </>
      }
      contentClassName="grid gap-4 xl:grid-cols-2"
    >
      <figure className="grid content-start gap-1.5">
        <figcaption className="text-[13px] font-medium">
          Velocity RMS (mm/s){" "}
          <span className="font-normal text-muted-foreground">
            · zones {limitsShort(limits.velocity)}
          </span>
        </figcaption>
        {velUrl ? (
          <img
            src={velUrl}
            alt={`Velocity trend for ${history?.label}`}
            className="w-full rounded-md border bg-white"
          />
        ) : null}
      </figure>
      <figure className="grid content-start gap-1.5">
        <figcaption className="text-[13px] font-medium">
          Acceleration RMS{" "}
          <span className="font-normal text-muted-foreground">
            · zones {limitsShort(limits.acceleration)}
          </span>
        </figcaption>
        {accUrl ? (
          <img
            src={accUrl}
            alt={`Acceleration trend for ${history?.label}`}
            className="w-full rounded-md border bg-white"
          />
        ) : null}
      </figure>
    </Panel>
  );
}
