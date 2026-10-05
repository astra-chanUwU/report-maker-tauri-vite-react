import { RotateCcw, Siren } from "lucide-react";
import {
  DEFAULT_ZONE_LIMITS,
  ZONE_FILL,
  ZONE_LABELS,
  type ZoneLetter,
  type ZoneLimitSet,
  type ZoneMetric,
} from "../lib/zones";
import { useUi } from "../lib/i18n";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const METRICS: { key: ZoneMetric; title: string; hint: string }[] = [
  { key: "velocity", title: "Velocity (mm/s RMS)", hint: "Overall velocity alarms" },
  { key: "acceleration", title: "Acceleration / BC", hint: "Overall acceleration alarms" },
  { key: "envelope", title: "Envelope", hint: "All-zero disables envelope zones" },
];

const EDGES = ["bottom", "mid", "top"] as const;

/** Alarm thresholds (B/U/C per metric) — mirrors the legacy report editor. */
export function ZoneLimitsCard({
  limits,
  onChange,
}: {
  limits: ZoneLimitSet;
  onChange: (l: ZoneLimitSet) => void;
}) {
  const { t } = useUi();
  const set = (metric: ZoneMetric, edge: (typeof EDGES)[number], text: string) => {
    const v = text.trim() === "" ? null : Number(text);
    onChange({
      ...limits,
      [metric]: {
        ...limits[metric],
        [edge]: text.trim() === "" || !Number.isFinite(v) ? null : v,
      },
    });
  };

  return (
    <Panel
      icon={<Siren />}
      title={t("zonesTitle")}
      description={t("zoneLimitsDesc")}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(structuredClone(DEFAULT_ZONE_LIMITS))}
          title={t("zoneDefaultsHint")}
        >
          <RotateCcw aria-hidden="true" />
          {t("zoneDefaults")}
        </Button>
      }
      contentClassName="grid gap-3"
    >
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(ZONE_LABELS) as ZoneLetter[]).map((z) => (
          <span
            key={z}
            className="rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: `#${ZONE_FILL[z]}`, color: z === "B" ? "#000" : "#fff" }}
          >
            {z} · {ZONE_LABELS[z]}
          </span>
        ))}
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-semibold">{t("zoneMetric")}</th>
              {EDGES.map((e) => (
                <th key={e} className="w-24 px-2 py-2 text-start font-semibold">
                  {e === "bottom" ? t("zoneBFrom") : e === "mid" ? t("zoneUFrom") : t("zoneCFrom")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key} className="border-t">
                <td className="px-3 py-1.5">
                  <p className="font-medium">{m.title}</p>
                  <p className="text-xs text-muted-foreground">{m.hint}</p>
                </td>
                {EDGES.map((e) => (
                  <td key={e} className="px-2 py-1.5">
                    <Label htmlFor={`zone-${m.key}-${e}`} className="sr-only">
                      {m.title} {e}
                    </Label>
                    <Input
                      id={`zone-${m.key}-${e}`}
                      type="number"
                      step="any"
                      className="h-7"
                      value={limits[m.key][e] ?? ""}
                      placeholder="—"
                      onChange={(ev) => set(m.key, e, ev.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
