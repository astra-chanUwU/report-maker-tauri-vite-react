import { useCallback, useRef, useState } from "react";
import { useUi } from "../lib/i18n";
import { FileUp, TriangleAlert } from "lucide-react";
import { parseSp3, type ParseResult } from "../lib/parseSp3";
import { cn } from "../lib/utils";
import { classifyZone, ZONE_LABELS, type ZoneLimitSet } from "../lib/zones";
import { ZoneBadge } from "./measuring-table";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { SpectraChart } from "./spectra-chart";

const ACCEPT = ".sp3,.txt,.csv";

/** Head slice for huge files: enough for header + first rows (Spec path needs ~200KB). */
const HEAD_SLICE = 4 * 1024 * 1024;
/** Above this, never buffer the whole file — first-row-only or error. */
const FULL_BUFFER_GUARD = 50 * 1024 * 1024;

export function Ingest({
  onParsed,
  limits,
}: {
  onParsed?: (r: ParseResult | null, file?: File) => void;
  limits?: ZoneLimitSet;
}) {
  const { t } = useUi();
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setError(null);
      setLoading(true);
      try {
        if (ctrl.signal.aborted) return;
        let parsed: ParseResult;
        if (file.size > HEAD_SLICE) {
          const headBuf = await file.slice(0, HEAD_SLICE).arrayBuffer();
          if (ctrl.signal.aborted) return;
          const head = parseSp3(new Uint8Array(headBuf), file.name);
          if (head.meta.source === "spec-csv") {
            parsed = {
              ...head,
              meta: { ...head.meta, size: file.size, extraRows: undefined },
              warning: undefined,
            };
          } else if (file.size > FULL_BUFFER_GUARD) {
            // Never buffer 50MB+ non-CSV into RAM — would OOM in WebView.
            throw new Error(
              `File is ${(file.size / 1024 / 1024).toFixed(0)} MB and not a Data-table CSV export. Split or export one row per file (mdb-export file.sp3 Data > data.csv) then drop the CSV. Showing preview skipped to avoid out-of-memory.`
            );
          } else {
            const buf = await file.arrayBuffer();
            if (ctrl.signal.aborted) return;
            parsed = parseSp3(new Uint8Array(buf), file.name);
          }
        } else {
          const buf = await file.arrayBuffer();
          if (ctrl.signal.aborted) return;
          parsed = parseSp3(new Uint8Array(buf), file.name);
        }
        if (ctrl.signal.aborted) return;
        setResult(parsed);
        onParsed?.(parsed, file);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        const msg =
          e instanceof Error
            ? e.message.includes("out of memory") ||
              e.message.includes("Array buffer allocation failed")
              ? "File too large to preview in the browser — use the desktop app's 'Open .sp3 file' or export one row per CSV."
              : e.message
            : "Failed to parse file.";
        setResult(null);
        onParsed?.(null);
        setError(msg);
      } finally {
        if (abortRef.current === ctrl) setLoading(false);
      }
    },
    [onParsed]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setError("Cancelled.");
  }, []);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("ingestTitle")}</CardTitle>
          <CardDescription>Drop a file or pick one. Parsed locally via File API.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop .sp3, .txt or .csv file here — press Enter or Space to browse"
            aria-busy={loading}
            onClick={() => !loading && inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragging ? "border-primary bg-accent" : "hover:bg-accent/50"
            )}
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p aria-live="polite">
              {loading
                ? "Parsing… large files preview first row only."
                : "Drop .sp3 / .txt / .csv here, or click to browse"}
            </p>
            <Button variant="outline" size="sm" type="button" tabIndex={-1} aria-hidden="true">
              Browse files
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-hidden="true"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
          {loading ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground" aria-live="polite" aria-busy="true">
                Reading file…
              </p>
              <Button variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert" aria-live="assertive">
              {error}
            </p>
          ) : null}
          {!result && !error ? (
            <p className="text-sm text-muted-foreground">No file loaded yet. Try the demo below.</p>
          ) : null}
          {!result ? (
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void handleFile(
                    new File(["100,0.42\n200,0.87\n300,1.31\n400,0.95\n"], "demo.sp3", {
                      type: "text/plain",
                    })
                  )
                }
              >
                Load demo fixture
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {result ? <IngestPreview result={result} limits={limits} /> : null}
    </div>
  );
}

export function IngestPreview({ result, limits }: { result: ParseResult; limits?: ZoneLimitSet }) {
  const rows = result.spectra.slice(0, 80);
  const overall = result.meta.overall;
  const zone = overall && limits ? classifyZone(overall.rmsV, limits.velocity) : "";
  const sourceLabel =
    result.meta.source === "spec-csv"
      ? "spec csv"
      : result.meta.source === "mdb"
        ? "jet mdb (preview only)"
        : result.meta.source;
  return (
    <div className="grid gap-4">
      {result.warning ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{result.warning}</p>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{result.meta.filename}</CardTitle>
          <CardDescription>
            {formatBytes(result.meta.size)} · {result.stats.spectra_points} points · source{" "}
            {sourceLabel} · freq {result.stats.freq_min}–{result.stats.freq_max} · amp{" "}
            {result.stats.amp_min}–{result.stats.amp_max} · peak {result.stats.peak.amp} @{" "}
            {result.stats.peak.freq}
            {overall
              ? ` · ${overall.unit || "units"} · meas ${overall.measDate || "—"} · RMS-V ${overall.rmsV} · peak-V ${overall.peakV} @ ${overall.peakFreq}`
              : ""}
            {result.meta.extraRows ? ` · +${result.meta.extraRows} more measurements in file` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {zone ? (
            <p className="mb-2 flex items-center gap-2 text-sm">
              <ZoneBadge zone={zone} />
              <span className="text-muted-foreground">
                Velocity · {ZONE_LABELS[zone as keyof typeof ZONE_LABELS]} (RMS-V {overall?.rmsV})
              </span>
            </p>
          ) : null}
          <SpectraChart spectra={result.spectra} />
          <p className="mt-2 text-xs text-muted-foreground">
            Showing first {rows.length} of {result.spectra.length} rows
            {result.spectra.length > 500 ? " (chart downsampled to 500)" : ""}.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spectra table</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Freq</TableHead>
                <TableHead>Amp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p, i) => (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{p.freq}</TableCell>
                  <TableCell>{p.amp}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
