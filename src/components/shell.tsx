import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  Cog,
  Database,
  FileBarChart2,
  FileDown,
  FileUp,
  Gauge,
  History,
  LayoutTemplate,
  LineChart,
  ListChecks,
  Monitor,
  Moon,
  NotebookPen,
  Settings,
  Siren,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useUi } from "../lib/i18n";

export type PageId =
  | "data"
  | "machines"
  | "details"
  | "equipment"
  | "measurements"
  | "findings"
  | "alarms"
  | "chart"
  | "layout"
  | "export"
  | "history"
  | "settings";

type NavItem = { id: PageId; icon: LucideIcon; label: string; desc: string };

export type WizardStepId = 1 | 2 | 3 | 4;

export interface WizardStep {
  n: WizardStepId;
  label: string;
  items: NavItem[];
}

/** Open database → Select machines → Edit report (sub-pages) → Export. */
export const WIZARD: WizardStep[] = [
  {
    n: 1,
    label: "stepOpen",
    items: [{ id: "data", icon: Database, label: "navData", desc: "pageDataDesc" }],
  },
  {
    n: 2,
    label: "stepMachines",
    items: [{ id: "machines", icon: ListChecks, label: "navMachines", desc: "pageMachinesDesc" }],
  },
  {
    n: 3,
    label: "stepEdit",
    items: [
      { id: "details", icon: NotebookPen, label: "navDetails", desc: "pageDetailsDesc" },
      { id: "equipment", icon: Cog, label: "navEquipment", desc: "pageEquipmentDesc" },
      { id: "measurements", icon: Gauge, label: "navMeasurements", desc: "pageMeasurementsDesc" },
      { id: "findings", icon: FileBarChart2, label: "navFindings", desc: "pageFindingsDesc" },
      { id: "alarms", icon: Siren, label: "navAlarms", desc: "pageAlarmsDesc" },
      { id: "chart", icon: LineChart, label: "navChart", desc: "pageChartDesc" },
      { id: "layout", icon: LayoutTemplate, label: "navLayout", desc: "pageLayoutDesc" },
    ],
  },
  {
    n: 4,
    label: "stepExport",
    items: [{ id: "export", icon: FileDown, label: "navExport", desc: "pageExportDesc" }],
  },
];

export const WORKFLOW_NAV: NavItem[] = WIZARD.flatMap((s) => s.items);

export const APP_NAV: NavItem[] = [
  { id: "history", icon: History, label: "navHistory", desc: "pageHistoryDesc" },
  { id: "settings", icon: Settings, label: "navSettings", desc: "pageSettingsDesc" },
];

export const ALL_NAV = [...WORKFLOW_NAV, ...APP_NAV];

export function stepOfPage(p: PageId): WizardStepId | null {
  return WIZARD.find((s) => s.items.some((i) => i.id === p))?.n ?? null;
}

export type NavIndicator = { kind: "done" } | { kind: "warn" } | { kind: "count"; value: number };

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

const COLLAPSE_KEY = "report-maker:sidebar-collapsed";

