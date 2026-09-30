import { describe, expect, it } from "vitest";
import {
  ALARM_TOP_SCALE,
  classifyZone,
  deriveAlarmLimits,
  formatLimits,
  limitsDisabled,
  limitsShort,
  resolveLimits,
  trendZoneBands,
  ZONE_FILL,
  ZONE_LABELS,
  ZONE_TEXT,
  DEFAULT_ZONE_LIMITS,
} from "../zones";
import { loadZoneLimits, saveZoneLimits } from "../settings";

const V = DEFAULT_ZONE_LIMITS.velocity; // 3.5 / 7.0 / 8.6

describe("classifyZone (legacy parity)", () => {
  it("classifies below the bottom edge as Acceptable", () => {
    expect(classifyZone(0, V)).toBe("A");
    expect(classifyZone(3.49, V)).toBe("A");
  });

  it("treats boundaries as inclusive at the lower edge", () => {
    expect(classifyZone(3.5, V)).toBe("B");
    expect(classifyZone(6.999, V)).toBe("B");
    expect(classifyZone(7.0, V)).toBe("U");
    expect(classifyZone(8.599, V)).toBe("U");
    expect(classifyZone(8.6, V)).toBe("C");
    expect(classifyZone(25, V)).toBe("C");
  });

  it("coerces numeric strings like legacy float()", () => {
    expect(classifyZone("7.5", V)).toBe("U");
    expect(classifyZone(" 3.5 ", V)).toBe("B");
  });

  it("returns empty for missing / non-numeric readings", () => {
    expect(classifyZone(null, V)).toBe("");
    expect(classifyZone(undefined, V)).toBe("");
    expect(classifyZone("", V)).toBe("");
    expect(classifyZone("n/a", V)).toBe("");
    expect(classifyZone(NaN, V)).toBe("");
  });

  it("supports partial limit sets (two-zone mode)", () => {
    expect(classifyZone(5, { bottom: 3.5, mid: null, top: null })).toBe("B");
    expect(classifyZone(1, { bottom: 3.5, mid: null, top: null })).toBe("A");
  });

  it("treats disabled sets (envelope 0/0/0) as no zone", () => {
    expect(classifyZone(99, DEFAULT_ZONE_LIMITS.envelope)).toBe("");
    expect(classifyZone(99, { bottom: null, mid: null, top: null })).toBe("");
    expect(limitsDisabled(DEFAULT_ZONE_LIMITS.envelope)).toBe(true);
    expect(limitsDisabled(V)).toBe(false);
  });
});

describe("deriveAlarmLimits (legacy parity)", () => {
  it("derives mid/top with the 1.23 scale", () => {
    expect(deriveAlarmLimits(3.5, 7.0)).toEqual({ bottom: 3.5, mid: 7.0, top: 8.6 });
    expect(ALARM_TOP_SCALE).toBe(1.23);
  });

  it("resolves a missing mid from bottom/top", () => {
    expect(resolveLimits({ bottom: 3.5, mid: null, top: 7.0 })).toEqual({
      bottom: 3.5,
      mid: 7.0,
      top: 8.6,
    });
  });

  it("keeps an explicit mid untouched", () => {
    expect(resolveLimits({ bottom: 3.5, mid: 6.0, top: 9.0 })).toEqual({
      bottom: 3.5,
      mid: 6.0,
      top: 9.0,
    });
  });
});

describe("zone presentation constants", () => {
  it("matches the legacy palette and labels", () => {
    expect(ZONE_FILL).toEqual({ A: "2E7D32", B: "FFEB3B", U: "F57C00", C: "D32F2F", "": "E0E0E0" });
    expect(ZONE_TEXT).toEqual({
      A: "FFFFFF",
      B: "000000",
      U: "FFFFFF",
      C: "FFFFFF",
      "": "333333",
    });
    expect(ZONE_LABELS).toEqual({
      A: "Acceptable",
      B: "Borderline",
      U: "Unacceptable",
      C: "Critical",
    });
  });

  it("formats limits legacy-style", () => {
    expect(formatLimits(V)).toBe("3.50 / 7.00 / 8.60");
    expect(limitsShort(V)).toBe("3.5/7/8.6");
  });
});

describe("trendZoneBands", () => {
  it("covers the range with ordered bands", () => {
    const bands = trendZoneBands(V, 0, 10);
    expect(bands.map((b) => b.zone)).toEqual(["A", "B", "U", "C"]);
    expect(bands[0]).toMatchObject({ y0: 0, y1: 3.5 });
    expect(bands[3]).toMatchObject({ y0: 8.6, y1: 10 });
  });

  it("returns empty without limits or with an empty range", () => {
    expect(trendZoneBands({ bottom: null, mid: null, top: null }, 0, 10)).toEqual([]);
    expect(trendZoneBands(V, 5, 5)).toEqual([]);
  });
});

describe("zone limits persistence", () => {
  it("round-trips through settings storage", () => {
    saveZoneLimits({
      velocity: { bottom: 2, mid: 4, top: 6 },
      acceleration: { bottom: 10, mid: 20, top: 30 },
      envelope: { bottom: 0, mid: 0, top: 0 },
    });
    const loaded = loadZoneLimits();
    expect(loaded.velocity).toEqual({ bottom: 2, mid: 4, top: 6 });
    expect(classifyZone(5, loaded.velocity)).toBe("U");
    saveZoneLimits(structuredClone(DEFAULT_ZONE_LIMITS));
    expect(loadZoneLimits()).toEqual(DEFAULT_ZONE_LIMITS);
  });

  it("repairs corrupt stored values with defaults", () => {
    saveZoneLimits({
      velocity: { bottom: "x", mid: null, top: undefined },
      acceleration: { bottom: null, mid: null, top: null },
      envelope: { bottom: 0, mid: 0, top: 0 },
    } as unknown as Parameters<typeof saveZoneLimits>[0]);
    const loaded = loadZoneLimits();
    expect(loaded.velocity).toEqual(DEFAULT_ZONE_LIMITS.velocity);
    saveZoneLimits(structuredClone(DEFAULT_ZONE_LIMITS));
  });
});
