import { useState } from "react";
import type { ReportOptions } from "../lib/parseSp3";
import {
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
