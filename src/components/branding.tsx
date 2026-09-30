import { useRef } from "react";
import { Check, ImagePlus, LayoutTemplate, PenLine } from "lucide-react";
import type { ReportOptions } from "../lib/parseSp3";
import { base64ToBytes, bytesToBase64, type Branding } from "../lib/settings";
import { TEMPLATES, type DocTemplate } from "../lib/templates";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Field, Segmented } from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

const MAX_LOGO_BYTES = 500 * 1024;
const MAX_COVER_BYTES = 1024 * 1024;

function dataUrl(b64: string | null, fallbackMime: string): string | null {
  if (!b64) return null;
  const bin = atob(b64.slice(0, 24));
  if (bin.startsWith("\xFF\xD8\xFF")) return `data:image/jpeg;base64,${b64}`;
  if (bin.startsWith("\x89PNG")) return `data:image/png;base64,${b64}`;
  return `data:${fallbackMime};base64,${b64}`;
}

/** Tiny schematic of the cover so templates can be told apart at a glance. */
function TemplateThumb({ tpl }: { tpl: DocTemplate }) {
  const accent = `#${tpl.accentHex}`;
  const align = tpl.coverStyle === "modern" ? "items-start" : "items-center";
  return (
    <div className="flex h-28 items-center justify-center rounded-md bg-muted/70 p-2">
      <div
        className={cn(
          "flex h-full w-[4.2rem] flex-col gap-1 rounded-sm bg-white p-1.5 shadow-sm",
          align
        )}
      >
        {tpl.coverStyle === "modern" ? (
          <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: accent }} />
        ) : null}
        <div className="mt-2 h-1.5 w-3/4 rounded-full" style={{ backgroundColor: accent }} />
        <div className="h-1 w-1/2 rounded-full bg-neutral-300" />
        {tpl.coverStyle === "minimal" ? (
          <div className="my-1 h-px w-full bg-neutral-300" />
        ) : (
          <div className="my-1 h-5 w-full rounded-sm bg-neutral-100" />
        )}
        <div className="h-0.5 w-full rounded-full bg-neutral-200" />
        <div className="h-0.5 w-full rounded-full bg-neutral-200" />
        <div className="h-0.5 w-2/3 rounded-full bg-neutral-200" />
      </div>
    </div>
  );
}

export function TemplateCard({
  options,
  onOptions,
}: {
  options: ReportOptions;
  onOptions: (next: ReportOptions) => void;
}) {
  const selected = options.templateId ?? "classic";
  return (
    <Panel
      icon={<LayoutTemplate />}
      title="Template"
      description="Cover and heading style of the Word document."
    >
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Template">
        {TEMPLATES.map((tpl) => {
          const active = selected === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onOptions({ ...options, templateId: tpl.id })}
              className={cn(
                "relative grid cursor-default gap-2 rounded-lg border p-2 text-start transition-colors",
                active
                  ? "border-primary ring-2 ring-primary/25"
                  : "hover:border-muted-foreground/50"
              )}
            >
              {active ? (
                <span className="absolute end-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" aria-hidden="true" />
                </span>
              ) : null}
              <TemplateThumb tpl={tpl} />
              <span className="grid gap-0.5 px-1 pb-1">
                <span className="text-[13px] font-semibold">{tpl.name}</span>
                <span className="text-xs text-muted-foreground">{tpl.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
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
  const { t } = useUi();
  const sigLayout = options.signatureLayout ?? "en";

  const handleFile = async (
    key: "logoBase64" | "coverBase64" | "signatureBase64",
    file: File,
    maxBytes: number
  ) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("imageType"));
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`Image must be under ${Math.round(maxBytes / 1024)} KB.`);
      return;
    }
    const b64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    base64ToBytes(b64); // validate round-trip before persisting
    onBranding({ ...branding, [key]: b64 });
    toast.success(t("imageSaved"));
  };

  return (
    <Panel
      icon={<PenLine />}
      title={t("brandingTitle")}
      description="Stored on this computer and applied to every report."
      contentClassName="grid gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <AssetTile
          title="Logo"
          hint="Header of every page · PNG/JPEG under 500 KB"
          preview={dataUrl(branding.logoBase64, "image/png")}
          accept="image/png,image/jpeg"
          onPick={(f) => void handleFile("logoBase64", f, MAX_LOGO_BYTES)}
          onRemove={
            branding.logoBase64 ? () => onBranding({ ...branding, logoBase64: null }) : null
          }
        />
        <AssetTile
          title="Cover page"
          hint="Full first page · under 1 MB"
          preview={dataUrl(branding.coverBase64, "image/jpeg")}
          accept="image/jpeg,image/png"
          tall
          onPick={(f) => void handleFile("coverBase64", f, MAX_COVER_BYTES)}
          onRemove={
            branding.coverBase64 ? () => onBranding({ ...branding, coverBase64: null }) : null
          }
        />
        <AssetTile
          title="Signature / stamp"
          hint="Closing block with engineer and date"
          preview={dataUrl(branding.signatureBase64, "image/png")}
          accept="image/png,image/jpeg"
          onPick={(f) => void handleFile("signatureBase64", f, MAX_LOGO_BYTES)}
          onRemove={
            branding.signatureBase64
              ? () => onBranding({ ...branding, signatureBase64: null })
              : null
          }
        />
      </div>
      <div className="grid gap-3 rounded-md border bg-muted/40 p-3 md:grid-cols-[auto_1fr] md:items-start">
        <Field label="Signature style">
          <Segmented
            ariaLabel="Signature style"
            value={sigLayout}
            onChange={(v) => onOptions({ ...options, signatureLayout: v })}
            options={[
              { value: "en", label: "English", title: "Approval + Engineer / Date" },
              { value: "fa", label: "فارسی", title: "با سپاس + نام / سمت" },
            ]}
          />
        </Field>
        {sigLayout === "fa" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name (نام)" htmlFor="sig-name">
              <Input
                id="sig-name"
                value={options.signatureName ?? ""}
                placeholder="محسن مردانه"
                onChange={(e) => onOptions({ ...options, signatureName: e.target.value })}
              />
            </Field>
            <Field label="Role (سمت)" htmlFor="sig-role">
              <Input
                id="sig-role"
                value={options.signatureRole ?? ""}
                placeholder="سرپرست کارگاه"
                onChange={(e) => onOptions({ ...options, signatureRole: e.target.value })}
              />
            </Field>
          </div>
        ) : (
          <p className="self-center text-xs text-muted-foreground">
            Prints an “Approval” block with the engineer name and report date.
          </p>
        )}
      </div>
    </Panel>
  );
}

function AssetTile({
  title,
  hint,
  preview,
  accept,
  tall,
  onPick,
  onRemove,
}: {
  title: string;
  hint: string;
  preview: string | null;
  accept: string;
  tall?: boolean;
  onPick: (f: File) => void;
  onRemove: (() => void) | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="grid content-start gap-2 rounded-lg border p-2">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex cursor-default items-center justify-center overflow-hidden rounded-md border border-dashed border-input hover:border-primary",
          preview ? "bg-white" : "bg-muted/50",
          tall ? "h-32" : "h-24"
        )}
        aria-label={`${preview ? "Replace" : "Upload"} ${title.toLowerCase()}`}
      >
        {preview ? (
          <img src={preview} alt={`${title} preview`} className="h-full w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <ImagePlus className="h-5 w-5" aria-hidden="true" />
            Click to upload
          </span>
        )}
      </button>
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {onRemove ? (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
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
