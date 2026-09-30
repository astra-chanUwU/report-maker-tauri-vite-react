import { describe, expect, it } from "vitest";
import {
  buildDocx,
  buildMeasuringTableData,
  detectImageKind,
  encodePng,
  listZipFilenames,
  renderChartPng,
} from "../generateDocx";
import { parseSp3 } from "../parseSp3";
import { renderTrendPng } from "../trends";
import { DEFAULT_ZONE_LIMITS } from "../zones";

const OPTS = {
  projectName: "P",
  engineer: "E",
  reportDate: "2026-09-29",
  units: "SI",
  norm: "Default",
  notes: "n",
  pointLimit: 80,
};

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
        {
          point: "7 / 1",
          date: "2025-06-03",
          rms: "1.2",
          rmsA: "10.5",
          peak: "0.5",
          peakFreq: "25",
        },
        {
          point: "9 / 2",
          date: "2025-06-04",
          rms: "7.5",
          rmsA: "40.1",
          peak: "3.1",
          peakFreq: "30",
        },
        { point: "? / ?", date: "—", rms: "", rmsA: "", peak: "", peakFreq: "" },
      ],
      DEFAULT_ZONE_LIMITS
    );
    expect(header[3]).toBe("V Zone (3.5/7/8.6)");
    expect(header[5]).toBe("A Zone (14.71/29.4/36.2)");
    expect(body[0][3]).toMatchObject({ text: "A", fill: "2E7D32", color: "FFFFFF" });
    expect(body[0][5]).toMatchObject({ text: "A", fill: "2E7D32", color: "FFFFFF" });
    expect(body[1][3]).toMatchObject({ text: "U", fill: "F57C00", color: "FFFFFF" });
    expect(body[1][5]).toMatchObject({ text: "C", fill: "D32F2F", color: "FFFFFF" });
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
        rows: [
          { point: "7", date: "2025-06-03", rms: "1.2", rmsA: "9.9", peak: "0.5", peakFreq: "25" },
        ],
      },
    });
    expect(blob.size).toBeGreaterThan(2000);
  }, 30000);

  it("embeds trend charts into the .docx", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n"), "a.sp3");
    const samples = [1.2, 2.1, 3.3].map((v, i) => ({
      dateNum: 45000 + i,
      dateISO: "2023-01-01",
      rmsV: v,
      rmsA: v * 2,
    }));
    const withTrends = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: OPTS,
      trends: {
        pointLabel: "7 / 1",
        sampleCount: 3,
        window: "last 10",
        velocityPng: renderTrendPng(samples, "rmsV", DEFAULT_ZONE_LIMITS.velocity),
        accelPng: renderTrendPng(samples, "rmsA", DEFAULT_ZONE_LIMITS.acceleration),
      },
    });
    const without = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: OPTS,
    });
    expect(withTrends.size).toBeGreaterThan(without.size);
  }, 30000);

  it("detects branding image kinds from magic bytes", () => {
    expect(detectImageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]))).toBe("png");
    expect(detectImageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).toBe("jpg");
    expect(detectImageKind(new Uint8Array([1, 2, 3]))).toBe("png");
  });

  it("builds with cover + signature + ISO, and without ISO when disabled", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n"), "a.sp3");
    const png = renderChartPng(parsed.spectra);
    const full = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: OPTS,
      branding: {
        cover: { data: png, kind: "png" },
        signature: { data: png, kind: "png" },
      },
    });
    const bare = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { ...OPTS, includeIsoTable: false },
    });
    expect(full.size).toBeGreaterThan(bare.size);
    expect(bare.size).toBeGreaterThan(2000);
  }, 30000);
});
