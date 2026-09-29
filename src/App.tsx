import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { DesignDemo } from "./components/demo";
import { ExportCard } from "./components/export-card";
import { Ingest } from "./components/ingest";
import { ReportForm } from "./components/report-form";
import type { ParseResult, ReportOptions } from "./lib/parseSp3";
import { loadReportOptions, saveReportOptions } from "./lib/settings";

function App() {
  const [dark, setDark] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [options, setOptions] = useState<ReportOptions>(() => loadReportOptions());

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    saveReportOptions(options);
  }, [options]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Report Maker</h1>
          <p className="text-sm text-muted-foreground">
            {parsed
              ? `${parsed.meta.filename} · ${parsed.stats.spectra_points} pts · peak ${parsed.stats.peak.amp} @ ${parsed.stats.peak.freq}`
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
          <Ingest onParsed={setParsed} />
          <ReportForm options={options} onChange={setOptions} />
          <ExportCard parsed={parsed} options={options} />
        </TabsContent>
        <TabsContent value="design">
          <DesignDemo />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default App;
