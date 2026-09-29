import { describe, expect, it } from "vitest";
import { buildDocx, encodePng, listZipFilenames, renderChartPng } from "../generateDocx";
import { parseSp3 } from "../parseSp3";

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
});
