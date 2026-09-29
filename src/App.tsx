import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { AiDraftCard, AiSettingsCard, type AiDraftFields } from "./components/ai-draft";
import { BrandingCard } from "./components/branding";
import { ChartEditor } from "./components/chart-editor";
import { DesignDemo } from "./components/demo";
import { ExportCard } from "./components/export-card";
import { HistoryTab } from "./components/history";
import { Ingest } from "./components/ingest";
import { LicenseCard } from "./components/license";
import { MdbImportCard } from "./components/mdb-import";
import { MeasurementPicker } from "./components/measurement-picker";
import { ReportForm } from "./components/report-form";
import { TelemetryCard } from "./components/telemetry";
import { addHistoryEntry, makeEntry } from "./lib/history";
import {
  computeStats,
  type ParseResult,
  type ReportOptions,
  type SpectraPoint,
} from "./lib/parseSp3";
import {
  loadBranding,
  loadReportOptions,
  saveBranding,
  saveReportOptions,
  type Branding,
} from "./lib/settings";
import { initCrashHooks, track } from "./lib/telemetry";

function App() {
  const [dark, setDark] = useState(false);
  const [tab, setTab] = useState("report");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [options, setOptions] = useState<ReportOptions>(() => loadReportOptions());
  const [edited, setEdited] = useState<SpectraPoint[] | null>(null);
  const [branding, setBranding] = useState<Branding>(() => loadBranding());
  const [aiDraft, setAiDraft] = useState<AiDraftFields | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    initCrashHooks();
    void track("app_started", {});
  }, []);

  useEffect(() => {
    saveReportOptions(options);
  }, [options]);

  useEffect(() => {
    saveBranding(branding);
  }, [branding]);

  const handleParsed = (r: ParseResult | null, file: File | null = null) => {
    setParsed(r);
    setEdited(r ? r.spectra : null);
    setAiDraft(null);
    setCsvFile(r && r.meta.source === "spec-csv" ? file : null);
  };

  /** Switching measurements keeps the file/CSV source for further picks. */
  const handlePicked = (r: ParseResult) => {
    setParsed(r);
    setEdited(r.spectra);
    setAiDraft(null);
  };

  const effective = parsed
    ? {
        ...parsed,
        spectra: edited ?? parsed.spectra,
        stats: computeStats(edited ?? parsed.spectra),
      }
    : null;

  const handleExported = (info: { filename: string; savedPath: string | null }) => {
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
    void addHistoryEntry(entry).then(() => setHistoryTick((t) => t + 1));
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Report Maker</h1>
          <p className="text-sm text-muted-foreground">
            {effective
              ? `${effective.meta.filename} · ${effective.stats.spectra_points} pts · peak ${effective.stats.peak.amp} @ ${effective.stats.peak.freq}`
              : "Drop a .sp3 to begin."}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setDark((d) => !d)}
          aria-label="Toggle dark mode"
        >
          {dark ? <Sun /> : <Moon />}
        </Button>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
        </TabsList>
        <TabsContent value="report" className="grid gap-4">
          <MdbImportCard onConverted={handleParsed} />
          <Ingest onParsed={handleParsed} />
          {effective &&
          (effective.meta.csvPath || (effective.meta.source === "spec-csv" && csvFile)) ? (
            <MeasurementPicker
              tauriPath={effective.meta.csvPath ?? null}
              file={effective.meta.csvPath ? null : csvFile}
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
          <ReportForm options={options} onChange={setOptions} />
          <AiDraftCard parsed={effective} options={options} draft={aiDraft} onChange={setAiDraft} />
          {effective ? (
            <ChartEditor
              spectra={effective.spectra}
              onChange={setEdited}
              options={options}
              onOptions={setOptions}
            />
          ) : null}
          <BrandingCard
            options={options}
            onOptions={setOptions}
            branding={branding}
            onBranding={setBranding}
          />
          <ExportCard
            parsed={effective}
            options={options}
            branding={branding}
            aiDraft={aiDraft}
            onExported={handleExported}
          />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab
            key={historyTick}
            onReopen={(o) => {
              setOptions(o);
              setTab("report");
            }}
          />
        </TabsContent>
        <TabsContent value="design">
          <DesignDemo />
        </TabsContent>
        <TabsContent value="settings" className="grid gap-4">
          <LicenseCard />
          <AiSettingsCard />
          <TelemetryCard />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default App;
