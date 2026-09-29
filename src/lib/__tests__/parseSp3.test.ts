import { describe, expect, it } from "vitest";
import { parseSp3 } from "../parseSp3";

const TEXT_FIXTURE = `# demo sp3
100,0.42
200 0.87
300;1.31
400\t0.95
`;

function binaryFixture(): Uint8Array {
  const pairs: Array<[number, number]> = [
    [10, 0.1],
    [20, 0.5],
    [30, 1.2],
    [40, 0.9],
  ];
  const buf = new ArrayBuffer(pairs.length * 8);
  const view = new DataView(buf);
  pairs.forEach(([f, a], i) => {
    view.setFloat32(i * 8, f, true);
    view.setFloat32(i * 8 + 4, a, true);
  });
  return new Uint8Array(buf);
}

describe("parseSp3", () => {
  it("parses text csv .sp3", () => {
    const r = parseSp3(new TextEncoder().encode(TEXT_FIXTURE), "demo.sp3");
    expect(r.meta.source).toBe("text");
    expect(r.spectra).toHaveLength(4);
    expect(r.stats.spectra_points).toBe(4);
    expect(r.stats.freq_min).toBe(100);
    expect(r.stats.freq_max).toBe(400);
    expect(r.stats.peak).toEqual({ freq: 300, amp: 1.31 });
  });

  it("parses binary float32 LE pairs", () => {
    const r = parseSp3(binaryFixture(), "bin.sp3");
    expect(r.meta.source).toBe("binary");
    expect(r.spectra).toHaveLength(4);
    expect(r.stats.peak.freq).toBe(30);
    expect(r.stats.peak.amp).toBeCloseTo(1.2, 5);
  });

  it("falls back to synthetic on empty", () => {
    const r = parseSp3(new Uint8Array(0), "empty.sp3");
    expect(r.meta.source).toBe("synthetic");
    expect(r.spectra.length).toBeGreaterThan(10);
    expect(r.warning).toMatch(/synthetic/i);
    expect(r.stats.spectra_points).toBe(r.spectra.length);
  });
});
