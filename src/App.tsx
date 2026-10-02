import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Database, FileText, Gauge, Keyboard, Palette } from "lucide-react";
import { AiDraftCard, AiSettingsCard, type AiDraftFields } from "./components/ai-draft";
import { ChartsMetricsCard, IsoTableEditor, MachineLimitsCard } from "./components/alarms-page";
import { BrandingCard, TemplateCard } from "./components/branding";
import { ChartEditor } from "./components/chart-editor";
import { ClientProfiles } from "./components/client-profiles";
import { DesignDemo } from "./components/demo";
import { EquipmentWorkspace } from "./components/equipment-list";
import { ExportControls } from "./components/export-card";
import { ExportPage } from "./components/export-page";
import { HistoryTab } from "./components/history";
import { DataOverview, DropZone, FileBar, IngestError, useIngest } from "./components/ingest";
import { RecentDbsCard } from "./components/recent-dbs";
import { LicenseCard } from "./components/license";
import { MachinePicker } from "./components/machine-picker";
import { MdbToolSettings } from "./components/mdb-import";
import { MeasurementPicker } from "./components/measurement-picker";
import { DatabaseSummary, MeasuringTable, useMeasureRows } from "./components/measuring-table";
import { Onboarding } from "./components/onboarding";
import {
  ClientDetailsCard,
  languagePatch,
  ProjectDetailsCard,
  ReportContentsCard,
} from "./components/report-form";
import {
  ALL_NAV,
  DropOverlay,
  ReadinessChip,
  Sidebar,
  StatusBar,
  THEME_ICONS,
  Toolbar,
  useTheme,
  WIZARD,
  WizardFooter,
  WORKFLOW_NAV,
  type MissingItem,
  type NavIndicator,
  type PageId,
  type ThemePref,
  type WizardStepId,
} from "./components/shell";
import { TelemetryCard } from "./components/telemetry";
import { TrendCard, type TrendSnapshot } from "./components/trend-card";
import { Button } from "./components/ui/button";
import { Card, Panel } from "./components/ui/card";
import { EmptyState, Field, Segmented } from "./components/ui/form";
import { ZoneLimitsCard } from "./components/zone-limits";
import { addHistoryEntry, makeEntry } from "./lib/history";
import { loadEquipments, saveEquipments, type EquipmentItem } from "./lib/equipment";
import { addRecentDb } from "./lib/recentDbs";
import { APP_VERSION } from "./lib/license";
import {
  computeStats,
  type ParseResult,
  type ReportOptions,
  type SpectraPoint,
} from "./lib/parseSp3";
import {
  hasStoredBranding,
  loadBranding,
  loadReportOptions,
  loadZoneLimits,
  saveBranding,
  saveReportOptions,
  saveZoneLimits,
  seedDefaultBranding,
  validateReportOptions,
  type Branding,
} from "./lib/settings";
import { initCrashHooks, track } from "./lib/telemetry";
import { translate, UiProvider, type UiLang } from "./lib/i18n";
import { cn } from "./lib/utils";
import type { ZoneLimitSet } from "./lib/zones";
import { IMAGE_EXTS, INGEST_EXTS, shouldHandleNativeDrop } from "./lib/drop-guards";
import { DiagnosticsPanel } from "./components/diagnostics-panel";
import { ImportPill, ImportProgress } from "./components/import-progress";
import { ExportPill, ExportProgressPanel } from "./components/export-progress";
import {
  formatBytes,
  makeJob,
  softExportPercent,
  type ImportJob,
} from "./lib/import-jobs";
import { IDLE_EXPORT, type ExportProgress } from "./lib/export-progress";
import { convertSp3Path } from "./lib/mdb";

