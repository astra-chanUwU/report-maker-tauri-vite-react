import { describe, expect, it } from "vitest";
import type { CsvRowSummary } from "../mdb";
import {
  groupHistories,
  renderTrendPng,
  takeLastHistory,
  trendYMax,
  type TrendSample,
} from "../trends";
import { DEFAULT_ZONE_LIMITS } from "../zones";

function row(over: Partial<CsvRowSummary> & { index: number }): CsvRowSummary {
  return {
    pointId: "P1",
    directionId: "H",
    measDate: "45000",
    peakV: "1",
    peakFreq: "10",
    rmsV: "1",
    rmsA: "2",
    peakA: "3",
    unit: "mm/s",
    noLines: "100",
    ...over,
  };
}

describe("groupHistories", () => {
  it("groups by point+direction and sorts by OLE date", () => {
    const rows = [
      row({ index: 0, measDate: "45002", rmsV: "3" }),
      row({ index: 1, measDate: "45000", rmsV: "1" }),
      row({ index: 2, measDate: "45001", rmsV: "2" }),
    ];
    const g = groupHistories(rows);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("P1 / H");
    expect(g[0].samples.map((s) => s.rmsV)).toEqual([1, 2, 3]);
  });

  it("splits distinct points/directions and skips bad dates", () => {
    const rows = [
      row({ index: 0, pointId: "A", directionId: "H", measDate: "45000" }),
      row({ index: 1, pointId: "A", directionId: "V", measDate: "45001" }),
      row({ index: 2, pointId: "B", directionId: "", measDate: "45002" }),
      row({ index: 3, pointId: "A", directionId: "H", measDate: "not-a-date" }),
      row({ index: 4, pointId: "A", directionId: "H", measDate: "0" }),
    ];
    const g = groupHistories(rows);
    expect(g.map((h) => h.label)).toEqual(["A / H", "A / V", "B"]);
    expect(g[0].samples).toHaveLength(1);
  });

  it("carries unreadable rms/accel as nulls, keeps sample positions", () => {
    const rows = [
      row({ index: 0, measDate: "45000", rmsV: "—", rmsA: "" }),
      row({ index: 1, measDate: "45001", rmsV: "2.5", rmsA: "7" }),
    ];
    const g = groupHistories(rows);
    expect(g[0].samples[0]).toMatchObject({ rmsV: null, rmsA: null });
    // Spectra stores acceleration in g; trends carry m/s²
    expect(g[0].samples[1].rmsV).toBe(2.5);
    expect(g[0].samples[1].rmsA).toBeCloseTo(7 * 9.80665, 3);
  });
});

describe("takeLastHistory", () => {
  const samples: TrendSample[] = [1, 2, 3, 4, 5].map((v) => ({
    dateNum: 45000 + v,
    dateISO: `d${v}`,
    rmsV: v,
    rmsA: v,
  }));

  it("takes the last N", () => {
    expect(takeLastHistory(samples, 3).map((s) => s.rmsV)).toEqual([3, 4, 5]);
  });

  it('"all" returns everything', () => {
    expect(takeLastHistory(samples, "all")).toHaveLength(5);
  });

  it("clamps when N exceeds length", () => {
    expect(takeLastHistory(samples, 10)).toHaveLength(5);
  });
});

describe("trendYMax", () => {
  const vel = DEFAULT_ZONE_LIMITS.velocity;

  it("expands above the max data value", () => {
    expect(trendYMax([1, 2, 3], vel)).toBeGreaterThan(3);
  });

  it("covers the top threshold when the data is small", () => {
    expect(trendYMax([0.2, 0.3], vel)).toBeGreaterThanOrEqual((vel.top ?? 0) * 1.05);
  });

  it("ignores nulls", () => {
    expect(trendYMax([null, 2, null], vel)).toBeGreaterThan(2);
  });
});

describe("renderTrendPng", () => {
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  it("renders a valid PNG for real data", () => {
    const samples: TrendSample[] = [1, 2, 2.5, 4].map((v, i) => ({
      dateNum: 45000 + i,
      dateISO: `d${i}`,
      rmsV: v,
      rmsA: v * 2,
    }));
    const png = renderTrendPng(samples, "rmsV", DEFAULT_ZONE_LIMITS.velocity);
    expect(Array.from(png.slice(0, 8))).toEqual(pngSig);
    expect(png.length).toBeGreaterThan(100);
  });

  it("renders a valid PNG for empty and all-null data", () => {
    const cases: TrendSample[][] = [[], [{ dateNum: 1, dateISO: "d", rmsV: null, rmsA: null }]];
    for (const samples of cases) {
      const png = renderTrendPng(samples, "rmsV", DEFAULT_ZONE_LIMITS.velocity);
      expect(Array.from(png.slice(0, 8))).toEqual(pngSig);
    }
  });
});
