import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  DatabaseZap,
  FolderOpen,
  ListChecks,
  Loader2,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { EquipmentItem } from "../lib/equipment";
import {
  equipmentFromMachine,
  isMachineAdded,
  loadSpectraCatalog,
  type SpectraCatalog,
} from "../lib/machine-import";
import { pickSp3Path, pickSp3Paths, type CsvRowSummary } from "../lib/mdb";
import { latestPerPoint } from "../lib/report-slices";
import type { SpectraMachine } from "../lib/spectra-catalog";
import { oleDateToISO } from "../lib/specdata";
import { classifyZone, DEFAULT_ZONE_LIMITS, type ZoneResult } from "../lib/zones";
import { cn } from "../lib/utils";
import { ZoneBadge } from "./measuring-table";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge, EmptyState, Segmented } from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";
import { groupEquipmentsByDb, sp3Filename } from "../lib/equipment";
import { useUi } from "../lib/i18n";

const ZONE_RANK: Record<ZoneResult, number> = { "": 0, A: 1, B: 2, U: 3, C: 4 };

interface MachineInfo {
  machine: SpectraMachine;
  measurements: number;
  lastDate: string;
  worst: ZoneResult;
}

function summarize(m: SpectraMachine, byPoint: Map<string, CsvRowSummary[]>): MachineInfo {
  const mine = m.points.flatMap((p) => byPoint.get(p.pointId) ?? []);
  let last = 0;
  for (const r of mine) last = Math.max(last, Number(r.measDate) || 0);
  const limits = m.limits ?? DEFAULT_ZONE_LIMITS;
  let worst: ZoneResult = "";
  for (const r of latestPerPoint(mine)) {
    const z = classifyZone(r.rmsV, limits.velocity);
    if (ZONE_RANK[z] > ZONE_RANK[worst]) worst = z;
  }
  return {
    machine: m,
    measurements: mine.length,
    lastDate: last > 0 ? oleDateToISO(last) || "" : "",
    worst,
  };
}

