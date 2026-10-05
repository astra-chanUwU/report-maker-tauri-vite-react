import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, Loader2 } from "lucide-react";
import { estimatePercent, yieldToUi, type ExportProgress } from "../lib/export-progress";

// Types from generateDocx without a static runtime import — keeps true code-split.
// `import()` type queries are erased at build time and do not bundle docx.
type MeasurePeak = import("../lib/generateDocx").MeasurePeak;
type MeasureRow = import("../lib/generateDocx").MeasureRow;
type BuildDocxInput = import("../lib/generateDocx").BuildDocxInput;

// Lazily loaded chart renderer (dynamic import ensures docx chunk is not in the main bundle).
let cachedRenderChartPng: ((spectra: import("../lib/parseSp3").SpectraPoint[]) => Uint8Array) | null = null;
async function getRenderChartPng(): Promise<
  (spectra: import("../lib/parseSp3").SpectraPoint[]) => Uint8Array
> {
  if (cachedRenderChartPng) return cachedRenderChartPng;
  const mod = await import("../lib/generateDocx");
  cachedRenderChartPng = mod.renderChartPng;
  return cachedRenderChartPng;
}

async function buildDocxViaWorker(
  input: BuildDocxInput,
  onProgress: (p: ExportProgress) => Promise<void>
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/docx-worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (e) {
      reject(e);
      return;
    }
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("docx worker timeout"));
    }, 120_000);
    worker.onmessage = async (e: MessageEvent) => {
      const data = e.data as {
        id: number;
        type: string;
        progress?: ExportProgress;
        buffer?: ArrayBuffer;
        error?: string;
      };
      if (data.id !== id) return;
      if (data.type === "progress" && data.progress) {
        await onProgress(data.progress);
      } else if (data.type === "done" && data.buffer) {
        clearTimeout(timeout);
        worker.terminate();
        resolve(
          new Blob([data.buffer], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          })
        );
      } else if (data.type === "error") {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(data.error ?? "docx worker failed"));
      }
    };
    worker.onerror = (ev) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(ev.error instanceof Error ? ev.error : new Error("Worker error"));
    };
    worker.postMessage({ id, input });
  });
}
import { loadIsoRows } from "../lib/iso-store";
import { SECONDARY_SERIES } from "../lib/metrics";
import { fallbackDraft } from "../lib/ai";
import type { EquipmentItem } from "../lib/equipment";
import { isoToJalaliFa } from "../lib/fa";
import { findLastReportFor } from "../lib/history";
import {
  applyEnvelopeSamples,
  fetchEnvelopeSamples,
  loadFileRow,
  loadTauriRow,
  type CsvRowSummary,
} from "../lib/mdb";
import {
  buildMeasureRows,
  formatSpectrumPeak,
  latestPerPoint,
  peaksFromSpectrum,
  rowsForPoints,
} from "../lib/report-slices";
import { computeStats, type ParseResult, type ReportOptions } from "../lib/parseSp3";
import { base64ToBytes, validateReportOptions, type Branding } from "../lib/settings";
import { oleDateToISO } from "../lib/specdata";
import { track } from "../lib/telemetry";
import { buildAllTrendSnapshots, groupHistories } from "../lib/trends";
import { DEFAULT_ZONE_LIMITS, type ZoneLimitSet } from "../lib/zones";
import { Button } from "./ui/button";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

function parseTrendWindow(window?: string): number | "all" {
  const w = window ?? "";
  if (/all/i.test(w)) return "all";
  const m = /last\s+(\d+)/i.exec(w);
  return m ? Number(m[1]) : 10;
}

export function sanitizeFilename(name: string): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || "report";
}

/** Dispatch on window to run the toolbar export from elsewhere (one exporter, one Ctrl+E). */
export const EXPORT_EVENT = "report-maker:export";

