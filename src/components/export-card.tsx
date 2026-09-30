import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, Loader2 } from "lucide-react";
import { renderChartPng } from "../lib/generateDocx";
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
import { buildMeasureRows, latestPerPoint, rowsForPoints } from "../lib/report-slices";
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
}) {
  const [busy, setBusy] = useState(false);
  const { t } = useUi();
  const [lastPath, setLastPath] = useState<string | null>(null);

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
      const zones =
        limits && measureRows && measureRows.length > 0
          ? { limits, rows: buildMeasureRows(measureRows, limits, win) }
          : undefined;
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
      const askedEnvelope = (options.trendMetrics ?? []).includes("envelope");
      const sp3Paths = [
        ...new Set((equipments ?? []).map((e) => e.sp3Path).filter((p): p is string => Boolean(p))),
      ];
      let envelopeHits = 0;
      if (measureRows && measureRows.length > 0 && sp3Paths.length > 0) {
        for (const path of sp3Paths) {
          try {
            envelopeHits += applyEnvelopeSamples(measureRows, await fetchEnvelopeSamples(path));
          } catch {
            // envelope table optional
          }
        }
      }
      const includeEnvelope =
        envelopeHits > 0 ||
        (askedEnvelope &&
          (measureRows ?? []).some(
            (r) => r.envelopeRms != null && Number.isFinite(Number(r.envelopeRms))
          ));
      // All-points trends (brochure p.6)
      let allTrends:
        | {
            pointLabel: string;
            sampleCount: number;
            velocityPng: Uint8Array;
            accelPng: Uint8Array;
          }[]
        | undefined;
      if (options.trendAllPoints !== false && limits && measureRows && measureRows.length > 1) {
        try {
          allTrends = buildAllTrendSnapshots(
            groupHistories(measureRows),
            limits,
            win,
            40,
            includeEnvelope
          );
          // single-point mode already covers it — skip duplicate
          if (allTrends.length <= 1) allTrends = undefined;
        } catch {
          allTrends = undefined;
        }
      }
      // FFT charts: latest spectrum per point. Bound machines keep their own gallery (cap 24 each).
      const fftItem = async (row: CsvRowSummary, labels?: Record<string, string>) => {
        if (!measureRows) return null;
        let pr: ParseResult | null = null;
        if (tauriPath) {
          try {
            pr = await loadTauriRow(tauriPath, row.index, parsed.meta.filename, measureRows.length);
          } catch {
            pr = null;
          }
        } else if (csvFile) {
          try {
            pr = await loadFileRow(csvFile, parsed.meta.filename, row.index, measureRows.length);
          } catch {
            pr = null;
          }
        }
        if (!pr) return null;
        const st = computeStats(pr.spectra);
        const named = labels?.[`${row.pointId} ${row.directionId}`.trim()];
        const fallback = `${row.pointId || "?"}${row.directionId ? ` / ${row.directionId}` : ""}`;
        return {
          label: `${named || fallback} · ${oleDateToISO(Number(row.measDate)) || ""}`,
          png: renderChartPng(pr.spectra),
          peak: `${st.peak.amp} @ ${st.peak.freq}`,
        };
      };
      const loadFft = async (rows: CsvRowSummary[], labels?: Record<string, string>) => {
        const items: { label: string; png: Uint8Array; peak?: string }[] = [];
        for (const row of latestPerPoint(rows).slice(0, 24)) {
          const item = await fftItem(row, labels);
          if (item) items.push(item);
        }
        return items;
      };
      const eqList = (equipments ?? []).filter((e) => e.name.trim() || e.specs.trim());
      const perMachineFft = new Map<string, { label: string; png: Uint8Array; peak?: string }[]>();
      let fftGallery: { label: string; png: Uint8Array; peak?: string }[] | undefined;
      if (options.fftAllPoints !== false && measureRows && measureRows.length > 0) {
        try {
          const bound = eqList.filter((e) => e.pointIds && e.pointIds.length > 0);
          if (bound.length > 0) {
            for (const e of bound) {
              const items = await loadFft(rowsForPoints(measureRows, e.pointIds), e.labels);
              if (items.length > 0) perMachineFft.set(e.id, items);
            }
          }
          if (perMachineFft.size === 0) {
            const items = await loadFft(measureRows);
            if (items.length > 0) fftGallery = items;
          }
        } catch {
          fftGallery = undefined;
        }
      }
      const { buildDocx } = await import("../lib/generateDocx");
      const toBrandImage = (b64: string | null) => (b64 ? { data: base64ToBytes(b64) } : undefined);
      const blob = await buildDocx({
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
        trends: trendSnap ?? undefined,
        allTrends,
        fftGallery,
        equipments:
          eqList.length > 0
            ? eqList.map((e) => {
                const slice =
                  limits && measureRows && e.pointIds && e.pointIds.length > 0
                    ? rowsForPoints(measureRows, e.pointIds)
                    : [];
                const fft = perMachineFft.get(e.id);
                const vib =
                  (limits && slice.length > 0) || (fft && fft.length > 0)
                    ? {
                        limits: limits ?? DEFAULT_ZONE_LIMITS,
                        rows:
                          limits && slice.length > 0
                            ? buildMeasureRows(slice, limits, win, e.labels)
                            : [],
                        trends:
                          limits && slice.length > 0
                            ? buildAllTrendSnapshots(
                                groupHistories(slice).map((h) => ({
                                  ...h,
                                  label: e.labels?.[`${h.pointId} ${h.directionId}`] || h.label,
                                })),
                                limits,
                                win,
                                40,
                                includeEnvelope
                              )
                            : undefined,
                        fft,
                      }
                    : undefined;
                return {
                  name: e.name,
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
      });
      const filename = `${sanitizeFilename(options.projectName)}-${options.reportDate}.docx`;
      // filename preview already sanitized — shown below when enabled
      const savedPath = await saveBlob(blob, filename);
      if (savedPath) setLastPath(savedPath);
      onExported?.({ filename, savedPath });
      void track("report_generated", {
        spectra_points: parsed.stats.spectra_points,
        via: savedPath ? "tauri" : "web",
      });
      toast.success(savedPath ? `${t("saved")} ${filename}` : `${t("downloaded")} ${filename}`);
    } catch (e) {
      void track("report_failed", {});
      toast.error(e instanceof Error ? e.message : t("exportFailed"));
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
  exportRef.current = handleExport;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void exportRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
