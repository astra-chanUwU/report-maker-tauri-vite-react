import { RotateCcw } from "lucide-react";
import {
  DEFAULT_ZONE_LIMITS,
  ZONE_FILL,
  ZONE_LABELS,
  type ZoneLetter,
  type ZoneLimitSet,
  type ZoneMetric,
} from "../lib/zones";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Alarm zones</CardTitle>
        <CardDescription>
          B / U / C thresholds per metric. Readings at or above an edge move up a zone; envelope
          stays disabled while all-zero.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ZONE_LABELS) as ZoneLetter[]).map((z) => (
            <span
              key={z}
              className="rounded px-2 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: `#${ZONE_FILL[z]}`, color: z === "B" ? "#000" : "#fff" }}
              title={ZONE_LABELS[z]}
            >
              {z} · {ZONE_LABELS[z]}
            </span>
          ))}
        </div>
        {METRICS.map((m) => (
          <div key={m.key} className="grid gap-1.5">
            <p className="text-sm font-medium">
              {m.title} <span className="font-normal text-muted-foreground">— {m.hint}</span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              {EDGES.map((e) => (
                <div key={e} className="grid gap-1">
                  <Label htmlFor={`zone-${m.key}-${e}`} className="text-xs uppercase">
                    {e === "bottom" ? "B" : e === "mid" ? "U" : "C"}
                  </Label>
                  <Input
                    id={`zone-${m.key}-${e}`}
                    type="number"
                    step="any"
                    value={limits[m.key][e] ?? ""}
                    placeholder="—"
                    onChange={(ev) => set(m.key, e, ev.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(structuredClone(DEFAULT_ZONE_LIMITS))}
          >
            <RotateCcw />
            Reset to defaults (3.5/7/8.6 · 14.71/29.4/36.2)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