function App() {
  const [themePref, setThemePref] = useTheme();
  const [page, setPage] = useState<PageId>("data");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [options, setOptions] = useState<ReportOptions>(() => loadReportOptions());
  const [edited, setEdited] = useState<SpectraPoint[] | null>(null);
  const [branding, setBranding] = useState<Branding>(() => loadBranding());
  const [aiDraft, setAiDraft] = useState<AiDraftFields | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [zoneLimits, setZoneLimits] = useState<ZoneLimitSet>(() => loadZoneLimits());
  const [trendSnap, setTrendSnap] = useState<TrendSnapshot | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [equipments, setEquipments] = useState<EquipmentItem[]>(() => loadEquipments());
  const [showErrors, setShowErrors] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const [sp3Path, setSp3Path] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress>(IDLE_EXPORT);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    if (exportProgress.stage !== "done") return;
    const timer = window.setTimeout(() => setExportProgress(IDLE_EXPORT), 6000);
    return () => window.clearTimeout(timer);
  }, [exportProgress.stage]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const pendingSp3PathRef = useRef<string | null>(null);
  const jobsRef = useRef<ImportJob[]>([]);
  jobsRef.current = importJobs;

  const uiLang: UiLang = options.language === "fa" ? "fa" : "en";
  const t = useCallback((key: string) => translate(uiLang, key), [uiLang]);

  useEffect(() => {
    initCrashHooks();
    void track("app_started", {});
    if (!hasStoredBranding()) {
      void seedDefaultBranding().then((seed) => {
        if (seed) setBranding(seed);
      });
    }
  }, []);

  useEffect(() => {
    saveReportOptions(options);
  }, [options]);

  useEffect(() => {
    saveBranding(branding);
  }, [branding]);

  useEffect(() => {
    saveZoneLimits(zoneLimits);
  }, [zoneLimits]);

  const handleParsed = useCallback((r: ParseResult | null, file: File | null = null) => {
    setParsed(r);
    setEdited(r ? r.spectra : null);
    setAiDraft(null);
    setCsvFile(r && r.meta.source === "spec-csv" ? file : null);
    setTrendSnap(null);
    setSp3Path(r ? pendingSp3PathRef.current : null);
    if (r) {
      const opened = pendingSp3PathRef.current;
      if (opened) {
        void addRecentDb({
          path: opened,
          filename: r.meta.filename,
          size: r.meta.size,
          source: r.meta.source,
          rows: (r.meta.extraRows ?? 0) + 1,
        }).then(() => setRecentTick((n) => n + 1));
        pendingSp3PathRef.current = null;
      } else if (r.meta.source === "spec-csv" && file) {
        void addRecentDb({
          path: file.name,
          filename: file.name,
          size: file.size,
          source: r.meta.source,
          rows: (r.meta.extraRows ?? 0) + 1,
        }).then(() => setRecentTick((n) => n + 1));
      } else if (r.meta.csvPath) {
        void addRecentDb({
          path: r.meta.csvPath,
          filename: r.meta.filename,
          size: r.meta.size,
          source: r.meta.source,
          rows: (r.meta.extraRows ?? 0) + 1,
        }).then(() => setRecentTick((n) => n + 1));
      }
    } else {
      pendingSp3PathRef.current = null;
    }
  }, []);

  const ingest = useIngest(handleParsed);

  // Import job helpers — keep UI responsive while a large DB exports in the background.
  const enqueueJob = useCallback((path: string) => {
    const job = makeJob(path);
    setImportJobs((prev) => [...prev, job]);
    return job.id;
  }, []);
  const patchJob = useCallback((id: string, patch: Partial<ImportJob>) => {
    setImportJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);
  const dismissJob = useCallback((id: string) => {
    setImportJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);
  const cancelJob = useCallback(
    (id: string) => {
      patchJob(id, { stage: "failed", error: "cancelled" });
      window.setTimeout(() => dismissJob(id), 2500);
    },
    [patchJob, dismissJob]
  );

  const runPathWithJob = useCallback(
    async (path: string) => {
      const id = enqueueJob(path);
      pendingSp3PathRef.current = path;
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      patchJob(id, {
        stage: "exporting",
        percent: 5,
        progress: ext === "csv" ? "Loading CSV…" : "Exporting Data table…",
      });
      try {
        if (ext === "sp3" || ext === "mdb") {
          const result = await convertSp3Path(path, undefined, (p) => {
            patchJob(id, {
              stage: "exporting",
              bytes: p.bytes,
              rows: p.rows,
              percent: softExportPercent(p.bytes),
              progress: `${formatBytes(p.bytes)}${p.rows ? ` · ${p.rows.toLocaleString()} rows` : ""}`,
            });
          });
          patchJob(id, {
            stage: "indexing",
            percent: 95,
            progress: "Parsing preview…",
          });
          handleParsed(result, null);
          patchJob(id, { stage: "ready", percent: 100, progress: "Ready" });
          window.setTimeout(() => dismissJob(id), 4000);
          return;
        }
        await ingest.handlePath(path);
        patchJob(id, { stage: "ready", percent: 100, progress: "Ready" });
        window.setTimeout(() => dismissJob(id), 4000);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "cancelled") dismissJob(id);
        else patchJob(id, { stage: "failed", error: msg.slice(0, 80) });
      }
    },
    [enqueueJob, patchJob, dismissJob, ingest, handleParsed]
  );

  /** Switching measurements keeps the file/CSV source for further picks. */
  const handlePicked = (r: ParseResult) => {
    setParsed(r);
    setEdited(r.spectra);
    setAiDraft(null);
  };

  const effective = useMemo(
    () =>
      parsed
        ? {
            ...parsed,
            spectra: edited ?? parsed.spectra,
            stats: computeStats(edited ?? parsed.spectra),
          }
        : null,
    [parsed, edited]
  );

  const hasRowSource = !!(
    effective &&
    (effective.meta.csvPath || (effective.meta.source === "spec-csv" && csvFile))
  );
  const rowPath = hasRowSource ? (effective?.meta.csvPath ?? null) : null;
  const rowFile = hasRowSource && !effective?.meta.csvPath ? csvFile : null;
  const { rows: measureRows, loading: rowsLoading } = useMeasureRows(rowPath, rowFile);

  const handleExported = (info: { filename: string; savedPath: string | null }) => {
    if (info.savedPath) setLastSaved(info.savedPath);
    if (!effective) return;
    const entry = makeEntry({
      projectName: options.projectName,
      engineer: options.engineer,
      date: options.reportDate,
      filename: info.filename,
      savedPath: info.savedPath,
      sourceFile: effective.meta.filename,
      source: effective.meta.source,
      spectraPoints: effective.stats.spectra_points,
      peak: effective.stats.peak,
      options,
    });
    void addHistoryEntry(entry).then(() => setHistoryTick((n) => n + 1));
  };

  const updateEquipments = (n: EquipmentItem[]) => {
    setEquipments(n);
    saveEquipments(n);
  };

  const errors = validateReportOptions(options);
  const missing: MissingItem[] = [
    ...(!effective ? [{ key: "data", label: t("needData"), page: "data" as const }] : []),
    ...(errors.projectName
      ? [
          {
            key: "project",
            label: t("needProject"),
            page: "details" as const,
            focusId: "opt-project",
          },
        ]
      : []),
    ...(errors.engineer
      ? [
          {
            key: "engineer",
            label: t("needEngineer"),
            page: "details" as const,
            focusId: "opt-engineer",
          },
        ]
      : []),
    ...(errors.reportDate
      ? [{ key: "date", label: t("needDate"), page: "details" as const, focusId: "opt-date" }]
      : []),
  ];

  const goTo = useCallback((p: PageId, focusId?: string) => {
    setPage(p);
    if (focusId) {
      window.setTimeout(() => {
        const el = document.getElementById(focusId);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.focus({ preventScroll: true });
      }, 50);
    }
  }, []);

  const fix = (m: MissingItem) => {
    setShowErrors(true);
    goTo(m.page, m.focusId);
  };

  // Ctrl+1..4 wizard steps, Ctrl+8 History, Ctrl+9 Settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= WIZARD.length) {
        e.preventDefault();
        setPage(WIZARD[n - 1].items[0].id);
      } else if (n === 8 || n === 9) {
        e.preventDefault();
        setPage(n === 8 ? "history" : "settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Wrap ingest.handlePath to capture the original sp3 path for Recent DBs.
  const openRecentPath = useCallback(
    async (path: string) => {
      setPage("data");
      await runPathWithJob(path);
    },
    [runPathWithJob]
  );

  // Native window drops (Tauri) carry real paths, so .sp3 can go through mdb-export.
  const handlePathRef = useRef(ingest.handlePath);
  handlePathRef.current = ingest.handlePath;
  const isInsideBrandingDrop = (target: EventTarget | null) =>
    target instanceof HTMLElement && !!target.closest("[data-branding-drop],[data-schematic-drop]");
  const dragLooksLikeIngest = (e: React.DragEvent) => {
    const items = Array.from(e.dataTransfer.items ?? []);
    if (items.length > 0) {
      let hasIngest = false;
      let hasImage = false;
      let hasUnknown = false;
      for (const it of items) {
        if (it.kind !== "file") continue;
        const f = it.getAsFile();
        const name = f?.name ?? "";
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        const type = it.type || f?.type || "";
        if (ext && INGEST_EXTS.has(ext)) hasIngest = true;
        else if (type.startsWith("image/") || (ext && IMAGE_EXTS.has(ext))) hasImage = true;
        else if (!ext && !type) hasUnknown = true;
        else if (ext) hasUnknown = true;
      }
      if (hasIngest) return true;
      if (hasImage && !hasUnknown) return false;
    }
    // Fallback: extension-less drag (e.g. from OS) — assume ingest so overlay shows.
    return true;
  };
  useEffect(() => {
    if (!ingest.isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") {
            const first = (p as { paths?: string[] }).paths?.[0] ?? "";
            if (!shouldHandleNativeDrop(first)) return;
            setDragOver(true);
          } else if (p.type === "leave") setDragOver(false);
          else if (p.type === "drop") {
            setDragOver(false);
            const first = p.paths[0];
            if (!first || !shouldHandleNativeDrop(first)) return;
            setPage("data");
            void runPathWithJob(first);
          }
        })
      )
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ingest.isTauri]);

  // Browser/HTML5 drops (vite dev, or Tauri with native drop disabled).
  const dragDepth = useRef(0);
  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      if (isInsideBrandingDrop(e.target)) return;
      if (!dragLooksLikeIngest(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      if (isInsideBrandingDrop(e.target)) return;
      if (!dragLooksLikeIngest(e)) return;
      e.preventDefault();
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      if (isInsideBrandingDrop(e.target)) return;
      // Let image-only drags fall through to the branding/schematic drop zones.
      if (!dragLooksLikeIngest(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      const ext = f.name.split(".").pop()?.toLowerCase();
      if (ext && IMAGE_EXTS.has(ext)) return;
      if (ext && !INGEST_EXTS.has(ext)) return;
      // In Tauri the native window drop (onDragDropEvent → handlePath → mdb-export -b octal)
      // is the correct path for .sp3/.mdb — it streams to a temp CSV and never
      // buffers a 400MB File blob into the WebView. The HTML5 File drop for a
      // Jet DB large blob would both freeze the UI (ArrayBuffer) and produce
      // binary-corrupted CSV (needs -b octal), so defer instead of calling
      // handleFile which is meant for small .csv/.txt shims.
      if (ingest.isTauri && (ext === "sp3" || ext === "mdb")) return;
      setPage("data");
      void ingest.handleFile(f);
    },
  };

  const draftFilled = aiDraft ? Object.values(aiDraft).filter((v) => v.trim()).length : 0;
  const editedLimits = equipments.filter(
    (e) => e.dbLimits && JSON.stringify(e.limits) !== JSON.stringify(e.dbLimits)
  ).length;
  const indicators: Partial<Record<PageId, NavIndicator>> = {
    machines: equipments.length > 0 ? { kind: "count", value: equipments.length } : undefined,
    details:
      errors.projectName || errors.engineer || errors.reportDate
        ? showErrors
          ? { kind: "warn" }
          : undefined
        : { kind: "done" },
    findings: draftFilled > 0 ? { kind: "done" } : undefined,
    alarms: editedLimits > 0 ? { kind: "count", value: editedLimits } : undefined,
  };

  const hasProjectDetails = !errors.projectName && !errors.engineer && !errors.reportDate;
  const stepDone: Partial<Record<WizardStepId, boolean>> = {
    1: !!effective,
    2: equipments.length > 0,
    3: hasProjectDetails,
  };
  // The single-spectrum editor only matters for single-measurement reports.
  const wizardPages = WORKFLOW_NAV.map((n) => n.id).filter(
    (id) => id !== "chart" || equipments.length === 0
  );

  const current = ALL_NAV.find((n) => n.id === page)!;
  const ThemeIcon = THEME_ICONS[themePref];
  const nextTheme: Record<ThemePref, ThemePref> = {
    system: "light",
    light: "dark",
    dark: "system",
  };

  const handleOpenSp3 = useCallback(async () => {
    if (!ingest.isTauri) {
      void ingest.openSp3();
      return;
    }
    try {
      const [{ open }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/api/core"),
      ]);
      const picked = await open({
        filters: [{ name: "SP3 / MDB", extensions: ["sp3", "mdb"] }],
        multiple: false,
      });
      if (!picked || Array.isArray(picked)) return;
      await runPathWithJob(picked as string);
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
    }
  }, [runPathWithJob]);
  const ingestWithPath = { ...ingest, openSp3: handleOpenSp3 };

  const noData = (
    <EmptyState
      icon={<Database />}
      title="No measurement data loaded"
      actions={
        <Button onClick={() => setPage("data")}>
          <Database aria-hidden="true" />
          {t("navData")}
        </Button>
      }
    >
      Open a Spectra .sp3 database or a Data-table CSV first.
    </EmptyState>
  );

  return (
    <UiProvider lang={uiLang}>
      <div className="flex h-full" {...dropHandlers}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          {t("skip")}
        </a>
        <Sidebar
          page={page}
          onNavigate={setPage}
          indicators={indicators}
          stepDone={stepDone}
          version={APP_VERSION}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Toolbar title={t(current.label)} description={t(current.desc)}>
            <ImportPill jobs={importJobs} />
            <ExportPill progress={exportProgress} />
            <ReadinessChip missing={missing} onFix={fix} />
            <Segmented
              ariaLabel={t("language")}
              size="sm"
              className="hidden sm:inline-flex"
              value={uiLang}
              onChange={(l) => setOptions((o) => ({ ...o, ...languagePatch(o, l) }))}
              options={[
                { value: "en", label: "EN", title: "English report + interface" },
                { value: "fa", label: "فا", title: "گزارش و رابط فارسی" },
              ]}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setThemePref(nextTheme[themePref])}
              title={`${t("theme")}: ${t(`theme${themePref[0].toUpperCase()}${themePref.slice(1)}`)}`}
              aria-label={`${t("theme")}: ${themePref}`}
            >
              <ThemeIcon aria-hidden="true" />
            </Button>
            <span className="h-6 w-px bg-border" aria-hidden="true" />
            <ExportControls
              onBlocked={() => missing[0] && fix(missing[0])}
              parsed={effective}
              options={options}
              branding={branding}
              aiDraft={aiDraft}
              onExported={handleExported}
              limits={zoneLimits}
              measureRows={measureRows ?? undefined}
              trendSnap={trendSnap}
              equipments={equipments}
              tauriPath={rowPath}
              csvFile={rowFile}
              onBusy={setExportBusy}
              onProgress={setExportProgress}
            />
          </Toolbar>

          <main id="main" className="relative min-h-0 flex-1">
            <Page active={page === "data"}>
              {!effective ? (
                <div className="grid gap-4">
                  <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                    <DropZone ingest={ingestWithPath} />
                    <Onboarding />
                  </div>
                  <DiagnosticsPanel rows={measureRows} equipments={equipments} limits={zoneLimits} />
                  <RecentDbsCard onOpen={(p) => void openRecentPath(p)} tick={recentTick} />
                </div>
              ) : (
                <div className="grid gap-4">
                  <FileBar result={effective} ingest={ingestWithPath} />
                  {ingest.error ? <IngestError message={ingest.error} /> : null}
                  {hasRowSource ? (
                    <>
                      {rowsLoading && !measureRows ? (
                        <p className="text-[13px] text-muted-foreground">Reading measurements…</p>
                      ) : (
                        <DatabaseSummary rows={measureRows} limits={zoneLimits} />
                      )}
                      <DiagnosticsPanel rows={measureRows} equipments={equipments} limits={zoneLimits} />
                      <Card className="flex flex-wrap items-center gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold">{t("stepMachines")}</p>
                          <p className="text-xs text-muted-foreground">{t("pageMachinesDesc")}</p>
                        </div>
                        <Button onClick={() => setPage("machines")}>
                          {t("next")}: {t("navMachines")}
                          <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
                        </Button>
                      </Card>
                    </>
                  ) : (
                    <>
                      <DiagnosticsPanel rows={measureRows} equipments={equipments} limits={zoneLimits} />
                      <DataOverview result={effective} limits={zoneLimits} />
                    </>
                  )}
                </div>
              )}
            </Page>

            <Page active={page === "machines"}>
              <MachinePicker
                sp3Path={sp3Path ?? equipments.find((e) => e.sp3Path)?.sp3Path ?? null}
                isTauri={ingest.isTauri}
                items={equipments}
                onChange={updateEquipments}
                rows={measureRows}
              />
            </Page>

            <Page active={page === "measurements"}>
              {hasRowSource ? (
                <div className="grid gap-4">
                  <MeasuringTable
                    rows={measureRows}
                    loading={rowsLoading}
                    limits={zoneLimits}
                    equipments={equipments}
                    secondary={options.secondaryMetric ?? "acceleration"}
                    sp3Path={sp3Path}
                    isTauri={ingest.isTauri}
                  />
                  {measureRows && measureRows.length > 0 ? (
                    <TrendCard rows={measureRows} limits={zoneLimits} onSnapshot={setTrendSnap} />
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  icon={<Gauge />}
                  title="No readings yet"
                  actions={
                    <Button variant="outline" onClick={() => setPage("data")}>
                      <Database aria-hidden="true" />
                      {t("navData")}
                    </Button>
                  }
                >
                  Readings and trends appear when you open a Spectra .sp3 database or a Data-table
                  CSV with several measurements.
                </EmptyState>
              )}
            </Page>

            <Page active={page === "details"}>
              <div className="grid gap-4">
                <ProjectDetailsCard
                  options={options}
                  onChange={setOptions}
                  showErrors={showErrors}
                />
                <div className="grid items-start gap-4 xl:grid-cols-2">
                  <ClientDetailsCard options={options} onChange={setOptions} />
                  <ClientProfiles
                    options={options}
                    onOptions={setOptions}
                    onLogo={(logoBase64) => setBranding((b) => ({ ...b, logoBase64 }))}
                  />
                </div>
              </div>
            </Page>

            <Page active={page === "equipment"}>
              <EquipmentWorkspace
                items={equipments}
                onChange={updateEquipments}
                options={options}
                onOptions={setOptions}
                onPickMachines={() => setPage("machines")}
                onEditLimits={() => setPage("alarms")}
              />
            </Page>

            <Page active={page === "findings"}>
              <div className="grid gap-4">
                {equipments.length > 0 ? (
                  <p className="rounded-md border bg-card px-3 py-2 text-[13px] text-muted-foreground">
                    These findings are shared by the whole report. Each machine can override them
                    under{" "}
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setPage("equipment")}
                    >
                      Machines → Machine narrative
                    </button>
                    .
                  </p>
                ) : null}
                <AiDraftCard
                  parsed={effective}
                  options={options}
                  draft={aiDraft}
                  onChange={setAiDraft}
                />
              </div>
            </Page>

            <Page active={page === "alarms"}>
              <div className="grid gap-4">
                <ChartsMetricsCard options={options} onOptions={setOptions} />
                <MachineLimitsCard
                  items={equipments}
                  onChange={updateEquipments}
                  defaults={zoneLimits}
                />
                <IsoTableEditor options={options} onOptions={setOptions} />
                <ZoneLimitsCard limits={zoneLimits} onChange={setZoneLimits} />
              </div>
            </Page>

            <Page active={page === "chart"}>
              {effective ? (
                <div
                  className={cn(
                    "grid items-start gap-4",
                    hasRowSource && "xl:grid-cols-[minmax(0,1fr)_22rem]"
                  )}
                >
                  <div className="grid min-w-0 gap-4">
                    {equipments.length > 0 ? (
                      <p className="rounded-md border bg-card px-3 py-2 text-[13px] text-muted-foreground">
                        Multi-machine reports use each point's own spectrum. This editor only
                        changes the single-measurement report.
                      </p>
                    ) : null}
                    <ChartEditor
                      spectra={effective.spectra}
                      onChange={setEdited}
                      options={options}
                      onOptions={setOptions}
                    />
                  </div>
                  {hasRowSource ? (
                    <MeasurementPicker
                      className="max-h-[28rem] xl:sticky xl:top-0 xl:max-h-[calc(100vh-12rem)]"
                      tauriPath={rowPath}
                      file={rowFile}
                      filename={effective.meta.filename}
                      current={
                        effective.meta.overall
                          ? {
                              pointId: effective.meta.overall.pointId,
                              measDate: effective.meta.overall.measDate,
                            }
                          : null
                      }
                      onSelect={handlePicked}
                    />
                  ) : null}
                </div>
              ) : (
                noData
              )}
            </Page>

            <Page active={page === "layout"}>
              <div className="grid gap-4">
                <div className="grid items-start gap-4 xl:grid-cols-2">
                  <TemplateCard options={options} onOptions={setOptions} />
                  <ReportContentsCard options={options} onChange={setOptions} />
                </div>
                <BrandingCard
                  options={options}
                  onOptions={setOptions}
                  branding={branding}
                  onBranding={setBranding}
                />
              </div>
            </Page>

            <Page active={page === "export"}>
              <ExportPage
                hasData={!!effective}
                missing={missing}
                onFix={fix}
                onNavigate={setPage}
                options={options}
                equipments={equipments}
                findingsFilled={draftFilled > 0}
                busy={exportBusy}
                progress={exportProgress}
                lastSaved={lastSaved}
              />
            </Page>

            <Page active={page === "history"}>
              <HistoryTab
                key={historyTick}
                onReopen={(o) => {
                  setOptions(o);
                  setPage("details");
                }}
              />
            </Page>

            <Page active={page === "settings"}>
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <AppearanceCard pref={themePref} onPref={setThemePref} />
                <MdbToolSettings
                  isTauri={ingest.isTauri}
                  status={ingest.tool}
                  onRefresh={ingest.refreshTool}
                />
                <LicenseCard />
                <AiSettingsCard />
                <TelemetryCard />
                {import.meta.env.DEV ? (
                  <div className="xl:col-span-2">
                    <DesignDemo />
                  </div>
                ) : null}
              </div>
            </Page>
          </main>

          {importJobs.length > 0 || exportProgress.stage !== "idle" ? (
            <div className="grid shrink-0 gap-2 border-t bg-background px-4 py-2">
              {importJobs.length > 0 ? (
                <ImportProgress jobs={importJobs} onDismiss={dismissJob} onCancel={cancelJob} />
              ) : null}
              {exportProgress.stage !== "idle" ? (
                <ExportProgressPanel
                  progress={exportProgress}
                  onDismiss={() => setExportProgress(IDLE_EXPORT)}
                />
              ) : null}
            </div>
          ) : null}

          <WizardFooter page={page} onNavigate={setPage} pages={wizardPages} />

          <StatusBar
            left={
              effective ? (
                <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-foreground">
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{effective.meta.filename}</span>
                </span>
              ) : (
                <span>{t("noFile")}</span>
              )
            }
            right={
              <>
                {measureRows && measureRows.length > 0 ? (
                  <span className="hidden lg:inline">
                    {measureRows.length.toLocaleString()} {t("measurementsInFile")}
                  </span>
                ) : null}
                {equipments.length > 0 ? (
                  <span className="hidden lg:inline">
                    {t("equipments")}: {equipments.length}
                  </span>
                ) : null}
                <span>{uiLang === "fa" ? "فارسی" : "English"}</span>
                <span>v{APP_VERSION}</span>
              </>
            }
          />
        </div>
        <DropOverlay visible={dragOver} />
      </div>
    </UiProvider>
  );
}

