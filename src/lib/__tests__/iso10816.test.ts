import { describe, expect, it } from "vitest";
import { buildIsoTableData, ISO_DATA_ROWS, ISO_FOOTER, ISO_ZONE_FILL } from "../iso10816";

const spanSum = (row: { span?: number }[]) => row.reduce((a, c) => a + (c.span ?? 1), 0);

describe("ISO 10816-3 data (legacy parity)", () => {
  it("carries the 9 reference severity rows", () => {
    expect(ISO_DATA_ROWS).toHaveLength(9);
    expect(ISO_DATA_ROWS[0]).toMatchObject({ label: "DAMAGE OCCURS", rms: "11.0", peak: "0.61" });
    expect(ISO_DATA_ROWS[3]).toMatchObject({
      label: "UNRESTRICTED OPERATION",
      rms: "3.5",
      peak: "0.19",
    });
    expect(ISO_DATA_ROWS[8]).toMatchObject({
      label: "NEWLY COMMISSIONED MACHINERY",
      rms: "0.0",
      peak: "0.00",
    });
  });

  it("uses the legacy ISO palette", () => {
    expect(ISO_ZONE_FILL).toEqual({
      red: "FF0000",
      amber: "FFC000",
      yellow: "FFFF00",
      green: "00B050",
    });
  });

  it("builds 13 grid-consistent rows (3 header + 9 data + footer)", () => {
    const { rows } = buildIsoTableData();
    expect(rows).toHaveLength(13);
    for (const r of rows) expect(spanSum(r)).toBe(6);
    expect(rows[0].map((c) => c.text)).toEqual([
      "Machinery Groups 1 and 3",
      "Machinery Groups 2 and 4",
      "ISO 10816 - 3",
    ]);
    // worst row: all-red DAMAGE swatches
    expect(rows[3][0]).toMatchObject({ text: "", fill: "FF0000" });
    expect(rows[3][1]).toMatchObject({ text: "DAMAGE OCCURS", fill: "FF0000" });
    expect(rows[3][3]).toMatchObject({ text: "11.0" });
    expect(rows[3][4]).toMatchObject({ text: "0.61" });
    // footer
    expect(rows[12].map((c) => c.text)).toEqual(ISO_FOOTER);
  });
});
