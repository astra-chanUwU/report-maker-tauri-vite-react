import { Loader2, X, CheckCircle2, AlertCircle, Database } from "lucide-react";
import type { ImportJob } from "../lib/import-jobs";
import { Badge } from "./ui/form";
import { Button } from "./ui/button";

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
      <ul className="grid gap-1.5">
        {jobs.map((j) => (
          <li
            key={j.id}
            className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-[13px]"
          >
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
            <Badge tone={j.stage === "failed" ? "danger" : j.stage === "ready" ? "success" : "neutral"}>
              {j.stage === "failed" ? j.error?.slice(0, 40) || "failed" : j.stage}
            </Badge>
            {j.stage !== "ready" && j.stage !== "failed" ? (
              <Button variant="ghost" size="sm" onClick={() => onCancel(j.id)} aria-label={`Cancel ${j.filename}`}>
                <X aria-hidden="true" />
                Cancel
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => onDismiss(j.id)}>
                Dismiss
              </Button>
            )}
          </li>
        ))}
      </ul>
      {done.length > 0 && active.length === 0 ? (
        <p className="text-xs text-muted-foreground">Done — you can open another database or continue editing.</p>
      ) : null}
    </div>
  );
}

export function ImportPill({ jobs }: { jobs: ImportJob[] }) {
  const active = jobs.filter((j) => j.stage !== "ready" && j.stage !== "failed").length;
  if (active === 0) return null;
  return (
    <span className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary lg:flex" aria-live="polite">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      Importing {active}
    </span>
  );
}