/** Wizard step 2: pick machines from the Spectra tree (plant → machine). */
export function MachinePicker({
  sp3Path,
  sp3Paths,
  isTauri,
  items,
  onChange,
  rows,
}: {
  sp3Path: string | null;
  sp3Paths?: string[];
  isTauri: boolean;
  items: EquipmentItem[];
  onChange: (next: EquipmentItem[]) => void;
  rows: CsvRowSummary[] | null;
}) {
  const { t } = useUi();
  const [catalogs, setCatalogs] = useState<SpectraCatalog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addMode, setAddMode] = useState<"append" | "replace">("append");
  const anchor = useRef<string | null>(null);

  const keyFor = (path: string, id: string) => `${path}::${id}`;

  const load = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const cat = await loadSpectraCatalog(path);
      setCatalogs((prev) => {
        const filtered = prev.filter((c) => c.path !== path);
        return [...filtered, cat];
      });
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the machine tree.");
    } finally {
      setLoading(false);
    }
  };

  const loadMany = async (paths: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const cats: SpectraCatalog[] = [];
      for (const p of paths) {
        try {
          cats.push(await loadSpectraCatalog(p));
        } catch (e) {
          console.warn("Failed to load", p, e);
        }
        // yield between DBs
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      setCatalogs(cats);
      setSelected(new Set());
      if (cats.length === 0) setError("No databases could be read.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the machine tree.");
    } finally {
      setLoading(false);
    }
  };

  const effectivePaths = useMemo(() => {
    if (sp3Paths && sp3Paths.length > 0) return sp3Paths;
    if (sp3Path) return [sp3Path];
    return [] as string[];
  }, [sp3Path, sp3Paths]);

  useEffect(() => {
    if (!isTauri) return;
    if (effectivePaths.length === 0) return;
    const existing = new Set(catalogs.map((c) => c.path));
    const missing = effectivePaths.filter((p) => !existing.has(p));
    if (missing.length > 0) void loadMany(effectivePaths);
  }, [effectivePaths.join("|"), isTauri]);

  const openOther = async () => {
    try {
      // Try multi-pick first, fall back to single
      try {
        const paths = await pickSp3Paths();
        if (paths.length === 1) await load(paths[0]);
        else await loadMany(paths);
        return;
      } catch {
        await load(await pickSp3Path());
      }
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
      toast.error(e instanceof Error && e.message ? e.message : t("toastCouldNotOpenDb"));
    }
  };

  const infos = useMemo(() => {
    if (catalogs.length === 0) return [] as (MachineInfo & { catalogPath: string; dbName: string })[];
    const byPoint = new Map<string, CsvRowSummary[]>();
    for (const r of rows ?? []) {
      const list = byPoint.get(r.pointId);
      if (list) list.push(r);
      else byPoint.set(r.pointId, [r]);
    }
    const out: (MachineInfo & { catalogPath: string; dbName: string })[] = [];
    for (const cat of catalogs) {
      for (const m of cat.machines) {
        const info = summarize(m, byPoint);
        out.push({ ...info, catalogPath: cat.path, dbName: sp3Filename(cat.path) });
      }
    }
    return out;
  }, [catalogs, rows]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? infos.filter((i) =>
        `${i.machine.name} ${i.machine.plantName} ${i.machine.note} ${i.dbName}`.toLowerCase().includes(q)
      )
    : infos;
  const plants = useMemo(() => {
    const map = new Map<string, (MachineInfo & { catalogPath: string; dbName: string })[]>();
    for (const i of shown) {
      const key = `${i.machine.plantName || "—"} · ${i.dbName}`;
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return [...map.entries()];
  }, [shown]);
  const order = plants.flatMap(([, list]) => list.map((i) => keyFor(i.catalogPath, i.machine.machineId)));

  const inReport = (path: string, id: string) => isMachineAdded(items, path, id);

  const toggle = (id: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchor.current) {
        const a = order.indexOf(anchor.current);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const on = !prev.has(id);
          for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(k);
            else next.delete(k);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchor.current = id;
      return next;
    });
  };

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const selectedInfos = infos.filter((i) => selected.has(keyFor(i.catalogPath, i.machine.machineId)));
  const toAdd = selectedInfos.filter((i) => !inReport(i.catalogPath, i.machine.machineId));
  const toRemove = selectedInfos.filter((i) => inReport(i.catalogPath, i.machine.machineId));

  const catalogByPath = useMemo(() => {
    const m = new Map<string, SpectraCatalog>();
    for (const c of catalogs) m.set(c.path, c);
    return m;
  }, [catalogs]);

  const addSelected = async () => {
    if (catalogs.length === 0 || toAdd.length === 0) return;
    setBusy(true);
    try {
      const built: EquipmentItem[] = [];
      const CONC = 3;
      for (let i = 0; i < toAdd.length; i += CONC) {
        const chunk = toAdd.slice(i, i + CONC);
        const part = await Promise.all(
          chunk.map((x) => {
            const cat = catalogByPath.get(x.catalogPath);
            if (!cat) throw new Error(`Catalog not loaded for ${x.dbName}`);
            return equipmentFromMachine(cat, x.machine);
          })
        );
        built.push(...part);
      }
      if (addMode === "replace") {
        if (
          items.length > 0 &&
          !confirm(t("confirmReplaceMachines", { count: items.length, newCount: built.length }))
        )
          return;
        onChange(built);
        toast.success(t("toastReplacedMachines", { count: built.length }));
      } else {
        onChange([...items, ...built]);
        toast.success(
          built.length === 1
            ? t("toastAddedOne", { name: built[0].name })
            : t("toastAddedMany", {
                count: built.length,
                source: toAdd.length > 1 ? t("pickerMultipleDbs") : toAdd[0].dbName,
              })
        );
      }
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = () => {
    if (catalogs.length === 0) return;
    const toRemoveKeys = new Set(toRemove.map((i) => keyFor(i.catalogPath, i.machine.machineId)));
    onChange(
      items.filter((e) => {
        const k = e.sp3Path && e.machineId ? keyFor(e.sp3Path, e.machineId) : "";
        return !toRemoveKeys.has(k);
      })
    );
    setSelected(new Set());
  };

  if (!isTauri) {
    return (
      <EmptyState icon={<ListChecks />} title={t("pickerNeedsDesktopTitle")}>
        {t("pickerNeedsDesktopBody")}
      </EmptyState>
    );
  }

  if (effectivePaths.length === 0 && catalogs.length === 0) {
    return (
      <EmptyState
        icon={<DatabaseZap />}
        title={t("pickerOpenFirstTitle")}
        actions={
          <Button onClick={() => void openOther()}>
            <FolderOpen aria-hidden="true" />
            {t("pickerOpenSp3")}
          </Button>
        }
      >
        {t("pickerOpenFirstBody")}
      </EmptyState>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="relative min-w-48 flex-1">
            <Search
              className="pointer-events-none absolute start-2.5 top-2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="ps-8"
              placeholder={t("pickerSearchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("pickerSearchAria")}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void openOther()}>
            <FolderOpen aria-hidden="true" />
            {t("pickerOtherDbs")}
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-10 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("pickerReadingTree")}
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-[13px] text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <div className="max-h-[calc(100vh-17rem)] min-h-0 overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="w-9 px-3 py-2" />
                  <th className="px-2 py-2 text-start font-semibold">{t("pickerTableMachine")}</th>
                  <th className="w-20 px-2 py-2 text-end font-semibold">{t("pickerTablePoints")}</th>
                  <th className="w-28 px-2 py-2 text-end font-semibold">{t("pickerTableMeasurements")}</th>
                  <th className="w-28 px-2 py-2 text-start font-semibold">{t("pickerTableLastMeasured")}</th>
                  <th
                    className="w-16 px-2 py-2 text-center font-semibold"
                    title={t("pickerTableZoneTitle")}
                  >
                    {t("pickerTableZone")}
                  </th>
                </tr>
              </thead>
              {plants.map(([plant, list]) => {
                const ids = list.map((i) => keyFor(i.catalogPath, i.machine.machineId));
                const all = ids.every((id) => selected.has(id));
                const some = !all && ids.some((id) => selected.has(id));
                const closed = collapsed.has(plant);
                return (
                  <tbody key={plant}>
                    <tr className="border-t bg-muted/40">
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          aria-label={t("pickerSelectAllIn", { plant })}
                          checked={all}
                          ref={(el) => {
                            if (el) el.indeterminate = some;
                          }}
                          onChange={(e) => setMany(ids, e.target.checked)}
                        />
                      </td>
                      <td colSpan={5} className="px-2 py-1.5">
                        <button
                          type="button"
                          className="flex cursor-default items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                          onClick={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (next.has(plant)) next.delete(plant);
                              else next.add(plant);
                              return next;
                            })
                          }
                          aria-expanded={!closed}
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              closed && "-rotate-90"
                            )}
                            aria-hidden="true"
                          />
                          {plant}
                          <span className="font-normal normal-case">{t("pickerMachinesCount", { count: list.length })}</span>
                        </button>
                      </td>
                    </tr>
                    {closed
                      ? null
                      : list.map((i) => {
                          const id = i.machine.machineId;
                          const key = keyFor(i.catalogPath, id);
                          const on = selected.has(key);
                          const added = inReport(i.catalogPath, id);
                          return (
                            <tr
                              key={key}
                              onClick={(e) => toggle(key, e.shiftKey)}
                              className={cn(
                                "cursor-default border-t select-none",
                                on ? "bg-accent/70" : "hover:bg-muted/60",
                                i.measurements === 0 && "text-muted-foreground"
                              )}
                            >
                              <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  aria-label={t("pickerSelectMachine", { name: i.machine.name })}
                                  checked={on}
                                  onChange={() => toggle(key, false)}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="truncate font-medium">
                                    {i.machine.name || t("pickerMachineFallback", { id })}
                                  </span>
                                  {added ? <Badge tone="success">{t("pickerInReportBadge")}</Badge> : null}
                                </span>
                                {i.machine.note ? (
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {i.machine.note}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2 py-1.5 text-end tabular-nums">
                                {i.machine.points.length}
                              </td>
                              <td className="px-2 py-1.5 text-end tabular-nums">
                                {rows ? i.measurements.toLocaleString() : "…"}
                              </td>
                              <td className="px-2 py-1.5 tabular-nums">{i.lastDate || "—"}</td>
                              <td className="px-2 py-1.5 text-center">
                                {i.worst ? <ZoneBadge zone={i.worst} /> : null}
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                );
              })}
              {plants.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      {catalogs.length ? t("pickerNoMatch") : t("pickerNoTree")}
                    </td>
                  </tr>
                </tbody>
              ) : null}
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
          <span className="flex-1 text-[13px] text-muted-foreground">
            {selected.size > 0
              ? t("pickerSelectedRange", { count: selected.size })
              : t("pickerClickToSelect")}
          </span>
          {toRemove.length > 0 ? (
            <Button variant="outline" size="sm" onClick={removeSelected}>
              <Minus aria-hidden="true" />
              {t("pickerRemoveCount", { count: toRemove.length })}
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => void addSelected()}
            disabled={busy || toAdd.length === 0}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {toAdd.length > 0 ? t("pickerAddToReport", { count: toAdd.length }) : t("pickerAddToReportShort")}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col overflow-hidden lg:sticky lg:top-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-[13px] font-semibold">
            {t("pickerInReport")}{" "}
            <span className="font-normal text-muted-foreground">({items.length})</span>
          </p>
          <p className="text-xs text-muted-foreground">{t("pickerGroupedByDb")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Add mode"
              value={addMode}
              onChange={(v) => setAddMode(v as typeof addMode)}
              options={[
                { value: "append", label: t("pickerAppend") },
                { value: "replace", label: t("pickerReplace") },
              ]}
            />
            <span className="text-xs text-muted-foreground" title={t("pickerReplaceHint")}>
              {addMode === "replace" ? t("pickerReplacesAll") : t("pickerAddsToExisting")}
            </span>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {t("pickerNothingYet")}
          </p>
        ) : (
          <div className="max-h-[calc(100vh-20rem)] overflow-auto py-1">
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(t("confirmClearMachines", { count: items.length }))) onChange([]);
                }}
              >
                <X aria-hidden="true" />
                Clear all
              </Button>
              {catalogs.map((cat) =>
                items.some((e) => e.sp3Path === cat.path) ? (
                  <Button
                    key={cat.path}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const n = items.filter((e) => e.sp3Path === cat.path).length;
                      if (confirm(t("confirmRemoveMachinesFromDb", { count: n, db: sp3Filename(cat.path) })))
                        onChange(items.filter((e) => e.sp3Path !== cat.path));
                    }}
                  >
                    {t("pickerRemoveFrom", { db: sp3Filename(cat.path) })}
                  </Button>
                ) : null
              )}
            </div>
            {[...groupEquipmentsByDb(items).entries()].map(([db, list]) => (
              <div key={db} className="border-t first:border-t-0">
                <p className="sticky top-0 bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                  {db} <span className="font-normal">{t("pickerDbCount", { count: list.length })}</span>
                </p>
                <ol>
                  {list.map((e) => (
                    <li key={e.id} className="group flex items-center gap-2 px-3 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{e.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[e.plant, e.pointIds?.length ? t("pickerPointsCount", { count: e.pointIds.length }) : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                        aria-label={t("pickerRemoveMachine", { name: e.name })}
                        title={t("pickerRemoveFromReport")}
                        onClick={() => onChange(items.filter((x) => x.id !== e.id))}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
