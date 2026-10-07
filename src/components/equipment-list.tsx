import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Cog, Copy, ListChecks, Plus, Trash2 } from "lucide-react";
import { EQUIPMENT_STATUSES, makeEquipment, type EquipmentItem } from "../lib/equipment";
import type { ReportOptions } from "../lib/parseSp3";
import { cn } from "../lib/utils";
import { formatLimits } from "../lib/zones";
import { SchematicField, SingleEquipmentCard } from "./report-form";
import { Button } from "./ui/button";
import { Card, Panel } from "./ui/card";
import { Badge, Field, FieldGroupTitle, Select } from "./ui/form";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

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
  onPickMachines,
  onEditLimits,
}: {
  items: EquipmentItem[];
  onChange: (next: EquipmentItem[]) => void;
  options: ReportOptions;
  onOptions: (o: ReportOptions) => void;
  /** Opens the wizard's machine selection step. */
  onPickMachines: () => void;
  onEditLimits: () => void;
}) {
  const { t } = useUi();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = items.find((e) => e.id === selectedId) ?? items[0] ?? null;

  const add = () => {
    const item = makeEquipment({ name: `Equipment ${items.length + 1}` });
    onChange([...items, item]);
    setSelectedId(item.id);
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
      <Button variant="outline" size="sm" onClick={onPickMachines}>
        <ListChecks aria-hidden="true" />
        {t("selectFromDb")}
      </Button>
      <Button variant="ghost" size="sm" onClick={add}>
        <Plus aria-hidden="true" />
        {t("addEquipment")}
      </Button>
    </>
  );

  if (items.length === 0) {
    return (
      <div className="grid gap-3">
        <Card className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
            <Cog className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold">{t("reportingOnSeveral")}</p>
            <p className="text-xs text-muted-foreground">{t("equipmentsHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">{toolbar}</div>
        </Card>
        <SingleEquipmentCard options={options} onChange={onOptions} />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-3 md:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
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
                        : t("manualEntry")}
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
            toast.success(t("toastFilledFromForm"));
          }}
          onEditLimits={onEditLimits}
        />
      ) : null}
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
  onEditLimits,
}: {
  item: EquipmentItem;
  index: number;
  count: number;
  onPatch: (p: Partial<EquipmentItem>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onFillFromForm: () => void;
  onEditLimits: () => void;
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
          ? t("linkedTo", {
              count: e.pointIds?.length ?? 0,
              file: e.sp3Path.split(/[/\\]/).pop() ?? "",
            })
          : t("enteredManually")
      }
      actions={
        <>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("moveUp")} title={t("moveUp")}>
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t("moveDown")} title={t("moveDown")}>
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onFillFromForm} title={t("copyFromSingle")}>
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
        <FieldGroupTitle>{t("identity")}</FieldGroupTitle>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/60 px-3 py-2 text-xs">
          <span className="font-medium">{t("alarmLimits")}</span>
          {e.limits ? (
            <>
              <span className="tabular-nums">Velocity {formatLimits(e.limits.velocity)} mm/s</span>
              <span className="tabular-nums">
                Accel / BC {formatLimits(e.limits.acceleration)} m/s²
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t("reportDefaults")}</span>
          )}
          <button type="button" className="ms-auto font-medium text-primary hover:underline" onClick={onEditLimits}>
            {t("editLimits")}
          </button>
        </div>
      </section>

      <section className="grid gap-3">
        <FieldGroupTitle>{t("condition")}</FieldGroupTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label={t("problems")} htmlFor={id("problems")} hint={t("leftBlankFindings")}>
            <Textarea id={id("problems")} value={e.problems} onChange={(ev) => onPatch({ problems: ev.target.value })} rows={4} />
          </Field>
          <Field label={t("actions")} htmlFor={id("actions")} hint={t("leftBlankRecommendations")}>
            <Textarea id={id("actions")} value={e.corrective} onChange={(ev) => onPatch({ corrective: ev.target.value })} rows={4} />
          </Field>
        </div>
      </section>

      <details className="group rounded-md border" open={narrativeCount > 0 || undefined}>
        <summary className="flex cursor-default items-center gap-2 px-3 py-2 text-[13px] font-medium select-none hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          {t("machineNarrative")}
          <span className="text-xs font-normal text-muted-foreground">
            {narrativeCount > 0 ? t("ofFiveFilled", { count: narrativeCount }) : t("machineNarrativeHint")}
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
