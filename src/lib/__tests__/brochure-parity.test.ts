import { describe, expect, it } from "vitest";
import { findDominantPeaks, formatPeakLabel } from "../spectra-peaks";
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
import { buildMeasureRows } from "../report-slices";
import { indexEnvelopeCsv } from "../mdb";

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
});

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
    const env = indexEnvelopeCsv("PointID,MeasDate,TotalRMSV\n1,45000,0.2\n");
    expect(env.get("1|45000")).toBe("0.2");
  });
});
