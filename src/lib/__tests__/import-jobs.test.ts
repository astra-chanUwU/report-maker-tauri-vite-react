import { describe, expect, it } from "vitest";
import {
  basename,
  filenameOf,
  formatBytes,
  groupByDb,
  makeJob,
  softExportPercent,
} from "../import-jobs";

describe("import-jobs", () => {
  it("filenameOf extracts basename", () => {
    expect(filenameOf("C:\\Data\\foo.sp3")).toBe("foo.sp3");
    expect(filenameOf("/tmp/bar.mdb")).toBe("bar.mdb");
    expect(filenameOf("plain.csv")).toBe("plain.csv");
  });

  it("basename handles empty", () => {
    expect(basename(null)).toBe("");
    expect(basename("")).toBe("");
    expect(basename("a/b/c.sp3")).toBe("c.sp3");
  });

  it("makeJob creates queued job", () => {
    const j = makeJob("/tmp/my.sp3");
    expect(j.path).toBe("/tmp/my.sp3");
    expect(j.filename).toBe("my.sp3");
    expect(j.stage).toBe("queued");
  });

  it("groupByDb groups by filename", () => {
    const items = [
      { sp3Path: "C:\\a\\db1.sp3", id: "1" },
      { sp3Path: "C:\\a\\db1.sp3", id: "2" },
      { sp3Path: "/tmp/db2.sp3", id: "3" },
      { sp3Path: null, id: "4" },
    ];
    const g = groupByDb(items);
    expect(g.get("db1.sp3")?.length).toBe(2);
    expect(g.get("db2.sp3")?.length).toBe(1);
    expect(g.get("(manual)")?.length).toBe(1);
  });

  it("softExportPercent grows with bytes but caps under 90", () => {
    expect(softExportPercent(0)).toBe(5);
    expect(softExportPercent(1024 * 1024)).toBeGreaterThan(softExportPercent(0));
    expect(softExportPercent(200 * 1024 * 1024)).toBeLessThanOrEqual(90);
  });

  it("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toMatch(/KB/);
    expect(formatBytes(3 * 1024 * 1024)).toMatch(/MB/);
  });
});
