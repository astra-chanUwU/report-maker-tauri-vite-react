import { useEffect, useState } from "react";
import { LineChart, RotateCcw, Siren, Table2 } from "lucide-react";
import type { EquipmentItem } from "../lib/equipment";
import {
  cycleIsoZone,
  defaultIsoRows,
  ISO_ZONE_FILL,
  isoRowsEqual,
  type IsoDataRow,
} from "../lib/iso10816";
import { loadIsoRows, saveIsoRows } from "../lib/iso-store";
import { SECONDARY_HINT, SECONDARY_METRICS, type SecondaryMetric } from "../lib/metrics";
import type { ReportOptions } from "../lib/parseSp3";
import { cn } from "../lib/utils";
import {
  DEFAULT_ZONE_LIMITS,
  formatLimits,
  type ZoneLimits,
  type ZoneLimitSet,
  type ZoneMetric,
} from "../lib/zones";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Badge, CheckRow, Field, Segmented, Select } from "./ui/form";
import { Input } from "./ui/input";

const METRIC_LABEL: Record<SecondaryMetric, string> = {
  acceleration: "Acceleration",
  bc: "BC",
  envelope: "Envelope",
};

/** Secondary metric + chart switches (mirrors the legacy "Charts & metrics" step). */
export function ChartsMetricsCard({
  options,
  onOptions,
}: {
  options: ReportOptions;
  onOptions: (o: ReportOptions) => void;
}) {
  const metric = options.secondaryMetric ?? "acceleration";
  const set = (p: Partial<ReportOptions>) => onOptions({ ...options, ...p });
  return (
    <Panel
      icon={<LineChart />}
      title="Charts & metrics"
      description="The measuring-results table always shows velocity. Pick what goes beside it."
      contentClassName="grid gap-4"
    >
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-xs font-medium text-foreground/85">Secondary metric</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SECONDARY_METRICS.map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-default items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]",
                metric === m ? "border-primary bg-primary/5" : "hover:bg-muted/60"
              )}
            >
              <input
                type="radio"
                name="secondary-metric"
                className="mt-0.5 h-4 w-4"
                checked={metric === m}
                onChange={() => set({ secondaryMetric: m })}
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{METRIC_LABEL[m]}</span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {SECONDARY_HINT[m]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-1 sm:grid-cols-2">
        <CheckRow
          checked={options.showSecondary !== false}
          onChange={(v) => set({ showSecondary: v })}
          label={`Show ${METRIC_LABEL[metric].toLowerCase()} columns`}
          description="Trend and zone columns beside velocity in the measuring table."
        />
        <CheckRow
          checked={options.trendZoneBands !== false}
          onChange={(v) => set({ trendZoneBands: v })}
          label="Alarm zone backgrounds on trends"
          description="Green / yellow / orange / red bands behind each trend line."
        />
        <CheckRow
          checked={options.trendPages === true}
          onChange={(v) => set({ trendPages: v })}
          label="Full-size trend pages"
          description="Adds a large chart per point after the table. Off keeps reports compact."
        />
        <CheckRow
          checked={options.fftAllPoints !== false}
          onChange={(v) => set({ fftAllPoints: v })}
          label="FFT spectra grid"
          description="Latest spectrum of every point, two per row."
        />
      </div>
    </Panel>
  );
}

const ROWS: { key: ZoneMetric; label: string; unit: string }[] = [
  { key: "velocity", label: "Velocity", unit: "mm/s" },
  { key: "acceleration", label: "Accel / BC", unit: "m/s²" },
  { key: "envelope", label: "Envelope", unit: "gEN" },
];
const EDGES = ["bottom", "mid", "top"] as const;

