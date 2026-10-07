import { useCallback, useEffect, useRef, useState } from "react";
import {
  DatabaseZap,
  FileUp,
  FlaskConical,
  Loader2,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useUi } from "../lib/i18n";
import { detectJetMdb } from "../lib/specdata";
import { parseSp3, type ParseResult } from "../lib/parseSp3";
import {
  convertSp3FromDisk,
  convertSp3Path,
  isTauriRuntime,
  loadTauriCsvPath,
  mdbToolStatus,
  type MdbToolStatus,
} from "../lib/mdb";
import { classifyZone, ZONE_LABELS, type ZoneLimitSet } from "../lib/zones";
import { ZoneBadge } from "./measuring-table";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Stat } from "./ui/form";
import { SpectraChart } from "./spectra-chart";
import { toast } from "./ui/sonner";

export const INGEST_ACCEPT = ".sp3,.txt,.csv";

/** Head slice for huge files: enough for header + first rows (Spec path needs ~200KB). */
const HEAD_SLICE = 4 * 1024 * 1024;
/** Above this, never buffer the whole file — first-row-only or error. */
const FULL_BUFFER_GUARD = 50 * 1024 * 1024;

export type OnParsed = (r: ParseResult | null, file?: File | null) => void;

export interface Ingest {
  loading: boolean;
  error: string | null;
  isTauri: boolean;
  tool: MdbToolStatus | null;
  handleFile: (file: File) => Promise<void>;
  handlePath: (path: string) => Promise<void>;
  openSp3: () => Promise<void>;
  loadDemo: () => void;
  cancel: () => void;
  refreshTool: () => void;
}

/** Every way data enters the app (browse, drop, native drop, mdb-export) funnels through here. */
export function useIngest(onParsed: OnParsed): Ingest {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isTauri, setIsTauri] = useState(false);
  const [tool, setTool] = useState<MdbToolStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onParsedRef = useRef(onParsed);
  useEffect(() => {
    onParsedRef.current = onParsed;
  }, [onParsed]);

  const refreshTool = useCallback(() => {
    void mdbToolStatus()
      .then(setTool)
      .catch(() => setTool({ found: false, version: "backend unreachable" }));
  }, []);

  useEffect(() => {
    let alive = true;
    void isTauriRuntime().then((t) => {
      if (!alive || !t) return;
      setIsTauri(true);
      refreshTool();
    });
    return () => {
      alive = false;
    };
  }, [refreshTool]);

  const handleFile = useCallback(async (file: File) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setLoading(true);
    try {
      // Jet DB large blob via HTML5 File would freeze the WebView on ArrayBuffer
      // and also lacks -b octal — fast-reject and point to the Tauri path.
      if (file.size > HEAD_SLICE) {
        const probe = new Uint8Array(await file.slice(0, 64).arrayBuffer());
        if (detectJetMdb(probe)) {
          const inTauri =
            isTauri || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
          if (inTauri) {
            throw new Error(
              `This is a ${Math.round(file.size / 1024 / 1024)} MB Spectra database (.sp3). Drop it on the window chrome or use "Open .sp3 file" so the backend converts it with mdb-export. Browser file drops for .sp3 are for small CSV shims only.`
            );
          }
          if (file.size > FULL_BUFFER_GUARD) {
            throw new Error(
              `This is a ${Math.round(file.size / 1024 / 1024)} MB .sp3 database — browsers cannot read Jet DBs. In Tauri: use "Open .sp3 file". Otherwise export the Data table to CSV first: mdb-export file.sp3 Data > data.csv`
            );
          }
        }
      }
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
            `File is ${(file.size / 1024 / 1024).toFixed(0)} MB and not a Data-table CSV export. Open the .sp3 with "Open .sp3 file", or export one table to CSV (mdb-export file.sp3 Data > data.csv) and drop that.`
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
      onParsedRef.current(parsed, file);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      const msg =
        e instanceof Error
          ? e.message.includes("out of memory") ||
            e.message.includes("Array buffer allocation failed")
            ? 'File too large to preview — use "Open .sp3 file" or export one row per CSV.'
            : e.message
          : "Failed to parse file.";
      setError(msg);
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, []);

  const runTauri = useCallback(async (job: () => Promise<ParseResult>) => {
    abortRef.current?.abort();
    setError(null);
    setLoading(true);
    try {
      const result = await job();
      onParsedRef.current(result, null);
      const lang = (
        typeof document !== "undefined" && document.documentElement.lang === "fa" ? "fa" : "en"
      ) as "fa" | "en";
      const { translate } = await import("../lib/i18n");
      toast.success(translate(lang, "toastLoadedFile", { file: result.meta.filename }));
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePath = useCallback(
    async (path: string) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "sp3" || ext === "mdb") return runTauri(() => convertSp3Path(path));
      if (ext === "csv") return runTauri(() => loadTauriCsvPath(path));
      setError(
        `Can't open .${ext || "?"} by drop here — use "Browse files" for plain .txt spectra.`
      );
    },
    [runTauri]
  );

  const openSp3 = useCallback(() => runTauri(convertSp3FromDisk), [runTauri]);

  const loadDemo = useCallback(() => {
    void handleFile(
      new File(["100,0.42\n200,0.87\n300,1.31\n400,0.95\n"], "demo.sp3", { type: "text/plain" })
    );
  }, [handleFile]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setError(null);
  }, []);

  return {
    loading,
    error,
    isTauri,
    tool,
    handleFile,
    handlePath,
    openSp3,
    loadDemo,
    cancel,
    refreshTool,
  };
}

/** Hidden file input + a function that opens it. */
export function useFilePicker(onFile: (f: File) => void, accept = INGEST_ACCEPT) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      className="hidden"
      aria-hidden="true"
      tabIndex={-1}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

