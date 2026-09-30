import { describe, expect, it } from "vitest";
import { findDominantPeaks, formatPeakLabel } from "../spectra-peaks";
import { buildMeasuringTableData, renderChartPng } from "../generateDocx";
import {
  buildMachineSpecs,
  extractJpegFromHex,
  joinCatalog,
  machineLabelMap,
  pointAxisLabel,
} from "../spectra-catalog";
import { historyStats, renderTrendPng } from "../trends";
import { buildIsoTableData } from "../iso10816";
import { sectionTitle } from "../fa";
import { DEFAULT_ZONE_LIMITS } from "../zones";
import { chooseSchematic, linesForMachine, renderGMachinePng } from "../spectra-gmachine";
import { renderPointSchematic } from "../spectra-schematic";
import { translate } from "../i18n";
import type { SpectraPoint } from "../spectra-catalog";
import { buildMeasureRows } from "../report-slices";
import { applyEnvelopeSamples, indexEnvelopeCsv } from "../mdb";

const plant = `PlantID,Name\n1,"Motor Pump RO1"\n`;
const machine = `MachineID,PlantID,Name,LblRPM,ValueRPM,Note\n1,1,"HHP-101A","Primary RPM",24.583,"Potable Water"\n`;
const point = `PointID,MachineID,Name,BearProducer1,BearType1,BearProducer2,BearType2\n1,1,"P1","SKF","6213","-","-"\n2,1,"P2","SKF","6311","-","-"\n`;
const direction = `DirectionID,PointID,Name\n1,1,"V1"\n2,1,"H1"\n3,2,"A2"\n`;

describe("spectra catalog", () => {
  it("joins machines, bearings, and axis labels", () => {
    const machines = joinCatalog({ plantCsv: plant, machineCsv: machine, pointCsv: point, directionCsv: direction });
    expect(machines).toHaveLength(1);
    expect(machines[0].name).toBe("HHP-101A");
    expect(machines[0].plantName).toBe("Motor Pump RO1");
    expect(pointAxisLabel("P1", "V1")).toBe("P1 V");
    const specs = buildMachineSpecs(machines[0]);
    expect(specs).toContain("6213");
    expect(specs).toContain("1475");
    expect(machineLabelMap(machines[0])["1 1"]).toBe("P1 V");
  });

  it("extracts a JPEG from a hex MachPicture field", () => {
    const jpeg = extractJpegFromHex("00FFD8FFE000");
    expect(jpeg?.[0]).toBe(0xff);
    expect(jpeg?.[1]).toBe(0xd8);
  });
});

describe("dominant peaks", () => {
  it("keeps separated local maxima", () => {
    const spectra = [0, 1, 0, 5, 0, 1, 3, 0].map((amp, i) => ({ freq: i * 10, amp }));
    const peaks = findDominantPeaks(spectra, 3, 5);
    expect(peaks.map((p) => p.amp)).toEqual([1, 5, 3]);
    expect(formatPeakLabel(24.5)).toBe("24.5");
    expect(formatPeakLabel(1500)).toBe("1500");
  });

  it("draws a red callout with light digits on the peak", () => {
    const spectra = Array.from({ length: 80 }, (_, i) => ({
      freq: (i + 1) * 10,
      amp: i === 40 ? 4 : 0.1,
    }));
    const png = renderChartPng(spectra);
    const rgb = inflateStoredPng(png, 800, 400);
    let red = 0;
    let boxedWhite = 0;
    const w = 800;
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        if (rgb[i] === 220 && rgb[i + 1] === 38 && rgb[i + 2] === 38) red++;
        if (rgb[i] !== 255 || rgb[i + 1] !== 255 || rgb[i + 2] !== 255) continue;
        const left = x > 0 ? (y * w + x - 1) * 3 : -1;
        const right = x + 1 < w ? (y * w + x + 1) * 3 : -1;
        const nearRed =
          (left >= 0 && rgb[left] === 220 && rgb[left + 1] === 38) ||
          (right >= 0 && rgb[right] === 220 && rgb[right + 1] === 38);
        if (nearRed) boxedWhite++;
      }
    }
    expect(red).toBeGreaterThan(200);
    expect(boxedWhite).toBeGreaterThan(8);
  });
});

describe("gmachine schematic", () => {
  const gmachine = `GMID,MachineID,GMName,GMLineX1,GMLinex2,GMLineY1,GMLineY2,GMLabelLeft,GMLabelTop\n5,9,P1,10,90,40,40,20,20\n`;
  const gdirection = `GMID,GDName,GDLineX1,GDLinex2,GDLineY1,GDLineY2\n5,V,10,10,40,70\n8,H,0,1,0,1\n`;

  it("keeps the JPEG ahead of vector lines and the point drawing", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6]);
    const lines = linesForMachine(gmachine, gdirection, "9");
    expect(lines).toHaveLength(2);
    expect(lines[0].label).toBe("P1");
    const png = renderGMachinePng(lines);
    expect(png?.[0]).toBe(137);
    expect(chooseSchematic(jpeg, png, new Uint8Array([137, 80]))).toBe(jpeg);
    expect(chooseSchematic(null, png, new Uint8Array([137, 80]))).toBe(png);
    expect(chooseSchematic(new Uint8Array([1, 2, 3]), null, null)).toBeNull();
    expect(translate("fa", "appTitle")).toBe("گزارش‌ساز");
    expect(translate("en", "tabReport")).toBe("Report");
  });
});

