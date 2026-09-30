import { useRef, useState } from "react";
import {
  Building2,
  FileText,
  ImagePlus,
  ListChecks,
  RotateCcw,
  Trash2,
  Wrench,
} from "lucide-react";
import type { ReportOptions } from "../lib/parseSp3";
import { EQUIPMENT_STATUSES } from "../lib/equipment";
import { cn } from "../lib/utils";
import { DEFAULT_ADDRESS_BLOCK_EN, DEFAULT_ADDRESS_BLOCK_FA, isoToJalaliFa } from "../lib/fa";
import {
  base64ToBytes,
  bytesToBase64,
  clearReportOptions,
  defaultReportOptions,
  todayISO,
  validateReportOptions,
} from "../lib/settings";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { CheckRow, Field, FieldGroupTitle, Segmented, Select } from "./ui/form";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

const MAX_SCHEMATIC_BYTES = 1024 * 1024;

export function imageDataUrl(b64: string | null | undefined): string | null {
  if (!b64) return null;
  const bin = atob(b64.slice(0, 24));
  if (bin.startsWith("\xFF\xD8\xFF")) return `data:image/jpeg;base64,${b64}`;
  return `data:image/png;base64,${b64}`;
}

/** Report language also drives the UI language; Farsi derives the Jalali date. */
export function languagePatch(options: ReportOptions, lang: "en" | "fa"): Partial<ReportOptions> {
  return { language: lang, jalaliDate: lang === "fa" ? isoToJalaliFa(options.reportDate) : "" };
}

type FormProps = {
  options: ReportOptions;
  onChange: (next: ReportOptions) => void;
};

export function ProjectDetailsCard({
  options,
  onChange,
  showErrors,
}: FormProps & { showErrors?: boolean }) {
  const { t } = useUi();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errors = validateReportOptions(options);
  const set = (patch: Partial<ReportOptions>) => onChange({ ...options, ...patch });
  const err = (k: keyof typeof errors) => ((showErrors || touched[k]) && errors[k]) || undefined;
  const blur = (k: string) => () => setTouched((s) => ({ ...s, [k]: true }));
  const lang = options.language === "fa" ? "fa" : "en";

  return (
    <Panel
      icon={<FileText />}
      title={t("project")}
      description={t("reportDetailsHint")}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            title={t("resetHint")}
            onClick={() => {
              setTouched({});
              onChange({ ...defaultReportOptions(), reportDate: todayISO() });
            }}
          >
            <RotateCcw aria-hidden="true" />
            {t("reset")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title={t("clearHint")}
            onClick={() => {
              clearReportOptions();
              setTouched({});
              onChange(defaultReportOptions());
            }}
          >
            <Trash2 aria-hidden="true" />
            {t("clear")}
          </Button>
        </>
      }
      contentClassName="grid gap-4"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field
          label={t("projectName").replace(" *", "")}
          htmlFor="opt-project"
          required
          error={err("projectName")}
          className="md:col-span-2 xl:col-span-1"
        >
          <Input
            id="opt-project"
            value={options.projectName}
            placeholder="e.g. Site survey 04"
            onChange={(e) => set({ projectName: e.target.value })}
            onBlur={blur("projectName")}
            aria-required="true"
            aria-invalid={!!err("projectName")}
            aria-describedby={err("projectName") ? "opt-project-error" : undefined}
          />
        </Field>
        <Field
          label={t("engineer").replace(" *", "")}
          htmlFor="opt-engineer"
          required
          error={err("engineer")}
        >
          <Input
            id="opt-engineer"
            value={options.engineer}
            placeholder="e.g. A. Chan"
            onChange={(e) => set({ engineer: e.target.value })}
            onBlur={blur("engineer")}
            aria-required="true"
            aria-invalid={!!err("engineer")}
            aria-describedby={err("engineer") ? "opt-engineer-error" : undefined}
          />
        </Field>
        <Field
          label={t("reportDate")}
          htmlFor="opt-date"
          required
          error={err("reportDate")}
          hint={
            lang === "fa"
              ? `جلالی: ${options.jalaliDate || isoToJalaliFa(options.reportDate) || "—"}`
              : undefined
          }
        >
          <Input
            id="opt-date"
            type="date"
            value={options.reportDate}
            onChange={(e) =>
              set({
                reportDate: e.target.value,
                ...(lang === "fa" ? { jalaliDate: isoToJalaliFa(e.target.value) } : {}),
              })
            }
            onBlur={blur("reportDate")}
            aria-required="true"
            aria-invalid={!!err("reportDate")}
          />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label={t("letterNo")} htmlFor="opt-letter">
          <Input
            id="opt-letter"
            value={options.letterNo ?? ""}
            placeholder="405"
            onChange={(e) => set({ letterNo: e.target.value })}
          />
        </Field>
        <Field label={t("normalization")} htmlFor="opt-norm">
          <Input
            id="opt-norm"
            value={options.norm}
            placeholder="Default"
            onChange={(e) => set({ norm: e.target.value })}
          />
        </Field>
        <Field label={t("units")}>
          <Segmented
            ariaLabel={t("units")}
            value={options.units === "Metric" ? "Metric" : "SI"}
            onChange={(u) => set({ units: u })}
            options={[
              { value: "SI", label: "SI" },
              { value: "Metric", label: "Metric" },
            ]}
          />
        </Field>
        <Field label={t("language")} hint={t("languageHint")}>
          <Segmented
            ariaLabel={t("language")}
            value={lang}
            onChange={(l) => set(languagePatch(options, l))}
            options={[
              { value: "en", label: "English" },
              { value: "fa", label: "فارسی" },
            ]}
          />
        </Field>
      </div>
      <Field label={t("notes")} htmlFor="opt-notes">
        <Textarea
          id="opt-notes"
          rows={3}
          value={options.notes}
          placeholder={t("notesPlaceholder")}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
    </Panel>
  );
}

