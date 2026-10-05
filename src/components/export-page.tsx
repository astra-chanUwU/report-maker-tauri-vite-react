import {
  CircleAlert,
  CircleCheck,
  Circle,
  Download,
  FileText,
  FolderOpen,
  Loader2,
} from "lucide-react";
import type { EquipmentItem } from "../lib/equipment";
import { stageLabel, type ExportProgress } from "../lib/export-progress";
import { secondaryLabels } from "../lib/metrics";
import type { ReportOptions } from "../lib/parseSp3";
import { cn } from "../lib/utils";
import { EXPORT_EVENT, sanitizeFilename } from "./export-card";
import type { MissingItem, PageId } from "./shell";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

interface Check {
  label: string;
  detail?: string;
  state: "ok" | "todo" | "optional";
  page?: PageId;
  focusId?: string;
}

/** Wizard step 4: what is still missing, what the report will contain, and the Generate button. */
export function ExportPage({
  hasData,
  missing,
  onFix,
  onNavigate,
  options,
  equipments,
  findingsFilled,
  busy,
  progress,
  lastSaved,
}: {
  hasData: boolean;
  missing: MissingItem[];
  onFix: (m: MissingItem) => void;
  onNavigate: (p: PageId) => void;
  options: ReportOptions;
  equipments: EquipmentItem[];
  findingsFilled: boolean;
  busy: boolean;
  progress?: ExportProgress;
  lastSaved: string | null;
}) {
  const { t } = useUi();
  const field = (key: string) => missing.find((m) => m.key === key);
  const edited = equipments.filter(
    (e) => e.dbLimits && JSON.stringify(e.limits) !== JSON.stringify(e.dbLimits)
  ).length;
  const checks: Check[] = [
    { label: t("databaseOpened"), state: hasData ? "ok" : "todo", page: "data" },
    {
      label: t("machinesSelected"),
      detail:
        equipments.length > 0
          ? `${equipments.length} machine${equipments.length === 1 ? "" : "s"}`
          : t("withoutMachinesDetail"),
      state: equipments.length > 0 ? "ok" : "optional",
      page: "machines",
    },
    ...(["project", "engineer", "date"] as const).map((k) => {
      const m = field(k);
      return {
        label: { project: t("projectName").replace(" *", ""), engineer: t("engineer").replace(" *", ""), date: t("reportDate") }[k],
        detail: k === "project" && !m ? options.projectName : undefined,
        state: m ? ("todo" as const) : ("ok" as const),
        page: "details" as const,
        focusId: m?.focusId,
      };
    }),
    {
      label: t("findings"),
      detail: findingsFilled ? t("findingsWritten") : t("findingsAutoSummary"),
      state: findingsFilled ? "ok" : "optional",
      page: "findings",
    },
    {
      label: t("alarmLimitsLabel"),
      detail:
        equipments.length === 0
          ? t("alarmLimitsDefault")
          : edited > 0
            ? t("alarmLimitsEdited", { count: edited, plural: edited === 1 ? "" : "s" })
            : t("alarmLimitsFromDb"),
      state: "ok",
      page: "alarms",
    },
  ];

  const sec = secondaryLabels(options.secondaryMetric ?? "acceleration", options.language ?? "en");
  const iso =
    options.includeIsoTable === false || options.isoPosition === "off"
      ? t("isoOff")
      : options.isoPosition === "afterToc"
        ? t("isoAfterToc")
        : t("isoEnd");
  const sections: [string, string][] = [
    [t("languageLabel"), options.language === "fa" ? "Persian (RTL)" : "English"],
    [t("measuringResults"), options.showSecondary === false ? t("velocityOnly") : t("velocityPlus", { metric: sec.short.toLowerCase() })],
    [t("trendSparklines"), options.trendZoneBands === false ? t("plain") : t("withBands")],
    [t("fullTrendPages"), options.trendPages ? t("yes") : t("no")],
    [t("fftSpectraGrid"), options.fftAllPoints === false ? t("no") : t("yes")],
    [t("isoTable"), `${iso}${options.useCustomIso ? " (edited values)" : ""}`],
    [t("toc"), options.includeToc === false ? t("no") : t("yes")],
  ];

  const ready = hasData && missing.length === 0;
  const filename = `${sanitizeFilename(options.projectName)}-${options.reportDate || "YYYY-MM-DD"}.docx`;

  const reveal = async () => {
    if (!lastSaved) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(lastSaved);
    } catch {
      toast.error(t("toastCouldNotOpenFolder"));
    }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-4">
        <Panel title={t("beforeGenerate")} contentClassName="grid gap-0.5">
          {checks.map((c) => {
            const Icon = c.state === "ok" ? CircleCheck : c.state === "todo" ? CircleAlert : Circle;
            return (
              <button
                key={c.label}
                type="button"
                onClick={() =>
                  c.state === "todo" && c.page
                    ? onFix({ key: c.label, label: c.label, page: c.page, focusId: c.focusId })
                    : c.page && onNavigate(c.page)
                }
                className="flex cursor-default items-start gap-2.5 rounded-md px-2 py-2 text-start hover:bg-muted/70"
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    c.state === "ok"
                      ? "text-success"
                      : c.state === "todo"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  )}
                  aria-hidden="true"
                />
                <span className="grid gap-0.5">
                  <span className="text-[13px] font-medium">
                    {c.label}
                    {c.state === "todo" ? <span className="ms-2 text-xs font-normal text-destructive">{t("required")}</span> : null}
                  </span>
                  {c.detail ? (
                    <span className="text-xs text-muted-foreground">{c.detail}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </Panel>
        <Panel
          title={t("whatReportContains")}
          actions={
            <Button variant="ghost" size="sm" onClick={() => onNavigate("alarms")}>
              {t("change")}
            </Button>
          }
        >
          <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            {sections.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {equipments.length > 0 ? (
            <ol className="mt-4 grid gap-1 border-t pt-3 text-[13px]">
              {equipments.map((e, i) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="truncate">{e.name}</span>
                  {e.plant ? (
                    <span className="truncate text-muted-foreground">· {e.plant}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </Panel>
      </div>

      <Panel
        className="lg:sticky lg:top-0 lg:shadow-sm"
        icon={<FileText />}
        title={t("wordReport")}
        description={t("wordReportDesc")}
        contentClassName="grid gap-3"
      >
        <p
          className="truncate rounded-md bg-muted/70 px-2.5 py-2 font-mono text-[12px] text-muted-foreground"
          title={filename}
        >
          {filename}
        </p>
        <Button
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => window.dispatchEvent(new Event(EXPORT_EVENT))}
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {busy
            ? typeof progress?.percent === "number"
              ? t("generatingWithPercent", { percent: progress.percent })
              : t("generatingEllipsis")
            : ready
              ? t("generateReport")
              : t("checkAndGenerate")}
        </Button>
        {busy || (progress && progress.stage !== "idle" && progress.stage !== "done") ? (
          <div className="grid gap-1.5">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress?.percent}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progress?.percent ?? 8))}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {progress?.detail || (progress ? stageLabel(progress.stage) : "Working…")} · {t("keepBrowsing")}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{ready ? t("readySaveHint") : t("missingHint")}</p>
        )}
        {lastSaved ? (
          <Button variant="outline" size="sm" onClick={() => void reveal()} title={lastSaved}>
            <FolderOpen aria-hidden="true" />
            {t("showLastInFolder")}
          </Button>
        ) : null}
      </Panel>
    </div>
  );
}
