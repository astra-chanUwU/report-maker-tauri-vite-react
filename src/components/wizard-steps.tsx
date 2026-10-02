import { Check, ChevronRight, Database, Cog, NotebookPen, FileUp } from "lucide-react";
import { cn } from "../lib/utils";
import { useUi } from "../lib/i18n";
import type { ParseResult } from "../lib/parseSp3";
import type { EquipmentItem } from "../lib/equipment";

export type WizardStep = 1 | 2 | 3 | 4;

export const WIZARD_STEPS = [
  { id: 1 as const, key: "wUpload", labelEn: "Upload .sp3", icon: Database },
  { id: 2 as const, key: "wMachines", labelEn: "Select machines", icon: Cog },
  { id: 3 as const, key: "wConfigure", labelEn: "Configure report", icon: NotebookPen },
  { id: 4 as const, key: "wExport", labelEn: "Export Word", icon: FileUp },
] as const;

export function stepFromFlow(args: {
  effective: ParseResult | null;
  equipments: EquipmentItem[];
  hasProject: boolean;
}): WizardStep {
  if (!args.effective) return 1;
  if (args.equipments.length === 0) return 2;
  if (!args.hasProject) return 3;
  return 4;
}

export function WizardBreadcrumb({
  current,
  onJump,
  effective,
  equipments,
  hasProject,
}: {
  current: WizardStep;
  onJump: (s: WizardStep) => void;
  effective: ParseResult | null;
  equipments: EquipmentItem[];
  hasProject: boolean;
}) {
  const { t } = useUi();

  const canReach = (s: WizardStep): boolean => {
    if (s === 1) return true;
    if (s === 2) return !!effective;
    if (s === 3) return !!effective; // allow config even before machines (single-equip mode)
    if (s === 4) return !!effective;
    return false;
  };

  return (
    <nav
      aria-label="Report steps"
      className="flex shrink-0 items-center gap-1 border-b bg-muted/40 px-4 py-2.5"
    >
      <ol className="flex items-center gap-1" role="list">
        {WIZARD_STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = current === step.id;
          const isDone = stepFromFlow({ effective, equipments, hasProject }) > step.id;
          const reachable = canReach(step.id);
          const label = t(step.key) !== step.key ? t(step.key) : step.labelEn;

          return (
            <li key={step.id} className="flex items-center gap-1">
              {idx > 0 ? (
                <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                onClick={() => reachable && onJump(step.id)}
                disabled={!reachable}
                aria-current={isActive ? "step" : undefined}
                aria-disabled={!reachable}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : isDone
                      ? "border-success/40 bg-success/10 text-success hover:bg-success/15"
                      : reachable
                        ? "border-input bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        : "border-input bg-muted text-muted-foreground/60 cursor-not-allowed"
                )}
                title={reachable ? `Go to ${label}` : label}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                    isActive
                      ? "bg-primary-foreground/20"
                      : isDone
                        ? "bg-success text-success-foreground"
                        : "bg-muted"
                  )}
                  aria-hidden="true"
                >
                  {isDone && !isActive ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{step.id}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <span className="ms-auto hidden text-[11px] text-muted-foreground md:inline">
        Step {current} of 4
      </span>
    </nav>
  );
}
