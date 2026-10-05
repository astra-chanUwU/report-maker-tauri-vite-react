import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Search } from "lucide-react";
import type { EquipmentItem } from "../lib/equipment";
import {
  applyEnvelopeSamples,
  fetchEnvelopeSamples,
  listFileRows,
  listTauriRowsPaged,
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
import { sp3Filename } from "../lib/equipment";
import { Panel } from "./ui/card";
import { Badge, CheckRow, Stat } from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";
import { translate } from "../lib/i18n";

export function formatRowDate(raw: string): string {
  return oleDateToISO(Number(raw)) || "—";
}

/** Zone badge with the legacy palette. */
export const ZoneBadge = memo(function ZoneBadge({ zone, label }: { zone: string; label?: string }) {
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
});

const RANK: Record<ZoneResult, number> = { "": 0, A: 1, B: 2, U: 3, C: 4 };

const ROW_HEIGHT = 36;
const VIRTUAL_THRESHOLD = 100;
const VIRTUAL_OVERSCAN = 8;

interface MeasuringRowProps {
  point: string;
  date: string;
  rms: string | undefined;
  prevV?: string;
  currV?: string;
  zv: ZoneResult;
  rmsA: string | undefined;
  za: ZoneResult;
  peakFreq: string;
  peak: string;
  rowKey: string | undefined;
}

const MeasuringRow = memo(function MeasuringRow({
  point, date, rms, prevV, currV, zv, rmsA, za, peakFreq, peak, rowKey,
}: MeasuringRowProps) {
  const peakText = formatSpectrumPeak({ freq: Number(peakFreq), amp: Number(peak) });
  const trend = prevV && prevV !== "—" && Number(currV) > Number(prevV) * 1.25;
  return (
    <tr key={rowKey} className="border-t first:border-t-0 hover:bg-muted/40">
      <td className="px-3 py-1.5 font-medium">{point}</td>
      <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{date}</td>
      <td className="px-2 py-1.5 text-end tabular-nums">
        <span className="font-medium">{num(rms)}</span>
        {prevV && prevV !== "—" ? (
          <span className={cn("ms-1.5 text-xs", trend ? "text-destructive" : "text-muted-foreground")} title="Previous reading">
            prev {num(prevV)}
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1.5 text-center"><ZoneBadge zone={zv} /></td>
      <td className="px-2 py-1.5 text-end font-medium tabular-nums">{num(rmsA)}</td>
      <td className="px-2 py-1.5 text-center">{rmsA ? <ZoneBadge zone={za} /> : null}</td>
      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{peakText || "—"}</td>
    </tr>
  );
});

function VirtualizedRows({ lines, sec }: { lines: { r: ReturnType<typeof buildMeasureRows>[number]; zv: ZoneResult; za: ZoneResult; worst: ZoneResult }[]; sec: ReturnType<typeof secondaryLabels> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);
  useEffect(() => {
    if (ref.current) setViewport(ref.current.clientHeight || 400);
  }, [lines.length]);
  const total = lines.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const visibleCount = Math.ceil(viewport / ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
  const end = Math.min(total, start + visibleCount);
  const slice = lines.slice(start, end);
  const padTop = start * ROW_HEIGHT;
  const padBottom = (total - end) * ROW_HEIGHT;
  return (
    <div ref={ref} onScroll={onScroll} className="max-h-[480px] overflow-auto" style={{ contain: "strict" }}>
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="w-24 bg-background px-3 py-1.5 text-start font-medium">Point</th>
            <th className="w-28 bg-background px-2 py-1.5 text-start font-medium">Measured</th>
            <th className="bg-background px-2 py-1.5 text-end font-medium">Velocity</th>
            <th className="w-14 bg-background px-2 py-1.5 text-center font-medium">V</th>
            <th className="bg-background px-2 py-1.5 text-end font-medium">{sec.short}</th>
            <th className="w-14 bg-background px-2 py-1.5 text-center font-medium">{sec.zone.replace(" Zone", "")}</th>
            <th className="bg-background px-3 py-1.5 text-start font-medium">Main peak</th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 ? <tr><td colSpan={7} style={{ height: padTop }} aria-hidden="true" /></tr> : null}
          {slice.map(({ r, zv, za }) => (
            <MeasuringRow key={r.key ?? r.point} rowKey={r.key} point={r.point} date={r.date} rms={r.rms} prevV={r.prevV} currV={r.currV} zv={zv} rmsA={r.rmsA} za={za} peakFreq={r.peakFreq} peak={r.peak} />
          ))}
          {padBottom > 0 ? <tr><td colSpan={7} style={{ height: padBottom }} aria-hidden="true" /></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function num(v: string | undefined, digits = 2): string {
  const n = Number(v);
  return v && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

interface Group {
  id: string;
  title: string;
  sub: string;
  fullPath: string;
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
    const run = async () => {
      try {
        const l = tauriPath
          ? await listTauriRowsPaged(tauriPath, 2500, (n) => {
              // progressive hint while paging large exports; final set below wins
              if (alive && n % 5000 === 0) {
                // keep loading true but allow event loop to breathe
              }
            })
          : await listFileRows(file!);
        if (!alive) return;
        setRows(l.rows);
        onRows?.(l.rows);
      } catch (e) {
        if (alive) {
          const lang = document.documentElement.lang === "fa" ? "fa" : "en";
          toast.error(
            e instanceof Error && e.message
              ? e.message
              : translate(lang as "fa" | "en", "toastCouldNotLoadMeasurements")
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
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
  }, [secondary, isTauri, sp3Path, rows]);

  const source = secondary === "envelope" && envelope ? envelope.rows : (rows ?? []);
  const sec = secondaryLabels(secondary, "en", envUnit);

  const groups: Group[] = useMemo(() => {
    const linked = equipments.filter((e) => (e.pointIds?.length ?? 0) > 0);
    if (linked.length === 0) {
      return [{ id: "all", title: "All measuring points", sub: "", fullPath: "", limits, rows: source }];
    }
    return linked.map((e) => ({
      id: e.id,
      title: e.name || "Machine",
      sub: [e.plant, sp3Filename(e.sp3Path)].filter(Boolean).join(" · "),
      fullPath: e.sp3Path ?? "",
      limits: e.limits ?? limits,
      rows: rowsForPoints(source, e.pointIds),
      labels: e.labels,
    }));
  }, [equipments, limits, source]);

  const q = query.trim().toLowerCase();
  const [built, setBuilt] = useState<ReturnType<typeof buildGroups> | null>(null);
  function buildGroups() {
    return groups.map((g) => {
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
  }
  // Chunked build to avoid blocking the main thread on the last 10% for large imports
  useEffect(() => {
    let cancelled = false;
    const CHUNK = 400;
    const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
    // small datasets: keep synchronous path to avoid flicker
    if (totalRows < 2000) {
      setBuilt(buildGroups());
      return;
    }
    // large datasets: yield between groups
    const run = async () => {
      const out: ReturnType<typeof buildGroups> = [];
      for (const g of groups) {
        if (cancelled) return;
        // allow paint / app switch between groups
        await new Promise<void>((r) => setTimeout(r, 0));
        if (cancelled) return;
        const all = buildMeasureRows(g.rows, g.limits, 10, g.labels, false, { secondary });
        const lines: (typeof out)[number]["lines"] = [];
        for (let i = 0; i < all.length; i += CHUNK) {
          const slice = all.slice(i, i + CHUNK);
          for (const r of slice) {
            const zv = classifyZone(r.rms, g.limits.velocity);
            const za = classifyZone(r.rmsA, secondaryLimits(g.limits, secondary));
            const worst = RANK[zv] >= RANK[za] ? zv : za;
            if (alarmsOnly && RANK[worst] < RANK.B) continue;
            if (q && !`${g.title} ${r.point}`.toLowerCase().includes(q)) continue;
            lines.push({ r, zv, za, worst });
          }
          if (i + CHUNK < all.length) await new Promise<void>((r) => setTimeout(r, 0));
          if (cancelled) return;
        }
        out.push({ g, lines });
      }
      if (!cancelled) setBuilt(out);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [groups, secondary, q, alarmsOnly]);

  const displayBuilt = built ?? (groups.reduce((n, g) => n + g.rows.length, 0) < 2000 ? buildGroups() : []);
  const total = displayBuilt.reduce((n, b) => n + b.lines.length, 0);

  if (!rows && !loading) return null;

  const langUi = document.documentElement.lang === "fa" ? "fa" : "en";
  return (
    <Panel
      icon={<Gauge />}
      title={translate(langUi as "fa" | "en", "latestReadings")}
      description={
        loading
          ? translate(langUi as "fa" | "en", "featuredMeasurementLoading")
          : translate(langUi as "fa" | "en", "latestReadingsDesc", {
              metric: sec.short.toLowerCase(),
              unit: sec.unit,
            })
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
              placeholder={translate(langUi as "fa" | "en", "filterPointsPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter points"
            />
          </div>
          <CheckRow
            className="py-1"
            checked={alarmsOnly}
            onChange={setAlarmsOnly}
            label={translate(langUi as "fa" | "en", "onlyAlarms")}
          />
        </div>
      }
      contentClassName="grid gap-4"
    >
      {displayBuilt.map(({ g, lines }) =>
        lines.length === 0 && (q || alarmsOnly) ? null : (
          <section key={g.id} className="overflow-hidden rounded-md border">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b bg-muted/50 px-3 py-2">
              <h3 className="text-[13px] font-semibold">{g.title}</h3>
              {g.sub ? <span className="text-xs text-muted-foreground" title={g.fullPath || g.sub}>{g.sub}</span> : null}
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                V {formatLimits(g.limits.velocity)} · {sec.short}{" "}
                {formatLimits(secondaryLimits(g.limits, secondary))}
              </span>
            </header>
            {lines.length === 0 ? (
              <p className="px-3 py-4 text-[13px] text-muted-foreground">
                {translate(langUi as "fa" | "en", "noReadingsForMachine")}
              </p>
            ) : lines.length > VIRTUAL_THRESHOLD ? (
              <VirtualizedRows lines={lines} sec={sec} />
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
                  {lines.map(({ r, zv, za }) => (
                    <MeasuringRow key={r.key ?? r.point} rowKey={r.key} point={r.point} date={r.date} rms={r.rms} prevV={r.prevV} currV={r.currV} zv={zv} rmsA={r.rmsA} za={za} peakFreq={r.peakFreq} peak={r.peak} />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      )}
      {total === 0 && (q || alarmsOnly) ? (
        <p className="text-center text-[13px] text-muted-foreground">
          {translate(langUi as "fa" | "en", "noPointsMatch")}
        </p>
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
