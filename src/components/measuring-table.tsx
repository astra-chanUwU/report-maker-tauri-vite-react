import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { listFileRows, listTauriRows, type CsvRowSummary } from "../lib/mdb";
import { oleDateToISO } from "../lib/specdata";
import {
  classifyZone,
  limitsShort,
  ZONE_FILL,
  ZONE_LABELS,
  ZONE_TEXT,
  type ZoneLimitSet,
} from "../lib/zones";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { toast } from "./ui/sonner";

const DISPLAY_CAP = 200;

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

/**
 * Measuring-results table: one row per measurement of the export with its
 * velocity zone (from Overall RMS scalars — no spectrum decode needed).
 * Reports the full row list upward so export can embed it in the .docx.
 */
export function MeasuringTable({
  tauriPath,
  file,
  limits,
  onRows,
}: {
  tauriPath: string | null;
  file: File | null;
  limits: ZoneLimitSet;
  onRows?: (rows: CsvRowSummary[]) => void;
}) {
  const [rows, setRows] = useState<CsvRowSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tauriPath && !file) {
      setRows(null);
      onRows?.([]);
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

  if (!tauriPath && !file) return null;
  const shown = (rows ?? []).slice(0, DISPLAY_CAP);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" />
          Measuring results
        </CardTitle>
        <CardDescription>
          {loading
            ? "Reading…"
            : rows
              ? `${rows.length} measurements · V Zone (${limitsShort(limits.velocity)})`
              : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Point</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>RMS-V</TableHead>
              <TableHead>V Zone</TableHead>
              <TableHead>Peak</TableHead>
              <TableHead>@ Freq</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const zone = classifyZone(r.rmsV, limits.velocity);
              return (
                <TableRow key={r.index}>
                  <TableCell>{r.index + 1}</TableCell>
                  <TableCell>
                    {r.pointId || "?"} {r.directionId ? `/ ${r.directionId}` : ""}
                  </TableCell>
                  <TableCell>{formatRowDate(r.measDate)}</TableCell>
                  <TableCell>{r.rmsV || "—"}</TableCell>
                  <TableCell>
                    <ZoneBadge zone={zone} />
                  </TableCell>
                  <TableCell>{r.peakV || "—"}</TableCell>
                  <TableCell>{r.peakFreq || "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows && rows.length > DISPLAY_CAP ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing first {DISPLAY_CAP} of {rows.length} — the .docx export includes all.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
