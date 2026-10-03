import { Loader2, X, CheckCircle2, AlertCircle, Database } from "lucide-react";
import { formatBytes, type ImportJob, type ImportStage } from "../lib/import-jobs";
import { Badge } from "./ui/form";
import { Button } from "./ui/button";

function stageText(stage: ImportStage): string {
  switch (stage) {
    case "queued":
      return "Queued";
    case "exporting":
      return "Exporting Data";
    case "catalog":
      return "Building catalog";
    case "indexing":
      return "Indexing rows";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
  }
}

function phaseDetail(job: ImportJob): string {
  const elapsed = job.elapsedSec != null ? ` · ${job.elapsedSec}s` : "";
  const speed = job.speedMbs != null ? ` · ${job.speedMbs.toFixed(1)} MB/s` : "";
  if (job.stage === "exporting") return `Dumping Data table${elapsed}${speed}`;
  if (job.stage === "catalog") return `Reading Plant/Machine/Point/Direction${elapsed}`;
  if (job.stage === "indexing") return `Parsing preview & indexing${elapsed}`;
  return stageText(job.stage);
}

function JobBar({ job }: { job: ImportJob }) {
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
      aria-label={`${job.filename} ${stageText(job.stage)}`}
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
  if (jobs.length === 0) return null;
  const active = jobs.filter((j) => j.stage !== "ready" && j.stage !== "failed");
  const done = jobs.filter((j) => j.stage === "ready" || j.stage === "failed");
  return (
    <div className="grid gap-2 rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-[13px] font-semibold">
          {active.length > 0
            ? `Importing ${active.length} database${active.length > 1 ? "s" : ""}…`
            : `Import finished`}
        </span>
        <span className="text-xs text-muted-foreground">
          {jobs.length} job{jobs.length > 1 ? "s" : ""} · you can keep working
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
                {j.stage === "failed" ? j.error?.slice(0, 40) || "failed" : stageText(j.stage)}
              </Badge>
              {j.stage !== "ready" && j.stage !== "failed" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancel(j.id)}
                  aria-label={`Cancel ${j.filename}`}
                >
                  <X aria-hidden="true" />
                  Cancel
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => onDismiss(j.id)}>
                  Dismiss
                </Button>
              )}
            </div>
            {j.stage !== "failed" ? <JobBar job={j} /> : null}
            <p className="text-xs text-muted-foreground">
              {j.stage === "failed" && j.error ? j.error : j.progress || phaseDetail(j)}
            </p>
            {(typeof j.bytes === "number" || typeof j.rows === "number") && j.stage !== "failed" ? (
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
                <span>{j.filename}</span>
                {typeof j.bytes === "number" ? <span>{formatBytes(j.bytes)}</span> : null}
                {typeof j.rows === "number" ? <span>{j.rows.toLocaleString()} rows</span> : null}
                {typeof j.elapsedSec === "number" ? <span>{j.elapsedSec}s elapsed</span> : null}
                {typeof j.speedMbs === "number" ? <span>{j.speedMbs.toFixed(1)} MB/s</span> : null}
              </p>
            ) : null}
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              Step {j.stage === "catalog" ? "2/3" : j.stage === "indexing" ? "3/3" : j.stage === "exporting" ? "1/3" : "—"} · {phaseDetail(j)}
            </p>
          </li>
        ))}
      </ul>
      {done.length > 0 && active.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Done — you can open another database or continue editing.
        </p>
      ) : null}
    </div>
  );
}

export function ImportPill({ jobs }: { jobs: ImportJob[] }) {
  const active = jobs.filter((j) => j.stage !== "ready" && j.stage !== "failed");
  if (active.length === 0) return null;
  const pct = active.length === 1 ? active[0].percent : undefined;
  const phase = active.length === 1 ? stageText(active[0].stage) : `${active.length} DBs`;
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary lg:flex"
      aria-live="polite"
      title={active.map((j) => `${j.filename}: ${stageText(j.stage)} ${j.percent ?? ""}%`).join(" · ")}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {phase}
      {typeof pct === "number" ? ` ${pct}%` : ` ${active.length}`}
    </span>
  );
}
