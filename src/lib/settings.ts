import type { ReportOptions } from "./parseSp3";
import { DEFAULT_ZONE_LIMITS, toLimit, type ZoneLimitSet } from "./zones";

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
    includeIsoTable: true,
    isoGroups: "all",
    isoPosition: "end",
    useCustomIso: false,
    secondaryMetric: "acceleration",
    showSecondary: true,
    trendZoneBands: true,
    trendPages: false,
    equipmentName: "",
    equipmentSpecs: "",
    schematicBase64: null,
    equipmentStatus: "",
    equipmentLastReport: "",
    equipmentProblems: "",
    equipmentCorrective: "",
    includeToc: true,
    exportAllPoints: true,
    fftAllPoints: true,
    trendAllPoints: true,
    trendMetrics: ["rmsV", "rmsA"],
    language: "en",
    jalaliDate: "",
    letterNo: "",
    clientName: "",
    clientUnit: "",
    addressBlock: "",
    signatureLayout: "en",
    signatureName: "",
    signatureRole: "",
  };
}

export function loadReportOptions(): ReportOptions {
  const base = defaultReportOptions();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const o = JSON.parse(raw) as Partial<ReportOptions>;
    const str = (v: unknown, fb = ""): string => (typeof v === "string" ? v : fb);
    const bool = (v: unknown, fb: boolean): boolean => (typeof v === "boolean" ? v : fb);
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
      includeIsoTable: typeof o.includeIsoTable === "boolean" ? o.includeIsoTable : true,
      isoGroups: o.isoGroups === "1+3" || o.isoGroups === "2+4" ? o.isoGroups : "all",
      isoPosition: o.isoPosition === "off" || o.isoPosition === "afterToc" ? o.isoPosition : "end",
      useCustomIso: bool(o.useCustomIso, false),
      secondaryMetric:
        o.secondaryMetric === "bc" || o.secondaryMetric === "envelope"
          ? o.secondaryMetric
          : "acceleration",
      showSecondary: bool(o.showSecondary, true),
      trendZoneBands: bool(o.trendZoneBands, true),
      trendPages: bool(o.trendPages, false),
      equipmentName: typeof o.equipmentName === "string" ? o.equipmentName : "",
      equipmentSpecs: typeof o.equipmentSpecs === "string" ? o.equipmentSpecs : "",
      schematicBase64: typeof o.schematicBase64 === "string" ? o.schematicBase64 : null,
      equipmentStatus: str(o.equipmentStatus),
      equipmentLastReport: str(o.equipmentLastReport),
      equipmentProblems: str(o.equipmentProblems),
      equipmentCorrective: str(o.equipmentCorrective),
      includeToc: bool(o.includeToc, true),
      exportAllPoints: bool(o.exportAllPoints, true),
      fftAllPoints: bool(o.fftAllPoints, true),
      trendAllPoints: bool(o.trendAllPoints, true),
      trendMetrics: Array.isArray(o.trendMetrics) ? (o.trendMetrics as string[]) : ["rmsV", "rmsA"],
      language: o.language === "fa" ? "fa" : "en",
      jalaliDate: str(o.jalaliDate),
      letterNo: str(o.letterNo),
      clientName: str(o.clientName),
      clientUnit: str(o.clientUnit),
      addressBlock: str(o.addressBlock),
      signatureLayout: o.signatureLayout === "fa" ? "fa" : "en",
      signatureName: str(o.signatureName),
      signatureRole: str(o.signatureRole),
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
  /** User-supplied PNG bytes as base64 (no data: prefix). Null when no logo. */
  logoBase64: string | null;
  /** User-supplied cover image (JPEG/PNG base64, no prefix). Null = no cover page. */
  coverBase64: string | null;
  /** User-supplied signature stamp (PNG base64, no prefix). Null = no signature block. */
  signatureBase64: string | null;
}

export function defaultBranding(): Branding {
  return { logoBase64: null, coverBase64: null, signatureBase64: null };
}

export function loadBranding(): Branding {
  try {
    const raw = lsGet(BRANDING_KEY);
    if (!raw) return defaultBranding();
    const o = JSON.parse(raw) as Partial<Branding>;
    return {
      logoBase64: typeof o.logoBase64 === "string" ? o.logoBase64 : null,
      coverBase64: typeof o.coverBase64 === "string" ? o.coverBase64 : null,
      signatureBase64: typeof o.signatureBase64 === "string" ? o.signatureBase64 : null,
    };
  } catch {
    return defaultBranding();
  }
}

export function saveBranding(b: Branding): void {
  try {
    lsSet(BRANDING_KEY, JSON.stringify(b));
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

const ZONE_KEY = "report-maker:zones:v1";

function toZoneLimits(o: unknown): ZoneLimitSet {
  const get = (
    group: unknown,
    fb: { bottom: number | null; mid: number | null; top: number | null }
  ) => {
    const g = (group ?? {}) as { bottom?: unknown; mid?: unknown; top?: unknown };
    const b = toLimit(g.bottom);
    const m = toLimit(g.mid);
    const t = toLimit(g.top);
    return {
      bottom: b ?? fb.bottom,
      mid: m ?? fb.mid,
      top: t ?? fb.top,
    };
  };
  const src = (o ?? {}) as {
    velocity?: unknown;
    acceleration?: unknown;
    envelope?: unknown;
  };
  return {
    velocity: get(src.velocity, DEFAULT_ZONE_LIMITS.velocity),
    acceleration: get(src.acceleration, DEFAULT_ZONE_LIMITS.acceleration),
    envelope: get(src.envelope, DEFAULT_ZONE_LIMITS.envelope),
  };
}

/** Alarm zone thresholds (B/U/C per metric). Null = unset → falls back to default. */
export function loadZoneLimits(): ZoneLimitSet {
  try {
    const raw = lsGet(ZONE_KEY);
    if (!raw) return structuredClone(DEFAULT_ZONE_LIMITS);
    return toZoneLimits(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_ZONE_LIMITS);
  }
}

export function saveZoneLimits(s: ZoneLimitSet): void {
  try {
    lsSet(ZONE_KEY, JSON.stringify(s));
  } catch {
    // ignore — keeps working in-memory
  }
}
