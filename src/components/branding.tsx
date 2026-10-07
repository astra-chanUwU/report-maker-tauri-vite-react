import { useRef, useState } from "react";
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
  const soft = `#${tpl.accentSoft}`;
  return (
    <div className="flex h-32 items-center justify-center rounded-md bg-muted/70 p-2">
      <div className="flex h-full w-[5rem] flex-col gap-1 overflow-hidden rounded-sm bg-white p-1.5 shadow-sm">
        {tpl.coverStyle === "modern" ? (
          <>
            <div className="-mx-1.5 -mt-1.5 mb-1 space-y-1 px-1.5 py-1.5" style={{ backgroundColor: accent }}>
              <div className="h-0.5 w-2/3 rounded-full bg-white/70" />
              <div className="h-1.5 w-full rounded-full bg-white" />
            </div>
            <div className="h-1 w-full rounded-full" style={{ backgroundColor: soft }} />
            <div className="h-1 w-3/4 rounded-full bg-neutral-200" />
          </>
        ) : tpl.coverStyle === "industrial" ? (
          <>
            <div className="-mx-1.5 -mt-1.5 h-2" style={{ backgroundColor: accent }} />
            <div className="mx-auto mt-1 h-1.5 w-3/4 rounded-full" style={{ backgroundColor: accent }} />
            <div className="h-1 w-full rounded-full" style={{ backgroundColor: soft }} />
            <div className="h-0.5 w-full rounded-full bg-neutral-200" />
            <div className="h-0.5 w-2/3 rounded-full bg-neutral-200" />
            <div className="-mx-1.5 mt-auto h-1.5" style={{ backgroundColor: accent }} />
          </>
        ) : tpl.coverStyle === "minimal" ? (
          <>
            <div className="mt-3 h-1 w-1/2 rounded-full bg-neutral-300" />
            <div className="h-2 w-full rounded-full" style={{ backgroundColor: accent }} />
            <div className="my-0.5 h-px w-full" style={{ backgroundColor: accent }} />
            <div className="h-0.5 w-full rounded-full bg-neutral-200" />
            <div className="h-0.5 w-2/3 rounded-full bg-neutral-200" />
          </>
        ) : (
          <>
            <div className="mx-auto mt-2 h-1.5 w-3/4 rounded-full" style={{ backgroundColor: accent }} />
            <div className="mx-auto h-1 w-1/2 rounded-full bg-neutral-300" />
            <div className="my-1 h-1.5 w-full rounded-sm" style={{ backgroundColor: accent }} />
            <div className="h-0.5 w-full rounded-full bg-neutral-200" />
            <div className="h-0.5 w-full rounded-full bg-neutral-200" />
            <div className="h-0.5 w-2/3 rounded-full bg-neutral-200" />
          </>
        )}
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
  const { t } = useUi();
  const selected = options.templateId ?? "classic";
  return (
    <Panel
      icon={<LayoutTemplate />}
      title={t("template")}
      description={t("templateDesc")}
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="radiogroup" aria-label="Template">
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
                "relative grid cursor-default gap-1.5 rounded border p-1.5 text-start transition-colors",
                active
                  ? "border-primary ring-2 ring-primary/20"
                  : "hover:border-muted-foreground/40"
              )}
            >
              {active ? (
                <span className="absolute end-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-2.5 w-2.5" aria-hidden="true" />
                </span>
              ) : null}
              <TemplateThumb tpl={tpl} />
              <span className="grid gap-0 px-1 pb-0.5">
                <span className="text-xs font-semibold">{tpl.name}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{tpl.description}</span>
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
      toast.error(t("toastImageTooLarge", { size: Math.round(maxBytes / 1024) }));
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
      description={t("brandingStorageHint")}
      contentClassName="grid gap-3"
    >
      <div className="grid gap-2.5 sm:grid-cols-3">
        <AssetTile
          title={t("assetLogo")}
          hint={t("assetLogoHint")}
          preview={dataUrl(branding.logoBase64, "image/png")}
          accept="image/png,image/jpeg"
          onPick={(f) => void handleFile("logoBase64", f, MAX_LOGO_BYTES)}
          onRemove={
            branding.logoBase64 ? () => onBranding({ ...branding, logoBase64: null }) : null
          }
        />
        <AssetTile
          title={t("assetCover")}
          hint={t("assetCoverHint")}
          preview={dataUrl(branding.coverBase64, "image/jpeg")}
          accept="image/jpeg,image/png"
          tall
          onPick={(f) => void handleFile("coverBase64", f, MAX_COVER_BYTES)}
          onRemove={
            branding.coverBase64 ? () => onBranding({ ...branding, coverBase64: null }) : null
          }
        />
        <AssetTile
          title={t("assetSignature")}
          hint={t("assetSignatureHint")}
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
      <div className="grid gap-2.5 rounded border bg-muted/40 p-2.5 md:grid-cols-[auto_1fr] md:items-start">
        <Field label={t("signatureStyle")}>
          <Segmented
            ariaLabel={t("signatureStyle")}
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
          <p className="self-center text-xs text-muted-foreground">{t("signatureStyleHintEn")}</p>
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
  const { t } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const isImageDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files") &&
    Array.from(e.dataTransfer.items ?? []).some(
      (it) => it.kind === "file" && (it.type.startsWith("image/") || !it.type)
    );
  const handleDragEnter = (e: React.DragEvent) => {
    if (!isImageDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!isImageDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPick(f);
  };
  return (
    <div
      data-branding-drop
      className="grid content-start gap-1.5 rounded border p-1.5"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex cursor-default items-center justify-center overflow-hidden rounded border border-dashed hover:border-primary",
          dragActive ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-input",
          preview && !dragActive ? "bg-white" : dragActive ? "bg-primary/5" : "bg-muted/50",
          tall ? "h-28" : "h-20"
        )}
        aria-label={`${preview ? "Replace" : "Upload"} ${title.toLowerCase()}`}
      >
        {preview ? (
          <img src={preview} alt={`${title} preview`} className="h-full w-full object-contain pointer-events-none" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground pointer-events-none">
            <ImagePlus className="h-5 w-5" aria-hidden="true" />
            {dragActive ? t("dropImageHere") : t("clickOrDropImage")}
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
            {t("remove")}
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
