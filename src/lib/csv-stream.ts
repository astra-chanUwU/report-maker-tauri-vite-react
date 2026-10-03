import { detectEncoding, splitCsvLine } from "./specdata";

/** 1 MiB streaming chunk for Blob.slice → TextDecoder. */
export const FILE_CHUNK = 1 << 20;

/**
 * Shared Blob streaming helper: encoding-aware, BOM-skipping, 1.5 GiB guard.
 * Used by both the main-thread `listFileRows` and the `csv-worker`.
 */
export async function streamLines(
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
