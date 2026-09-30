import { describe, expect, it } from "vitest";
import { buildTocData, makeClient, makeEquipment } from "../equipment";
import { gregorianToJalali, isoToJalali, isoToJalaliFa, toFaDigits } from "../fa";
import {
  buildTocRows,
  buildDocx,
  buildSignatureBlock,
  equipmentBookmarkId,
  sectionBookmarkId,
  tocPartsFor,
  renderChartPng,
} from "../generateDocx";
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
    expect(sectionBookmarkId(1, "fft")).toBe("eq1fft");
    expect(tocPartsFor({ status: "Alert", specs: "15kW" })).toEqual(["status", "specs"]);
    expect(tocPartsFor({})).toEqual([]);
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
        {
          name: "Pump A",
          specs: "15kW",
          status: "Alert",
          lastReport: "prev ok",
          problems: "unbalance",
          corrective: "balance",
        },
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
    expect(xml).toContain("eq1status");
    expect(xml).toContain("eq1specs");
    expect(xml).toContain("eq2status");
    expect(xml).toContain("eq2specs");
  }, 30000);

  it("puts each machine FFT gallery inside that equipment section", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const png = renderChartPng(parsed.spectra);
    const base = {
      projectName: "P",
      engineer: "E",
      reportDate: "2026-09-30",
      units: "SI",
      norm: "Default",
      notes: "",
    };
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { ...base, includeToc: false },
      equipments: [
        {
          name: "Pump A",
          vib: {
            limits: DEFAULT_ZONE_LIMITS,
            rows: [],
            fft: [{ label: "P1 V only-on-a", png, peak: "1 @ 100" }],
          },
        },
        {
          name: "Fan B",
          vib: {
            limits: DEFAULT_ZONE_LIMITS,
            rows: [],
            fft: [{ label: "P2 H only-on-b", png, peak: "2 @ 200" }],
          },
        },
      ],
    });
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    const a = xml.indexOf("only-on-a");
    const b = xml.indexOf("only-on-b");
    const fan = xml.indexOf("Fan B");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(fan);
    expect(a).toBeLessThan(fan);
  }, 30000);

  it("prints one machine's narrative in that section and keeps the shared essay once", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const png = renderChartPng(parsed.spectra);
    const base = {
      projectName: "P",
      engineer: "E",
      reportDate: "2026-09-30",
      units: "SI",
      norm: "Default",
      notes: "",
      includeToc: false,
    };
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: base,
      aiDraft: {
        summary: "SHARED-SUMMARY",
        methodology: "SHARED-METHOD",
        observations: "SHARED-OBS",
        recommendations: "SHARED-REC",
        conclusion: "SHARED-END",
      },
      branding: { signature: { data: png, kind: "png" } },
      equipments: [
        {
          name: "Pump A",
          observations: "NARR-M1-OBS",
          vib: {
            limits: DEFAULT_ZONE_LIMITS,
            rows: [],
            fft: [{ label: "P1 V only-on-a", png }],
          },
        },
        {
          name: "Fan B",
          vib: {
            limits: DEFAULT_ZONE_LIMITS,
            rows: [],
            fft: [{ label: "P2 H only-on-b", png }],
          },
        },
      ],
    });
    const JSZip = (await import("jszip")).default;
    const xml = await (
      await JSZip.loadAsync(await blob.arrayBuffer())
    )
      .file("word/document.xml")!
      .async("string");
    const count = (token: string) => xml.split(token).length - 1;
    const a = xml.indexOf("only-on-a");
    const narr = xml.indexOf("NARR-M1-OBS");
    const fan = xml.indexOf("Fan B");
    const b = xml.indexOf("only-on-b");
    const shared = xml.indexOf("SHARED-SUMMARY");
    const sharedEnd = xml.indexOf("SHARED-END");
    const iso = xml.indexOf("ISO 10816-3 standards");
    const approval = xml.indexOf("Approval");
    expect(count("NARR-M1-OBS")).toBe(1);
    expect(narr).toBeGreaterThan(a);
    expect(narr).toBeLessThan(fan);
    expect(b).toBeGreaterThan(fan);
    expect(count("SHARED-SUMMARY")).toBe(1);
    expect(count("SHARED-METHOD")).toBe(1);
    expect(count("SHARED-OBS")).toBe(1);
    expect(shared).toBeGreaterThan(b);
    expect(xml.indexOf("SHARED-METHOD")).toBeGreaterThan(b);
    const machine2 = xml.slice(fan, shared);
    expect(machine2).not.toContain("NARR-M1-OBS");
    expect(machine2).not.toContain("SHARED-METHOD");
    expect(iso).toBeGreaterThan(sharedEnd);
    expect(count("ISO 10816-3 standards")).toBe(1);
    expect(approval).toBeGreaterThan(iso);
    expect(count("Approval")).toBe(1);
  }, 30000);

  it("folds an empty single machine onto the shared draft and does not repeat it", async () => {
    const parsed = parseSp3(new TextEncoder().encode("100,0.4\n200,0.9\n"), "a.sp3");
    const png = renderChartPng(parsed.spectra);
    const base = {
      projectName: "P",
      engineer: "E",
      reportDate: "2026-09-30",
      units: "SI",
      norm: "Default",
      notes: "",
      includeToc: false,
    };
    const blob = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: { ...base, language: "fa" },
      aiDraft: {
        summary: "SOLE-SUMMARY",
        methodology: "SOLE-METHOD",
        observations: "SOLE-OBS",
        recommendations: "SOLE-REC",
        conclusion: "SOLE-END",
      },
      branding: { signature: { data: png, kind: "png" } },
      equipments: [
        {
          name: "Pump A",
          vib: {
            limits: DEFAULT_ZONE_LIMITS,
            rows: [],
            fft: [{ label: "P1 V only-on-a", png }],
          },
        },
      ],
    });
    const JSZip = (await import("jszip")).default;
    const xml = await (
      await JSZip.loadAsync(await blob.arrayBuffer())
    )
      .file("word/document.xml")!
      .async("string");
    const count = (token: string) => xml.split(token).length - 1;
    const a = xml.indexOf("only-on-a");
    const summary = xml.indexOf("SOLE-SUMMARY");
    const end = xml.indexOf("SOLE-END");
    const iso = xml.indexOf("جدول استاندارد ISO 10816-3");
    expect(count("SOLE-SUMMARY")).toBe(1);
    expect(count("SOLE-METHOD")).toBe(1);
    expect(summary).toBeGreaterThan(a);
    expect(end).toBeGreaterThan(summary);
    expect(xml.indexOf("خلاصه")).toBeGreaterThan(a);
    expect(xml.indexOf("خلاصه")).toBeLessThan(summary);
    expect(iso).toBeGreaterThan(end);
    expect(count("جدول استاندارد ISO 10816-3")).toBe(1);
    expect(xml.indexOf("تأیید")).toBeGreaterThan(iso);
    expect(count("تأیید")).toBe(1);
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
    const samples = [1, 2, 3].map((v, i) => ({
      dateNum: 45000 + i,
      dateISO: "2023-01-01",
      rmsV: v,
      rmsA: v * 2,
    }));
    const full = await buildDocx({
      meta: parsed.meta,
      spectra: parsed.spectra,
      options: {
        ...base,
        language: "fa" as const,
        jalaliDate: isoToJalaliFa("2026-09-30"),
        letterNo: "405",
        clientName: "C",
        clientUnit: "U",
        addressBlock: "addr",
      },
      allTrends: [
        {
          pointLabel: "7 / 1",
          sampleCount: 3,
          velocityPng: renderTrendPng(samples, "rmsV", DEFAULT_ZONE_LIMITS.velocity),
          accelPng: renderTrendPng(samples, "rmsA", DEFAULT_ZONE_LIMITS.acceleration),
        },
      ],
      fftGallery: [{ label: "7 / 1", png: renderChartPng(parsed.spectra), peak: "1 @ 2" }],
    });
    expect(full.size).toBeGreaterThan(bare.size);
    const JSZip = (await import("jszip")).default;
    const faZip = await JSZip.loadAsync(await full.arrayBuffer());
    const faXml = await faZip.file("word/document.xml")!.async("string");
    const enXml = await (
      await JSZip.loadAsync(await bare.arrayBuffer())
    )
      .file("word/document.xml")!
      .async("string");
    expect(faXml).toContain("<w:bidi/>");
    expect(faXml).toContain("bidiVisual");
    expect(faXml).toContain("fa-IR");
    const settings = await faZip.file("word/settings.xml")!.async("string");
    expect(settings).toContain('w:bidi="fa-IR"');
    expect(enXml).not.toContain("<w:bidi/>");
  }, 30000);
});

describe("all trends", () => {
  it("builds one snapshot per point", () => {
    const rows = [
      {
        index: 0,
        pointId: "7",
        directionId: "1",
        measDate: "45000",
        peakV: "",
        peakFreq: "",
        rmsV: "1.2",
        rmsA: "10",
        peakA: "",
        unit: "",
        noLines: "",
      },
      {
        index: 1,
        pointId: "7",
        directionId: "1",
        measDate: "45001",
        peakV: "",
        peakFreq: "",
        rmsV: "2.2",
        rmsA: "12",
        peakA: "",
        unit: "",
        noLines: "",
      },
      {
        index: 2,
        pointId: "9",
        directionId: "2",
        measDate: "45000",
        peakV: "",
        peakFreq: "",
        rmsV: "3.2",
        rmsA: "14",
        peakA: "",
        unit: "",
        noLines: "",
      },
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
      {
        ...base,
        signatureLayout: "fa",
        signatureName: "محسن مردانه",
        signatureRole: "سرپرست کارگاه",
      },
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
