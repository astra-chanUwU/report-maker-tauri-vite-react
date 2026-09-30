import { useCallback, useRef, useState } from "react";
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

export function Ingest({
  onParsed,
  limits,
}: {
  onParsed?: (r: ParseResult | null, file?: File) => void;
  limits?: ZoneLimitSet;
}) {
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        let parsed: ParseResult;
        if (file.size > HEAD_SLICE) {
          // Giant exports (100s of MB): preview-parse the head only. The
          // measurement picker streams rows on demand, so nothing is lost.
          const head = parseSp3(
            new Uint8Array(await file.slice(0, HEAD_SLICE).arrayBuffer()),
            file.name
          );
          parsed =
            head.meta.source === "spec-csv"
              ? {
                  ...head,
                  meta: { ...head.meta, size: file.size, extraRows: undefined },
                  warning: undefined,
                }
              : parseSp3(new Uint8Array(await file.arrayBuffer()), file.name);
        } else {
          const buf = await file.arrayBuffer();
          parsed = parseSp3(new Uint8Array(buf), file.name);
        }
        setResult(parsed);
        onParsed?.(parsed, file);
      } catch (e) {
        setResult(null);
        onParsed?.(null);
        setError(e instanceof Error ? e.message : "Failed to parse file.");
      } finally {
        setLoading(false);
      }
    },
    [onParsed]
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Ingest .sp3</CardTitle>
          <CardDescription>Drop a file or pick one. Parsed locally via File API.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop .sp3 file here"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
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
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm transition-colors",
              dragging ? "border-primary bg-accent" : "hover:bg-accent/50"
            )}
          >
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <p>{loading ? "Parsing…" : "Drop .sp3 / .txt / .csv here, or click to browse"}</p>
            <Button variant="outline" size="sm" type="button">
              Browse files
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
