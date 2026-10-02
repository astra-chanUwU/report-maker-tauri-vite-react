import { useEffect, useMemo, useState } from "react";
import { Gauge, Search } from "lucide-react";
import type { EquipmentItem } from "../lib/equipment";
import {
  applyEnvelopeSamples,
  fetchEnvelopeSamples,
  listFileRows,
  listTauriRows,
  type CsvRowSummary,
} from "../lib/mdb";
import { secondaryLabels, secondaryLimits, type SecondaryMetric } from "../lib/metrics";
import {
  buildMeasureRows,
  formatSpectrumPeak,
  latestPerPoint,
  rowsForPoints,
} from "../lib/report-slices";
import { oleDateToISO } from "../lib/specdata";
import {
  classifyZone,
  formatLimits,
  ZONE_FILL,
  ZONE_LABELS,
  ZONE_TEXT,
  type ZoneLimitSet,
  type ZoneResult,
} from "../lib/zones";
import { cn } from "../lib/utils";
import { Panel } from "./ui/card";
import { Badge, CheckRow, Stat } from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";

export function formatRowDate(raw: string): string {
  return oleDateToISO(Number(raw)) || "—";
}

/** Zone badge with the legacy palette. */
export function ZoneBadge({ zone, label }: { zone: string; label?: string }) {
  const z = zone as keyof typeof ZONE_FILL;
  return (
    <span
      className="inline-block min-w-6 rounded px-1.5 py-0.5 text-center text-xs font-bold"
      style={{
        backgroundColor: `#${ZONE_FILL[z] ?? ZONE_FILL[""]}`,
        color: `#${ZONE_TEXT[z] ?? ZONE_TEXT[""]}`,
      }}
      title={label ?? (ZONE_LABELS as Record<string, string>)[zone] ?? ""}
    >
      {zone || "—"}
    </span>
  );
}

const RANK: Record<ZoneResult, number> = { "": 0, A: 1, B: 2, U: 3, C: 4 };

