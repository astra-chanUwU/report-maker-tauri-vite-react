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

const BRANDING_KEY = "report-maker:branding:v1";

export interface Branding {
  /** PNG bytes as base64 (no data: prefix). Null when no logo. */
  logoBase64: string | null;
}

export function loadBranding(): Branding {
  try {
    const raw = localStorage.getItem(BRANDING_KEY);
    if (!raw) return { logoBase64: null };
    const o = JSON.parse(raw) as Partial<Branding>;
    return { logoBase64: typeof o.logoBase64 === "string" ? o.logoBase64 : null };
  } catch {
    return { logoBase64: null };
  }
}

export function saveBranding(b: Branding): void {
  try {
    localStorage.setItem(BRANDING_KEY, JSON.stringify(b));
  } catch {
    // quota — keep in-memory only
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

const MDB_TOOL_KEY = "report-maker:mdb-tool:v1";

/** In-memory fallback when localStorage is unavailable (Node tests, SSR). */
const memStore = new Map<string, string>();

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return memStore.get(key) ?? null;
    return localStorage.getItem(key);
  } catch {
    return memStore.get(key) ?? null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") memStore.set(key, value);
    else localStorage.setItem(key, value);
  } catch {
    memStore.set(key, value);
  }
}

/** Explicit mdb-export binary path override ("" = auto: settings → env → PATH). */
export function loadMdbToolPath(): string {
  return lsGet(MDB_TOOL_KEY) ?? "";
}

export function saveMdbToolPath(p: string): void {
  lsSet(MDB_TOOL_KEY, p);
}

const AI_KEY = "report-maker:ai:v1";

export interface AiSettings {
  apiKey: string;
  model: string;
}

export function defaultAiSettings(): AiSettings {
  return { apiKey: "", model: "gpt-4o-mini" };
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (!raw) return defaultAiSettings();
    const o = JSON.parse(raw) as Partial<AiSettings>;
    return {
      apiKey: typeof o.apiKey === "string" ? o.apiKey : "",
      model: typeof o.model === "string" && o.model ? o.model : "gpt-4o-mini",
    };
  } catch {
    return defaultAiSettings();
  }
}

export function saveAiSettings(s: AiSettings): void {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify(s));
  } catch {
    // ignore — key stays in-memory only
  }
}
