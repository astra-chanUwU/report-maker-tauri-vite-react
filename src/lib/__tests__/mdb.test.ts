import { describe, expect, it } from "vitest";
import {
  convertSp3FromDisk,
  isTauriRuntime,
  listFileRows,
  loadFileRow,
  mdbToolStatus,
} from "../mdb";
import { loadMdbToolPath, saveMdbToolPath } from "../settings";

function encodeOctal(values: number[]): string {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  const bytes = new Uint8Array(buf);
  return '"' + [...bytes].map((b) => "\\" + b.toString(8).padStart(3, "0")).join("") + '"';
}

function twoRowCsv(): string {
  const header =
    "DataID,PointID,DirectionID,NoLines,BandWidth,Unit,MeasDate,ValuePeakMaxV,FreqPeakMaxV,TotalRMSV,TotalRMSA,TotalPeakA,Specdata";
  const r1 = `1,7,1,4,0.5,"mm/s",45811.43,0.5,1.0,0.83,12.4,0.9,${encodeOctal([0.1, 0.5, 0.2, 0.05])}`;
  const r2 = `2,9,2,4,0.5,"mm/s",45812.43,0.4,1.5,0.9,31.2,1.1,${encodeOctal([0.2, 0.1, 0.4, 0.05])}`;
  return `${header}\n${r1}\n${r2}\n`;
}

describe("mdb (Tauri-only integration)", () => {
  it("detects non-Tauri runtime", async () => {
    await expect(isTauriRuntime()).resolves.toBe(false);
  });

  it("refuses conversion outside Tauri instead of hanging", async () => {
    await expect(convertSp3FromDisk()).rejects.toThrow();
  });

  it("status call fails loudly outside Tauri", async () => {
    await expect(mdbToolStatus()).rejects.toThrow();
  });

  it("persists the tool path override", () => {
    saveMdbToolPath("D:\\tools\\mdb-export.exe");
    expect(loadMdbToolPath()).toBe("D:\\tools\\mdb-export.exe");
    saveMdbToolPath("");
    expect(loadMdbToolPath()).toBe("");
  });

  it("lists + loads rows from a multi-row export File", async () => {
    const file = new File([twoRowCsv()], "data.csv", { type: "text/plain" });
    const list = await listFileRows(file);
    expect(list.rows).toHaveLength(2);
    expect(list.rows[0].pointId).toBe("7");
    expect(list.rows[1].pointId).toBe("9");
    expect(list.rows[0].index).toBe(0);
    expect(list.rows[0].rmsA).toBe("12.4");
    expect(list.rows[1].peakA).toBe("1.1");
    const second = await loadFileRow(file, "data.csv", 1, list.rows.length);
    expect(second.meta.source).toBe("spec-csv");
    expect(second.meta.overall?.pointId).toBe("9");
    expect(second.spectra).toHaveLength(4);
    // row2 amplitudes [0.2,0.1,0.4,0.05] → peak 0.4 @ 1.5 Hz
    expect(second.stats.peak.freq).toBe(1.5);
    expect(second.stats.peak.amp).toBeCloseTo(0.4, 5);
  });
});
