import React, { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import type { CsvRowSummary } from "../lib/mdb";
import { groupHistories, renderTrendPng, sampleValue, takeLastHistory } from "../lib/trends";
import { limitsShort, type ZoneLimitSet } from "../lib/zones";
import type { TrendMetric } from "../lib/metrics";
import { useUi } from "../lib/i18n";
import { Panel } from "./ui/card";
import { Segmented, Select } from "./ui/form";
import { Label } from "./ui/label";

export interface TrendSnapshot {
  pointLabel: string;
  sampleCount: number;
  window: string;
  secondaryMetric: TrendMetric;
  velocityPng: Uint8Array;
  accelPng: Uint8Array;
  velocityCategories: string[];
  velocityValues: (number | null)[];
  accelCategories: string[];
  accelValues: (number | null)[];
  velocityLimits?: import("../lib/zones").ZoneLimits;
  accelLimits?: import("../lib/zones").ZoneLimits;
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
  secondaryMetric = "rmsA",
  onSnapshot,
}: {
  rows: CsvRowSummary[];
  limits: ZoneLimitSet;
  secondaryMetric?: TrendMetric;
  onSnapshot?: (snap: TrendSnapshot | null) => void;
}) {
  const { t } = useUi();
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
    () =>
      samples.length
        ? renderTrendPng(
            samples,
            secondaryMetric,
            secondaryMetric === "envelope" ? (limits.envelope ?? limits.acceleration) : limits.acceleration
          )
        : null,
    [samples, limits.acceleration, limits.envelope, secondaryMetric]
  );
  const velUrl = usePngUrl(velocityPng);
  const accUrl = usePngUrl(accelPng);

  useEffect(() => {
    if (!history || !velocityPng || !accelPng) {
      onSnapshot?.(null);
      return;
    }
    const velocityCategories = samples.map((s) => s.dateISO);
    const velocityValues = samples.map((s) => sampleValue(s, "rmsV"));
    const accelCategories = samples.map((s) => s.dateISO);
    const accelValues = samples.map((s) => sampleValue(s, secondaryMetric));
    onSnapshot?.({
      pointLabel: history.label,
      sampleCount: samples.length,
      window: window === "all" ? "all data" : `last ${window}`,
      secondaryMetric,
      velocityPng,
      accelPng,
      velocityCategories,
      velocityValues,
      accelCategories,
      accelValues,
      velocityLimits: limits.velocity,
      accelLimits: secondaryMetric === "envelope" ? (limits.envelope ?? limits.acceleration) : limits.acceleration,
    });
  }, [history?.label, samples.length, velocityPng, accelPng, window, secondaryMetric, limits.velocity, limits.acceleration, limits.envelope]);

  if (histories.length === 0) return null;
  const first = samples[0]?.dateISO ?? "—";
  const last = samples[samples.length - 1]?.dateISO ?? "—";

  return (
    <Panel
      icon={<TrendingUp />}
      title={t("vibrationTrends")}
      description={t("trendDesc", { label: history?.label ?? "", count: samples.length, first, last })}
      actions={
        <>
          <Label htmlFor="trend-point" className="sr-only">
            {t("measuringPoint")}
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
            ariaLabel={t("trendWindow")}
            value={String(window)}
            onChange={(v) => setWindow(v === "all" ? "all" : (Number(v) as Window))}
            options={WINDOWS.map((w) => ({
              value: String(w),
              label: w === "all" ? t("segmentAll") : t("lastN", { n: w }),
            }))}
          />
        </>
      }
      contentClassName="grid gap-3 xl:grid-cols-2"
    >
      <figure className="grid content-start gap-1.5">
        <figcaption className="text-[13px] font-medium">
          {t("velocityRms")}{" "}
          <span className="font-normal text-muted-foreground">
            · {t("zonesLabel", { zones: limitsShort(limits.velocity) })}
          </span>
        </figcaption>
        {velUrl ? (
          <img
            src={velUrl}
            alt={`Velocity trend for ${history?.label}`}
            className="w-full rounded border bg-white"
          />
        ) : null}
      </figure>
      <figure className="grid content-start gap-1.5">
        <figcaption className="text-xs font-medium">
          {t("accelerationRms")}{" "}
          <span className="font-normal text-muted-foreground">
            · {t("zonesLabel", { zones: limitsShort(limits.acceleration) })}
          </span>
        </figcaption>
        {accUrl ? (
          <img
            src={accUrl}
            alt={`Acceleration trend for ${history?.label}`}
            className="w-full rounded border bg-white"
          />
        ) : null}
      </figure>
    </Panel>
  );
}
