import { Download, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
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
  const STEPS = [
    { title: t("onboardingStep1Title"), body: t("onboardingStep1Body") },
    { title: t("onboardingStep2Title"), body: t("onboardingStep2Body") },
    { title: t("onboardingStep3Title"), body: t("onboardingStep3Body") },
  ];
  return (
    <Panel
      title={t("onboardingTitle")}
      description={t("onboardingStepsDesc")}
      className="flex h-full flex-col"
      contentClassName="grid flex-1 content-start gap-3"
    >
      <ol className="grid gap-2.5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <span className="grid gap-0.5">
              <span className="text-[13px] font-semibold">{s.title}</span>
              <span className="text-[13px] text-muted-foreground">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success/5 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        {t("worksOffline")}
      </div>
      <Button variant="outline" size="sm" className="justify-self-start" onClick={downloadSampleCsv}>
        <Download aria-hidden="true" />
        {t("downloadSample")}
      </Button>
    </Panel>
  );
}
