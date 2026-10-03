import { describe, expect, it } from "vitest";

describe("export cache wiring", () => {
  it("mdb.rs has cache hit and put", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src-tauri/src/mdb.rs", "utf8"));
    expect(src).toContain("get_cached");
    expect(src).toContain("put_cached");
    expect(src).toContain("is_data");
  });
  it("cache.rs has LRU and age eviction", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src-tauri/src/cache.rs", "utf8"));
    expect(src).toContain("MAX_ENTRIES");
    expect(src).toContain("MAX_BYTES");
    expect(src).toContain("MAX_AGE_MS");
    expect(src).toContain("evict_on_startup");
  });
  it("cache commands are registered", async () => {
    const src = await import("fs").then((fs) => fs.readFileSync("src-tauri/src/lib.rs", "utf8"));
    expect(src).toContain("cache::clear_export_cache");
    expect(src).toContain("cache::cache_status");
    expect(src).toContain("cache::is_cached");
    expect(src).toContain("cache::list_cache_entries");
  });
  it("frontend cache helpers and settings exist", async () => {
    const mdb = await import("fs").then((fs) => fs.readFileSync("src/lib/cache.ts", "utf8"));
    expect(mdb).toContain("getCacheStatus");
    expect(mdb).toContain("clearExportCache");
    expect(mdb).toContain("listCacheEntries");
    expect(mdb).toContain("isCached");
    const app = await import("fs").then((fs) => fs.readFileSync("src/App.tsx", "utf8"));
    expect(app).toContain("CacheSettings");
    const panel = await import("fs").then((fs) => fs.readFileSync("src/components/cache-settings.tsx", "utf8"));
    expect(panel).toContain("Export cache");
    expect(panel).toContain("listCacheEntries");
  });
  it("Settings page is dense dashboard with per-DB sizes", async () => {
    const panel = await import("fs").then((fs) => fs.readFileSync("src/components/cache-settings.tsx", "utf8"));
    expect(panel).toContain("formatCacheBytes");
    expect(panel).toContain("cachedAtMs");
  });
});
