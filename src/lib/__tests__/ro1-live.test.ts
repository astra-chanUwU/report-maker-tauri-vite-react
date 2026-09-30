import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocx, renderChartPng } from "../generateDocx";
import type { CsvRowSummary } from "../mdb";
import { computeStats } from "../parseSp3";
import { buildMeasureRows, latestPerPoint, rowsForPoints } from "../report-slices";
import { buildMachineSpecs, joinCatalog, machineLabelMap } from "../spectra-catalog";
import { oleDateToISO, parseSpecRowCells, rowToSpectrum, splitCsvLine } from "../specdata";
import { buildAllTrendSnapshots, groupHistories } from "../trends";
import { DEFAULT_ZONE_LIMITS } from "../zones";

const dir = process.env.RO1_DIR;
const out = process.env.RO1_OUT;

describe.skipIf(!dir)("Motor Pump RO1 live export", () => {
  it("builds an HHP-101A report from the real Data table", async () => {
    const read = (name: string) => readFileSync(`${dir}/${name}`, "utf8").replace(/^\uFEFF/, "");
    const machine = joinCatalog({
      plantCsv: read("Plant.csv"),
      machineCsv: read("Machine.csv"),
      pointCsv: read("Point.csv"),
      directionCsv: read("Direction.csv"),
    }).find((m) => m.name === "HHP-101A");
    expect(machine).toBeTruthy();
    const labels = machineLabelMap(machine!);
    const pointIds = machine!.points.map((p) => p.pointId);

    const lines = read("Data.csv")
      .split(/\r?\n/)
      .filter((l) => l.trim());
    const header = splitCsvLine(lines[0]);
    const col = (cells: string[], name: string) => {
      const i = header.indexOf(name);
      return i >= 0 ? (cells[i] ?? "").replace(/^"|"$/g, "").trim() : "";
    };
    const all: CsvRowSummary[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      all.push({
        index: i - 1,
        pointId: col(cells, "PointID"),
        directionId: col(cells, "DirectionID"),
        measDate: col(cells, "MeasDate"),
        peakV: col(cells, "ValuePeakMaxV"),
        peakFreq: col(cells, "FreqPeakMaxV"),
        rmsV: col(cells, "TotalRMSV"),
        rmsA: col(cells, "TotalRMSA"),
        peakA: col(cells, "TotalPeakA"),
        unit: col(cells, "Unit"),
        noLines: col(cells, "NoLines"),
      });
    }
    const slice = rowsForPoints(all, pointIds);
    expect(slice.length).toBeGreaterThan(0);
    const fft: { label: string; png: Uint8Array; peak: string }[] = [];
    let spectra: { freq: number; amp: number }[] | null = null;
    let peakFreq = 0;
    for (const row of latestPerPoint(slice)) {
      const spec = parseSpecRowCells(header, splitCsvLine(lines[row.index + 1]));
      expect(spec).toBeTruthy();
      const points = rowToSpectrum(spec!);
      const st = computeStats(points);
      if (row.pointId === "1" && row.directionId === "1") {
        spectra = points;
        peakFreq = Number(row.peakFreq);
        expect(Math.abs(st.peak.freq - peakFreq)).toBeLessThan(1);
      }
      const named = labels[`${row.pointId} ${row.directionId}`] || row.pointId;
      fft.push({
        label: `${named} · ${oleDateToISO(Number(row.measDate)) || ""}`,
        png: renderChartPng(points),
        peak: `${st.peak.amp} @ ${st.peak.freq}`,
      });
    }
    expect(spectra).toBeTruthy();
    expect(fft.some((f) => f.label.startsWith("P1 V"))).toBe(true);

    const blob = await buildDocx({
      meta: { filename: "Motor Pump RO1 Ard.sp3", size: 0, source: "mdb" },
      spectra: spectra!,
      options: {
        projectName: "HHP-101A vibration check",
        engineer: "Verify",
        reportDate: "2026-09-30",
        units: "SI",
        norm: "ISO 10816-3",
        notes: "",
        includeToc: true,
        language: "en",
      },
      equipments: [
        {
          name: machine!.name,
          specs: buildMachineSpecs(machine!),
          status: "Healthy",
          vib: {
            limits: DEFAULT_ZONE_LIMITS,
            rows: buildMeasureRows(slice, DEFAULT_ZONE_LIMITS, "all", labels, true),
            trends: buildAllTrendSnapshots(
              groupHistories(slice).map((h) => ({
                ...h,
                label: labels[`${h.pointId} ${h.directionId}`] || h.label,
              })),
              DEFAULT_ZONE_LIMITS,
              "all"
            ),
            fft,
          },
        },
      ],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (out) writeFileSync(out, bytes);
    const JSZip = (await import("jszip")).default;
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("HHP-101A");
    expect(xml).toContain("6213");
    expect(xml).toContain("P1 V");
    expect(xml).toContain("PAGEREF");
    expect(blob.size).toBeGreaterThan(20000);
  }, 60000);
});
