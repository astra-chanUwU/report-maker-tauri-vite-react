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
  const field = (key: string) => missing.find((m) => m.key === key);
  const edited = equipments.filter(
    (e) => e.dbLimits && JSON.stringify(e.limits) !== JSON.stringify(e.dbLimits)
  ).length;
  const checks: Check[] = [
    { label: "Database opened", state: hasData ? "ok" : "todo", page: "data" },
    {
      label: "Machines selected",
      detail:
        equipments.length > 0
          ? `${equipments.length} machine${equipments.length === 1 ? "" : "s"}`
          : "Without machines the report covers the single open measurement.",
      state: equipments.length > 0 ? "ok" : "optional",
      page: "machines",
    },
    ...(["project", "engineer", "date"] as const).map((k) => {
      const m = field(k);
      return {
        label: { project: "Project name", engineer: "Engineer", date: "Report date" }[k],
        detail: k === "project" && !m ? options.projectName : undefined,
        state: m ? ("todo" as const) : ("ok" as const),
        page: "details" as const,
        focusId: m?.focusId,
      };
    }),
    {
      label: "Findings",
      detail: findingsFilled ? "Written" : "A short automatic summary is used when left empty.",
      state: findingsFilled ? "ok" : "optional",
      page: "findings",
    },
    {
      label: "Alarm limits",
      detail:
        equipments.length === 0
          ? "Default limits from Settings."
          : edited > 0
            ? `${edited} machine${edited === 1 ? "" : "s"} edited, the rest from the database.`
            : "From the database for every machine.",
      state: "ok",
      page: "alarms",
    },
  ];

  const sec = secondaryLabels(options.secondaryMetric ?? "acceleration", options.language ?? "en");
  const iso =
    options.includeIsoTable === false || options.isoPosition === "off"
      ? "Off"
      : options.isoPosition === "afterToc"
        ? "After the contents"
        : "At the end";
  const sections: [string, string][] = [
    ["Language", options.language === "fa" ? "Persian (RTL)" : "English"],
    [
      "Measuring results",
      options.showSecondary === false ? "Velocity only" : `Velocity + ${sec.short.toLowerCase()}`,
    ],
    ["Trend sparklines", options.trendZoneBands === false ? "Plain" : "With alarm bands"],
    ["Full-size trend pages", options.trendPages ? "Yes" : "No"],
    ["FFT spectra grid", options.fftAllPoints === false ? "No" : "Yes"],
    ["ISO 10816-3 table", `${iso}${options.useCustomIso ? " (edited values)" : ""}`],
    ["Table of contents", options.includeToc === false ? "No" : "Yes"],
  ];

  const ready = hasData && missing.length === 0;
  const filename = `${sanitizeFilename(options.projectName)}-${options.reportDate || "YYYY-MM-DD"}.docx`;

  const reveal = async () => {
    if (!lastSaved) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(lastSaved);
    } catch {
      toast.error("Could not open the folder.");
    }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-4">
        <Panel title="Before you generate" contentClassName="grid gap-0.5">
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
                    {c.state === "todo" ? (
                      <span className="ms-2 text-xs font-normal text-destructive">Required</span>
                    ) : null}
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
          title="What the report contains"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onNavigate("alarms")}>
              Change
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
        title="Word report"
        description="Editable .docx — keep browsing while it generates."
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
              ? `Generating ${progress.percent}%`
              : "Generating…"
            : ready
              ? "Generate report"
              : "Check and generate"}
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
              {progress?.detail || (progress ? stageLabel(progress.stage) : "Working…")} · keep
              browsing while this runs
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {ready
              ? "You choose where to save it. Ctrl+E works from any page."
              : "Missing required items are highlighted when you press the button."}
          </p>
        )}
        {lastSaved ? (
          <Button variant="outline" size="sm" onClick={() => void reveal()} title={lastSaved}>
            <FolderOpen aria-hidden="true" />
            Show last report in folder
          </Button>
        ) : null}
      </Panel>
    </div>
  );
}
