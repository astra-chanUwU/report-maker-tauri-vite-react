import { describe, expect, it } from "vitest";
import type { SpectraPoint } from "../lib/parseSp3";
import { previewPeakMarks } from "./spectra-chart-peaks";

function spectrum(peaks: { index: number; amp: number }[], n = 80): SpectraPoint[] {
  const spectra = Array.from({ length: n }, (_, i) => ({ freq: i * 10, amp: 0 }));
  for (const peak of peaks) spectra[peak.index] = { freq: peak.index * 10, amp: peak.amp };
  return spectra;
}

describe("preview peak callouts", () => {
  it("selects the same top 5 local maxima as the Word gallery", () => {
    const marks = previewPeakMarks(
      spectrum([
        { index: 5, amp: 8 },
        { index: 15, amp: 3 },
        { index: 25, amp: 6 },
        { index: 35, amp: 2 },
        { index: 45, amp: 9 },
        { index: 55, amp: 4 },
      ])
    );
    expect(marks).toHaveLength(5);
    expect(marks.map((m) => m.amp)).toEqual([8, 3, 6, 9, 4]);
    expect(marks.map((m) => m.freq)).toEqual([50, 150, 250, 450, 550]);
    expect(marks.map((m) => m.label)).toEqual(["50.0", "150", "250", "450", "550"]);
    expect(marks.map((m) => m.lift)).toEqual([22, 38, 54, 22, 38]);
  });

  it("labels smaller frequencies with the shared formatter", () => {
    const marks = previewPeakMarks(
      spectrum([
        { index: 4, amp: 2 },
        { index: 20, amp: 5 },
      ])
    );
    expect(marks.map((m) => m.label)).toEqual(["40.0", "200"]);
  });
});
