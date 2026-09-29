import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ChartEditor } from "./components/chart-editor";
import { DesignDemo } from "./components/demo";
import { ExportCard } from "./components/export-card";
import { Ingest } from "./components/ingest";
import { ReportForm } from "./components/report-form";
import {
  computeStats,
  type ParseResult,
  type ReportOptions,
  type SpectraPoint,
} from "./lib/parseSp3";
import { loadReportOptions, saveReportOptions } from "./lib/settings";

function App() {
  const [dark, setDark] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [options, setOptions] = useState<ReportOptions>(() => loadReportOptions());
  const [edited, setEdited] = useState<SpectraPoint[] | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    saveReportOptions(options);
  }, [options]);

  const handleParsed = (r: ParseResult | null) => {
    setParsed(r);
    setEdited(r ? r.spectra : null);
  };

  const effective = parsed
    ? {
        ...parsed,
        spectra: edited ?? parsed.spectra,
        stats: computeStats(edited ?? parsed.spectra),
      }
    : null;

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
      <Tabs defaultValue="report">
        <TabsList>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
        </TabsList>
        <TabsContent value="report" className="grid gap-4">
          <Ingest onParsed={handleParsed} />
          <ReportForm options={options} onChange={setOptions} />
          {effective ? (
            <ChartEditor
              spectra={effective.spectra}
              onChange={setEdited}
              options={options}
              onOptions={setOptions}
            />
          ) : null}
          <ExportCard parsed={effective} options={options} />
        </TabsContent>
        <TabsContent value="design">
          <DesignDemo />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default App;