/** Every page stays mounted so trend/measurement state (and export inputs) survive navigation. */
function Page({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={cn("absolute inset-0 overflow-y-auto", !active && "hidden")}>
      <div className="mx-auto w-full max-w-[1400px] px-5 py-5">{children}</div>
    </div>
  );
}

function AppearanceCard({ pref, onPref }: { pref: ThemePref; onPref: (p: ThemePref) => void }) {
  const shortcuts: [string, string][] = [
    ["Ctrl+E", "Generate report"],
    ["Ctrl+1 … Ctrl+4", "Jump to a wizard step"],
    ["Ctrl+8 / Ctrl+9", "History / Settings"],
    ["Drop a file", "Import it from any page"],
  ];
  return (
    <Panel icon={<Palette />} title="Appearance" contentClassName="grid gap-4">
      <Field label="Theme">
        <Segmented
          ariaLabel="Theme"
          value={pref}
          onChange={onPref}
          options={(["light", "dark", "system"] as const).map((p) => {
            const Icon = THEME_ICONS[p];
            return {
              value: p,
              label: (
                <>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {p === "system" ? "Match Windows" : p === "light" ? "Light" : "Dark"}
                </>
              ),
            };
          })}
        />
      </Field>
      <div className="grid gap-1.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
          Keyboard shortcuts
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          {shortcuts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium">
                  {k}
                </kbd>
              </dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

export default App;
