import { describe, expect, it } from "vitest";
import { catalogPercent, stagedExportPercent } from "../import-jobs";

describe("import progress stages are meaningful", () => {
  it("stagedExportPercent stays in 5-60", () => {
    expect(stagedExportPercent(0)).toBe(5);
    expect(stagedExportPercent(10 * 1024 * 1024)).toBeLessThan(30);
    expect(stagedExportPercent(500 * 1024 * 1024)).toBeLessThanOrEqual(60);
    expect(stagedExportPercent(2 * 1024 * 1024 * 1024)).toBe(60);
  });
  it("catalogPercent maps 60->85", () => {
    expect(catalogPercent(0, 4)).toBe(60);
    expect(catalogPercent(2, 4)).toBe(73);
    expect(catalogPercent(4, 4)).toBe(85);
  });
  it("App wires 3 stages", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/App.tsx", "utf8"));
    expect(src).toContain("Step 1/3");
    expect(src).toContain("Step 2/3");
    expect(src).toContain("Step 3/3");
    expect(src).toContain("stagedExportPercent");
  });
  it("ImportProgress shows phase detail and step badge", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/components/import-progress.tsx", "utf8"));
    expect(src).toContain("phaseDetail");
    expect(src).toContain("Step");
    expect(src).toContain("Exporting Data");
  });
});
