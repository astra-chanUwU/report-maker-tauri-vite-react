import { useRef, useState } from "react";
import type { ReportOptions } from "../lib/parseSp3";
import { base64ToBytes, bytesToBase64, type Branding } from "../lib/settings";
import { TEMPLATES } from "../lib/templates";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { toast } from "./ui/sonner";

const MAX_LOGO_BYTES = 500 * 1024;

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
  const [preview, setPreview] = useState<string | null>(() =>
    branding.logoBase64 ? `data:image/png;base64,${branding.logoBase64}` : null
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = options.templateId ?? "classic";

  const handleLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Upload a PNG or SVG image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo must be under 500 KB.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === "image/svg+xml") {
      toast.error("SVG converts at export time — PNG recommended.");
    }
    const b64 = bytesToBase64(bytes);
    // Validate it decodes (round-trip) before persisting
    base64ToBytes(b64);
    onBranding({ logoBase64: b64 });
    setPreview(`data:${file.type};base64,${b64}`);
    toast.success("Logo saved locally.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Template & branding</CardTitle>
        <CardDescription>Gallery + cover logo. Stored locally; applied on export.</CardDescription>
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
        <div className="flex items-center gap-3">
          {preview ? (
            <img
              src={preview}
              alt="Logo preview"
              className="h-12 max-w-32 rounded border bg-white object-contain"
            />
          ) : (
            <div className="flex h-12 w-32 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
              No logo
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              Upload logo
            </Button>
            {branding.logoBase64 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onBranding({ logoBase64: null });
                  setPreview(null);
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/svg+xml,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleLogo(f);
              e.target.value = "";
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
