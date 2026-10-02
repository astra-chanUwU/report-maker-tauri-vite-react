import { useMemo } from "react";
import { AlertTriangle, Clock3, TrendingUp, Activity } from "lucide-react";
import type { EquipmentItem } from "../lib/equipment";
import type { CsvRowSummary } from "../lib/mdb";
import { latestPerPoint } from "../lib/report-slices";
import { classifyZone, type ZoneLimitSet, type ZoneResult } from "../lib/zones";
import { filenameOf } from "../lib/import-jobs";
import { Panel } from "./ui/card";
import { Badge } from "./ui/form";
import { ZoneBadge } from "./measuring-table";

const RANK: Record<ZoneResult, number> = { "": 0, A: 1, B: 2, U: 3, C: 4 };
const STALE_DAYS = 60;
const OLE_EPOCH_MS = Date.UTC(1899, 11, 30);

function oleToMs(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return OLE_EPOCH_MS + n * 86400000;
}

export function DiagnosticsPanel({
  rows,
  equipments,
  limits,
}: {
  rows: CsvRowSummary[] | null;
  equipments: EquipmentItem[];
  limits: ZoneLimitSet;
}) {
  const facts = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const latest = latestPerPoint(rows);
    const byPointId = new Map<string, CsvRowSummary[]>();
    for (const r of rows) {
      const arr = byPointId.get(r.pointId);
      if (arr) arr.push(r);
      else byPointId.set(r.pointId, [r]);
    }
    // sort each point's rows by date to find prev
    for (const arr of byPointId.values()) arr.sort((a, b) => Number(a.measDate) - Number(b.measDate));

    let worst: ZoneResult = "";
    let breachCount = 0;
    let jumpCount = 0;
    let staleCount = 0;
    const nowMs = Date.now();
    const staleCut = nowMs - STALE_DAYS * 86400000;
    for (const r of latest) {
      const lim = equipments.find((e) => e.pointIds?.includes(r.pointId))?.limits ?? limits;
      const z = classifyZone(r.rmsV, lim.velocity);
      if (RANK[z] > RANK[worst]) worst = z;
      if (RANK[z] >= RANK.B) breachCount++;
      const arr = byPointId.get(r.pointId);
      if (arr && arr.length >= 2) {
        const prev = arr[arr.length - 2];
        const prevLim = equipments.find((e) => e.pointIds?.includes(prev.pointId))?.limits ?? limits;
        const prevZ = classifyZone(prev.rmsV, prevLim.velocity);
        if (RANK[z] > RANK[prevZ]) jumpCount++;
      }
      const ms = oleToMs(r.measDate);
      if (ms > 0 && ms < staleCut) staleCount++;
    }
    const distinctDbs = new Set(equipments.map((e) => filenameOf(e.sp3Path ?? "")).filter(Boolean)).size;
    return { latestCount: latest.length, worst, breachCount, jumpCount, staleCount, distinctDbs, totalRows: rows.length };
  }, [rows, equipments, limits]);

  if (!facts) {
    return (
      <Panel icon={<Activity />} title="Diagnostics" description="Open a database to see health checks." />
    );
  }
  return (
    <Panel
      icon={<Activity />}
      title="Diagnostics"
      description={`${facts.latestCount} points · worst zone ${facts.worst || "A"} · ${facts.breachCount} above A`}
      contentClassName="grid gap-3"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Needs attention</p>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              {facts.breachCount > 0 ? <ZoneBadge zone={facts.worst} /> : null}
              {facts.breachCount} of {facts.latestCount} points
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Jumped a zone since prev</p>
            <p className="text-sm font-semibold">{facts.jumpCount} points</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Stale (&gt;{STALE_DAYS}d)</p>
            <p className="text-sm font-semibold">{facts.staleCount} points</p>
          </div>
        </div>
      </div>
      {facts.distinctDbs > 1 ? (
        <p className="text-xs text-muted-foreground">
          <Badge tone="neutral">{facts.distinctDbs} databases</Badge> in report — grouped by file in the machine list.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {facts.totalRows.toLocaleString()} measurements in the open database. Use Readings → Only B/U/C to isolate.
      </p>
    </Panel>
  );
}
