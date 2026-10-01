import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseSpecCsvFirstRow, detectJetMdb, decodeOctalBlob } from "../specdata";
describe("large CH conveyor fix", () => {
  it("detects Jet DB magic", () => {
    const jet = new TextEncoder().encode("Standard Jet DB extra");
    expect(detectJetMdb(jet)).toBe(true);
    expect(detectJetMdb(new TextEncoder().encode("hello"))).toBe(false);
  });
  it("decodes octal blob from -b octal export", () => {
    // Simulate \000\001 octal for 2 zero bytes
    const blob = decodeOctalBlob('"\\000\\001\\002"');
    expect(blob[0]).toBe(0);
    expect(blob[1]).toBe(1);
    expect(blob[2]).toBe(2);
  });
  it("parses CH conveyor octal head (1M slice, expects first row)", async () => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync("/tmp/ch_head_octal.bin");
    } catch {
      return;
    }
    if (bytes.length < 100) return;
    const preview = parseSpecCsvFirstRow(bytes);
    expect(preview).not.toBeNull();
    expect(preview!.row.noLines).toBe(6400);
    expect(preview!.row.bandWidth).toBe(0.5);
    // First row decodes; head slice contains ~10 rows worth of bytes so rowCount is small
    expect(preview!.rowCount).toBeGreaterThan(5);
  });
});
