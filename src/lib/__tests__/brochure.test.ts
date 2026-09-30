import { describe, expect, it } from "vitest";
import { buildTocData, makeClient, makeEquipment } from "../equipment";
import { gregorianToJalali, isoToJalali, isoToJalaliFa, toFaDigits } from "../fa";
import { buildTocRows, buildDocx, buildSignatureBlock, equipmentBookmarkId } from "../generateDocx";
import { parseSp3 } from "../parseSp3";
import { buildAllTrendSnapshots, groupHistories } from "../trends";
import { DEFAULT_ZONE_LIMITS } from "../zones";

describe("jalali", () => {
  it("converts known date 2026-09-30 → 1405/07/08", () => {
    expect(isoToJalali("2026-09-30")).toBe("1405/07/08");
    const [jy] = gregorianToJalali(2026, 9, 30);
    expect(jy).toBe(1405);
  });
  it("fa digits", () => {
    expect(toFaDigits("1405/07/08")).toContain("۰");
    expect(isoToJalaliFa("2026-09-30")).toContain("۰");
  });
});

describe("equipments + toc", () => {
  it("builds toc rows with fallback names", () => {
    const list = [makeEquipment({ name: "Pump A", status: "Alert" }), makeEquipment({})];
    const toc = buildTocData(list);
    expect(toc).toHaveLength(2);
    expect(toc[0]).toMatchObject({ index: 1, name: "Pump A", status: "Alert" });
    expect(toc[1].name).toContain("Equipment");
    expect(buildTocRows(list)).toHaveLength(2);
    expect(equipmentBookmarkId(1)).toBe("eq1");
    expect(makeClient({ clientName: "X" }).clientName).toBe("X");
  });

  it("multi-equipment docx is bigger than single", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const base = {
      projectName: "P",
      engineer: "E",
      reportDate: "2026-09-30",
      units: "SI",
      norm: "Default",
      notes: "",
    };
    const single = await buildDocx({ meta: parsed.meta, spectra: parsed.spectra, options: base });
    const multi = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { ...base, includeToc: true },
      equipments: [
        { name: "Pump A", specs: "15kW", status: "Alert", lastReport: "prev ok", problems: "unbalance", corrective: "balance" },
        { name: "Fan B", specs: "30kW", status: "Healthy" },
      ],
    });
    expect(multi.size).toBeGreaterThan(single.size);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await multi.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("PAGEREF");
    expect(xml).toContain("eq1");
    expect(xml).toContain("eq2");
  }, 30000);

  it("letterhead + fa + galleries grow docx", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const base = {
      projectName: "P",
      engineer: "E",
      reportDate: "2026-09-30",
      units: "SI",
      norm: "Default",
      notes: "",
    };
    const bare = await buildDocx({ meta: parsed.meta, spectra: parsed.spectra, options: base });
    const { renderTrendPng } = await import("../trends");
    const { renderChartPng } = await import("../generateDocx");
    const samples = [1, 2, 3].map((v, i) => ({ dateNum: 45000 + i, dateISO: "2023-01-01", rmsV: v, rmsA: v * 2 }));
    const full = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { ...base, language: "fa" as const, jalaliDate: isoToJalaliFa("2026-09-30"), letterNo: "405", clientName: "C", clientUnit: "U", addressBlock: "addr" },
      allTrends: [
        { pointLabel: "7 / 1", sampleCount: 3, velocityPng: renderTrendPng(samples, "rmsV", DEFAULT_ZONE_LIMITS.velocity), accelPng: renderTrendPng(samples, "rmsA", DEFAULT_ZONE_LIMITS.acceleration) },
      ],
      fftGallery: [{ label: "7 / 1", png: renderChartPng(parsed.spectra), peak: "1 @ 2" }],
    });
    expect(full.size).toBeGreaterThan(bare.size);
  }, 30000);
});

describe("all trends", () => {  it("builds one snapshot per point", () => {
    const rows = [
      { index: 0, pointId: "7", directionId: "1", measDate: "45000", peakV: "", peakFreq: "", rmsV: "1.2", rmsA: "10", peakA: "", unit: "", noLines: "" },
      { index: 1, pointId: "7", directionId: "1", measDate: "45001", peakV: "", peakFreq: "", rmsV: "2.2", rmsA: "12", peakA: "", unit: "", noLines: "" },
      { index: 2, pointId: "9", directionId: "2", measDate: "45000", peakV: "", peakFreq: "", rmsV: "3.2", rmsA: "14", peakA: "", unit: "", noLines: "" },
    ];
    const histories = groupHistories(rows);
    expect(histories).toHaveLength(2);
    const snaps = buildAllTrendSnapshots(histories, DEFAULT_ZONE_LIMITS, 10);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].velocityPng[0]).toBe(137);
  });
});

describe("signature layouts", () => {
  const sig = { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), kind: "png" as const };
  const base = {
    projectName: "P",
    engineer: "A. Chan",
    reportDate: "2026-09-30",
    units: "SI",
    norm: "Default",
    notes: "",
  };
  it("en layout: Approval + Engineer/Date, fa layout: با سپاس + name/role", async () => {
    const en = buildSignatureBlock({ ...base, signatureLayout: "en" }, sig);
    const fa = buildSignatureBlock(
      { ...base, signatureLayout: "fa", signatureName: "محسن مردانه", signatureRole: "سرپرست کارگاه" },
      sig
    );
    expect(en.length).toBeGreaterThan(0);
    expect(fa.length).toBe(4);
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const enDoc = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { ...base, signatureLayout: "en" },
      branding: { signature: sig },
    });
    const faDoc = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { ...base, signatureLayout: "fa", signatureName: "محسن مردانه" },
      branding: { signature: sig },
    });
    expect(enDoc.size).toBeGreaterThan(2000);
    expect(faDoc.size).toBeGreaterThan(2000);
  });
  it("empty signature → no block", () => {
    expect(buildSignatureBlock({ ...base }, undefined)).toHaveLength(0);
    expect(buildSignatureBlock({ ...base }, { data: new Uint8Array(0) })).toHaveLength(0);
  });
});