describe("point schematic", () => {
  it("draws one station per point instead of a photo", () => {
    const points: SpectraPoint[] = [1, 2, 3, 4].map((n) => ({
      pointId: String(n),
      machineId: "1",
      name: `P${n}`,
      bearings: [],
      directions: [
        { directionId: "1", pointId: String(n), name: "V1" },
        { directionId: "2", pointId: String(n), name: "H1" },
      ],
    }));
    const png = renderPointSchematic(points);
    expect(png).not.toBeNull();
    const rgb = inflateStoredPng(png!, 720, 240);
    let ink = 0;
    for (let i = 0; i < rgb.length; i += 3) {
      if (rgb[i] === 17 && rgb[i + 1] === 24 && rgb[i + 2] === 39) ink++;
    }
    expect(ink).toBeGreaterThan(400);
    expect(renderPointSchematic([])).toBeNull();
  });
});

/** Unpack this app's stored-block PNG into RGB bytes (filter byte stripped). */
function inflateStoredPng(png: Uint8Array, width: number, height: number): Uint8Array {
  let idat = -1;
  let o = 8;
  while (o + 8 < png.length) {
    const len = (png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3];
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    if (type === "IDAT") {
      idat = o + 8;
      break;
    }
    o += 12 + len;
  }
  if (idat < 0) throw new Error("no IDAT");
  let p = idat + 2;
  const raw: number[] = [];
  while (png[p] !== undefined && raw.length < 2_000_000) {
    const final = png[p] & 1;
    const n = png[p + 1] | (png[p + 2] << 8);
    p += 5;
    for (let i = 0; i < n; i++) raw.push(png[p + i]);
    p += n;
    if (final) break;
  }
  const rgb: number[] = [];
  const stride = width * 3;
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) rgb.push(raw[row + i] ?? 0);
  }
  return new Uint8Array(rgb);
}

describe("brochure polish", () => {
  it("history stats and sparkline png", () => {
    const samples = [
      { dateNum: 1, dateISO: "a", rmsV: 1, rmsA: 2 },
      { dateNum: 2, dateISO: "b", rmsV: 3, rmsA: 4 },
    ];
    expect(historyStats(samples, "rmsV").curr).toBe("3");
    expect(historyStats(samples, "rmsV").prev).toBe("1");
    const png = renderTrendPng(samples, "rmsV", DEFAULT_ZONE_LIMITS.velocity, { sparkline: true });
    expect(png[0]).toBe(137);
  });

  it("measuring rows carry avg/prev and ISO/FA options", () => {
    const rows = buildMeasureRows(
      [
        { index: 0, pointId: "1", directionId: "1", measDate: "45000", peakV: "0.5", peakFreq: "25", rmsV: "1", rmsA: "2", peakA: "", unit: "", noLines: "" },
        { index: 1, pointId: "1", directionId: "1", measDate: "45001", peakV: "0.6", peakFreq: "26", rmsV: "3", rmsA: "4", peakA: "", unit: "", noLines: "" },
      ],
      DEFAULT_ZONE_LIMITS,
      "all",
      { "1 1": "P1 V" },
      false
    );
    expect(rows[0].point).toBe("P1 V");
    expect(rows[0].currV).toBe("3");
    expect(rows[0].prevV).toBe("1");
    const iso = buildIsoTableData({ groups: "1+3", language: "fa" });
    expect(iso.rows[0][0].text).toContain("۱");
    expect(sectionTitle("fa", "measuring")).toContain("انداز");
    const faHeader = buildMeasuringTableData(
      [{ point: "P1", date: "a", rms: "1", rmsA: "2", peak: "", peakFreq: "" }],
      DEFAULT_ZONE_LIMITS,
      "fa"
    ).header;
    expect(faHeader[0]).toBe("نقطه");
    expect(faHeader[6]).toContain("ناحیه سرعت");
    expect(faHeader[7]).toBe("فهرست پیک");
    const env = indexEnvelopeCsv("PointID,MeasDate,TotalRMSV\n1,45000,0.2\n");
    expect(env.get("1|45000")).toBe("0.2");
    const joined = [
      { pointId: "1", measDate: "45000", envelopeRms: undefined as string | undefined },
      { pointId: "9", measDate: "45000", envelopeRms: undefined as string | undefined },
    ];
    expect(
      applyEnvelopeSamples(joined, [{ pointId: "1", measDate: "45000", rms: "0.2" }])
    ).toBe(1);
    expect(joined[0].envelopeRms).toBe("0.2");
    expect(joined[1].envelopeRms).toBeUndefined();
  });
});
