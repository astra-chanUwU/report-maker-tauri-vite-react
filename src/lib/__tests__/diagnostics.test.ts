import { describe, expect, it } from "vitest";
import { classifyZone } from "../zones";
import { latestPerPoint } from "../report-slices";
import type { CsvRowSummary } from "../mdb";

function row(partial: Partial<CsvRowSummary>): CsvRowSummary {
  return {
    index: 0,
    pointId: "P1",
    directionId: "V",
    measDate: "45000",
    peakV: "1",
    peakFreq: "25",
    rmsV: "3.2",
    rmsA: "0.5",
    peakA: "1",
    unit: "mm/s",
    noLines: "800",
    ...partial,
  } as CsvRowSummary;
}

describe("diagnostics helpers", () => {
  it("classifies zones for jump detection", () => {
    const limits = { bottom: 2.8, mid: 7.1, top: 18 } as any;
    expect(classifyZone("1.0", limits)).toBe("A");
    expect(classifyZone("3.2", limits)).toBe("B");
    expect(classifyZone("8.0", limits)).toBe("U");
    expect(classifyZone("20", limits)).toBe("C");
  });

  it("latestPerPoint picks newest per point-direction", () => {
    const rows = [
      row({ pointId: "P1", directionId: "V", measDate: "45000", rmsV: "2.0" }),
      row({ pointId: "P1", directionId: "V", measDate: "45001", rmsV: "4.5" }),
      row({ pointId: "P2", directionId: "H", measDate: "45000", rmsV: "1.1" }),
    ];
    const latest = latestPerPoint(rows);
    expect(latest.length).toBe(2);
    const p1 = latest.find((r) => r.pointId === "P1")!;
    expect(p1.rmsV).toBe("4.5");
  });

  it("jump detection: B->U counts as jump", () => {
    const limits = { bottom: 2.8, mid: 7.1, top: 18 } as any;
    const prev = classifyZone("3.0", limits); // B
    const curr = classifyZone("8.0", limits); // U
    const RANK: Record<string, number> = { "": 0, A: 1, B: 2, U: 3, C: 4 };
    expect(RANK[curr] > RANK[prev]).toBe(true);
  });

  it("stale cutoff: old measDate is stale", () => {
    const OLE_EPOCH_MS = Date.UTC(1899, 11, 30);
    const oleToMs = (v: string) => OLE_EPOCH_MS + Number(v) * 86400000;
    const old = oleToMs("40000"); // ~2009
    const now = Date.now();
    const staleCut = now - 60 * 86400000;
    expect(old < staleCut).toBe(true);
  });
});
