import { useEffect, useMemo, useState } from "react";
import { ListOrdered, Search } from "lucide-react";
import type { ParseResult } from "../lib/parseSp3";
import { oleDateToISO } from "../lib/specdata";
import {
  listFileRows,
  listTauriRows,
  loadFileRow,
  loadTauriRow,
  type CsvRowList,
} from "../lib/mdb";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";

const DISPLAY_CAP = 200;

export interface PickerCurrent {
  pointId: string;
  measDate: string;
}

/** Choose which measurement of a multi-row export becomes the report. */
export function MeasurementPicker({
  tauriPath,
  file,
  filename,
  current,
  onSelect,
}: {
  tauriPath: string | null;
  file: File | null;
  filename: string;
  current: PickerCurrent | null;
  onSelect: (r: ParseResult) => void;
}) {
  const [list, setList] = useState<CsvRowList | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!tauriPath && !file) {
      setList(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const load = tauriPath ? listTauriRows(tauriPath) : listFileRows(file!);
    load
      .then((l) => alive && setList(l))
      .catch(
        (e) => alive && toast.error(e instanceof Error ? e.message : "Could not list measurements.")
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tauriPath, file]);

  const filtered = useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();
    const rows = q
      ? list.rows.filter((r) =>
          [r.pointId, r.directionId, r.measDate, r.peakFreq, r.rmsV].some((s) =>
            s.toLowerCase().includes(q)
          )
        )
      : list.rows;
    return rows.slice(0, DISPLAY_CAP);
  }, [list, query]);

  if (!tauriPath && !file) return null;

  const handleSelect = async (index: number) => {
    if (!list) return;
    setBusyIdx(index);
    try {
      const total = list.rows.length;
      const result = tauriPath
        ? await loadTauriRow(tauriPath, index, filename, total)
        : await loadFileRow(file!, filename, index, total);
      onSelect(result);
      toast.success(
        `Loaded measurement ${index + 1} (Point ${result.meta.overall?.pointId || "?"})`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load measurement.");
    } finally {
      setBusyIdx(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListOrdered className="h-4 w-4" />
          Measurements
        </CardTitle>
        <CardDescription>
          {loading
            ? "Reading…"
            : list
              ? `${list.rows.length} in this export — pick one for the report.`
              : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Filter by point, date, peak…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {list && list.rows.length > DISPLAY_CAP && filtered.length >= DISPLAY_CAP ? (
          <p className="text-xs text-muted-foreground">
            Showing first {DISPLAY_CAP} — refine the filter.
          </p>
        ) : null}
        <ul className="grid max-h-72 gap-1 overflow-auto">
          {filtered.map((r) => {
            const active =
              current !== null && current.pointId === r.pointId && current.measDate === r.measDate;
            return (
              <li key={r.index}>
                <Button
                  variant={active ? "default" : "ghost"}
                  className="h-auto w-full justify-start py-1.5 font-normal"
                  disabled={busyIdx !== null}
                  onClick={() => void handleSelect(r.index)}
                >
                  <span className="w-10 shrink-0 text-xs text-muted-foreground">
                    #{r.index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left text-sm">
                    Pt {r.pointId || "?"} · {oleDateToISO(Number(r.measDate)) || "—"} · peak{" "}
                    {r.peakV} @ {r.peakFreq} {r.unit}
                  </span>
                  {busyIdx === r.index ? <span className="text-xs">…</span> : null}
                </Button>
              </li>
            );
          })}
        </ul>
        {list && filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
