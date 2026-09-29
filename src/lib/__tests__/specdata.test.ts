import { describe, expect, it } from "vitest";
import { parseSp3 } from "../parseSp3";
import {
  decodeOctalBlob,
  detectJetMdb,
  freqOf,
  oleDateToISO,
  parseSpecCsvFirstRow,
  parseSpecRowCells,
  rowToOverall,
  rowToSpectrum,
  sniffSpecCsv,
  splitCsvLine,
} from "../specdata";
import fixture from "./fixtures/spec-row1.json";

const head = (fixture as { specHead: string }).specHead;
const scalars = (fixture as { scalars: Record<string, string> }).scalars;

function encodeOctal(values: number[]): string {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  const bytes = new Uint8Array(buf);
  return '"' + [...bytes].map((b) => "\\" + b.toString(8).padStart(3, "0")).join("") + '"';
}

/** mdb-export writes UTF-16LE + BOM — encode a CSV that way. */
function encodeUtf16LeCsv(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[2 + i * 2 + 1] = (text.charCodeAt(i) >> 8) & 0xff;
  }
  return out;
}

describe("decodeOctalBlob (real fixture head)", () => {
  it("decodes the real Specdata head: 3 zeros then rising amplitudes", () => {
    const bytes = decodeOctalBlob(head);
    expect(bytes.length).toBe(100);
    const view = new DataView(bytes.buffer);
    expect(view.getFloat32(0, true)).toBe(0);
    expect(view.getFloat32(4, true)).toBe(0);
    expect(view.getFloat32(8, true)).toBe(0);
    expect(view.getFloat32(12, true)).toBeCloseTo(0.01174344, 5);
    expect(view.getFloat32(16, true)).toBeCloseTo(0.009381902, 5);
  });
});

describe("spec csv plumbing", () => {
  it("splits quoted csv lines", () => {
    expect(splitCsvLine('1,"mm/s",0.5')).toEqual(["1", "mm/s", "0.5"]);
  });

  it("parses a first row end to end", () => {
    const header = ["DataID", "PointID", "NoLines", "BandWidth", "Unit", "Specdata"];
    const csv = `DataID,PointID,NoLines,BandWidth,Unit,Specdata\n1,7,4,0.5,"mm/s",${encodeOctal([0.1, 0.5, 0.2, 0.05])}\n`;
    const preview = parseSpecCsvFirstRow(new TextEncoder().encode(csv));
    expect(preview).not.toBeNull();
    expect(preview!.rowCount).toBe(1);
    expect(preview!.row.noLines).toBe(4);
    const amps = [...preview!.row.amplitudes];
    expect(amps[0]).toBeCloseTo(0.1, 5);
    expect(amps[1]).toBeCloseTo(0.5, 5);
    expect(amps[2]).toBeCloseTo(0.2, 5);
    expect(amps[3]).toBeCloseTo(0.05, 5);
    const spectrum = rowToSpectrum(preview!.row);
    expect(spectrum[1].freq).toBe(1.0);
    expect(spectrum[1].amp).toBeCloseTo(0.5, 5);
    expect(header.length).toBeGreaterThan(0);
  });

  it("rejects rows without Specdata", () => {
    expect(parseSpecRowCells(["a", "b"], ["1", "2"])).toBeNull();
  });

  it("parses UTF-16LE exports (mdb-export default)", () => {
    const csv = `DataID,PointID,NoLines,BandWidth,Unit,Specdata\n1,7,4,0.5,"mm/s",${encodeOctal([0.1, 0.5, 0.2, 0.05])}\n2,7,4,0.5,"mm/s",${encodeOctal([0.2, 0.4, 0.1, 0.05])}\n`;
    const bytes = encodeUtf16LeCsv(csv);
    expect(sniffSpecCsv(bytes)).toBe(true);
    const preview = parseSpecCsvFirstRow(bytes);
    expect(preview).not.toBeNull();
    expect(preview!.rowCount).toBe(2);
    expect(preview!.row.noLines).toBe(4);
    expect(preview!.row.amplitudes[1]).toBeCloseTo(0.5, 5);
  });
});