export function ClientDetailsCard({ options, onChange }: FormProps) {
  const { t } = useUi();
  const set = (patch: Partial<ReportOptions>) => onChange({ ...options, ...patch });
  return (
    <Panel
      icon={<Building2 />}
      title={t("clientLetterhead")}
      description={t("letterheadDesc")}
      contentClassName="grid gap-3"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("client")} htmlFor="opt-client">
          <Input
            id="opt-client"
            value={options.clientName ?? ""}
            placeholder={t("clientNamePlaceholder")}
            onChange={(e) => set({ clientName: e.target.value })}
          />
        </Field>
        <Field label={t("clientUnit")} htmlFor="opt-unit">
          <Input
            id="opt-unit"
            value={options.clientUnit ?? ""}
            placeholder={t("clientUnitPlaceholder")}
            onChange={(e) => set({ clientUnit: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t("address")} htmlFor="opt-addr">
        <Textarea
          id="opt-addr"
          rows={2}
          value={options.addressBlock ?? ""}
          placeholder={t("addressPlaceholder")}
          onChange={(e) => set({ addressBlock: e.target.value })}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Insert default address:</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => set({ addressBlock: DEFAULT_ADDRESS_BLOCK_EN })}
        >
          English
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            set({ addressBlock: DEFAULT_ADDRESS_BLOCK_FA, ...languagePatch(options, "fa") })
          }
          title="Also switches the report to Farsi"
        >
          فارسی
        </Button>
      </div>
    </Panel>
  );
}

export function ReportContentsCard({ options, onChange }: FormProps) {
  const { t } = useUi();
  const set = (patch: Partial<ReportOptions>) => onChange({ ...options, ...patch });
  const metrics = options.trendMetrics ?? ["rmsV", "rmsA"];
  return (
    <Panel
      icon={<ListChecks />}
      title={t("reportContents")}
      description="Choose which optional sections are generated."
      contentClassName="grid gap-4 md:grid-cols-2"
    >
      <div className="grid content-start gap-1">
        <FieldGroupTitle className="px-2 pb-1">Sections</FieldGroupTitle>
        <CheckRow
          checked={options.includeToc !== false}
          onChange={(v) => set({ includeToc: v })}
          label="Table of contents"
          description="Added when the report covers several machines."
        />
        <CheckRow
          checked={options.fftAllPoints !== false}
          onChange={(v) => set({ fftAllPoints: v })}
          label="FFT gallery for all points"
          description="Latest spectrum of every point, up to 24 per machine."
        />
        <CheckRow
          checked={options.trendAllPoints !== false}
          onChange={(v) => set({ trendAllPoints: v })}
          label={t("trendAll")}
        />
        <CheckRow
          checked={options.includeIsoTable !== false}
          onChange={(v) => set({ includeIsoTable: v })}
          label="ISO 10816-3 severity table"
          description="Appended as a reference at the end."
        />
        <div className="pe-2 ps-8 pt-1">
          <Field label={t("isoGroups")} htmlFor="opt-iso-groups">
            <Select
              id="opt-iso-groups"
              className="max-w-56"
              disabled={options.includeIsoTable === false}
              value={options.isoGroups ?? "all"}
              onChange={(e) => set({ isoGroups: e.target.value as ReportOptions["isoGroups"] })}
            >
              <option value="all">{t("groupsAll")}</option>
              <option value="1+3">{t("groups13")}</option>
              <option value="2+4">{t("groups24")}</option>
            </Select>
          </Field>
        </div>
      </div>
      <div className="grid content-start gap-1">
        <FieldGroupTitle className="px-2 pb-1">Trend metrics</FieldGroupTitle>
        {(["rmsV", "rmsA", "envelope"] as const).map((m) => (
          <CheckRow
            key={m}
            checked={metrics.includes(m)}
            onChange={(on) => {
              const cur = new Set(metrics);
              if (on) cur.add(m);
              else cur.delete(m);
              set({ trendMetrics: [...cur] });
            }}
            label={m === "rmsV" ? t("velocity") : m === "rmsA" ? t("acceleration") : t("envelope")}
            description={m === "envelope" ? "Only when the file has envelope data." : undefined}
          />
        ))}
      </div>
    </Panel>
  );
}

