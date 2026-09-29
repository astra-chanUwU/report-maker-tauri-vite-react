export const APP_VERSION = "0.1.0";
const KEY = "report-maker:license:v1";
const GRACE_MS = 30 * 24 * 3600 * 1000;

export interface LicenseRecord {
  key: string;
  valid: boolean;
  reason: string;
  validatedAt: string | null;
  dev: boolean;
}

function charValue(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  return code - 55; // A=10
}

/** TS mirror of the Rust checksum rule (docs/licensing.md). */
export function checkKeyFormat(key: string): {
  valid: boolean;
  reason: string;
  normalized: string;
} {
  const k = key.trim().toUpperCase();
  const parts = k.split("-");
  if (parts.length !== 4 || parts[0] !== "RM") {
    return { valid: false, reason: "Expected format RM-XXXX-XXXX-XXXX.", normalized: k };
  }
  const payload = parts.slice(1).join("");
  if (payload.length !== 12 || !/^[A-Z0-9]{12}$/.test(payload)) {
    return { valid: false, reason: "Payload must be 12 A-Z0-9 chars.", normalized: k };
  }
  const sum = [...payload].reduce((a, c) => a + charValue(c), 0);
  if (sum % 36 !== 0) return { valid: false, reason: "Checksum mismatch.", normalized: k };
  return { valid: true, reason: "Valid perpetual key (v1 checksum).", normalized: k };
}

export function isDev(): boolean {
  return (
    !("isTauri" in window && (window as unknown as { isTauri?: boolean }).isTauri) &&
    location.hostname === "localhost"
  );
}

export async function validateLicense(key: string): Promise<LicenseRecord> {
  const trimmed = key.trim();
  if (!trimmed)
    return { key: "", valid: false, reason: "No key entered.", validatedAt: null, dev: isDev() };
  // Prefer Rust validator inside Tauri, fall back to TS mirror on web
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<{ valid: boolean; key: string; reason: string }>("validate_license", {
      key: trimmed,
    });
    const rec: LicenseRecord = {
      key: res.key,
      valid: res.valid,
      reason: res.reason,
      validatedAt: res.valid ? new Date().toISOString() : null,
      dev: false,
    };
    saveLicense(rec);
    return rec;
  } catch {
    const r = checkKeyFormat(trimmed);
    const rec: LicenseRecord = {
      key: r.normalized,
      valid: r.valid,
      reason: r.reason,
      validatedAt: r.valid ? new Date().toISOString() : null,
      dev: isDev(),
    };
    saveLicense(rec);
    return rec;
  }
}

export function loadLicense(): LicenseRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as LicenseRecord;
    // Offline grace: previously-valid key stays valid 30 days
    if (rec.valid && rec.validatedAt) {
      const age = Date.now() - new Date(rec.validatedAt).getTime();
      if (age < GRACE_MS) return rec;
      return { ...rec, valid: false, reason: "Grace period expired — re-validate online." };
    }
    return rec;
  } catch {
    return null;
  }
}

export function saveLicense(rec: LicenseRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    // ignore
  }
}

export function clearLicense(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export async function checkForUpdates(): Promise<{
  current: string;
  latest: string | null;
  url: string | null;
  error?: string;
}> {
  const api =
    "https://api.github.com/repos/astra-chanUwU/report-maker-tauri-vite-react/releases/latest";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(api, {
      signal: ctrl.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    clearTimeout(t);
    if (res.status === 404) return { current: APP_VERSION, latest: null, url: null };
    if (!res.ok)
      return { current: APP_VERSION, latest: null, url: null, error: `GitHub ${res.status}` };
    const json = (await res.json()) as { tag_name?: string; html_url?: string };
    return { current: APP_VERSION, latest: json.tag_name ?? null, url: json.html_url ?? null };
  } catch (e) {
    return {
      current: APP_VERSION,
      latest: null,
      url: null,
      error: e instanceof Error ? e.message : "Network failed",
    };
  }
}
