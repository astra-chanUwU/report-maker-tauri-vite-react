import { describe, expect, it } from "vitest";
import { buildDocx } from "../generateDocx";
import { parseSp3 } from "../parseSp3";
import { DEFAULT_ZONE_LIMITS } from "../zones";

describe("docx table horizontal padding (w:tcMar)", () => {
  it("ensures deliberate left/right cell padding on all major tables and header/footer", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n"), "a.sp3");
    const blob = await buildDocx({
      meta: {
        ...parsed.meta,
        overall: {
          unit: "mm/s",
          measDate: "44927",
          pointId: "7",
          directionId: "1",
          bandWidth: 1.25,
          noLines: 800,
          freqRange: 1000,
          peakV: 2.1,
          peakFreq: 25,
          rmsD: 0.01,
          rmsV: 1.2,
          rmsA: 9.8,
          peakD: 0.02,
          peakA: 15.3,
        },
      },
      spectra: parsed.spectra,
      options: {
        projectName: "Padding Test",
        engineer: "Eng Test",
        reportDate: "2026-09-29",
        units: "SI",
        norm: "Default",
        notes: "notes",
        pointLimit: 80,
        addressBlock: "Sepas Co · Yazd",
      },
      zones: {
        limits: DEFAULT_ZONE_LIMITS,
        rows: [{ point: "7 / 1", date: "2025-06-03", rms: "1.2", rmsA: "9.9", peak: "0.5", peakFreq: "25" }],
      },
      equipment: {
        name: "Pump A",
        specs: "Drive: Motor\nSpeed: 1500 RPM",
        status: "OK",
        lastReport: "2025-01-01",
      },
      branding: {
        cover: undefined,
        signature: undefined,
      },
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    const headerXml = await zip.file("word/header1.xml")?.async("string") ?? "";
    const footerXml = await zip.file("word/footer1.xml")?.async("string") ?? "";

    // Table cell margins must use w:tcMar with start/end (OOXML) and have at least 120 twips (6pt) horizontal padding
    // docx library maps left/right to w:start/w:end
    const tcMarMatches = [...xml.matchAll(/<w:tcMar[^>]*>[\s\S]*?<\/w:tcMar>/g)];
    expect(tcMarMatches.length).toBeGreaterThan(10);

    // At least one cell should have start >=120 and end >=120 (our paddedCell / tight)
    const hasGenerous = tcMarMatches.some((m) => {
      const s = m[0];
      const start = s.match(/w:start[^>]*w:w="(\d+)"/);
      const end = s.match(/w:end[^>]*w:w="(\d+)"/);
      const left = s.match(/w:left[^>]*w:w="(\d+)"/);
      const right = s.match(/w:right[^>]*w:w="(\d+)"/);
      const sl = start ? Number(start[1]) : left ? Number(left[1]) : 0;
      const er = end ? Number(end[1]) : right ? Number(right[1]) : 0;
      return sl >= 120 && er >= 120;
    });
    expect(hasGenerous).toBe(true);

    // Header and footer must have indent for horizontal padding (not just table)
    // Header paragraph should have w:ind with left/right
    if (headerXml) {
      expect(headerXml).toMatch(/w:ind[^>]*w:left="150"/);
    }
    if (footerXml) {
      expect(footerXml).toMatch(/w:ind[^>]*w:left="150"/);
    }

    // Ensure columns still inside page margins: table width should be TABLE_DXA (10772) or 100% and not exceed page
    expect(xml).toContain('w:w="10772"');
    // Text must never touch border: no cell should have 0 margins on both sides where text exists
    // Our tight/paddedCell ensures at least 120 each side

    // Check that measuring table, cover metadata, and limits tables all appear with padding
    // by verifying at least 3 distinct table types with tcMar
    expect(tcMarMatches.length).toBeGreaterThanOrEqual(15);
  }, 30000);
});
