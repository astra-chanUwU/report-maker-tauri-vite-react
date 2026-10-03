import { describe, expect, it } from "vitest";
import { PERF_THRESHOLDS, timed, formatMs } from "../perf-measure";
import { FILE_CHUNK, streamLines } from "../csv-stream";
import { splitCsvLine } from "../specdata";

describe("perf thresholds are documented", () => {
  it("csv worker threshold is 50 MiB", () => {
    expect(PERF_THRESHOLDS.csvWorkerThresholdBytes).toBe(50 * 1024 * 1024);
  });
  it("virtual threshold is 100 rows", () => {
    expect(PERF_THRESHOLDS.virtualThresholdRows).toBe(100);
  });
  it("timed helper measures elapsed", async () => {
    const { elapsedMs, result } = await timed(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    });
    expect(result).toBe(42);
    expect(elapsedMs).toBeGreaterThanOrEqual(4);
    expect(formatMs(elapsedMs)).toMatch(/ms|s/);
  });
  it("streamLines is the shared implementation (not duplicated)", async () => {
    // tiny synthetic CSV exercising the shared streamLines path
    const csv = `PointID,DirectionID,Specdata,NoLines,ValuePeakMaxV,FreqPeakMaxV,TotalRMSV,TotalRMSA,TotalPeakA,BC,Unit\nP1,V,"\\101\\102",1,1,10,1,2,3,,|mm/s|\n`;
    const file = new File([csv], "tiny.csv", { type: "text/csv" });
    expect(FILE_CHUNK).toBe(1 << 20);
    let header: string[] | null = null;
    const res = await streamLines(file, (line, isHeader) => {
      if (isHeader) header = splitCsvLine(line);
    });
    expect(header).not.toBeNull();
    expect(res.header).not.toBeNull();
    expect(res.header).toContain("Specdata");
  });
});
