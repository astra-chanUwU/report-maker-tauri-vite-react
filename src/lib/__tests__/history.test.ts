import { describe, expect, it, beforeEach, vi, beforeAll } from "vitest";
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get() {
      throw new Error("no tauri in test");
    }
    async set() {}
    async save() {}
  },
}));

beforeAll(() => {
  if (typeof (globalThis as unknown as { localStorage?: unknown }).localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as unknown as Storage;
  }
});
import {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  makeEntry,
} from "../history";
import type { ReportOptions } from "../parseSp3";

function opts(): ReportOptions {
  return {
    projectName: "P",
    engineer: "E",
    reportDate: "2026-09-29",
    units: "SI",
    norm: "Default",
    notes: "",
    pointLimit: 120,
  };
}

describe("history", () => {
  beforeEach(async () => {
    await clearHistory();
    try {
      localStorage.clear();
    } catch {}
  });

  it("makeEntry fabricates ids and timestamps", () => {
    const e = makeEntry({
      projectName: "A",
      engineer: "Eng",
      date: "2026-09-30",
      filename: "a.docx",
      savedPath: null,
      sourceFile: "data.csv",
      source: "spec-csv",
      spectraPoints: 400,
      peak: { freq: 25, amp: 0.5 },
      options: opts(),
    });
    expect(e.id).toBeTruthy();
    expect(e.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(e.projectName).toBe("A");
  });

  it("persists across load, caps at 100, and LIFO order", async () => {
    for (let i = 0; i < 105; i++) {
      await addHistoryEntry(
        makeEntry({
          projectName: `P${i}`,
          engineer: "E",
          date: "2026-09-29",
          filename: `f${i}.docx`,
          savedPath: null,
          sourceFile: "x.csv",
          source: "text",
          spectraPoints: i,
          peak: { freq: i, amp: i },
          options: opts(),
        })
      );
    }
    const loaded = await loadHistory();
    expect(loaded).toHaveLength(100);
    expect(loaded[0].projectName).toBe("P104");
  });

  it("delete removes one entry", async () => {
    const a = makeEntry({
      projectName: "A",
      engineer: "E",
      date: "2026-09-29",
      filename: "a.docx",
      savedPath: null,
      sourceFile: "a.csv",
      source: "text",
      spectraPoints: 4,
      peak: { freq: 1, amp: 1 },
      options: opts(),
    });
    const b = makeEntry({
      projectName: "B",
      engineer: "E",
      date: "2026-09-29",
      filename: "b.docx",
      savedPath: "/tmp/b.docx",
      sourceFile: "b.csv",
      source: "text",
      spectraPoints: 4,
      peak: { freq: 2, amp: 2 },
      options: opts(),
    });
    await addHistoryEntry(a);
    await addHistoryEntry(b);
    const after = await deleteHistoryEntry(a.id);
    expect(after.some((e) => e.id === a.id)).toBe(false);
    expect(after.some((e) => e.id === b.id)).toBe(true);
  });

  it("clear empties store", async () => {
    await addHistoryEntry(
      makeEntry({
        projectName: "X",
        engineer: "E",
        date: "2026-09-29",
        filename: "x.docx",
        savedPath: null,
        sourceFile: "x.csv",
        source: "text",
        spectraPoints: 1,
        peak: { freq: 0, amp: 0 },
        options: opts(),
      })
    );
    expect((await loadHistory()).length).toBe(1);
    await clearHistory();
    expect((await loadHistory()).length).toBe(0);
  });
});
