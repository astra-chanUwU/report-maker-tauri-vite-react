/** Extra WordprocessingML so a Farsi report is a right-to-left document, not only right-aligned paragraphs. */

export async function applyWordRtl(blob: Blob): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const touch = async (name: string, edit: (xml: string) => string) => {
    const file = zip.file(name);
    if (!file) return;
    zip.file(name, edit(await file.async("string")));
  };
  await touch("word/document.xml", (xml) => {
    const next = xml.replace(/<w:tblPr>/g, "<w:tblPr><w:bidiVisual/>");
    return next.replace(/<w:sectPr>/g, "<w:sectPr><w:bidi/>");
  });
  await touch("word/settings.xml", (xml) => {
    if (xml.includes("w:themeFontLang")) {
      return xml.replace(/<w:themeFontLang\b([^>]*)\/>/g, (_m, attrs: string) => {
        const cleaned = String(attrs)
          .replace(/\sw:bidi="[^"]*"/g, "")
          .replace(/\sw:val="[^"]*"/g, "");
        return `<w:themeFontLang${cleaned} w:val="fa-IR" w:bidi="fa-IR"/>`;
      });
    }
    return xml.replace(
      "</w:settings>",
      '<w:themeFontLang w:val="fa-IR" w:bidi="fa-IR"/></w:settings>'
    );
  });
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const raw = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return new Blob([raw], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