export function Sidebar({
  page,
  onNavigate,
  indicators,
  stepDone,
  version,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  indicators: Partial<Record<PageId, NavIndicator>>;
  stepDone: Partial<Record<WizardStepId, boolean>>;
  version: string;
}) {
  const { t } = useUi();
  const narrow = useMediaQuery("(max-width: 1023px)");
  const [userCollapsed, setUserCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const collapsed = narrow || userCollapsed;

  const toggle = () => {
    const next = !userCollapsed;
    setUserCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const currentStep = stepOfPage(page);

  /** Numbered wizard step: circle (number / check) + label; single-page steps navigate directly. */
  const renderStep = (step: WizardStep) => {
    const here = currentStep === step.n;
    const done = !!stepDone[step.n] && !here;
    const single = step.items.length === 1;
    const target = step.items[0].id;
    const label = t(step.label);
    const active = single && page === target;
    return (
      <li key={step.n} className="grid gap-0.5">
        <button
          type="button"
          onClick={() => onNavigate(target)}
          aria-current={active ? "page" : here ? "step" : undefined}
          title={collapsed ? `${step.n}. ${label} (Ctrl+${step.n})` : `Ctrl+${step.n}`}
          className={cn(
            "group relative flex h-10 w-full cursor-default items-center gap-3 rounded-md text-[13px] font-semibold transition-colors",
            collapsed ? "justify-center px-0" : "px-2",
            active
              ? "bg-sidebar-active text-white"
              : here
                ? "text-white hover:bg-sidebar-accent"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
          )}
        >
          {active ? (
            <span
              className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-primary"
              aria-hidden="true"
            />
          ) : null}
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] tabular-nums",
              done
                ? "bg-success text-white"
                : here
                  ? "bg-primary text-primary-foreground"
                  : "border border-sidebar-muted/60 text-sidebar-muted"
            )}
            aria-hidden="true"
          >
            {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step.n}
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-start">{label}</span>
              {single ? renderIndicator(indicators[target]) : null}
            </>
          ) : null}
        </button>
        {!single && (here || !collapsed) ? (
          <ul
            className={cn(
              "grid gap-0.5",
              !collapsed && "ms-[1.3rem] border-s border-sidebar-border ps-1.5"
            )}
          >
            {step.items.map((item) => renderItem(item))}
          </ul>
        ) : null}
      </li>
    );
  };

  const renderIndicator = (ind: NavIndicator | undefined) =>
    ind?.kind === "done" ? (
      <CheckCircle2 className="h-4 w-4 text-success" aria-label="Done" />
    ) : ind?.kind === "warn" ? (
      <AlertCircle className="h-4 w-4 text-warning" aria-label="Needs attention" />
    ) : ind?.kind === "count" && ind.value > 0 ? (
      <span className="rounded bg-sidebar-accent px-1.5 text-[11px] text-sidebar-muted tabular-nums group-hover:bg-sidebar">
        {ind.value > 999 ? "999+" : ind.value}
      </span>
    ) : null;

  const renderItem = (item: NavItem, shortcut?: number) => {
    const active = page === item.id;
    const ind = indicators[item.id];
    const Icon = item.icon;
    const label = t(item.label);
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => onNavigate(item.id)}
          aria-current={active ? "page" : undefined}
          title={
            collapsed
              ? shortcut
                ? `${label} (Ctrl+${shortcut})`
                : label
              : shortcut
                ? `Ctrl+${shortcut}`
                : undefined
          }
          className={cn(
            "group relative flex h-8 w-full cursor-default items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors",
            collapsed ? "justify-center px-0" : "px-2",
            active
              ? "bg-sidebar-active text-white"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
          )}
        >
          {active ? (
            <span
              className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-primary"
              aria-hidden="true"
            />
          ) : null}
          <span className="relative">
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {collapsed && ind && ind.kind !== "count" ? (
              <span
                className={cn(
                  "absolute -end-1 -top-1 h-2 w-2 rounded-full ring-2 ring-sidebar",
                  ind.kind === "done" ? "bg-success" : "bg-warning"
                )}
                aria-hidden="true"
              />
            ) : null}
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-start">{label}</span>
              {renderIndicator(ind)}
            </>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150",
        collapsed ? "w-14" : "w-56"
      )}
      aria-label="Main navigation"
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2.5 border-b border-sidebar-border",
          collapsed ? "justify-center" : "px-4"
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <FileBarChart2 className="h-[18px] w-[18px]" aria-hidden="true" />
        </div>
        {!collapsed ? (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-white">{t("appTitle")}</p>
            <p className="text-[11px] text-sidebar-muted">v{version}</p>
          </div>
        ) : null}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
        <div className="grid gap-1">
          {!collapsed ? (
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
              {t("navGroupReport")}
            </p>
          ) : null}
          <ol className="grid gap-1">{WIZARD.map(renderStep)}</ol>
        </div>
        <div className="mt-auto grid gap-1">
          {!collapsed ? (
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
              {t("navGroupApp")}
            </p>
          ) : null}
          <ul className="grid gap-0.5">{APP_NAV.map((item, i) => renderItem(item, 8 + i))}</ul>
        </div>
      </nav>
      {!narrow ? (
        <div className="border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "flex h-8 w-full cursor-default items-center gap-2 rounded-md text-xs text-sidebar-muted hover:bg-sidebar-accent hover:text-white",
              collapsed ? "justify-center" : "px-2.5"
            )}
            aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
            title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                {t("collapseSidebar")}
              </>
            )}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

