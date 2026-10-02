import { describe, expect, it } from "vitest";
import { estimatePercent, stageLabel } from "../export-progress";

describe("export-progress", () => {
  it("labels stages", () => {
    expect(stageLabel("fft")).toMatch(/spectra/i);
    expect(stageLabel("done")).toMatch(/ready/i);
  });

  it("estimates percent within stage range", () => {
    const start = estimatePercent("fft", 0);
    const mid = estimatePercent("fft", 0.5);
    const end = estimatePercent("fft", 1);
    expect(mid).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(mid);
    expect(end).toBeLessThanOrEqual(estimatePercent("building"));
  });
});
