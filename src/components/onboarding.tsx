import { Download, FileSpreadsheet, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { useUi } from "../lib/i18n";

function downloadSampleCsv() {
  const header =
    "DataID,PointID,DirectionID,NoLines,BandWidth,Unit,MeasDate,ValuePeakMaxV,FreqPeakMaxV,TotalRMSV,Specdata";
  const encodeOctal = (values: number[]) => {
    const buf = new ArrayBuffer(values.length * 4);
    const view = new DataView(buf);
    values.forEach((v, i) => view.setFloat32(i * 4, v, true));
    const bytes = new Uint8Array(buf);
    return '"' + [...bytes].map((b) => "\\" + b.toString(8).padStart(3, "0")).join("") + '"';
  };
  // two demo rows — same shape as real Data exports
  const row1 = `1,7,1,4,0.5,"mm/s",45811.43922453703,0.5,1.0,0.83,${encodeOctal([0.1, 0.5, 0.2, 0.05])}`;
  const row2 = `2,9,2,4,0.5,"mm/s",45812.43922453703,0.4,1.5,0.9,${encodeOctal([0.2, 0.1, 0.4, 0.05])}`;
  const csv = `${header}\n${row1}\n${row2}\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sample-data.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function Onboarding() {
  const { t } = useUi();
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t("onboardingTitle")}
        </CardTitle>
        <CardDescription>{t("onboardingHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="grid gap-2 text-sm">
          <li className="flex gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              1
            </span>
            <span>
              <strong>Drop a file</strong> — Data-table CSV (<code>mdb-export file.sp3 Data</code>)
              or a plain <code>.txt</code> with <code>freq,amp</code> per line. In the desktop app
              you can also hit <em>Open .sp3 file</em> to convert automatically.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              2
            </span>
            <span>
              <strong>Fill Project &amp; Engineer</strong> — required before export; the filename
              previews as <code>project-name-YYYY-MM-DD.docx</code>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              3
            </span>
            <span>
              <strong>Generate Report</strong> — editable Word with spectra table, chart PNG,
              overall vibration, and optional AI draft. Or browse <em>History</em> to reopen past
              reports.
            </span>
          </li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={downloadSampleCsv}>
            <Download aria-hidden="true" />
            {t("downloadSample")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              document.getElementById("ingest")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <FileSpreadsheet aria-hidden="true" />
            Drop your file
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: desktop build auto-detects <code>mdb-export</code> via <code>MDB_EXPORT_PATH</code>{" "}
          or Settings → Tool path. Large exports (100s of MB) preview the first row; pick any
          measurement after.
        </p>
      </CardContent>
    </Card>
  );
}
