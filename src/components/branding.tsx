import { useRef } from "react";
import type { ReportOptions } from "../lib/parseSp3";
import { base64ToBytes, bytesToBase64, type Branding } from "../lib/settings";
import { TEMPLATES } from "../lib/templates";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { toast } from "./ui/sonner";

const MAX_LOGO_BYTES = 500 * 1024;
const MAX_COVER_BYTES = 1024 * 1024;

function dataUrl(b64: string | null, fallbackMime: string): string | null {
  if (!b64) return null;
  const bin = atob(b64.slice(0, 24));
  if (bin.startsWith("\xFF\xD8\xFF")) return `data:image/jpeg;base64,${b64}`;
  if (bin.startsWith("\x89PNG")) return `data:image/png;base64,${b64}`;
  return `data:${fallbackMime};base64,${b64}`;
}

export function BrandingCard({
  options,
  onOptions,
  branding,
  onBranding,
}: {
  options: ReportOptions;
  onOptions: (next: ReportOptions) => void;
  branding: Branding;
  onBranding: (next: Branding) => void;
}) {
  const selected = options.templateId ?? "classic";

  const handleFile = async (
    key: "logoBase64" | "coverBase64" | "signatureBase64",
    file: File,
    maxBytes: number
  ) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Upload a PNG or JPEG image.");
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`Image must be under ${Math.round(maxBytes / 1024)} KB.`);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const b64 = bytesToBase64(bytes);
    base64ToBytes(b64); // validate round-trip before persisting
    onBranding({ ...branding, [key]: b64 });
    toast.success("Saved locally.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Template & branding</CardTitle>
        <CardDescription>
          Gallery + Elika cover, logo and signature. Stored locally; applied on export.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onOptions({ ...options, templateId: t.id })}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors focus-visible:outline-2",
                selected === t.id ? "border-primary bg-accent" : "hover:bg-accent/50"
              )}
              aria-pressed={selected === t.id}
            >
              <div className="mb-2 h-8 rounded" style={{ backgroundColor: `#${t.accentHex}` }} />
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">{t.description}</p>
            </button>
          ))}
        </div>
        <AssetRow
          title="Logo"
          hint="Header of every report"
          preview={dataUrl(branding.logoBase64, "image/png")}
          previewAlt="Logo preview"
          previewClass="h-12 max-w-32"
          accept="image/png,image/jpeg,image/*"
          onPick={(f) => void handleFile("logoBase64", f, MAX_LOGO_BYTES)}
          onRemove={
            branding.logoBase64 ? () => onBranding({ ...branding, logoBase64: null }) : null
          }
        />
        <AssetRow
          title="Cover page"
          hint="Full first page of the .docx"
          preview={dataUrl(branding.coverBase64, "image/jpeg")}
          previewAlt="Cover preview"
          previewClass="h-24 max-w-40"
          accept="image/jpeg,image/png,image/*"
          onPick={(f) => void handleFile("coverBase64", f, MAX_COVER_BYTES)}
          onRemove={
            branding.coverBase64 ? () => onBranding({ ...branding, coverBase64: null }) : null
          }
        />
        <AssetRow
          title="Signature"
          hint="Stamp block at the end, with engineer + date"
          preview={dataUrl(branding.signatureBase64, "image/png")}
          previewAlt="Signature preview"
          previewClass="h-16 max-w-40"
          accept="image/png,image/jpeg,image/*"
          onPick={(f) => void handleFile("signatureBase64", f, MAX_LOGO_BYTES)}
          onRemove={
            branding.signatureBase64
              ? () => onBranding({ ...branding, signatureBase64: null })
              : null
          }
        />
      </CardContent>
    </Card>
  );
}

function AssetRow({
  title,
  hint,
  preview,
  previewAlt,
  previewClass,
  accept,
  onPick,
  onRemove,
}: {
  title: string;
  hint: string;
  preview: string | null;
  previewAlt: string;
  previewClass: string;
  accept: string;
  onPick: (f: File) => void;
  onRemove: (() => void) | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      {preview ? (
        <img
          src={preview}
          alt={previewAlt}
          className={`${previewClass} rounded border bg-white object-contain`}
        />
      ) : (
        <div className="flex h-12 w-32 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
          No {title.toLowerCase()}
        </div>
      )}
      <div className="grid gap-1">
        <p className="text-sm font-medium">
          {title} <span className="font-normal text-muted-foreground">— {hint}</span>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            Upload
          </Button>
          {onRemove ? (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
