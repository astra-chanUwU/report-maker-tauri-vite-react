import { Loader2, X, CheckCircle2, AlertCircle, Database } from "lucide-react";
import { formatBytes, type ImportJob, type ImportStage } from "../lib/import-jobs";
import { useUi } from "../lib/i18n";
import { Badge } from "./ui/form";
import { Button } from "./ui/button";

function stageText(stage: ImportStage, t: (k: string) => string): string {
  switch (stage) {
    case "queued":
      return t("importQueued");
    case "exporting":
      return t("importExportingData");
    case "catalog":
      return t("importBuildingCatalog");
    case "indexing":
      return t("importIndexingRows");
    case "ready":
      return t("importReady");
    case "failed":
      return t("importFailed");
  }
}

function phaseDetail(job: ImportJob, t: (k: string, p?: Record<string, string | number>) => string): string {
  const elapsed = job.elapsedSec != null ? ` · ${job.elapsedSec}s` : "";
  const speed = job.speedMbs != null ? ` · ${job.speedMbs.toFixed(1)} MB/s` : "";
  if (job.stage === "exporting") return `${t("dumpingDataTable")}${elapsed}${speed}`;
  if (job.stage === "catalog") return `${t("readingPlantMachine")}${elapsed}`;
  if (job.stage === "indexing") return `${t("parsingPreview")}${elapsed}`;
  return stageText(job.stage, t);
}

function JobBar({ job, t }: { job: ImportJob; t: (k: string) => string }) {
  const active = job.stage !== "ready" && job.stage !== "failed";
  const pct =
    job.stage === "ready"
      ? 100
      : job.stage === "failed"
        ? 0
        : job.percent ?? (active ? undefined : 0);

  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={typeof pct === "number" ? pct : undefined}
      aria-label={`${job.filename} ${stageText(job.stage, t)}`}
    >
      <div
        className={
          typeof pct === "number"
            ? "h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            : "h-full w-1/3 animate-pulse rounded-full bg-primary"
        }
        style={typeof pct === "number" ? { width: `${Math.min(100, Math.max(0, pct))}%` } : undefined}
      />
    </div>
  );
}

export function ImportProgress({
  jobs,
  onDismiss,
  onCancel,
}: {
  jobs: ImportJob[];
  onDismiss: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const { t } = useUi();
  if (jobs.length === 0) return null;
  const active = jobs.filter((j) => j.stage !== "ready" && j.stage !== "failed");
  const done = jobs.filter((j) => j.stage === "ready" || j.stage === "failed");
  return (
    <div className="grid gap-2 rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-[13px] font-semibold">
          {active.length > 0
            ? t("importingDbs", { count: active.length, plural: active.length > 1 ? "s" : "" })
            : t("importFinished")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("jobsCount", { count: jobs.length, plural: jobs.length > 1 ? "s" : "" })}
        </span>
      </div>
      <ul className="grid gap-2">
        {jobs.map((j) => (
          <li key={j.id} className="grid gap-1.5 rounded-md border bg-muted/40 px-2.5 py-2 text-[13px]">
            <div className="flex items-center gap-2">
              {j.stage === "ready" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              ) : j.stage === "failed" ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium" title={j.path}>
                {j.filename}
              </span>
              {typeof j.percent === "number" && j.stage !== "ready" && j.stage !== "failed" ? (
                <span className="text-xs tabular-nums text-muted-foreground">{j.percent}%</span>
              ) : null}
              <Badge tone={j.stage === "failed" ? "danger" : j.stage === "ready" ? "success" : "neutral"}>
                {j.stage === "failed" ? j.error?.slice(0, 40) || t("failedShort") : stageText(j.stage, t)}
              </Badge>
              {j.stage !== "ready" && j.stage !== "failed" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancel(j.id)}
                  aria-label={`${t("cancel")} ${j.filename}`}
                >
                  <X aria-hidden="true" />
                  {t("cancel")}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => onDismiss(j.id)}>
                  {t("dismissBtn")}
                </Button>
              )}
            </div>
            {j.stage !== "failed" ? <JobBar job={j} t={t} /> : null}
            <p className="text-xs text-muted-foreground">
              {j.stage === "failed" && j.error ? j.error : j.progress || phaseDetail(j, t)}
            </p>
            {(typeof j.bytes === "number" || typeof j.rows === "number") && j.stage !== "failed" ? (
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
                <span>{j.filename}</span>
                {typeof j.bytes === "number" ? <span>{formatBytes(j.bytes)}</span> : null}
                {typeof j.rows === "number" ? <span>{j.rows.toLocaleString()} {t("rowsLabel")}</span> : null}
                {typeof j.elapsedSec === "number" ? <span>{t("elapsedSec", { sec: j.elapsedSec })}</span> : null}
                {typeof j.speedMbs === "number" ? <span>{j.speedMbs.toFixed(1)} MB/s</span> : null}
              </p>
            ) : null}
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              {t("stepLabel", { step: j.stage === "catalog" ? "2/3" : j.stage === "indexing" ? "3/3" : j.stage === "exporting" ? "1/3" : "—" })} · {phaseDetail(j, t)}
            </p>
          </li>
        ))}
      </ul>
      {done.length > 0 && active.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("doneOpenAnother")}
        </p>
      ) : null}
    </div>
  );
}

export function ImportPill({ jobs }: { jobs: ImportJob[] }) {
  const { t } = useUi();
  const active = jobs.filter((j) => j.stage !== "ready" && j.stage !== "failed");
  if (active.length === 0) return null;
  const pct = active.length === 1 ? active[0].percent : undefined;
  const phase = active.length === 1 ? stageText(active[0].stage, t) : t("dbsLabel", { count: active.length });
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary lg:flex"
      aria-live="polite"
      title={active.map((j) => `${j.filename}: ${stageText(j.stage, t)} ${j.percent ?? ""}%`).join(" · ")}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {phase}
      {typeof pct === "number" ? ` ${pct}%` : ` ${active.length}`}
    </span>
  );
}
