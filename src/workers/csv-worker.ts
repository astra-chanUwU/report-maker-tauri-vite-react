/// <reference lib="webworker" />
import { splitCsvLine } from "../lib/specdata";
import { streamLines } from "../lib/csv-stream";

export interface CsvRowSummary {
  index: number;
  pointId: string;
  directionId: string;
  measDate: string;
  peakV: string;
  peakFreq: string;
  rmsV: string;
  rmsA: string;
  peakA: string;
  bc?: string;
  unit: string;
  noLines: string;
  envelopeRms?: string;
}

export interface CsvRowList {
  header: string[];
  rows: CsvRowSummary[];
}

function summarize(header: string[], cells: string[], index: number): CsvRowSummary {
  const get = (name: string): string => {
    const i = header.indexOf(name);
    return i >= 0 && i < cells.length ? cells[i] : "";
  };
  return {
    index,
    pointId: get("PointID").trim(),
    directionId: get("DirectionID").trim(),
    measDate: get("MeasDate").trim(),
    peakV: get("ValuePeakMaxV").trim(),
    peakFreq: get("FreqPeakMaxV").trim(),
    rmsV: get("TotalRMSV").trim(),
    rmsA: get("TotalRMSA").trim(),
    peakA: get("TotalPeakA").trim(),
    bc: get("BC").trim(),
    unit: get("Unit").replace(/^"|"$/g, "").trim(),
    noLines: get("NoLines").trim(),
  };
}

async function listFileRowsInternal(file: Blob): Promise<CsvRowList> {
  let header: string[] = [];
  const rows: CsvRowSummary[] = [];
  let index = 0;
  const res = await streamLines(file, (line, isHeader) => {
    if (isHeader) {
      header = splitCsvLine(line);
      if (!header.includes("Specdata")) throw new Error("Not a Data-table export (no Specdata column).");
      return;
    }
    const cells = splitCsvLine(line);
    rows.push(summarize(header, cells, index++));
  });
  if (!res.header || !res.header.includes("Specdata")) {
    throw new Error("Not a Data-table export (no Specdata column).");
  }
  return { header, rows };
}

type WorkerRequest = { file: File | Blob };
type WorkerResponse = { ok: true; result: CsvRowList } | { ok: false; error: string };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { file } = e.data;
  try {
    const result = await listFileRowsInternal(file);
    const response: WorkerResponse = { ok: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};

export type { WorkerRequest, WorkerResponse };
export { listFileRowsInternal, streamLines };
