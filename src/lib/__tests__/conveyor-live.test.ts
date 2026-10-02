import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocx, renderChartPng } from "../generateDocx";
import { applyEnvelopeSamples, indexEnvelopeCsv, type CsvRowSummary } from "../mdb";
import type { SecondaryMetric } from "../metrics";
import { computeStats } from "../parseSp3";
import {
  buildMeasureRows,
  latestPerPoint,
  peaksFromSpectrum,
  rowsForPoints,
} from "../report-slices";
import { buildMachineSpecs, joinCatalog, machineLabelMap } from "../spectra-catalog";
import { oleDateToISO, parseSpecRowCells, rowToSpectrum, splitCsvLine } from "../specdata";
import { buildAllTrendSnapshots, groupHistories } from "../trends";
import { DEFAULT_ZONE_LIMITS } from "../zones";

/**
 * Real-data check against the legacy Report Builder output for Conveyor System CH.
 * CONV_DIR holds Plant/Machine/Point/Direction/Data/EnvelopeData CSVs from mdb-export.
 */
const dir = process.env.CONV_DIR;
const out = process.env.CONV_OUT;
const secondary = (process.env.CONV_SECONDARY || "acceleration") as SecondaryMetric;

describe.skipIf(!dir)("Conveyor System CH live export", () => {
  it("builds a CVM-F11 report with DB alarm limits and the chosen secondary metric", async () => {
    const read = (name: string) => readFileSync(`${dir}/${name}`, "utf8").replace(/^\uFEFF/, "");
    const machine = joinCatalog({
      plantCsv: read("Plant.csv"),
      machineCsv: read("Machine.csv"),
      pointCsv: read("Point.csv"),
      directionCsv: read("Direction.csv"),
    }).find((m) => m.name === "CVM-F11");
    expect(machine).toBeTruthy();
    expect(machine!.limits?.velocity).toEqual({ bottom: 3.5, mid: 7, top: 8.6 });
    const limits = machine!.limits ?? DEFAULT_ZONE_LIMITS;
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
        bc: col(cells, "BC"),
        peakA: col(cells, "TotalPeakA"),
        unit: col(cells, "Unit"),
        noLines: col(cells, "NoLines"),
      });
    }
    const slice = rowsForPoints(all, pointIds);
    expect(slice.length).toBeGreaterThan(0);
    const env = indexEnvelopeCsv(read("EnvelopeData.csv"));
    expect(applyEnvelopeSamples(slice, env)).toBeGreaterThan(0);

    const rows = buildMeasureRows(slice, limits, 15, labels, true, { secondary });
    const fft: { label: string; png: Uint8Array; peak: string }[] = [];
    let spectra: { freq: number; amp: number }[] = [];
    for (const row of latestPerPoint(slice)) {
      const spec = parseSpecRowCells(header, splitCsvLine(lines[row.index + 1]));
      if (!spec) continue;
      const points = rowToSpectrum(spec);
      const st = computeStats(points);
      if (spectra.length === 0) spectra = points;
      const key = `${row.pointId} ${row.directionId}`;
      const mr = rows.find((r) => r.key === key);
      if (mr) mr.peaks = peaksFromSpectrum(points);
      fft.push({
        label: `${labels[key] || row.pointId} · ${oleDateToISO(Number(row.measDate)) || ""}`,
        png: renderChartPng(points),
        peak: `${st.peak.amp} @ ${st.peak.freq}`,
      });
    }
    const p1v = rows.find((r) => r.point === "P1 V");
    expect(p1v?.peaks?.length).toBeGreaterThan(0);

    const blob = await buildDocx({
      meta: { filename: "Conveyor System CH (1).sp3", size: 0, source: "mdb" },
      spectra,
      options: {
        projectName: "Conveyor System CH",
        engineer: "Verify",
        reportDate: "2026-10-01",
        units: "SI",
        norm: "ISO 10816-3",
        notes: "",
        includeToc: true,
        language: "en",
        secondaryMetric: secondary,
      },
      equipments: [
        {
          name: machine!.name,
          specs: buildMachineSpecs(machine!),
          status: "Healthy",
          vib: {
            limits,
            rows,
            trends: !process.env.CONV_TRENDS
              ? undefined
              : buildAllTrendSnapshots(
                  groupHistories(slice).map((h) => ({
                    ...h,
                    label: labels[`${h.pointId} ${h.directionId}`] || h.label,
                  })),
                  limits,
                  15,
                  40,
                  false,
                  secondary === "acceleration" ? "rmsA" : secondary
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
    expect(xml).toContain("CVM-F11");
    expect(xml).toContain("Measuring point");
    expect(xml).toContain("V Zone (3.5/7/8.6)");
    expect(xml).toContain("DAMAGE OCCURS");
    expect(xml).toContain('w:vMerge w:val="restart"');
  }, 120000);
});
