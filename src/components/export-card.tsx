import { useState } from "react";
import { Download, FolderOpen } from "lucide-react";
import { buildDocx } from "../lib/generateDocx";
import { fallbackDraft } from "../lib/ai";
import type { ParseResult, ReportOptions } from "../lib/parseSp3";
import { base64ToBytes, validateReportOptions, type Branding } from "../lib/settings";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { toast } from "./ui/sonner";

export function sanitizeFilename(name: string): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || "report";
}

export function ExportCard({
  parsed,
  options,
  branding,
}: {
  parsed: ParseResult | null;
  options: ReportOptions;
  branding?: Branding;
}) {
  const [busy, setBusy] = useState(false);
  const [lastPath, setLastPath] = useState<string | null>(null);

  const errors = validateReportOptions(options);
  const canExport = parsed !== null && Object.keys(errors).length === 0 && !busy;

  const handleExport = async () => {
    if (!parsed) {
      toast.error("Drop a .sp3 file first.");
      return;
    }
    if (Object.keys(errors).length > 0) {
      toast.error("Fill project name and engineer first.");
      return;
    }
    setBusy(true);
    try {
      const pointLimit = Math.max(1, Math.min(options.pointLimit ?? 120, 500));
      const draft = fallbackDraft({
        meta: parsed.meta,
        spectra: parsed.spectra,
        options,
        stats: parsed.stats,
      });
      const blob = await buildDocx({
        meta: parsed.meta,
        spectra: parsed.spectra,
        options: { ...options, pointLimit },
        aiDraft: draft,
        templateId: options.templateId ?? "classic",
        branding: branding?.logoBase64
          ? { logoPng: base64ToBytes(branding.logoBase64) }
          : undefined,
      });
      const filename = `${sanitizeFilename(options.projectName)}-${options.reportDate}.docx`;
      const savedPath = await saveBlob(blob, filename);
      if (savedPath) setLastPath(savedPath);
      toast.success(savedPath ? `Saved ${filename}` : `Downloaded ${filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    if (!lastPath) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(lastPath);
    } catch {
      toast.error("Could not open folder (web build?).");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <CardDescription>
          One click → editable Word file. Tauri save dialog when available, download fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button onClick={handleExport} disabled={!canExport}>
          <Download />
          {busy ? "Generating…" : "Generate Report"}
        </Button>
        {lastPath ? (
          <Button variant="outline" size="sm" onClick={handleReveal}>
            <FolderOpen />
            Open folder
          </Button>
        ) : null}
        {!parsed ? (
          <p className="text-xs text-muted-foreground">Drop a file to enable export.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Tauri save() + fs writeFile; falls back to anchor download. Returns path when saved via Tauri. */
async function saveBlob(blob: Blob, filename: string): Promise<string | null> {
  try {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (!path) return null; // user cancelled
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, bytes);
    return path;
  } catch {
    // Web fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return null;
  }
}
