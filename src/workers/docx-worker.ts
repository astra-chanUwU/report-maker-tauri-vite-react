/**
 * docx-worker: runs generateDocx off the main thread.
 * Protocol is manual postMessage (Comlink-compatible shape could be added later).
 * Main thread posts { id, input }, worker replies with phased progress then done/error.
 */
import { buildDocx, type BuildDocxInput } from "../lib/generateDocx";
import { estimatePercent, type ExportProgress } from "../lib/export-progress";

export type DocxWorkerRequest = {
  id: number;
  input: BuildDocxInput;
};

export type DocxWorkerResponse =
  | { id: number; type: "progress"; progress: ExportProgress }
  | { id: number; type: "done"; buffer: ArrayBuffer }
  | { id: number; type: "error"; error: string };

function postProgress(id: number, progress: ExportProgress): void {
  (self as unknown as { postMessage: (msg: DocxWorkerResponse) => void }).postMessage({
    id,
    type: "progress",
    progress,
  });
}

self.onmessage = async (e: MessageEvent<DocxWorkerRequest>) => {
  const { id, input } = e.data;
  if (typeof id !== "number" || !input) return;
  try {
    postProgress(id, {
      stage: "building",
      percent: estimatePercent("building"),
      detail: "Assembling document…",
    });
    const blob = await buildDocx(input);
    postProgress(id, {
      stage: "packing",
      percent: estimatePercent("packing"),
      detail: "Packing Word file…",
    });
    const buffer = await blob.arrayBuffer();
    const response: DocxWorkerResponse = { id, type: "done", buffer };
    (self as unknown as { postMessage: (msg: unknown, transfer: Transferable[]) => void }).postMessage(
      response,
      [buffer]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: DocxWorkerResponse = { id, type: "error", error: message };
    (self as unknown as { postMessage: (msg: DocxWorkerResponse) => void }).postMessage(response);
  }
};