/** Large import surface shown while no data is loaded. */
export function DropZone({ ingest }: { ingest: Ingest }) {
  const { t } = useUi();
  const picker = useFilePicker((f) => void ingest.handleFile(f));
  const toolMissing = ingest.isTauri && ingest.tool?.found === false;

  return (
    <div
      className="relative flex min-h-[13rem] flex-col items-center justify-center gap-2.5 overflow-hidden rounded-none border border-dashed border-input bg-card px-5 py-5 text-center lg:min-h-[14rem] lg:py-5"
      aria-busy={ingest.loading}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 62% 44% at 50% 0%, color-mix(in oklch, var(--primary) 8%, transparent), transparent 70%)",
        }}
        aria-hidden="true"
      />
      <div className="relative flex h-9 w-9 items-center justify-center rounded bg-primary/10 text-primary ring-1 ring-primary/15">
        {ingest.loading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <FileUp className="h-5 w-5" aria-hidden="true" />
        )}
      </div>
      <div className="relative grid max-w-[30rem] gap-0.5">
        <p className="text-[15px] font-semibold tracking-tight" aria-live="polite">
          {ingest.loading ? t("reading") : t("dropMeasurementFile")}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("dropMeasurementHint")}</p>
      </div>
      {ingest.loading ? (
        <Button variant="outline" className="relative" onClick={ingest.cancel}>
          <X aria-hidden="true" />
          {t("cancel")}
        </Button>
      ) : (
        <div className="relative flex flex-wrap justify-center gap-2">
          {ingest.isTauri ? (
            <Button onClick={() => void ingest.openSp3()} disabled={toolMissing}>
              <DatabaseZap aria-hidden="true" />
              {t("openSp3")}
            </Button>
          ) : null}
          <Button variant={ingest.isTauri ? "outline" : "default"} onClick={picker.open}>
            <FileUp aria-hidden="true" />
            {t("browseFiles")}
          </Button>
          <Button variant="ghost" onClick={ingest.loadDemo}>
            <FlaskConical aria-hidden="true" />
            {t("loadDemo")}
          </Button>
        </div>
      )}
      {toolMissing ? (
        <p className="relative text-xs text-destructive">{t("mdbNotFoundHint")}</p>
      ) : null}
      {ingest.error ? (
        <div className="relative">
          <IngestError message={ingest.error} />
        </div>
      ) : null}
      {picker.input}
    </div>
  );
}

export function IngestError({ message }: { message: string }) {
  return (
    <div
      className="flex max-w-xl items-start gap-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-start text-[13px] text-destructive"
      role="alert"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function sourceLabel(result: ParseResult): string {
  switch (result.meta.source) {
    case "spec-csv":
      return "Data-table CSV";
    case "mdb":
      return result.meta.csvPath ? "Spectra database" : "Jet MDB (preview only)";
    case "text":
      return "Text spectrum";
    case "binary":
      return "Binary spectrum";
    default:
      return result.meta.source;
  }
}

/** Header strip for the loaded file: name, source, replace/open actions. */
export function FileBar({ result, ingest }: { result: ParseResult; ingest: Ingest }) {
  const { t } = useUi();
  const picker = useFilePicker((f) => void ingest.handleFile(f));
  const total = (result.meta.extraRows ?? 0) + 1;
  return (
    <Card className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
        <DatabaseZap className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" title={result.meta.filename}>
          {result.meta.filename}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {sourceLabel(result)}
          {result.meta.size ? ` · ${formatBytes(result.meta.size)}` : ""}
          {total > 1 ? ` · ${total} ${t("measurementsInFile")}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ingest.loading ? (
          <Button variant="ghost" size="sm" onClick={ingest.cancel}>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {t("cancel")}
          </Button>
        ) : null}
        {ingest.isTauri ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void ingest.openSp3()}
            disabled={ingest.loading}
          >
            <DatabaseZap aria-hidden="true" />
            {t("openSp3")}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={picker.open} disabled={ingest.loading}>
          <RefreshCw aria-hidden="true" />
          {t("replaceFile")}
        </Button>
      </div>
      {picker.input}
    </Card>
  );
}

/** KPI tiles + spectrum preview for the active measurement. */
export function DataOverview({ result, limits }: { result: ParseResult; limits?: ZoneLimitSet }) {
  const { t } = useUi();
  const overall = result.meta.overall;
  const zone = overall && limits ? classifyZone(overall.rmsV, limits.velocity) : "";
  const unit = overall?.unit || "";
  return (
    <div className="grid gap-3">
      {result.warning ? (
        <div className="flex items-start gap-2 rounded border border-warning/50 bg-warning/10 px-3 py-2 text-xs">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>{result.warning}</p>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label={t("rmsVelocity")}
          value={
            overall ? (
              <span className="flex items-center gap-2">
                {overall.rmsV}
                {zone ? <ZoneBadge zone={zone} /> : null}
              </span>
            ) : (
              "—"
            )
          }
          sub={
            zone
              ? ZONE_LABELS[zone as keyof typeof ZONE_LABELS]
              : overall
                ? unit || "RMS"
                : t("noOverallValues")
          }
        />
        <Stat
          label={t("peak")}
          value={`${Number(result.stats.peak.amp).toFixed(2)}${unit ? ` ${unit}` : ""}`}
          sub={t("atRpm", {
            rpm: Math.round(Number(result.stats.peak.freq) * 60),
            freq: result.stats.peak.freq,
          })}
        />
      </div>
      <Card className="p-3">
        <SpectraChart spectra={result.spectra} height={260} />
      </Card>
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
