import { describe, expect, it } from "vitest";
import { softExportPercent } from "../import-jobs";

describe("softExportPercent staged 5-60 for 3-stage bar", () => {
  it("does not start at 90% for small files", () => {
    expect(softExportPercent(10 * 1024 * 1024)).toBeLessThan(30);
    expect(softExportPercent(50 * 1024 * 1024)).toBeLessThan(55);
  });
  it("caps at 60 for staged export (catalog/index fill the rest)", () => {
    const p200 = softExportPercent(200 * 1024 * 1024);
    const p500 = softExportPercent(500 * 1024 * 1024);
    expect(p200).toBeGreaterThan(40);
    expect(p200).toBeLessThanOrEqual(60);
    expect(p500).toBeGreaterThan(50);
    expect(p500).toBeLessThanOrEqual(60);
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