function sameLimits(a?: ZoneLimitSet | null, b?: ZoneLimitSet | null) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Per-machine alarm limits (B / U / C) — read from the database, editable for the report. */
export function MachineLimitsCard({
  items,
  onChange,
  defaults,
}: {
  items: EquipmentItem[];
  onChange: (next: EquipmentItem[]) => void;
  defaults: ZoneLimitSet;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = (id: string, limits: ZoneLimitSet | null) =>
    onChange(items.map((e) => (e.id === id ? { ...e, limits } : e)));

  const setEdge = (
    e: EquipmentItem,
    metric: ZoneMetric,
    edge: (typeof EDGES)[number],
    text: string
  ) => {
    const base = structuredClone(e.limits ?? defaults);
    const v = text.trim() === "" ? null : Number(text);
    (base[metric] as ZoneLimits)[edge] = v === null || !Number.isFinite(v) ? null : v;
    patch(e.id, base);
  };

  return (
    <Panel
      icon={<Siren />}
      title="Alarm limits per machine"
      description="Zones in the report use each machine's own limits. They come from the Spectra alarm settings and can be adjusted here."
      contentClassName="grid gap-2"
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Add machines first. Until then the report uses the default limits from Settings (
          {formatLimits(defaults.velocity)} mm/s).
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-semibold">Machine</th>
                <th className="px-2 py-2 text-start font-semibold">Velocity B / U / C</th>
                <th className="px-2 py-2 text-start font-semibold">Accel / BC B / U / C</th>
                <th className="px-2 py-2 text-start font-semibold">Envelope</th>
                <th className="w-32 px-2 py-2" />
              </tr>
            </thead>
            {items.map((e) => {
              const l = e.limits ?? defaults;
              const edited = !!e.dbLimits && !sameLimits(e.limits, e.dbLimits);
              const open = openId === e.id;
              return (
                <tbody key={e.id}>
                  <tr className="border-t">
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{e.name}</span>
                        {edited ? (
                          <Badge tone="warning">Edited</Badge>
                        ) : e.dbLimits ? (
                          <Badge tone="neutral" title="Read from the Spectra Direction alarms">
                            From DB
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Defaults</Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{formatLimits(l.velocity)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{formatLimits(l.acceleration)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                      {l.envelope.top ? formatLimits(l.envelope) : "off"}
                    </td>
                    <td className="px-2 py-1.5 text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : e.id)}
                      >
                        {open ? "Done" : "Edit"}
                      </Button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-t bg-muted/30">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="grid gap-2">
                          {ROWS.map((r) => (
                            <div
                              key={r.key}
                              className="grid grid-cols-[8rem_repeat(3,minmax(0,6rem))_auto] items-center gap-2"
                            >
                              <span className="text-xs font-medium">
                                {r.label} <span className="text-muted-foreground">({r.unit})</span>
                              </span>
                              {EDGES.map((edge) => (
                                <Input
                                  key={edge}
                                  type="number"
                                  step="any"
                                  className="h-7"
                                  aria-label={`${e.name} ${r.label} ${edge === "bottom" ? "B" : edge === "mid" ? "U" : "C"}`}
                                  placeholder={edge === "bottom" ? "B" : edge === "mid" ? "U" : "C"}
                                  value={l[r.key][edge] ?? ""}
                                  onChange={(ev) => setEdge(e, r.key, edge, ev.target.value)}
                                />
                              ))}
                            </div>
                          ))}
                          <div className="flex gap-2">
                            {e.dbLimits ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!edited}
                                onClick={() => patch(e.id, structuredClone(e.dbLimits!))}
                              >
                                <RotateCcw aria-hidden="true" />
                                Reset to database
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => patch(e.id, structuredClone(DEFAULT_ZONE_LIMITS))}
                            >
                              Use ISO defaults
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Editable ISO 10816-3 table: band labels, values and colour swatches. */
export function IsoTableEditor({
  options,
  onOptions,
}: {
  options: ReportOptions;
  onOptions: (o: ReportOptions) => void;
}) {
  const [rows, setRows] = useState<IsoDataRow[]>(() => loadIsoRows());
  useEffect(() => saveIsoRows(rows), [rows]);
  const position = options.includeIsoTable === false ? "off" : (options.isoPosition ?? "end");
  const custom = options.useCustomIso === true;
  const edited = !isoRowsEqual(rows, defaultIsoRows());
  const set = (p: Partial<ReportOptions>) => onOptions({ ...options, ...p });
  const patchRow = (i: number, p: Partial<IsoDataRow>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const cycle = (i: number, slot: 0 | 1 | 3) =>
    setRows((rs) =>
      rs.map((r, k) => {
        if (k !== i) return r;
        const zones = [...r.zones] as IsoDataRow["zones"];
        zones[slot] = cycleIsoZone(zones[slot]);
        if (slot === 1) zones[2] = zones[1];
        return { ...r, zones };
      })
    );

  const swatch = (i: number, slot: 0 | 1 | 3, label: string) => {
    const z = rows[i].zones[slot];
    return (
      <button
        type="button"
        onClick={() => cycle(i, slot)}
        title={`${label}: ${z} — click to change`}
        aria-label={`${label} row ${i + 1}: ${z}`}
        className="h-7 w-full cursor-default rounded-sm ring-offset-1 hover:ring-2 hover:ring-ring/50"
        style={{ backgroundColor: `#${ISO_ZONE_FILL[z]}` }}
      />
    );
  };

  return (
    <Panel
      icon={<Table2 />}
      title="ISO 10816-3 table"
      description="Printed as the reference severity table. Click a colour to change it; edit labels and values in place."
      actions={
        <Button
          variant="ghost"
          size="sm"
          disabled={!edited}
          onClick={() => setRows(defaultIsoRows())}
          title="Restore the standard ISO 10816-3 values and colours"
        >
          <RotateCcw aria-hidden="true" />
          Standard values
        </Button>
      }
      contentClassName="grid gap-4"
    >
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Position in report">
          <Segmented
            ariaLabel="ISO table position"
            value={position}
            onChange={(v) =>
              set(
                v === "off"
                  ? { includeIsoTable: false, isoPosition: "off" }
                  : { includeIsoTable: true, isoPosition: v }
              )
            }
            options={[
              { value: "off", label: "Off" },
              { value: "afterToc", label: "After contents" },
              { value: "end", label: "End of report" },
            ]}
          />
        </Field>
        <Field label="Machinery groups" htmlFor="iso-groups">
          <Select
            id="iso-groups"
            className="w-44"
            value={options.isoGroups ?? "all"}
            onChange={(e) => set({ isoGroups: e.target.value as ReportOptions["isoGroups"] })}
          >
            <option value="all">Groups 1–4</option>
            <option value="1+3">Groups 1 and 3</option>
            <option value="2+4">Groups 2 and 4</option>
          </Select>
        </Field>
        <CheckRow
          className="mb-0.5"
          checked={custom}
          onChange={(v) => set({ useCustomIso: v })}
          label="Use my edited values in the report"
          description={
            edited ? "You changed the table." : "The table matches the standard right now."
          }
        />
      </div>
      <div className={cn("overflow-auto rounded-md border", position === "off" && "opacity-60")}>
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="text-xs">
            <tr className="bg-[#1B5E20] text-white">
              <th className="px-2 py-1.5 font-semibold" title="Groups 1 and 3, flexible foundation">
                G1/3 flexible
              </th>
              <th className="px-2 py-1.5 font-semibold">Band (G1/3 rigid · G2/4 flexible)</th>
              <th className="px-2 py-1.5 font-semibold" title="Groups 2 and 4, rigid foundation">
                G2/4 rigid
              </th>
              <th className="w-24 px-2 py-1.5 text-end font-semibold">mm/s RMS</th>
              <th className="w-24 px-2 py-1.5 text-end font-semibold">in/s peak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="w-28 px-1.5 py-1">{swatch(i, 0, "G1/3 flexible")}</td>
                <td className="px-1.5 py-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-14 shrink-0">{swatch(i, 1, "Band")}</span>
                    <Input
                      className="h-7"
                      value={r.label}
                      aria-label={`Band label row ${i + 1}`}
                      onChange={(e) => patchRow(i, { label: e.target.value })}
                    />
                  </div>
                </td>
                <td className="w-28 px-1.5 py-1">{swatch(i, 3, "G2/4 rigid")}</td>
                <td className="px-1.5 py-1">
                  <Input
                    className="h-7 text-end tabular-nums"
                    value={r.rms}
                    aria-label={`RMS row ${i + 1}`}
                    onChange={(e) => patchRow(i, { rms: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <Input
                    className="h-7 text-end tabular-nums"
                    value={r.peak}
                    aria-label={`Peak row ${i + 1}`}
                    onChange={(e) => patchRow(i, { peak: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Rows with the same band label and colour merge into one block in Word, as in the standard
        table.
      </p>
    </Panel>
  );
}