export function ExportControls({
  onBlocked,
  parsed,
  options,
  branding,
  aiDraft,
  onExported,
  limits,
  measureRows,
  trendSnap,
  equipments,
  tauriPath,
  csvFile,
  onBusy,
  onProgress,
}: {
  /** Called instead of exporting when data or required fields are missing. */
  onBlocked?: () => void;
  parsed: ParseResult | null;
  options: ReportOptions;
  branding?: Branding;
  aiDraft?: {
    summary: string;
    methodology: string;
    observations: string;
    recommendations: string;
    conclusion: string;
  } | null;
  onExported?: (info: { filename: string; savedPath: string | null }) => void;
  limits?: ZoneLimitSet;
  measureRows?: CsvRowSummary[];
  trendSnap?: {
    pointLabel: string;
    sampleCount: number;
    window: string;
    velocityPng: Uint8Array;
    accelPng: Uint8Array;
  } | null;
  equipments?: EquipmentItem[];
  tauriPath?: string | null;
  csvFile?: File | null;
  onBusy?: (busy: boolean) => void;
  onProgress?: (progress: ExportProgress) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { t } = useUi();
  const [lastPath, setLastPath] = useState<string | null>(null);
  const progressRef = useRef(onProgress);
  useEffect(() => {
    progressRef.current = onProgress;
  }, [onProgress]);

  const report = async (p: ExportProgress) => {
    progressRef.current?.(p);
    await yieldToUi();
  };

  const errors = validateReportOptions(options);

  const handleExport = async () => {
    if (busy) return;
    if (!parsed) {
      toast.error(t("dropFirst"));
      onBlocked?.();
      return;
    }
    if (Object.keys(errors).length > 0) {
      toast.error(t("fillRequired"));
      onBlocked?.();
      return;
    }
    setBusy(true);
    await report({ stage: "preparing", percent: estimatePercent("preparing"), detail: "Preparing…" });
    try {
      const pointLimit = Math.max(1, Math.min(options.pointLimit ?? 120, 500));
      const effOptions: ReportOptions =
        options.language === "fa" && !options.jalaliDate && options.reportDate
          ? { ...options, jalaliDate: isoToJalaliFa(options.reportDate), pointLimit }
          : { ...options, pointLimit };
      const hasDraft = aiDraft && Object.values(aiDraft).some((v) => v.trim());
      const draft = hasDraft
        ? aiDraft
        : fallbackDraft({
            meta: parsed.meta,
            spectra: parsed.spectra,
            options,
            stats: parsed.stats,
          });
      const win = parseTrendWindow(trendSnap?.window);
      // Last-report autofill (brochure p.5)
      let lastReport = options.equipmentLastReport ?? "";
      if (!lastReport.trim() && options.equipmentName?.trim()) {
        try {
          const prev = await findLastReportFor(options.equipmentName);
          if (prev) lastReport = `${prev.date} · ${prev.filename}`;
        } catch {
          // offline-safe: leave empty
        }
      }
      const secondary = options.secondaryMetric ?? "acceleration";
      const series = SECONDARY_SERIES[secondary];
      const bands = options.trendZoneBands !== false;
      const trendPages = options.trendPages === true;
      const askedEnvelope =
        secondary === "envelope" || (options.trendMetrics ?? []).includes("envelope");
      const sp3Paths = [
        ...new Set((equipments ?? []).map((e) => e.sp3Path).filter((p): p is string => Boolean(p))),
      ];
      let envelopeHits = 0;
      let envelopeUnit: string | undefined;
      if (askedEnvelope && measureRows && measureRows.length > 0 && sp3Paths.length > 0) {
        await report({
          stage: "envelope",
          percent: estimatePercent("envelope"),
          detail: "Loading envelope data…",
        });
        for (let i = 0; i < sp3Paths.length; i++) {
          const path = sp3Paths[i];
          try {
            const samples = await fetchEnvelopeSamples(path);
            envelopeUnit ??= samples.find((s) => s.unit)?.unit;
            envelopeHits += applyEnvelopeSamples(measureRows, samples);
          } catch {
            // envelope table optional
          }
          await report({
            stage: "envelope",
            percent: estimatePercent("envelope", (i + 1) / sp3Paths.length),
            detail: `Envelope ${i + 1}/${sp3Paths.length}`,
          });
        }
      }
      const includeEnvelope = envelopeHits > 0 && secondary !== "envelope";
      // Full-size trend pages (opt-in; the measuring table already carries sparklines)
      let allTrends: ReturnType<typeof buildAllTrendSnapshots> | undefined;
      if (trendPages && limits && measureRows && measureRows.length > 1) {
        await report({
          stage: "trends",
          percent: estimatePercent("trends"),
          detail: "Building trend charts…",
        });
        try {
          allTrends = buildAllTrendSnapshots(
            groupHistories(measureRows),
            limits,
            win,
            40,
            includeEnvelope,
            series,
            bands
          );
          if (allTrends.length <= 1) allTrends = undefined;
        } catch {
          allTrends = undefined;
        }
        await yieldToUi();
      }
      // Latest spectrum per point feeds both the Peak List column and the FFT gallery.
      const peaksByKey = new Map<string, MeasurePeak[]>();
      let fftDone = 0;
      let fftTotal = 0;
      const bumpFft = async () => {
        fftDone += 1;
        const frac = fftTotal > 0 ? fftDone / fftTotal : 0;
        await report({
          stage: "fft",
          percent: estimatePercent("fft", frac),
          detail: `Spectra ${Math.min(fftDone, fftTotal)}/${fftTotal}`,
        });
      };
      const loadSpectrum = async (row: CsvRowSummary): Promise<ParseResult | null> => {
        if (!measureRows) return null;
        try {
          if (tauriPath) {
            return await loadTauriRow(
              tauriPath,
              row.index,
              parsed.meta.filename,
              measureRows.length
            );
          }
          if (csvFile) {
            return await loadFileRow(csvFile, parsed.meta.filename, row.index, measureRows.length);
          }
        } catch {
          return null;
        }
        return null;
      };
      const loadFft = async (rows: CsvRowSummary[], labels?: Record<string, string>) => {
        const items: { label: string; png: Uint8Array; peak?: string; spectra?: import("../lib/parseSp3").SpectraPoint[] }[] = [];
        const points = latestPerPoint(rows).slice(0, 40);
        for (const row of points) {
          const pr = await loadSpectrum(row);
          if (!pr || pr.spectra.length === 0) {
            await bumpFft();
            continue;
          }
          const key = `${row.pointId} ${row.directionId}`;
          peaksByKey.set(key, peaksFromSpectrum(pr.spectra));
          if (options.fftAllPoints === false || items.length >= 24) {
            await bumpFft();
            continue;
          }
          const named = labels?.[key.trim()];
          const fallback = `${row.pointId || "?"}${row.directionId ? ` / ${row.directionId}` : ""}`;
          items.push({
            label: `${named || fallback} · ${oleDateToISO(Number(row.measDate)) || ""}`,
            png: (await getRenderChartPng())(pr.spectra),
            peak: formatSpectrumPeak(computeStats(pr.spectra).peak),
            spectra: pr.spectra,
          });
          await bumpFft();
        }
        return items;
      };
      const eqList = (equipments ?? []).filter((e) => e.name.trim() || e.specs.trim());
      const perMachineFft = new Map<string, { label: string; png: Uint8Array; peak?: string }[]>();
      let fftGallery: { label: string; png: Uint8Array; peak?: string }[] | undefined;
      if (measureRows && measureRows.length > 0) {
        try {
          const bound = eqList.filter((e) => e.pointIds && e.pointIds.length > 0);
          const batches =
            bound.length > 0
              ? bound.map((e) => rowsForPoints(measureRows, e.pointIds))
              : [measureRows];
          fftTotal = batches.reduce((n, rows) => n + latestPerPoint(rows).slice(0, 40).length, 0);
          if (fftTotal > 0) {
            await report({
              stage: "fft",
              percent: estimatePercent("fft", 0),
              detail: `Spectra 0/${fftTotal}`,
            });
          }
          if (bound.length > 0) {
            for (const e of bound) {
              const items = await loadFft(rowsForPoints(measureRows, e.pointIds), e.labels);
              if (items.length > 0) perMachineFft.set(e.id, items);
            }
          } else {
            const items = await loadFft(measureRows);
            if (items.length > 0) fftGallery = items;
          }
        } catch {
          fftGallery = undefined;
        }
      }
      await report({
        stage: "building",
        percent: estimatePercent("building"),
        detail: "Assembling document…",
      });
      const withPeaks = (rows: MeasureRow[]) =>
        rows.map((r) =>
          r.key && peaksByKey.has(r.key) ? { ...r, peaks: peaksByKey.get(r.key) } : r
        );
      const rowOpts = { secondary, bands };
      const zones =
        limits && measureRows && measureRows.length > 0
          ? {
              limits,
              rows: withPeaks(buildMeasureRows(measureRows, limits, win, undefined, true, rowOpts)),
            }
          : undefined;
      const toBrandImage = (b64: string | null) => (b64 ? { data: base64ToBytes(b64) } : undefined);
      const docxInput: BuildDocxInput = {
        meta: parsed.meta,
        spectra: parsed.spectra,
        options: effOptions,
        aiDraft: draft,
        templateId: options.templateId ?? "classic",
        branding: {
          logoPng: branding?.logoBase64 ? base64ToBytes(branding.logoBase64) : undefined,
          cover: toBrandImage(branding?.coverBase64 ?? null),
          signature: toBrandImage(branding?.signatureBase64 ?? null),
        },
        zones,
        trends: trendPages ? (trendSnap ?? undefined) : undefined,
        allTrends,
        fftGallery,
        isoRows: options.useCustomIso ? loadIsoRows() : undefined,
        envelopeUnit,
        equipments:
          eqList.length > 0
            ? eqList.map((e) => {
                const slice =
                  measureRows && e.pointIds && e.pointIds.length > 0
                    ? rowsForPoints(measureRows, e.pointIds)
                    : [];
                const fft = perMachineFft.get(e.id);
                const mLimits = e.limits ?? limits ?? DEFAULT_ZONE_LIMITS;
                const vib =
                  slice.length > 0 || (fft && fft.length > 0)
                    ? {
                        limits: mLimits,
                        rows:
                          slice.length > 0
                            ? withPeaks(
                                buildMeasureRows(slice, mLimits, win, e.labels, true, rowOpts)
                              )
                            : [],
                        trends:
                          trendPages && slice.length > 0
                            ? buildAllTrendSnapshots(
                                groupHistories(slice).map((h) => ({
                                  ...h,
                                  label: e.labels?.[`${h.pointId} ${h.directionId}`] || h.label,
                                })),
                                mLimits,
                                win,
                                40,
                                includeEnvelope,
                                series,
                                bands
                              )
                            : undefined,
                        fft,
                      }
                    : undefined;
                return {
                  name: e.name,
                  plant: e.plant,
                  specs: e.specs,
                  schematic: toBrandImage(e.schematicBase64),
                  status: e.status,
                  lastReport:
                    e.lastReport || (e.name === options.equipmentName ? lastReport : e.lastReport),
                  problems: e.problems || draft.observations,
                  corrective: e.corrective || draft.recommendations,
                  summary: e.summary,
                  methodology: e.methodology,
                  observations: e.observations,
                  recommendations: e.recommendations,
                  conclusion: e.conclusion,
                  vib,
                };
              })
            : undefined,
        equipment: {
          name: options.equipmentName,
          specs: options.equipmentSpecs,
          schematic: toBrandImage(options.schematicBase64 ?? null),
          status: options.equipmentStatus,
          lastReport,
          problems: options.equipmentProblems || draft.observations,
          corrective: options.equipmentCorrective || draft.recommendations,
        },
      };
      // Offload heavy docx assembly to a Worker; fall back to dynamic import on failure.
      let blob: Blob;
      try {
        if (typeof Worker !== "undefined") {
          blob = await buildDocxViaWorker(docxInput, report);
        } else {
          throw new Error("Worker unavailable");
        }
      } catch {
        await report({
          stage: "packing",
          percent: estimatePercent("packing"),
          detail: "Packing Word file…",
        });
        const { buildDocx } = await import("../lib/generateDocx");
        await yieldToUi();
        blob = await buildDocx(docxInput);
        await yieldToUi();
      }
      const filename = `${sanitizeFilename(options.projectName)}-${options.reportDate}.docx`;
      await report({
        stage: "saving",
        percent: estimatePercent("saving"),
        detail: "Saving…",
      });
      const savedPath = await saveBlob(blob, filename);
      if (savedPath) setLastPath(savedPath);
      onExported?.({ filename, savedPath });
      void track("report_generated", {
        spectra_points: parsed.stats.spectra_points,
        via: savedPath ? "tauri" : "web",
      });
      toast.success(savedPath ? `${t("saved")} ${filename}` : `${t("downloaded")} ${filename}`);
      await report({
        stage: "done",
        percent: 100,
        detail: savedPath ? `Saved ${filename}` : `Downloaded ${filename}`,
      });
    } catch (e) {
      void track("report_failed", {});
      const msg = e instanceof Error ? e.message : t("exportFailed");
      toast.error(msg);
      await report({ stage: "failed", error: msg, detail: msg });
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    if (!lastPath) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(lastPath);
    } catch {
      toast.error(t("couldNotOpen"));
    }
  };

  const exportRef = useRef(handleExport);
  useEffect(() => {
    exportRef.current = handleExport;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void exportRef.current();
      }
    };
    const onRequest = () => void exportRef.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener(EXPORT_EVENT, onRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(EXPORT_EVENT, onRequest);
    };
  }, []);

  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const filename = `${sanitizeFilename(options.projectName)}-${options.reportDate || "YYYY-MM-DD"}.docx`;

  return (
    <div className="flex items-center gap-2">
      {lastPath ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReveal}
          title={lastPath}
          aria-label="Show exported file in folder"
        >
          <FolderOpen aria-hidden="true" />
          <span className="hidden xl:inline">{t("reveal")}</span>
        </Button>
      ) : null}
      <Button
        onClick={() => void handleExport()}
        aria-busy={busy}
        aria-label={busy ? t("generating") : t("generate")}
        title={`${t("generate")} (Ctrl+E) → ${filename}`}
        className="min-w-36"
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Download aria-hidden="true" />
        )}
        {busy ? t("generating") : t("generate")}
        {!busy ? (
          <kbd className="ms-1 hidden rounded bg-primary-foreground/15 px-1 font-sans text-[10px] font-medium lg:inline">
            Ctrl+E
          </kbd>
        ) : null}
      </Button>
    </div>
  );
}

/** Tauri save() + fs writeFile; falls back to anchor download. Returns path when saved via Tauri. */
async function saveBlob(blob: Blob, filename: string): Promise<string | null> {
  try {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (!path) return null; // user cancelled
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, bytes);
    return path;
  } catch {
    // Web fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return null;
  }
}
