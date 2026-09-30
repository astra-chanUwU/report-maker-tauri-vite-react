import { useState } from "react";
import type { ReportOptions } from "../lib/parseSp3";
import {
  base64ToBytes,
  bytesToBase64,
  clearReportOptions,
  defaultReportOptions,
  todayISO,
  validateReportOptions,
} from "../lib/settings";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/sonner";

const MAX_SCHEMATIC_BYTES = 1024 * 1024;

function schematicUrl(b64: string | null | undefined): string | null {
  if (!b64) return null;
  const bin = atob(b64.slice(0, 24));
  if (bin.startsWith("\xFF\xD8\xFF")) return `data:image/jpeg;base64,${b64}`;
  if (bin.startsWith("\x89PNG")) return `data:image/png;base64,${b64}`;
  return `data:image/png;base64,${b64}`;
}

export function ReportForm({
  options,
  onChange,
}: {
  options: ReportOptions;
  onChange: (next: ReportOptions) => void;
}) {
  const [touched, setTouched] = useState(false);
  const errors = validateReportOptions(options);
  const invalid = Object.keys(errors).length > 0;

  const set = (patch: Partial<ReportOptions>) => {
    setTouched(true);
    onChange({ ...options, ...patch });
  };

  const handleSchematic = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Upload a PNG or JPEG schematic.");
      return;
    }
    if (file.size > MAX_SCHEMATIC_BYTES) {
      toast.error(`Schematic must be under ${Math.round(MAX_SCHEMATIC_BYTES / 1024)} KB.`);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const b64 = bytesToBase64(bytes);
    base64ToBytes(b64); // validate round-trip before persisting
    set({ schematicBase64: b64 });
    toast.success("Schematic saved locally.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report details</CardTitle>
        <CardDescription>
          Defaults persist across reloads (localStorage; Tauri store in S08).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="opt-project">Project name *</Label>
          <Input
            id="opt-project"
            value={options.projectName}
            placeholder="e.g. Site survey 04"
            onChange={(e) => set({ projectName: e.target.value })}
            aria-required="true"
            aria-invalid={!!errors.projectName}
            aria-describedby={errors.projectName ? "err-project" : undefined}
          />
          {touched && errors.projectName ? (
            <p id="err-project" className="text-xs text-destructive" role="alert">
              {errors.projectName}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="opt-engineer">Engineer *</Label>
            <Input
              id="opt-engineer"
              value={options.engineer}
              placeholder="e.g. A. Chan"
              onChange={(e) => set({ engineer: e.target.value })}
              aria-required="true"
              aria-invalid={!!errors.engineer}
              aria-describedby={errors.engineer ? "err-engineer" : undefined}
            />
            {touched && errors.engineer ? (
              <p id="err-engineer" className="text-xs text-destructive" role="alert">
                {errors.engineer}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="opt-date">Report date *</Label>
            <Input
              id="opt-date"
              type="date"
              value={options.reportDate}
              onChange={(e) => set({ reportDate: e.target.value })}
              aria-required="true"
              aria-invalid={!!errors.reportDate}
              aria-describedby={errors.reportDate ? "err-date" : undefined}
            />
            {touched && errors.reportDate ? (
              <p id="err-date" className="text-xs text-destructive" role="alert">
                {errors.reportDate}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Units</Label>
            <div className="flex gap-2" role="group" aria-label="Units">
              {["SI", "Metric"].map((u) => (
                <Button
                  key={u}
                  type="button"
                  aria-pressed={options.units === u}
                  variant={options.units === u ? "default" : "outline"}
                  size="sm"
                  onClick={() => set({ units: u })}
                  className={cn(options.units === u && "pointer-events-none")}
                >
                  {u}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="opt-norm">Normalization</Label>
            <Input
              id="opt-norm"
              value={options.norm}
              placeholder="Default"
              onChange={(e) => set({ norm: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="opt-notes">Notes</Label>
          <Textarea
            id="opt-notes"
            value={options.notes}
            placeholder="Survey conditions, equipment, caveats…"
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="opt-equipment">Equipment name</Label>
          <Input
            id="opt-equipment"
            value={options.equipmentName ?? ""}
            placeholder="e.g. Conveyor System CH — CVM-F11"
            onChange={(e) => set({ equipmentName: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="opt-specs">Technical specs</Label>
          <Textarea
            id="opt-specs"
            value={options.equipmentSpecs ?? ""}
            placeholder="Drive power, RPM, bearing types, coupling…"
            onChange={(e) => set({ equipmentSpecs: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="opt-schematic">Machine schematic</Label>
          {schematicUrl(options.schematicBase64) ? (
            <div className="flex items-start gap-2">
              <img
                src={schematicUrl(options.schematicBase64)!}
                alt="Machine schematic preview"
                className="h-24 max-w-60 rounded border bg-white"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ schematicBase64: null })}
              >
                Remove
              </Button>
            </div>
          ) : (
            <Input
              id="opt-schematic"
              type="file"
              accept="image/png,image/jpeg,image/*"
              onChange={(e) => void handleSchematic(e.target.files?.[0] ?? null)}
            />
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={options.includeIsoTable !== false}
            onChange={(e) => set({ includeIsoTable: e.target.checked })}
            className="h-4 w-4 accent-green-700"
          />
          Append ISO 10816-3 severity table
        </label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setTouched(false);
              onChange({ ...defaultReportOptions(), reportDate: todayISO() });
            }}
          >
            Reset to defaults
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              clearReportOptions();
              setTouched(false);
              onChange(defaultReportOptions());
            }}
          >
            Clear
          </Button>
          {invalid && touched ? (
            <p className="self-center text-xs text-muted-foreground">
              Fill required fields before export.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
