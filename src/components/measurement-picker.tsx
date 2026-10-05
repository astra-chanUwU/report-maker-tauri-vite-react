import { useMemo, useState } from "react";
import { ListOrdered, Loader2, Search } from "lucide-react";
import type { ParseResult } from "../lib/parseSp3";
import { oleDateToISO } from "../lib/specdata";
import {
  loadFileRow,
  loadTauriRow,
  type CsvRowSummary,
} from "../lib/mdb";
import { cn } from "../lib/utils";
import { Panel } from "./ui/card";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";
import { translate } from "../lib/i18n";

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
  rows,
  loading,
  className,
}: {
  tauriPath: string | null;
  file: File | null;
  filename: string;
  current: PickerCurrent | null;
  onSelect: (r: ParseResult) => void;
  rows: CsvRowSummary[] | null;
  loading: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const matching = q
      ? rows.filter((r) =>
          [
            r.pointId,
            r.directionId,
            r.measDate,
            r.peakFreq,
            r.rmsV,
            oleDateToISO(Number(r.measDate)),
          ]
            .filter(Boolean)
            .some((s) => s.toLowerCase().includes(q))
        )
      : rows;
    return matching.slice(0, DISPLAY_CAP);
  }, [rows, query]);

  if (!tauriPath && !file) return null;

  const handleSelect = async (index: number) => {
    if (!rows || loading) return;
    setBusyIdx(index);
    try {
      const total = rows.length;
      const result = tauriPath
        ? await loadTauriRow(tauriPath, index, filename, total)
        : await loadFileRow(file!, filename, index, total);
      onSelect(result);
    } catch (e) {
      const lang = document.documentElement.lang === "fa" ? "fa" : "en";
      toast.error(
        e instanceof Error && e.message ? e.message : translate(lang as "fa" | "en", "toastCouldNotLoadMeasurement")
      );
    } finally {
      setBusyIdx(null);
    }
  };

  const langUi = (typeof document !== "undefined" && document.documentElement.lang === "fa" ? "fa" : "en") as "fa" | "en";
  return (
    <Panel
      icon={<ListOrdered />}
      title={translate(langUi, "featuredMeasurement")}
      description={
        loading
          ? translate(langUi, "featuredMeasurementLoading")
          : rows
            ? translate(langUi, "featuredMeasurementDesc", { count: rows.length.toLocaleString() })
            : ""
      }
      className={cn("flex min-h-0 flex-col", className)}
      contentClassName="flex min-h-0 flex-1 flex-col gap-2"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          className="ps-8"
          placeholder="Filter by point, date, peak…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter measurements"
        />
      </div>
      <ul
        className="min-h-40 flex-1 overflow-auto rounded-md border"
        aria-label="Measurements"
        aria-busy={loading}
      >
        {filtered.map((r) => {
          const active =
            current !== null && current.pointId === r.pointId && current.measDate === r.measDate;
          return (
            <li key={r.index} className="border-b last:border-b-0">
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                disabled={loading || busyIdx !== null}
                onClick={() => void handleSelect(r.index)}
                className={cn(
                  "grid w-full cursor-default grid-cols-[2.5rem_1fr_auto] items-center gap-2 px-2.5 py-1.5 text-start text-[13px] tabular-nums disabled:opacity-60",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/70 focus-visible:bg-muted/70"
                )}
              >
                <span className={cn("text-xs", active ? "opacity-80" : "text-muted-foreground")}>
                  {r.index + 1}
                </span>
                <span className="min-w-0 truncate">
                  <span className="font-medium">
                    Pt {r.pointId || "?"}
                    {r.directionId ? ` / ${r.directionId}` : ""}
                  </span>
                  <span className={active ? "opacity-80" : "text-muted-foreground"}>
                    {" "}
                    · {oleDateToISO(Number(r.measDate)) || "—"}
                  </span>
                </span>
                <span className={cn("text-xs", active ? "opacity-90" : "text-muted-foreground")}>
                  {busyIdx === r.index ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading" />
                  ) : (
                    `${r.peakV} @ ${r.peakFreq} ${r.unit}`
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {rows && filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">No matches.</li>
        ) : null}
      </ul>
      {rows && rows.length > DISPLAY_CAP && filtered.length >= DISPLAY_CAP ? (
        <p className="text-xs text-muted-foreground">
          Showing first {DISPLAY_CAP}. Type to filter the rest.
        </p>
      ) : null}
    </Panel>
  );
}
