import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Cog,
  Copy,
  DatabaseZap,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  bytesToBase64,
  buildMachineSpecs,
  joinCatalog,
  machineLabelMap,
  type SpectraMachine,
} from "../lib/spectra-catalog";
import { renderPointSchematic } from "../lib/spectra-schematic";
import { chooseSchematic, linesForMachine, renderGMachinePng } from "../lib/spectra-gmachine";
import { fetchMachinePicture, fetchSpectraCatalog, pickSp3Path } from "../lib/mdb";
import { EQUIPMENT_STATUSES, makeEquipment, type EquipmentItem } from "../lib/equipment";
import type { ReportOptions } from "../lib/parseSp3";
import { cn } from "../lib/utils";
import { SchematicField, SingleEquipmentCard } from "./report-form";
import { Button } from "./ui/button";
import { Card, Panel } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Badge, Field, FieldGroupTitle, Select } from "./ui/form";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

type Catalog = {
  path: string;
  machines: SpectraMachine[];
  gmachineCsv: string;
  gdirectionCsv: string;
};

export function statusTone(status: string) {
  switch (status) {
    case "Healthy":
      return "success" as const;
    case "Alert":
      return "warning" as const;
    case "Danger":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

/** Multi-equipment manager (brochure p.4): 1..N equipments → TOC + sections. */
export function EquipmentWorkspace({
  items,
  onChange,
  options,
  onOptions,
}: {
  items: EquipmentItem[];
  onChange: (next: EquipmentItem[]) => void;
  options: ReportOptions;
  onOptions: (o: ReportOptions) => void;
}) {
  const { t } = useUi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [reading, setReading] = useState(false);

  const selected = items.find((e) => e.id === selectedId) ?? items[0] ?? null;

  const importCatalog = async () => {
    setReading(true);
    try {
      const path = await pickSp3Path();
      const csv = await fetchSpectraCatalog(path);
      setCatalog({
        path,
        machines: joinCatalog(csv),
        gmachineCsv: csv.gmachineCsv ?? "",
        gdirectionCsv: csv.gdirectionCsv ?? "",
      });
      setCatalogOpen(true);
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
      toast.error(e instanceof Error ? e.message : "Could not read Spectra catalog.");
    } finally {
      setReading(false);
    }
  };

  const add = () => {
    const item = makeEquipment({ name: `Equipment ${items.length + 1}` });
    onChange([...items, item]);
    setSelectedId(item.id);
  };

  const addMachines = (added: EquipmentItem[]) => {
    if (added.length === 0) return;
    onChange([...items, ...added]);
    setSelectedId(added[added.length - 1].id);
    toast.success(
      added.length === 1 ? `Added ${added[0].name}.` : `Added ${added.length} machines.`
    );
  };

  const patch = (id: string, p: Partial<EquipmentItem>) =>
    onChange(items.map((e) => (e.id === id ? { ...e, ...p } : e)));

  const remove = (id: string) => {
    const idx = items.findIndex((e) => e.id === id);
    const next = items.filter((e) => e.id !== id);
    onChange(next);
    setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null);
  };

  const move = (id: string, delta: number) => {
    const idx = items.findIndex((e) => e.id === id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= items.length) return;
    const next = items.slice();
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  };

  const toolbar = (
    <>
      <Button variant="outline" size="sm" onClick={() => void importCatalog()} disabled={reading}>
        {reading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <DatabaseZap aria-hidden="true" />
        )}
        {reading ? t("reading") : t("importSpectra")}
      </Button>
      <Button size="sm" onClick={add}>
        <Plus aria-hidden="true" />
        {t("addEquipment")}
      </Button>
    </>
  );

  const dialog = (
    <CatalogDialog
      open={catalogOpen}
      onOpenChange={setCatalogOpen}
      catalog={catalog}
      existing={items}
      onAdd={addMachines}
    />
  );

  if (items.length === 0) {
    return (
      <div className="grid gap-4">
        <Card className="flex flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Cog className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Reporting on several machines?</p>
            <p className="text-xs text-muted-foreground">{t("equipmentsHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">{toolbar}</div>
        </Card>
        <SingleEquipmentCard options={options} onChange={onOptions} />
        {dialog}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
      <Card className="flex flex-col overflow-hidden md:sticky md:top-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <p className="text-[13px] font-semibold">
            {t("equipments")}{" "}
            <span className="font-normal text-muted-foreground">({items.length})</span>
          </p>
        </div>
        <ul className="max-h-[calc(100vh-18rem)] overflow-auto py-1" aria-label={t("equipments")}>
          {items.map((e, i) => {
            const active = selected?.id === e.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(e.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full cursor-default items-center gap-2 px-3 py-2 text-start",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"
                  )}
                >
                  <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {e.name || t("untitled")}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.pointIds && e.pointIds.length > 0
                        ? `${e.pointIds.length} ${t("points")}`
                        : "Manual entry"}
                    </span>
                  </span>
                  {e.status ? <Badge tone={statusTone(e.status)}>{e.status}</Badge> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-2 border-t p-2">{toolbar}</div>
      </Card>
      {selected ? (
        <EquipmentEditor
          key={selected.id}
          item={selected}
          index={items.findIndex((e) => e.id === selected.id)}
          count={items.length}
          onPatch={(p) => patch(selected.id, p)}
          onRemove={() => remove(selected.id)}
          onMove={(d) => move(selected.id, d)}
          onFillFromForm={() => {
            patch(selected.id, {
              name: options.equipmentName || selected.name || t("untitled"),
              specs: options.equipmentSpecs ?? selected.specs,
            });
            toast.success("Filled from single-equipment fields.");
          }}
        />
      ) : null}
      {dialog}
    </div>
  );
}

function EquipmentEditor({
  item: e,
  index,
  count,
  onPatch,
  onRemove,
  onMove,
  onFillFromForm,
}: {
  item: EquipmentItem;
  index: number;
  count: number;
  onPatch: (p: Partial<EquipmentItem>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onFillFromForm: () => void;
}) {
  const { t } = useUi();
  const id = (k: string) => `eq-${e.id}-${k}`;
  const narrativeCount = [
    e.summary,
    e.methodology,
    e.observations,
    e.recommendations,
    e.conclusion,
  ].filter((v) => v && v.trim()).length;

  return (
    <Panel
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
          <span className="truncate">{e.name || t("untitled")}</span>
        </span>
      }
      description={
        e.sp3Path
          ? `Linked to ${e.pointIds?.length ?? 0} measuring points in ${e.sp3Path.split(/[/\\]/).pop()}`
          : "Entered manually"
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move up"
            title="Move up"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="Move down"
            title="Move down"
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onFillFromForm}
            title="Copy name and specs from the single-equipment fields"
          >
            <Copy aria-hidden="true" />
            {t("fillFromForm")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
            {t("remove")}
          </Button>
        </>
      }
      contentClassName="grid gap-5"
    >
      <section className="grid gap-3">
        <FieldGroupTitle>Identity</FieldGroupTitle>
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr_2fr]">
          <Field label={t("name")} htmlFor={id("name")}>
            <Input
              id={id("name")}
              value={e.name}
              onChange={(ev) => onPatch({ name: ev.target.value })}
            />
          </Field>
          <Field label={t("status")} htmlFor={id("status")}>
            <Select
              id={id("status")}
              value={e.status}
              onChange={(ev) => onPatch({ status: ev.target.value })}
            >
              <option value="">—</option>
              {EQUIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("lastReport")} htmlFor={id("last")}>
            <Input
              id={id("last")}
              value={e.lastReport}
              onChange={(ev) => onPatch({ lastReport: ev.target.value })}
              placeholder="2026-…: OK"
            />
          </Field>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label={t("specs")} htmlFor={id("specs")}>
            <Textarea
              id={id("specs")}
              value={e.specs}
              onChange={(ev) => onPatch({ specs: ev.target.value })}
              rows={5}
            />
          </Field>
          <SchematicField
            id={id("schematic")}
            value={e.schematicBase64}
            onChange={(b64) => onPatch({ schematicBase64: b64 })}
          />
        </div>
      </section>

      <section className="grid gap-3">
        <FieldGroupTitle>Condition</FieldGroupTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field
            label={t("problems")}
            htmlFor={id("problems")}
            hint="Left blank, Findings → Observations is used."
          >
            <Textarea
              id={id("problems")}
              value={e.problems}
              onChange={(ev) => onPatch({ problems: ev.target.value })}
              rows={4}
            />
          </Field>
          <Field
            label={t("actions")}
            htmlFor={id("actions")}
            hint="Left blank, Findings → Recommendations is used."
          >
            <Textarea
              id={id("actions")}
              value={e.corrective}
              onChange={(ev) => onPatch({ corrective: ev.target.value })}
              rows={4}
            />
          </Field>
        </div>
      </section>

      <details className="group rounded-md border" open={narrativeCount > 0 || undefined}>
        <summary className="flex cursor-default items-center gap-2 px-3 py-2 text-[13px] font-medium select-none hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
          Machine narrative
          <span className="text-xs font-normal text-muted-foreground">
            {narrativeCount > 0
              ? `${narrativeCount} of 5 filled`
              : "optional — overrides the shared findings"}
          </span>
        </summary>
        <div className="grid gap-3 border-t p-3 lg:grid-cols-2">
          {(
            ["summary", "methodology", "observations", "recommendations", "conclusion"] as const
          ).map((k) => (
            <Field
              key={k}
              label={t(k)}
              htmlFor={id(k)}
              className={k === "summary" ? "lg:col-span-2" : undefined}
            >
              <Textarea
                id={id(k)}
                value={e[k] ?? ""}
                onChange={(ev) => onPatch({ [k]: ev.target.value })}
                rows={3}
              />
            </Field>
          ))}
        </div>
      </details>
    </Panel>
  );
}

function CatalogDialog({
  open,
  onOpenChange,
  catalog,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  catalog: Catalog | null;
  existing: EquipmentItem[];
  onAdd: (items: EquipmentItem[]) => void;
}) {
  const { t } = useUi();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (!catalog) return null;

  const added = (m: SpectraMachine) =>
    existing.some((e) => e.machineId === m.machineId && e.sp3Path === catalog.path);

  const build = async (m: SpectraMachine): Promise<EquipmentItem> => {
    let jpeg: Uint8Array | null = null;
    try {
      const bytes = await fetchMachinePicture(catalog.path, m.machineId);
      if (bytes.length > 8) jpeg = bytes;
    } catch {
      jpeg = null;
    }
    const vectors = renderGMachinePng(
      linesForMachine(catalog.gmachineCsv, catalog.gdirectionCsv, m.machineId)
    );
    const chosen = chooseSchematic(jpeg, vectors, renderPointSchematic(m.points));
    return makeEquipment({
      name: m.name || `Machine ${m.machineId}`,
      specs: buildMachineSpecs(m),
      sp3Path: catalog.path,
      machineId: m.machineId,
      pointIds: m.points.map((p) => p.pointId),
      labels: machineLabelMap(m),
      schematicBase64: chosen ? bytesToBase64(chosen) : null,
    });
  };

  const addOne = async (m: SpectraMachine) => {
    setBusy(m.machineId);
    try {
      onAdd([await build(m)]);
    } finally {
      setBusy(null);
    }
  };

  const addAll = async () => {
    setBusy("*");
    try {
      const out: EquipmentItem[] = [];
      for (const m of catalog.machines) if (!added(m)) out.push(await build(m));
      onAdd(out);
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = q
    ? catalog.machines.filter((m) => `${m.name} ${m.machineId}`.toLowerCase().includes(q))
    : catalog.machines;
  const remaining = catalog.machines.filter((m) => !added(m)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>
            {t("machinesIn")} {catalog.path.split(/[/\\]/).pop()}
          </DialogTitle>
          <DialogDescription>
            {catalog.machines.length} machines. Each one you add gets its measuring points, specs
            and schematic.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            className="ps-8"
            placeholder="Filter machines…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter machines"
          />
        </div>
        <ul className="max-h-[50vh] min-h-0 overflow-auto rounded-md border">
          {shown.map((m) => {
            const isAdded = added(m);
            return (
              <li
                key={m.machineId}
                className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{m.name || m.machineId}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.points.length} {t("points")}
                  </p>
                </div>
                {isAdded ? (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Added
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void addOne(m)}
                  >
                    {busy === m.machineId ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus aria-hidden="true" />
                    )}
                    Add
                  </Button>
                )}
              </li>
            );
          })}
          {shown.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">No matches.</li>
          ) : null}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button onClick={() => void addAll()} disabled={busy !== null || remaining === 0}>
            {busy === "*" ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            Add all ({remaining})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