describe("real-world rules", () => {
  it("freq axis is (i+1)*BandWidth — peak bin matches FreqPeakMaxV", () => {
    // Real row1: argmax=49 (0-based), BW=0.5 → (49+1)*0.5 = 25 = FreqPeakMaxV
    expect(freqOf(49, 0.5)).toBe(25);
    expect(scalars["FreqPeakMaxV"]).toBe("25");
    expect(scalars["BandWidth"]).toBe("0.5");
  });

  it("converts OLE dates", () => {
    expect(oleDateToISO(Number(scalars["MeasDate"]))).toBe("2025-06-03");
  });

  it("extracts overall values", () => {
    const header = [
      "PointID",
      "DirectionID",
      "NoLines",
      "BandWidth",
      "Unit",
      "MeasDate",
      "ValuePeakMaxV",
      "FreqPeakMaxV",
      "TotalRMSV",
      "XV_FreqRange",
      "Specdata",
    ];
    const row = parseSpecRowCells(header, [
      "1",
      "2",
      "4",
      "0.5",
      '"mm/s"',
      "45811.43922453703",
      "0.5",
      "1.0",
      "0.83",
      "1600",
      encodeOctal([0.1, 0.5, 0.2, 0.05]),
    ]);
    expect(row).not.toBeNull();
    const overall = rowToOverall(row!);
    expect(overall.unit).toBe("mm/s");
    expect(overall.measDate).toBe("2025-06-03");
    expect(overall.peakV).toBe(0.5);
    expect(overall.rmsV).toBe(0.83);
  });
});

describe("format detection", () => {
  it("detects Jet MDB magic", () => {
    const magic = new Uint8Array(32);
    magic.set([0x00, 0x01, 0x00, 0x00]);
    magic.set(new TextEncoder().encode("Standard Jet DB"), 4);
    expect(detectJetMdb(magic)).toBe(true);
    expect(detectJetMdb(new TextEncoder().encode("100,0.4\n"))).toBe(false);
  });

  it("sniffs spec csv", () => {
    const csv = new TextEncoder().encode("DataID,NoLines,BandWidth,Specdata\n");
    expect(sniffSpecCsv(csv)).toBe(true);
    expect(sniffSpecCsv(new TextEncoder().encode("100,0.4\n200,0.9\n"))).toBe(false);
  });
});

describe("parseSp3 integration", () => {
  it("parses a spec csv export with overall meta", () => {
    const csv = `DataID,PointID,NoLines,BandWidth,Unit,MeasDate,ValuePeakMaxV,FreqPeakMaxV,TotalRMSV,Specdata\n1,7,4,0.5,"mm/s",45811.43922453703,0.5,1.0,0.83,${encodeOctal([0.1, 0.5, 0.2, 0.05])}\n`;
    const r = parseSp3(new TextEncoder().encode(csv), "data.csv");
    expect(r.meta.source).toBe("spec-csv");
    expect(r.spectra).toHaveLength(4);
    expect(r.stats.peak.freq).toBe(1.0);
    expect(r.stats.peak.amp).toBeCloseTo(0.5, 5);
    expect(r.meta.overall?.unit).toBe("mm/s");
    expect(r.meta.overall?.pointId).toBe("7");
  });

  it("explains Jet MDB files instead of silent fallback", () => {
    const magic = new Uint8Array(64);
    magic.set([0x00, 0x01, 0x00, 0x00]);
    magic.set(new TextEncoder().encode("Standard Jet DB"), 4);
    const r = parseSp3(magic, "Blower Ard.sp3");
    expect(r.meta.source).toBe("mdb");
    expect(r.warning).toMatch(/mdb-export/i);
  });
});
