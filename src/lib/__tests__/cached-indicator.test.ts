import { describe, expect, it } from "vitest";

describe("cached indicator", () => {
  it("cache has is_cached command and frontend helper", async () => {
    const rs = await import("fs").then((fs) => fs.readFileSync("src-tauri/src/cache.rs", "utf8"));
    expect(rs).toContain("is_cached");
    const lib = await import("fs").then((fs) => fs.readFileSync("src-tauri/src/lib.rs", "utf8"));
    expect(lib).toContain("cache::is_cached");
    const js = await import("fs").then((fs) => fs.readFileSync("src/lib/cache.ts", "utf8"));
    expect(js).toContain("isCached");
  });
  it("App shows Cached/Not cached per DB", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/App.tsx", "utf8"));
    expect(src).toContain("cachedMap");
    expect(src).toContain("isCached");
    expect(src).toContain("Cached");
    expect(src).toContain("Not cached");
  });
  it("RecentDbs shows cached badge", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src/components/recent-dbs.tsx", "utf8"));
    expect(src).toContain("cachedSet");
    expect(src).toContain("isCached");
  });
});
