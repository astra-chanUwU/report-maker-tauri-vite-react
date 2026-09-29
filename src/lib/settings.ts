import type { ReportOptions } from "./parseSp3";

const KEY = "report-maker:report-options:v1";

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function defaultReportOptions(): ReportOptions {
  return {
    projectName: "",
    engineer: "",
    reportDate: todayISO(),
    units: "SI",
    norm: "Default",
    notes: "",
    pointLimit: 120,
  };
}

export function loadReportOptions(): ReportOptions {
  const base = defaultReportOptions();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const o = JSON.parse(raw) as Partial<ReportOptions>;
    return {
      projectName: typeof o.projectName === "string" ? o.projectName : "",
      engineer: typeof o.engineer === "string" ? o.engineer : "",
      reportDate:
        typeof o.reportDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.reportDate)
          ? o.reportDate
          : base.reportDate,
      units: typeof o.units === "string" && o.units ? o.units : "SI",
      norm: typeof o.norm === "string" ? o.norm : "Default",
      notes: typeof o.notes === "string" ? o.notes : "",
      pointLimit: typeof o.pointLimit === "number" && o.pointLimit > 0 ? o.pointLimit : 120,
      templateId: typeof o.templateId === "string" ? o.templateId : undefined,
    };
  } catch {
    return base;
  }
}

export function saveReportOptions(options: ReportOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // storage full / private mode — form still works in-memory
  }
}

export function clearReportOptions(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export interface FormErrors {
  projectName?: string;
  engineer?: string;
  reportDate?: string;
}

export function validateReportOptions(o: ReportOptions): FormErrors {
  const errors: FormErrors = {};
  if (!o.projectName.trim()) errors.projectName = "Project name is required.";
  if (!o.engineer.trim()) errors.engineer = "Engineer is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.reportDate)) errors.reportDate = "Use ISO date yyyy-mm-dd.";
  return errors;
}
