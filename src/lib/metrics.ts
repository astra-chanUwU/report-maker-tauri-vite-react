/**
 * Measurement metrics shown beside velocity in the measuring-results table.
 *
 * Spectra stores TotalRMSA and BC in g; the report (like the legacy Report Builder)
 * prints them in m/s², so readings and DB alarm limits are scaled by standard gravity.
 * Envelope overalls stay in their instrument unit (gEN).
 */

import { toLimit, type ZoneLimits, type ZoneLimitSet } from "./zones";

export const STANDARD_G = 9.80665;

export type SecondaryMetric = "acceleration" | "bc" | "envelope";

/** Series key on a trend sample. */
export type TrendMetric = "rmsV" | "rmsA" | "bc" | "envelope";

export const SECONDARY_METRICS: SecondaryMetric[] = ["acceleration", "bc", "envelope"];

export const SECONDARY_SERIES: Record<SecondaryMetric, TrendMetric> = {
  acceleration: "rmsA",
  bc: "bc",
  envelope: "envelope",
};

export function gToMps2(raw: unknown): number | null {
  const v = toLimit(raw);
  return v === null ? null : Math.round(v * STANDARD_G * 10000) / 10000;
}

/** Acceleration and BC share the acceleration alarms; envelope has its own. */
export function secondaryLimits(limits: ZoneLimitSet, metric: SecondaryMetric): ZoneLimits {
  return metric === "envelope" ? limits.envelope : limits.acceleration;
}

export interface SecondaryLabels {
  /** Group header, e.g. "Acceleration — RMS (m/s²)". */
  group: string;
  /** Zone column header, e.g. "A Zone". */
  zone: string;
  /** Short name for app tables and chips. */
  short: string;
  unit: string;
}

export function secondaryLabels(
  metric: SecondaryMetric,
  lang: "en" | "fa" = "en",
  envelopeUnit = "gEN"
): SecondaryLabels {
  const fa = lang === "fa";
  if (metric === "bc") {
    return {
      group: fa ? "BC — RMS (m/s²)" : "BC — RMS (m/s²)",
      zone: fa ? "ناحیه BC" : "BC Zone",
      short: "BC",
      unit: "m/s²",
    };
  }
  if (metric === "envelope") {
    return {
      group: fa ? `انولوپ — RMS (${envelopeUnit})` : `Envelope — RMS (${envelopeUnit})`,
      zone: fa ? "ناحیه E" : "E Zone",
      short: fa ? "انولوپ" : "Envelope",
      unit: envelopeUnit,
    };
  }
  return {
    group: fa ? "شتاب — RMS (m/s²)" : "Acceleration — RMS (m/s²)",
    zone: fa ? "ناحیه A" : "A Zone",
    short: fa ? "شتاب" : "Acceleration",
    unit: "m/s²",
  };
}

export const SECONDARY_HINT: Record<SecondaryMetric, string> = {
  acceleration: "Overall acceleration RMS (TotalRMSA). Uses the acceleration alarms.",
  bc: "Bearing condition (BC) overall. Uses the acceleration alarms.",
  envelope: "Envelope overall from EnvelopeData. Uses the envelope alarms.",
};