export type MissingItem = { key: string; label: string; page: PageId; focusId?: string };

/** "Ready" / "N to fix" pill with a dropdown that jumps to each missing field. */
export function ReadinessChip({
  missing,
  onFix,
}: {
  missing: MissingItem[];
  onFix: (m: MissingItem) => void;
}) {
  const { t } = useUi();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (missing.length === 0) {
    return (
      <span
        className="hidden items-center gap-1.5 text-xs font-medium text-success md:flex"
        role="status"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {t("readyToExport")}
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex h-8 cursor-default items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2.5 text-xs font-medium hover:bg-warning/20"
      >
        <AlertCircle className="h-4 w-4 text-warning" aria-hidden="true" />
        {missing.length} {t("toFix")}
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-40 mt-1 w-64 rounded-md border bg-popover p-1 shadow-lg">
          {missing.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setOpen(false);
                onFix(m);
              }}
              className="flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-start text-[13px] hover:bg-muted"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Toolbar({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base leading-tight font-semibold">{title}</h1>
        {description ? (
          <p className="hidden truncate text-xs text-muted-foreground md:block">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </header>
  );
}

/** Back / Next through the wizard pages in order. Hidden outside the workflow. */
export function WizardFooter({
  page,
  onNavigate,
  pages = WORKFLOW_NAV.map((n) => n.id),
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  /** Pages that are relevant right now (e.g. without the single-spectrum editor). */
  pages?: PageId[];
}) {
  const { t } = useUi();
  const i = pages.indexOf(page);
  if (i < 0) return null;
  const prev = i > 0 ? WORKFLOW_NAV.find((n) => n.id === pages[i - 1]) : undefined;
  const next = i < pages.length - 1 ? WORKFLOW_NAV.find((n) => n.id === pages[i + 1]) : undefined;
  const step = stepOfPage(page);
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t bg-card px-5">
      {prev ? (
        <button
          type="button"
          onClick={() => onNavigate(prev.id)}
          className="flex h-8 cursor-default items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t("back")}: {t(prev.label)}
        </button>
      ) : null}
      <span className="flex-1 text-center text-xs text-muted-foreground">
        {step ? `${step} / ${WIZARD.length} · ${t(WIZARD[step - 1].label)}` : null}
      </span>
      {next ? (
        <button
          type="button"
          onClick={() => onNavigate(next.id)}
          className="flex h-8 cursor-default items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("next")}: {t(next.label)}
          <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function StatusBar({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-4 border-t bg-muted px-3 text-[11px] text-muted-foreground"
      aria-label="Status"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 truncate" aria-live="polite">
        {left}
      </div>
      <div className="flex shrink-0 items-center gap-3">{right}</div>
    </footer>
  );
}

export function DropOverlay({ visible }: { visible: boolean }) {
  const { t } = useUi();
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-primary/10 p-6 backdrop-blur-[1px]">
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-card px-12 py-10 shadow-xl">
        <FileUp className="h-10 w-10 text-primary" aria-hidden="true" />
        <p className="text-lg font-semibold">{t("dropAnywhere")}</p>
        <p className="text-[13px] text-muted-foreground">{t("dropAnywhereHint")}</p>
      </div>
    </div>
  );
}

export type ThemePref = "light" | "dark" | "system";
const THEME_KEY = "report-maker:theme";

export function useTheme(): [ThemePref, (t: ThemePref) => void, boolean] {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch {
      return "system";
    }
  });
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark = pref === "dark" || (pref === "system" && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  const update = (next: ThemePref) => {
    setPref(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  };
  return [pref, update, dark];
}

export const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;
