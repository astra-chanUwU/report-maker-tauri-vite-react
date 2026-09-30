import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  Cog,
  Database,
  FileBarChart2,
  FileUp,
  Gauge,
  History,
  LayoutTemplate,
  LineChart,
  Monitor,
  Moon,
  NotebookPen,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useUi } from "../lib/i18n";

export type PageId =
  | "data"
  | "measurements"
  | "details"
  | "equipment"
  | "findings"
  | "chart"
  | "layout"
  | "history"
  | "settings";

type NavItem = { id: PageId; icon: LucideIcon; label: string; desc: string };

export const WORKFLOW_NAV: NavItem[] = [
  { id: "data", icon: Database, label: "navData", desc: "pageDataDesc" },
  { id: "measurements", icon: Gauge, label: "navMeasurements", desc: "pageMeasurementsDesc" },
  { id: "details", icon: NotebookPen, label: "navDetails", desc: "pageDetailsDesc" },
  { id: "equipment", icon: Cog, label: "navEquipment", desc: "pageEquipmentDesc" },
  { id: "findings", icon: FileBarChart2, label: "navFindings", desc: "pageFindingsDesc" },
  { id: "chart", icon: LineChart, label: "navChart", desc: "pageChartDesc" },
  { id: "layout", icon: LayoutTemplate, label: "navLayout", desc: "pageLayoutDesc" },
];

export const APP_NAV: NavItem[] = [
  { id: "history", icon: History, label: "navHistory", desc: "pageHistoryDesc" },
  { id: "settings", icon: Settings, label: "navSettings", desc: "pageSettingsDesc" },
];

export const ALL_NAV = [...WORKFLOW_NAV, ...APP_NAV];

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
  version,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  indicators: Partial<Record<PageId, NavIndicator>>;
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

  const renderItem = (item: NavItem, shortcut: number) => {
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
          title={collapsed ? `${label} (Ctrl+${shortcut})` : `Ctrl+${shortcut}`}
          className={cn(
            "group relative flex h-9 w-full cursor-default items-center gap-3 rounded-md text-[13px] font-medium transition-colors",
            collapsed ? "justify-center px-0" : "px-2.5",
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
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
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
              {ind?.kind === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-success" aria-label="Done" />
              ) : ind?.kind === "warn" ? (
                <AlertCircle className="h-4 w-4 text-warning" aria-label="Needs attention" />
              ) : ind?.kind === "count" && ind.value > 0 ? (
                <span className="rounded bg-sidebar-accent px-1.5 text-[11px] text-sidebar-muted tabular-nums group-hover:bg-sidebar">
                  {ind.value > 999 ? "999+" : ind.value}
                </span>
              ) : null}
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
          <ul className="grid gap-0.5">{WORKFLOW_NAV.map((item, i) => renderItem(item, i + 1))}</ul>
        </div>
        <div className="mt-auto grid gap-1">
          {!collapsed ? (
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
              {t("navGroupApp")}
            </p>
          ) : null}
          <ul className="grid gap-0.5">
            {APP_NAV.map((item, i) => renderItem(item, WORKFLOW_NAV.length + i + 1))}
          </ul>
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