function num(v: string | undefined, digits = 2): string {
  const n = Number(v);
  return v && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

interface Group {
  id: string;
  title: string;
  sub: string;
  limits: ZoneLimitSet;
  rows: CsvRowSummary[];
  labels?: Record<string, string>;
}

/** Loads every measurement row of the open database and reports it upward for export. */
export function useMeasureRows(
  tauriPath: string | null,
  file: File | null,
  onRows?: (rows: CsvRowSummary[] | null) => void
) {
  const [rows, setRows] = useState<CsvRowSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!tauriPath && !file) {
      setRows(null);
      onRows?.(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const load = tauriPath ? listTauriRows(tauriPath) : listFileRows(file!);
    load
      .then((l) => {
        if (!alive) return;
        setRows(l.rows);
        onRows?.(l.rows);
      })
      .catch((e) => {
        if (alive) toast.error(e instanceof Error ? e.message : "Could not load measurements.");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauriPath, file]);
  return { rows, loading };
}

/**
 * Latest reading per point, grouped by report machine, with velocity and the chosen
 * secondary metric classified against each machine's own alarm limits.
 */
export function MeasuringTable({
  rows,
  loading,
  limits,
  equipments,
  secondary,
  sp3Path,
  isTauri,
}: {
  rows: CsvRowSummary[] | null;
  loading: boolean;
  limits: ZoneLimitSet;
  equipments: EquipmentItem[];
  secondary: SecondaryMetric;
  sp3Path: string | null;
  isTauri: boolean;
}) {
  const [query, setQuery] = useState("");
  const [alarmsOnly, setAlarmsOnly] = useState(false);
  const [envelope, setEnvelope] = useState<{ path: string; rows: CsvRowSummary[] } | null>(null);
  const [envUnit, setEnvUnit] = useState("gEN");

  useEffect(() => {
    if (secondary !== "envelope" || !isTauri || !sp3Path || !rows) return;
    if (envelope?.path === sp3Path && envelope.rows.length === rows.length) return;
    let alive = true;
    fetchEnvelopeSamples(sp3Path)
      .then((samples) => {
        if (!alive) return;
        const copy = rows.map((r) => ({ ...r }));
        applyEnvelopeSamples(copy, samples);
        const unit = samples.find((s) => s.unit)?.unit;
        if (unit) setEnvUnit(unit);
        setEnvelope({ path: sp3Path, rows: copy });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondary, isTauri, sp3Path, rows]);

  const source = secondary === "envelope" && envelope ? envelope.rows : (rows ?? []);
  const sec = secondaryLabels(secondary, "en", envUnit);

  const groups: Group[] = useMemo(() => {
    const linked = equipments.filter((e) => (e.pointIds?.length ?? 0) > 0);
    if (linked.length === 0) {
      return [{ id: "all", title: "All measuring points", sub: "", limits, rows: source }];
    }
    return linked.map((e) => ({
      id: e.id,
      title: e.name || "Machine",
      sub: e.plant ?? "",
      limits: e.limits ?? limits,
      rows: rowsForPoints(source, e.pointIds),
      labels: e.labels,
    }));
  }, [equipments, limits, source]);

  const q = query.trim().toLowerCase();
  const built = groups.map((g) => {
    const all = buildMeasureRows(g.rows, g.limits, 10, g.labels, false, { secondary });
    const lines = all
      .map((r) => {
        const zv = classifyZone(r.rms, g.limits.velocity);
        const za = classifyZone(r.rmsA, secondaryLimits(g.limits, secondary));
        return { r, zv, za, worst: RANK[zv] >= RANK[za] ? zv : za };
      })
      .filter((l) => !alarmsOnly || RANK[l.worst] >= RANK.B)
      .filter((l) => !q || `${g.title} ${l.r.point}`.toLowerCase().includes(q));
    return { g, lines };
  });

  const total = built.reduce((n, b) => n + b.lines.length, 0);

  if (!rows && !loading) return null;

  return (
    <Panel
      icon={<Gauge />}
      title="Latest readings"
      description={
        loading
          ? "Reading measurements…"
          : `Most recent value of every point, as printed in the measuring-results table. Velocity in mm/s; ${sec.short.toLowerCase()} in ${sec.unit}.`
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-52">
            <Search
              className="pointer-events-none absolute start-2.5 top-2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="ps-8"
              placeholder="Filter points…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter points"
            />
          </div>
          <CheckRow
            className="py-1"
            checked={alarmsOnly}
            onChange={setAlarmsOnly}
            label="Only B / U / C"
          />
        </div>
      }
      contentClassName="grid gap-4"
    >
      {built.map(({ g, lines }) =>
        lines.length === 0 && (q || alarmsOnly) ? null : (
          <section key={g.id} className="overflow-hidden rounded-md border">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b bg-muted/50 px-3 py-2">
              <h3 className="text-[13px] font-semibold">{g.title}</h3>
              {g.sub ? <span className="text-xs text-muted-foreground">{g.sub}</span> : null}
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                V {formatLimits(g.limits.velocity)} · {sec.short}{" "}
                {formatLimits(secondaryLimits(g.limits, secondary))}
              </span>
            </header>
            {lines.length === 0 ? (
              <p className="px-3 py-4 text-[13px] text-muted-foreground">
                No readings for this machine's points in the open database.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="w-24 px-3 py-1.5 text-start font-medium">Point</th>
                    <th className="w-28 px-2 py-1.5 text-start font-medium">Measured</th>
                    <th className="px-2 py-1.5 text-end font-medium">Velocity</th>
                    <th className="w-14 px-2 py-1.5 text-center font-medium">V</th>
                    <th className="px-2 py-1.5 text-end font-medium">{sec.short}</th>
                    <th className="w-14 px-2 py-1.5 text-center font-medium">
                      {sec.zone.replace(" Zone", "")}
                    </th>
                    <th className="px-3 py-1.5 text-start font-medium">Main peak</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(({ r, zv, za }) => {
                    const peak = formatSpectrumPeak({
                      freq: Number(r.peakFreq),
                      amp: Number(r.peak),
                    });
                    const trend =
                      r.prevV && r.prevV !== "—" && Number(r.currV) > Number(r.prevV) * 1.25;
                    return (
                      <tr key={r.key} className="border-t first:border-t-0 hover:bg-muted/40">
                        <td className="px-3 py-1.5 font-medium">{r.point}</td>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{r.date}</td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          <span className="font-medium">{num(r.rms)}</span>
                          {r.prevV && r.prevV !== "—" ? (
                            <span
                              className={cn(
                                "ms-1.5 text-xs",
                                trend ? "text-destructive" : "text-muted-foreground"
                              )}
                              title="Previous reading"
                            >
                              prev {num(r.prevV)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <ZoneBadge zone={zv} />
                        </td>
                        <td className="px-2 py-1.5 text-end font-medium tabular-nums">
                          {num(r.rmsA)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {r.rmsA ? <ZoneBadge zone={za} /> : null}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                          {peak || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )
      )}
      {total === 0 && (q || alarmsOnly) ? (
        <p className="text-center text-[13px] text-muted-foreground">No points match.</p>
      ) : null}
    </Panel>
  );
}

/** Compact facts about the open database: size, coverage and current condition. */
export function DatabaseSummary({
  rows,
  limits,
}: {
  rows: CsvRowSummary[] | null;
  limits: ZoneLimitSet;
}) {
  const facts = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    let min = Infinity;
    let max = 0;
    const points = new Set<string>();
    for (const r of rows) {
      const d = Number(r.measDate);
      if (Number.isFinite(d) && d > 0) {
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
      points.add(r.pointId);
    }
    const counts: Record<ZoneResult, number> = { "": 0, A: 0, B: 0, U: 0, C: 0 };
    const latest = latestPerPoint(rows);
    for (const r of latest) counts[classifyZone(r.rmsV, limits.velocity)]++;
    return {
      total: rows.length,
      points: points.size,
      directions: latest.length,
      first: Number.isFinite(min) ? oleDateToISO(min) : "",
      last: max > 0 ? oleDateToISO(max) : "",
      counts,
    };
  }, [rows, limits]);

  if (!facts) return null;
  const alarms = facts.counts.B + facts.counts.U + facts.counts.C;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Measurements" value={facts.total.toLocaleString()} />
      <Stat
        label="Measuring points"
        value={facts.points.toLocaleString()}
        sub={`${facts.directions.toLocaleString()} point directions`}
      />
      <Stat
        label="Period"
        value={facts.last || "—"}
        sub={facts.first && facts.first !== facts.last ? `since ${facts.first}` : undefined}
      />
      <Stat
        label="Latest velocity zones"
        value={
          <span className="flex items-center gap-1.5">
            {(["A", "B", "U", "C"] as const).map((z) =>
              facts.counts[z] > 0 ? (
                <span key={z} className="flex items-center gap-1 text-sm font-medium">
                  <ZoneBadge zone={z} />
                  {facts.counts[z]}
                </span>
              ) : null
            )}
          </span>
        }
        sub={
          alarms > 0 ? (
            <Badge tone="warning">
              {alarms} of {facts.directions} above A · default limits
            </Badge>
          ) : (
            "All in zone A · default limits"
          )
        }
      />
    </div>
  );
}