/** Schematic image picker with preview; used by single and multi-equipment editors. */
export function SchematicField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (b64: string | null) => void;
}) {
  const { t } = useUi();
  const ref = useRef<HTMLInputElement>(null);
  const url = imageDataUrl(value);

  const handle = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("schematicType"));
      return;
    }
    if (file.size > MAX_SCHEMATIC_BYTES) {
      toast.error(`Schematic must be under ${Math.round(MAX_SCHEMATIC_BYTES / 1024)} KB.`);
      return;
    }
    const b64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    base64ToBytes(b64); // validate round-trip before persisting
    onChange(b64);
    toast.success(t("schematicSaved"));
  };

  return (
    <Field label={t("schematic")} htmlFor={id}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={cn(
            "flex h-24 w-40 shrink-0 cursor-default items-center justify-center overflow-hidden rounded-md border border-dashed border-input hover:border-primary",
            url ? "bg-white" : "bg-muted/50"
          )}
          aria-label={url ? "Replace schematic" : "Upload schematic"}
        >
          {url ? (
            <img
              src={url}
              alt="Machine schematic preview"
              className="h-full w-full object-contain"
            />
          ) : (
            <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          )}
        </button>
        <div className="grid gap-1.5">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
              {url ? "Replace" : "Upload"}
            </Button>
            {url ? (
              <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
                {t("remove")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">PNG or JPEG, under 1 MB.</p>
        </div>
        <input
          ref={ref}
          id={id}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            void handle(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
    </Field>
  );
}

export function SingleEquipmentCard({ options, onChange }: FormProps) {
  const { t } = useUi();
  const set = (patch: Partial<ReportOptions>) => onChange({ ...options, ...patch });
  return (
    <Panel
      icon={<Wrench />}
      title={t("singleEquipment")}
      description={t("singleEquipmentHint")}
      contentClassName="grid gap-4"
    >
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <Field label={t("equipment")} htmlFor="opt-equipment">
          <Input
            id="opt-equipment"
            value={options.equipmentName ?? ""}
            placeholder="e.g. Conveyor System CH — CVM-F11"
            onChange={(e) => set({ equipmentName: e.target.value })}
          />
        </Field>
        <Field label={t("status")} htmlFor="opt-status">
          <Select
            id="opt-status"
            value={options.equipmentStatus ?? ""}
            onChange={(e) => set({ equipmentStatus: e.target.value })}
          >
            <option value="">—</option>
            {EQUIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={t("specs")} htmlFor="opt-specs">
          <Textarea
            id="opt-specs"
            rows={4}
            value={options.equipmentSpecs ?? ""}
            placeholder="Drive power, RPM, bearing types, coupling…"
            onChange={(e) => set({ equipmentSpecs: e.target.value })}
          />
        </Field>
        <SchematicField
          id="opt-schematic"
          value={options.schematicBase64}
          onChange={(b64) => set({ schematicBase64: b64 })}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Field
          label={t("lastReport")}
          htmlFor="opt-lastreport"
          hint="Left blank, the last report in History is used."
        >
          <Textarea
            id="opt-lastreport"
            rows={3}
            value={options.equipmentLastReport ?? ""}
            placeholder="Previous status + actions taken…"
            onChange={(e) => set({ equipmentLastReport: e.target.value })}
          />
        </Field>
        <Field
          label={t("problems")}
          htmlFor="opt-problems"
          hint="Left blank, Findings → Observations is used."
        >
          <Textarea
            id="opt-problems"
            rows={3}
            value={options.equipmentProblems ?? ""}
            placeholder="Diagnosis…"
            onChange={(e) => set({ equipmentProblems: e.target.value })}
          />
        </Field>
        <Field
          label={t("actions")}
          htmlFor="opt-corrective"
          hint="Left blank, Findings → Recommendations is used."
        >
          <Textarea
            id="opt-corrective"
            rows={3}
            value={options.equipmentCorrective ?? ""}
            placeholder="What to do next…"
            onChange={(e) => set({ equipmentCorrective: e.target.value })}
          />
        </Field>
      </div>
    </Panel>
  );
}
