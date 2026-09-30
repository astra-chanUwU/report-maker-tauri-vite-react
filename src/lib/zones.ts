/**
 * Zone classification (A/B/U/C) from alarm thresholds.
 *
 * Faithful port of `ReportMaker/reporting/zones.py` + `word/docx_design.py`
 * from the legacy Python ReportMaker, so reports from both apps agree:
 * - Boundaries are INCLUSIVE at the lower edge: reading >= top → C, etc.
 * - Non-numeric / missing readings → "" (no zone).
 * - A missing `mid` is derived: mid = round(dbTop, 1), top = round(mid * 1.23, 1).
 * - Colors/labels are mirrored exactly (fills without '#').
 */

export type ZoneLetter = "A" | "B" | "U" | "C";

/** Empty string = no zone (missing reading or disabled limits). */
export type ZoneResult = ZoneLetter | "";

export interface ZoneLimits {
  bottom: number | null;
  mid: number | null;
  top: number | null;
}

export interface ZoneLimitSet {
  velocity: ZoneLimits;
  acceleration: ZoneLimits;
  envelope: ZoneLimits;
}

export type ZoneMetric = keyof ZoneLimitSet;

export const ZONE_LABELS: Record<ZoneLetter, string> = {
  A: "Acceptable",
  B: "Borderline",
  U: "Unacceptable",
  C: "Critical",
};

/** Cell fills (hex, no '#') — mirrored from legacy docx_design.ZONE_FILL. */
export const ZONE_FILL: Record<ZoneResult, string> = {
  A: "2E7D32",
  B: "FFEB3B",
  U: "F57C00",
  C: "D32F2F",
  "": "E0E0E0",
};

/** Cell text colors (hex, no '#') — mirrored from legacy docx_design.ZONE_TEXT. */
export const ZONE_TEXT: Record<ZoneResult, string> = {
  A: "FFFFFF",
  B: "000000",
  U: "FFFFFF",
  C: "FFFFFF",
  "": "333333",
};

/** Scale factor deriving the Critical edge from the Unacceptable edge. */
export const ALARM_TOP_SCALE = 1.23;

/**
 * Defaults observed in real legacy exports (Conveyor System CH):
 * velocity 3.50/7.00/8.60, acceleration 14.71/29.40/36.20, envelope disabled.
 */
export const DEFAULT_ZONE_LIMITS: ZoneLimitSet = {
  velocity: { bottom: 3.5, mid: 7.0, top: 8.6 },
  acceleration: { bottom: 14.71, mid: 29.4, top: 36.2 },
  envelope: { bottom: 0, mid: 0, top: 0 },
};

/** Coerce anything to a finite number or null (mirrors config._float_or_none). */
export function toLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * From DB alarm columns (bottom + db top) build bottom/mid/top.
 * Mirrors config.derive_alarm_limits.
 */
export function deriveAlarmLimits(bottom: unknown, dbTop: unknown): ZoneLimits {
  const bottomF = toLimit(bottom);
  const topF = toLimit(dbTop);
  if (topF === null) return { bottom: bottomF, mid: null, top: null };
  const mid = Math.round(topF * 10) / 10;
  const top = Math.round(mid * ALARM_TOP_SCALE * 10) / 10;
  return { bottom: bottomF, mid, top };
}

/** Fill a missing mid via derivation (mirrors zones._resolved_limits). */
export function resolveLimits(raw: { bottom: unknown; mid: unknown; top: unknown }): ZoneLimits {
  const mid = toLimit(raw.mid);
  if (mid === null) return deriveAlarmLimits(raw.bottom, raw.top);
  return { bottom: toLimit(raw.bottom), mid, top: toLimit(raw.top) };
}

/** Limits are disabled when nothing usable is set (e.g. envelope 0/0/0). */
export function limitsDisabled(limits: ZoneLimits): boolean {
  const vals = [limits.bottom, limits.mid, limits.top];
  return !vals.some((v) => v !== null && v > 0);
}

/**
 * Classify one reading. Boundaries inclusive at the lower edge.
 * Mirrors zones.classify_zone, plus "" for disabled limit sets.
 */
export function classifyZone(value: unknown, rawLimits: ZoneLimits): ZoneResult {
  const limits = resolveLimits(rawLimits);
  if (limitsDisabled(limits)) return "";
  const reading = toLimit(value);
  if (reading === null) return "";
  if (limits.top !== null && reading >= limits.top) return "C";
  if (limits.mid !== null && reading >= limits.mid) return "U";
  if (limits.bottom !== null && reading >= limits.bottom) return "B";
  return "A";
}

export interface ZoneBand {
  y0: number;
  y1: number;
  zone: ZoneLetter;
  color: string;
}

/**
 * Ordered horizontal bands for chart alarm backgrounds.
 * Mirrors zones.trend_zone_bands (kept for the future trend-chart slice).
 */
export function trendZoneBands(rawLimits: ZoneLimits, yMin: number, yMax: number): ZoneBand[] {
  if (!(yMax > yMin)) return [];
  const { bottom, mid, top } = resolveLimits(rawLimits);
  if (bottom === null && mid === null && top === null) return [];
  const bands: ZoneBand[] = [];
  let cursor = yMin;
  const append = (zone: ZoneLetter, y1: number) => {
    if (y1 <= cursor + 1e-12) return;
    bands.push({ y0: cursor, y1, zone, color: ZONE_FILL[zone] });
    cursor = y1;
  };
  if (bottom !== null) append("A", Math.min(bottom, yMax));
  if (mid !== null) append("B", Math.min(mid, yMax));
  if (top !== null) append("U", Math.min(top, yMax));
  if (cursor < yMax - 1e-12) {
    bands.push({ y0: cursor, y1: yMax, zone: "C", color: ZONE_FILL.C });
  }
  return bands;
}

/** Legacy specs-table style: "3.50 / 7.00 / 8.60". */
export function formatLimits(limits: ZoneLimits): string {
  const f = (v: number | null) => (v === null ? "—" : v.toFixed(2));
  return `${f(limits.bottom)} / ${f(limits.mid)} / ${f(limits.top)}`;
}

/** "V Zone (3.5/7/8.6)" column-header style. */
export function limitsShort(limits: ZoneLimits): string {
  const f = (v: number | null) => (v === null ? "—" : String(Math.round(v * 100) / 100));
  return `${f(limits.bottom)}/${f(limits.mid)}/${f(limits.top)}`;
}
