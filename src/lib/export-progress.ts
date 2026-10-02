/** Phased export status so the UI can show a bar while heavy work yields. */

export type ExportStage =
  | "idle"
  | "preparing"
  | "envelope"
  | "trends"
  | "fft"
  | "building"
  | "packing"
  | "saving"
  | "done"
  | "failed";

export interface ExportProgress {
  stage: ExportStage;
  /** 0–100 when known; indeterminate when omitted. */
  percent?: number;
  detail?: string;
  error?: string;
}

export const IDLE_EXPORT: ExportProgress = { stage: "idle" };

const STAGE_WEIGHT: Record<ExportStage, number> = {
  idle: 0,
  preparing: 5,
  envelope: 15,
  trends: 25,
  fft: 55,
  building: 75,
  packing: 90,
  saving: 97,
  done: 100,
  failed: 0,
};

export function stageLabel(stage: ExportStage): string {
  switch (stage) {
    case "preparing":
      return "Preparing…";
    case "envelope":
      return "Loading envelope data…";
    case "trends":
      return "Building trend charts…";
    case "fft":
      return "Rendering spectra…";
    case "building":
      return "Assembling document…";
    case "packing":
      return "Packing Word file…";
    case "saving":
      return "Saving…";
    case "done":
      return "Report ready";
    case "failed":
      return "Export failed";
    default:
      return "";
  }
}

const STAGE_ORDER: ExportStage[] = [
  "preparing",
  "envelope",
  "trends",
  "fft",
  "building",
  "packing",
  "saving",
  "done",
];

export function estimatePercent(stage: ExportStage, fraction = 0): number {
  const base = STAGE_WEIGHT[stage];
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx < 0 || fraction <= 0) return base;
  const next = STAGE_ORDER[idx + 1];
  if (!next) return base;
  const ceiling = STAGE_WEIGHT[next];
  return Math.round(base + (ceiling - base) * Math.min(1, Math.max(0, fraction)));
}

/** Yield to the event loop so React can paint progress and the UI stays interactive. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (s?.yield) {
      void s.yield().then(resolve, () => setTimeout(resolve, 0));
      return;
    }
    setTimeout(resolve, 0);
  });
}
