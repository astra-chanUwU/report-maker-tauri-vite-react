/// <reference lib="webworker" />
import { detectEncoding, splitCsvLine } from "../lib/specdata";

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

const FILE_CHUNK = 1 << 20;

async function streamLines(
  file: Blob,
  onLine: (line: string, isHeader: boolean) => boolean | void,
  stopAfterBytes = 1536 * 1024 * 1024,
): Promise<{ header: string[] | null; bytes: number }> {
  const prefix = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const { enc, skip } = detectEncoding(prefix);
  const decoder = new TextDecoder(enc === "utf16le" ? "utf-16le" : "utf-8");
  let offset = skip;
  let carry = "";
  let header: string[] | null = null;
  let stopped = false;
  while (offset < file.size && !stopped) {
    if (offset > stopAfterBytes) throw new Error("File larger than 1.5 GiB is not supported.");
    const buf = new Uint8Array(await file.slice(offset, offset + FILE_CHUNK).arrayBuffer());
    if (buf.length === 0) break;
    offset += buf.length;
    carry += decoder.decode(buf, { stream: true });
    const parts = carry.split("\n");
    carry = parts.pop() ?? "";
    for (const raw of parts) {
      const line = raw.replace(/\r$/, "");
      if (!header) {
        if (!line.trim()) continue;
        header = splitCsvLine(line);
        const done = onLine(line, true);
        if (done === true) stopped = true;
        continue;
      }
      if (!line.trim()) continue;
      if (onLine(line, false) === true) {
        stopped = true;
        break;
      }
    }
  }
  if (!stopped) {
    carry += decoder.decode();
    for (const raw of carry.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (!header) {
        if (!line.trim()) continue;
        header = splitCsvLine(line);
        onLine(line, true);
        continue;
      }
      if (!line.trim()) continue;
      onLine(line, false);
    }
  }
  return { header, bytes: offset };
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
