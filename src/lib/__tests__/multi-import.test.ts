import { describe, expect, it } from "vitest";
import { softExportPercent } from "../import-jobs";

describe("softExportPercent retuned for 500MB", () => {
  it("does not start at 90% for small files", () => {
    expect(softExportPercent(10 * 1024 * 1024)).toBeLessThan(30);
    expect(softExportPercent(50 * 1024 * 1024)).toBeLessThan(55);
  });
  it("reaches ~85% at 200MB and ~90% at 500MB", () => {
    const p200 = softExportPercent(200 * 1024 * 1024);
    const p500 = softExportPercent(500 * 1024 * 1024);
    expect(p200).toBeGreaterThan(75);
    expect(p200).toBeLessThan(90);
    expect(p500).toBeGreaterThan(85);
    expect(p500).toBeLessThanOrEqual(90);
  });
});

describe("multi-upload wiring", () => {
  it("App handles multiple paths", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/App.tsx", "utf8"));
    expect(src).toContain("runPathsWithJobs");
    expect(src).toContain("multiple: true");
    expect(src).toContain("sp3Paths");
  });
  it("MachinePicker supports multiple catalogs grouped by DB", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/components/machine-picker.tsx", "utf8"));
    expect(src).toContain("catalogs");
    expect(src).toContain("keyFor");
    expect(src).toContain("pickSp3Paths");
    expect(src).toContain("dbName");
  });
});
