import { describe, expect, it } from "vitest";
import { convertSp3FromDisk, isTauriRuntime, mdbToolStatus } from "../mdb";
import { loadMdbToolPath, saveMdbToolPath } from "../settings";

describe("mdb (Tauri-only integration)", () => {
  it("detects non-Tauri runtime", async () => {
    await expect(isTauriRuntime()).resolves.toBe(false);
  });

  it("refuses conversion outside Tauri instead of hanging", async () => {
    await expect(convertSp3FromDisk()).rejects.toThrow();
  });

  it("status call fails loudly outside Tauri", async () => {
    await expect(mdbToolStatus()).rejects.toThrow();
  });

  it("persists the tool path override", () => {
    saveMdbToolPath("D:\\tools\\mdb-export.exe");
    expect(loadMdbToolPath()).toBe("D:\\tools\\mdb-export.exe");
    saveMdbToolPath("");
    expect(loadMdbToolPath()).toBe("");
  });
});
