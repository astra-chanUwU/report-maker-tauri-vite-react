import { describe, expect, it } from "vitest";
import {
  buildDocx,
  buildMeasuringTableData,
  encodePng,
  listZipFilenames,
  renderChartPng,
} from "../generateDocx";
import { parseSp3 } from "../parseSp3";
import { DEFAULT_ZONE_LIMITS } from "../zones";

describe("png encoder", () => {
  it("emits valid PNG signature and single IDAT", () => {
    const rgb = new Uint8Array(4 * 2 * 3).fill(128);
    const png = encodePng(rgb, 4, 2);
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80);
    const text = new TextDecoder("latin1").decode(png);
    const idatCount = (text.match(/IDAT/g) ?? []).length;
    expect(idatCount).toBe(1);
  });

  it("renders chart png", () => {
    const r = parseSp3(new Uint8Array(0), "empty.sp3");
    const png = renderChartPng(r.spectra);
    expect(png.length).toBeGreaterThan(1000);
    expect(png[0]).toBe(137);
  });
});

describe("buildDocx", () => {
  it("produces a valid .docx zip with required parts", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n"), "a.sp3");
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: {
        projectName: "P",
        engineer: "E",
        reportDate: "2026-09-29",
        units: "SI",
        norm: "Default",
        notes: "n",
        pointLimit: 80,
      },
      aiDraft: {
        summary: "s",
        methodology: "m",
        observations: "o",
        recommendations: "r",
        conclusion: "c",
      },
    });
    expect(blob.size).toBeGreaterThan(2000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    const names = listZipFilenames(buf);
    expect(names).toContain("[Content_Types].xml");
    expect(names.some((n) => n.includes("document.xml"))).toBe(true);
  }, 30000);

  it("builds the measuring table with legacy zone shading", () => {
    const { header, body } = buildMeasuringTableData(
      [
        { point: "7 / 1", date: "2025-06-03", rms: "1.2", peak: "0.5", peakFreq: "25" },
        { point: "9 / 2", date: "2025-06-04", rms: "7.5", peak: "3.1", peakFreq: "30" },
        { point: "? / ?", date: "—", rms: "", peak: "", peakFreq: "" },
      ],
      DEFAULT_ZONE_LIMITS
    );
    expect(header[3]).toBe("V Zone (3.5/7/8.6)");
    expect(body[0][3]).toMatchObject({ text: "A", fill: "2E7D32", color: "FFFFFF" });
    expect(body[1][3]).toMatchObject({ text: "U", fill: "F57C00", color: "FFFFFF" });
    expect(body[2][3]).toMatchObject({ text: "—", fill: "E0E0E0", color: "333333" });
  });

  it("embeds zones + measuring rows into the .docx", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n"), "a.sp3");
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: {
        projectName: "P",
        engineer: "E",
        reportDate: "2026-09-29",
        units: "SI",
        norm: "Default",
        notes: "n",
        pointLimit: 80,
      },
      zones: {
        limits: DEFAULT_ZONE_LIMITS,
        rows: [{ point: "7", date: "2025-06-03", rms: "1.2", peak: "0.5", peakFreq: "25" }],
      },
    });
    expect(blob.size).toBeGreaterThan(2000);
  }, 30000);
});
