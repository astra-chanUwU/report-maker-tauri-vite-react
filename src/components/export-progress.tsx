import { CheckCircle2, AlertCircle, FileDown, Loader2, X } from "lucide-react";
import {
  stageLabel,
  type ExportProgress as Progress,
  type ExportStage,
} from "../lib/export-progress";
import { useUi } from "../lib/i18n";
import { Button } from "./ui/button";

function isActive(stage: ExportStage): boolean {
  return stage !== "idle" && stage !== "done" && stage !== "failed";
}

export function ExportProgressPanel({
  progress,
  onDismiss,
}: {
  progress: Progress;
  onDismiss?: () => void;
}) {
  const { t } = useUi();
  if (progress.stage === "idle") return null;
  const active = isActive(progress.stage);
  const pct = progress.percent ?? (active ? undefined : progress.stage === "done" ? 100 : 0);
  const label = progress.detail || stageLabel(progress.stage, t);

  return (
    <div
      className="grid gap-2 rounded-md border bg-card p-3"
      role="status"
      aria-live="polite"
      aria-busy={active}
    >
      <div className="flex items-center gap-2">
        {progress.stage === "done" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        ) : progress.stage === "failed" ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        )}
        <FileDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[13px] font-semibold">
          {progress.stage === "done"
            ? t("reportReady")
            : progress.stage === "failed"
              ? t("exportFailedLabel")
              : t("generatingReport")}
        </span>
        {typeof pct === "number" ? (
          <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
        ) : null}
        {!active && onDismiss ? (
          <Button variant="ghost" size="sm" onClick={onDismiss} aria-label={t("dismiss")}>
            <X aria-hidden="true" />
            {t("dismiss")}
          </Button>
        ) : null}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={typeof pct === "number" ? pct : undefined}
        aria-label={label}
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
      <p className="text-xs text-muted-foreground">
        {progress.stage === "failed" && progress.error
          ? progress.error
          : active
            ? `${label} · ${t("keepBrowsingSuffix")}`
            : label}
      </p>
    </div>
  );
}

export function ExportPill({ progress }: { progress: Progress }) {
  const { t } = useUi();
  if (!isActive(progress.stage)) return null;
  const pct = progress.percent;
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary lg:flex"
      aria-live="polite"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {typeof pct === "number" ? t("exportingWithPercent", { percent: pct }) : t("exportingEllipsis")}
    </span>
  );
}
