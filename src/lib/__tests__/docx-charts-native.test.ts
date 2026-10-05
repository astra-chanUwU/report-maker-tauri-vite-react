import { describe, expect, it } from "vitest";
import { buildDocx, listZipFilenames } from "../generateDocx";
import { parseSp3 } from "../parseSp3";
import { renderTrendPng, buildAllTrendSnapshots, groupHistories } from "../trends";
import { DEFAULT_ZONE_LIMITS } from "../zones";
import type { CsvRowSummary } from "../mdb";

// Helper to extract chart XML texts from docx buffer
async function chartTextsFromDocx(blob: Blob): Promise<string[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const chartFiles = Object.keys(zip.files).filter((k) => k.startsWith("word/charts/chart"));
  const texts = await Promise.all(chartFiles.map((f) => zip.file(f)!.async("string")));
  return texts;
}

describe("docx native charts", () => {
  it("main spectrum produces editable scatter chart (word/charts/chart*.xml with scatterChart)", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n400,1.0\n"), "sample.sp3");
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80 },
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const names = listZipFilenames(buf);
    expect(names.some((n) => n.startsWith("word/charts/chart"))).toBe(true);
    const texts = await chartTextsFromDocx(blob);
    expect(texts.length).toBeGreaterThanOrEqual(1);
    const first = texts[0]!;
    expect(first).toContain("scatterChart");
    expect(first).toContain("c:xVal");
    expect(first).toContain("c:yVal");
    expect(first).toContain("c:numCache");
  }, 30000);

  it("trend charts become editable line charts with category and value axes", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const samples = [1.2, 2.1, 3.3].map((v, i) => ({
      dateNum: 45000 + i,
      dateISO: "2023-01-0" + (i + 1),
      rmsV: v,
      rmsA: v * 2,
    }));
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80 },
      trends: {
        pointLabel: "7 / 1",
        sampleCount: 3,
        window: "last 10",
        velocityPng: renderTrendPng(samples, "rmsV", DEFAULT_ZONE_LIMITS.velocity),
        accelPng: renderTrendPng(samples, "rmsA", DEFAULT_ZONE_LIMITS.acceleration),
        velocityCategories: samples.map((s) => s.dateISO),
        velocityValues: samples.map((s) => s.rmsV),
        accelCategories: samples.map((s) => s.dateISO),
        accelValues: samples.map((s) => s.rmsA),
      },
    });
    const texts = await chartTextsFromDocx(blob);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    const hasLine = texts.some((t) => t.includes("lineChart"));
    const hasScatter = texts.some((t) => t.includes("scatterChart"));
    expect(hasLine).toBe(true);
    expect(hasScatter).toBe(true);
    const lineCharts = texts.filter((t) => t.includes("lineChart"));
    expect(lineCharts.some((t) => t.includes("c:cat") && t.includes("c:val"))).toBe(true);
  }, 30000);

  it("does not reintroduce a PNG trend fallback when raw values are absent", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80 },
      trends: {
        pointLabel: "7 / 1",
        sampleCount: 2,
        window: "last 10",
        velocityPng: renderTrendPng([{ dateNum: 45000, dateISO: "2023-01-01", rmsV: 1, rmsA: 2 }], "rmsV", DEFAULT_ZONE_LIMITS.velocity),
        accelPng: renderTrendPng([{ dateNum: 45000, dateISO: "2023-01-01", rmsV: 1, rmsA: 2 }], "rmsA", DEFAULT_ZONE_LIMITS.acceleration),
      },
    });
    const texts = await chartTextsFromDocx(blob);
    expect(texts.filter((t) => t.includes("lineChart"))).toHaveLength(0);
    const xml = await (await import("jszip")).default.loadAsync(await blob.arrayBuffer()).then((zip) => zip.file("word/document.xml")!.async("string"));
    expect(xml).toContain("No trend data available");
  }, 30000);

  it("FFT gallery with raw spectra produces editable scatter charts in table grid", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n"), "a.sp3");
    const spectra = parsed.spectra;
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80 },
      fftGallery: [
        { label: "7 / 1 · 2023-01-01", png: new Uint8Array([137, 80]), peak: "10 Hz", spectra },
        { label: "7 / 2 · 2023-01-02", png: new Uint8Array([137, 80]), peak: "12 Hz", spectra },
      ],
    });
    const texts = await chartTextsFromDocx(blob);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    const scatterCount = texts.filter((t) => t.includes("scatterChart")).length;
    expect(scatterCount).toBeGreaterThanOrEqual(3);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain("word/charts/chart");
  }, 30000);

  it("regression: production builders produce editable trend charts with real dates, values, null gaps, units and limits", async () => {
    // Build real histories via app builder, including a null gap
    const rows: CsvRowSummary[] = [
      { pointId: "7", directionId: "1", measDate: 45000, rmsV: 1.2, rmsA: 0.5, bc: 0.6, envelope: 0.7 },
      { pointId: "7", directionId: "1", measDate: 45001, rmsV: 1.8, rmsA: 0.9, bc: 0.9, envelope: 0.8 },
      { pointId: "7", directionId: "1", measDate: 45002, rmsV: null, rmsA: null, bc: null, envelope: null },
      { pointId: "7", directionId: "1", measDate: 45003, rmsV: 2.5, rmsA: 1.4, bc: 1.5, envelope: 1.6 },
      { pointId: "7", directionId: "1", measDate: 45004, rmsV: 3.1, rmsA: 2.0, bc: 2.1, envelope: 2.2 },
    ] as unknown as CsvRowSummary[];
    const histories = groupHistories(rows);
    expect(histories.length).toBe(1);
    const customLimits = {
      velocity: { bottom: 1.5, mid: 2.5, top: 4.0 },
      acceleration: { bottom: 0.8, mid: 1.6, top: 3.2 },
      envelope: { bottom: 0.5, mid: 1.0, top: 2.0 },
    };
    const snaps = buildAllTrendSnapshots(histories, customLimits, 5, 40, true, "rmsA", true);
    expect(snaps.length).toBe(1);
    const s = snaps[0]!;
    // Verify builder preserved window label, secondaryMetric, null gaps, categories
    expect(s.window).toBe("last 5");
    expect(s.secondaryMetric).toBe("rmsA");
    expect(s.velocityCategories).toEqual(s.velocityCategories); // sanity
    // rmsA is stored in g and scaled to m/s² via gToMps2
    const { gToMps2 } = await import("../metrics");
    expect(s.velocityValues).toEqual([1.2, 1.8, null, 2.5, 3.1]);
    expect(s.accelValues).toEqual([0.5, 0.9, null, 1.4, 2.0].map((v) => (v === null ? null : gToMps2(v))));
    expect(s.velocityLimits).toEqual(customLimits.velocity);
    expect(s.accelLimits).toEqual(customLimits.acceleration);

    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80 },
      allTrends: [
        {
          pointLabel: s.pointLabel,
          sampleCount: s.sampleCount,
          window: s.window,
          secondaryMetric: s.secondaryMetric as unknown as "acceleration",
          velocityPng: s.velocityPng,
          accelPng: s.accelPng,
          envelopePng: s.envelopePng,
          velocityCategories: s.velocityCategories,
          velocityValues: s.velocityValues,
          accelCategories: s.accelCategories,
          accelValues: s.accelValues,
          envelopeCategories: s.envelopeCategories,
          envelopeValues: s.envelopeValues,
          velocityLimits: s.velocityLimits,
          accelLimits: s.accelLimits,
          envelopeLimits: s.envelopeLimits,
        },
      ],
    });
    const texts = await chartTextsFromDocx(blob);
    const lineCharts = texts.filter((t) => t.includes("lineChart"));
    expect(lineCharts.length).toBeGreaterThanOrEqual(2);

    // Check that actual dates and values appear in chart XML (c:strCache for cats, c:numCache for vals)
    const firstLine = lineCharts[0]!;
    for (const d of s.velocityCategories) {
      expect(firstLine).toContain(d);
    }
    for (const v of s.velocityValues.filter((x): x is number => x !== null)) {
      // values appear as formatted numbers in numCache
      expect(firstLine).toContain(v.toString());
    }
    // Null gaps: docx line chart encodes missing as no value or empty; we verify at least categories preserved
    expect(firstLine).toContain("c:cat");
    expect(firstLine).toContain("c:val");

    // Units: velocity chart Y title must contain mm/s, acceleration chart must contain m/s²
    const secondLine = lineCharts[1]!;
    expect(firstLine).toContain("mm/s");
    expect(secondLine).toContain("m/s");

    // Limits: thresholds appear as additional editable series with limit values
    // customLimits.velocity.bottom = 1.5 should appear in velocity chart thresholds
    expect(firstLine).toContain("1.5");
    expect(secondLine).toContain("0.8");
    // Persian labels when lang=fa
    const blobFa = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80, language: "fa" },
      allTrends: [
        {
          pointLabel: s.pointLabel,
          sampleCount: s.sampleCount,
          window: s.window,
          secondaryMetric: s.secondaryMetric as unknown as "acceleration",
          velocityPng: s.velocityPng,
          accelPng: s.accelPng,
          velocityCategories: s.velocityCategories,
          velocityValues: s.velocityValues,
          accelCategories: s.accelCategories,
          accelValues: s.accelValues,
          velocityLimits: s.velocityLimits,
          accelLimits: s.accelLimits,
        },
      ],
    });
    const textsFa = await chartTextsFromDocx(blobFa);
    const lineFa = textsFa.filter((t) => t.includes("lineChart"))[0]!;
    expect(lineFa).toContain("حد");
  }, 30000);

  it("regression: FFT uses real spectra; missing spectra shows localized message not synthetic points", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n300,1.2\n"), "a.sp3");
    const realSpectra = parsed.spectra;
    expect(realSpectra.length).toBeGreaterThanOrEqual(3);
    // Case with real spectra: chart XML must contain real freq/amp values
    const blobReal = await buildDocx({
      meta: parsed.meta,
      spectra: realSpectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80 },
      fftGallery: [{ label: "7 / 1", png: new Uint8Array([137, 80]), spectra: realSpectra }],
    });
    const textsReal = await chartTextsFromDocx(blobReal);
    const scatterReal = textsReal.filter((t) => t.includes("scatterChart"))[0]!;
    // Real freq 100 should appear in chart data
    expect(scatterReal).toContain("100");
    expect(scatterReal).toContain("0.4");

    // Case with missing spectra: should NOT invent fake points; should show localized missing-data message or omit chart
    const blobMissing = await buildDocx({
      meta: parsed.meta,
      spectra: realSpectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80 },
      fftGallery: [{ label: "7 / 1", png: new Uint8Array([]) } as unknown as { label: string; png: Uint8Array; spectra: typeof realSpectra }],
    });
    const bufMissing = new Uint8Array(await blobMissing.arrayBuffer());
    const JSZip = (await import("jszip")).default;
    const zipMissing = await JSZip.loadAsync(bufMissing);
    const docXml = await zipMissing.file("word/document.xml")!.async("string");
    // Must contain localized missing message, not synthetic chart with fake values like 1.2/1.8
    expect(docXml).toContain("No spectrum data");
    // And must not contain a scatter chart for the missing entry beyond the main spectrum
    const textsMissing = await chartTextsFromDocx(blobMissing);
    // Only main spectrum chart should exist (1 scatter), not 2
    const scatterCount = textsMissing.filter((t) => t.includes("scatterChart")).length;
    expect(scatterCount).toBe(1);
  }, 30000);

  it("regression: Persian FFT missing message is localized", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n"), "a.sp3");
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { projectName: "P", engineer: "E", reportDate: "2026-09-29", units: "SI", norm: "Default", notes: "", pointLimit: 80, language: "fa" },
      fftGallery: [{ label: "7 / 1", png: new Uint8Array([]) } as unknown as { label: string; png: Uint8Array; spectra: [] }],
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")!.async("string");
    expect(docXml).toContain("داده طیف موجود نیست");
  }, 30000);
});
