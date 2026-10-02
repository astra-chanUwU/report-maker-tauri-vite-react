import { describe, expect, it } from "vitest";
import { groupEquipmentsByDb, sp3Filename } from "../equipment";

describe("equipment provenance", () => {
  it("sp3Filename extracts base", () => {
    expect(sp3Filename("C:\\Spectra\\HHP-101A.sp3")).toBe("HHP-101A.sp3");
    expect(sp3Filename("/tmp/data/foo.mdb")).toBe("foo.mdb");
    expect(sp3Filename(null)).toBe("");
    expect(sp3Filename("")).toBe("");
  });

  it("groups by DB filename", () => {
    const list = [
      { id: "a", sp3Path: "C:\\a\\db1.sp3" } as any,
      { id: "b", sp3Path: "C:\\a\\db1.sp3" } as any,
      { id: "c", sp3Path: "/tmp/db2.sp3" } as any,
      { id: "d", sp3Path: null } as any,
    ];
    const g = groupEquipmentsByDb(list);
    expect(g.get("db1.sp3")?.length).toBe(2);
    expect(g.get("db2.sp3")?.length).toBe(1);
    expect(g.get("(manual)")?.length).toBe(1);
  });

  it("replace vs append semantics (pure filter)", () => {
    const existing = [
      { id: "1", sp3Path: "a.sp3" } as any,
      { id: "2", sp3Path: "b.sp3" } as any,
    ];
    const built = [{ id: "3", sp3Path: "c.sp3" } as any];
    const appended = [...existing, ...built];
    expect(appended.length).toBe(3);
    const replaced = built;
    expect(replaced.length).toBe(1);
    expect(replaced[0].sp3Path).toBe("c.sp3");
  });

  it("clear all and remove by DB", () => {
    const list = [
      { id: "1", sp3Path: "db1.sp3" } as any,
      { id: "2", sp3Path: "db1.sp3" } as any,
      { id: "3", sp3Path: "db2.sp3" } as any,
    ];
    const cleared: typeof list = [];
    expect(cleared.length).toBe(0);
    const removedDb1 = list.filter((e) => e.sp3Path !== "db1.sp3");
    expect(removedDb1.length).toBe(1);
    expect(removedDb1[0].id).toBe("3");
  });
});
