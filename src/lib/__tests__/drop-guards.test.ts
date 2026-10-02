import { describe, expect, it } from "vitest";
import { extOf, isImagePath, isIngestPath, shouldHandleNativeDrop } from "../drop-guards";

describe("drop-guards – ingest vs image routing", () => {
  it("classifies ingest extensions", () => {
    expect(isIngestPath("db.sp3")).toBe(true);
    expect(isIngestPath("DB.SP3")).toBe(true);
    expect(isIngestPath("file.mdb")).toBe(true);
    expect(isIngestPath("export.csv")).toBe(true);
    expect(isIngestPath("notes.txt")).toBe(true);
  });

  it("classifies image extensions", () => {
    expect(isImagePath("logo.png")).toBe(true);
    expect(isImagePath("cover.JPG")).toBe(true);
    expect(isImagePath("sig.jpeg")).toBe(true);
    expect(isImagePath("shot.webp")).toBe(true);
  });

  it("does not cross-classify", () => {
    expect(isIngestPath("logo.png")).toBe(false);
    expect(isImagePath("db.sp3")).toBe(false);
    expect(isIngestPath("photo.jpg")).toBe(false);
  });

  it("extOf is case-insensitive and handles paths", () => {
    expect(extOf("C:\\Data\\file.MDB")).toBe("mdb");
    expect(extOf("/tmp/archive/db.sp3")).toBe("sp3");
    expect(extOf("noext")).toBe("noext");
  });

  it("shouldHandleNativeDrop only allows ingest", () => {
    expect(shouldHandleNativeDrop("C:\\Spectra\\machine.sp3")).toBe(true);
    expect(shouldHandleNativeDrop("/tmp/data.csv")).toBe(true);
    expect(shouldHandleNativeDrop("/tmp/logo.png")).toBe(false);
    expect(shouldHandleNativeDrop("/tmp/cover.jpg")).toBe(false);
    expect(shouldHandleNativeDrop("/tmp/report.pdf")).toBe(false);
    expect(shouldHandleNativeDrop("/tmp/noext")).toBe(false);
  });

  it("prevents image drop from stealing ingest overlay", () => {
    // Regression: dragging a logo/signature image must NOT be treated as an ingest drop
    expect(shouldHandleNativeDrop("signature.png")).toBe(false);
    expect(isIngestPath("signature.png")).toBe(false);
    expect(isImagePath("signature.png")).toBe(true);
  });
});
