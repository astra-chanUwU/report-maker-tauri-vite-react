export const APP_VERSION = "0.1.0";
const KEY = "report-maker:license:v1";
const GRACE_MS = 30 * 24 * 3600 * 1000;

export interface LeaseFeatures {
  core_export: boolean;
  hosted_ai: boolean;
}

export interface SignedLease {
  lease_version: number;
  key_id: string;
  license_id: string;
  activation_id: string;
  device_public_key: string;
  plan: string;
  features: LeaseFeatures & Record<string, boolean>;
  issued_at: string;
  offline_until: string;
}

export interface LicenseRecord {
  key: string;
  valid: boolean;
  reason: string;
  validatedAt: string | null;
  dev: boolean;
  activationId?: string | null;
  lease?: SignedLease | null;
  signature?: string | null;
  leaseEncoded?: string | null;
  devicePublicKey?: string | null;
  checkedAt?: string;
}

export interface VerifiedLease {
  activation_id: string;
  lease: SignedLease;
  signature: string;
  device_public_key: string;
  lease_encoded: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function charValue(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  return code - 55; // A=10
}

/** Development-only mirror of the old checksum validator. */
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
  return { valid: true, reason: "Valid development checksum key.", normalized: k };
}

export function isDev(): boolean {
  return !isTauriRuntime() && typeof location !== "undefined" && location.hostname === "localhost";
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function fromRustStatus(status: {
  valid: boolean;
  key?: string;
  reason: string;
  activation_id?: string | null;
  lease?: SignedLease | null;
  signature?: string | null;
  lease_encoded?: string | null;
  device_public_key?: string | null;
  checked_at?: string;
  dev?: boolean;
}): LicenseRecord {
  return {
    key: status.key ?? "",
    valid: status.valid,
    reason: status.reason,
    validatedAt: status.valid ? status.checked_at ?? new Date().toISOString() : null,
    dev: status.dev ?? false,
    activationId: status.activation_id,
    lease: status.lease,
    signature: status.signature,
    devicePublicKey: status.device_public_key,
    leaseEncoded: status.lease_encoded,
    checkedAt: status.checked_at,
  };
}

/** Activate through Rust in production; checksum remains available only in localhost web dev. */
export async function validateLicense(key: string): Promise<LicenseRecord> {
  const trimmed = key.trim();
  if (!trimmed)
    return { key: "", valid: false, reason: "No key entered.", validatedAt: null, dev: isDev() };
  if (isTauriRuntime()) {
    try {
      const res = await tauriInvoke<Parameters<typeof fromRustStatus>[0]>("activate_license", {
        licenseKey: trimmed,
      });
      const rec = fromRustStatus(res);
      saveLicense(rec);
      return rec;
    } catch (error) {
      return {
        key: trimmed,
        valid: false,
        reason: error instanceof Error ? error.message : String(error),
        validatedAt: null,
        dev: false,
      };
    }
  }
  if (!isDev()) {
    return {
      key: trimmed,
      valid: false,
      reason: "Activation requires the signed desktop app.",
      validatedAt: null,
      dev: false,
    };
  }
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

export async function licenseStatus(): Promise<LicenseRecord | null> {
  if (!isTauriRuntime()) return loadLicense();
  try {
    return fromRustStatus(await tauriInvoke("license_status"));
  } catch (error) {
    return {
      key: "",
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
      validatedAt: null,
      dev: false,
    };
  }
}

export async function refreshLicense(): Promise<LicenseRecord> {
  if (!isTauriRuntime()) return loadLicense() ?? { key: "", valid: false, reason: "No activated device.", validatedAt: null, dev: true };
  return fromRustStatus(await tauriInvoke("refresh_license"));
}

export async function deactivateLicense(): Promise<LicenseRecord | null> {
  if (!isTauriRuntime()) {
    clearLicense();
    return null;
  }
  const rec = fromRustStatus(await tauriInvoke("deactivate_license"));
  clearLicense();
  return rec;
}

export async function getVerifiedLease(): Promise<VerifiedLease | null> {
  const rec = await licenseStatus();
  if (!rec?.valid || !rec.activationId || !rec.lease || !rec.signature || !rec.devicePublicKey || !rec.leaseEncoded)
    return null;
  return {
    activation_id: rec.activationId,
    lease: rec.lease,
    signature: rec.signature,
    device_public_key: rec.devicePublicKey,
    lease_encoded: rec.leaseEncoded,
  };
}

export async function getControlPlaneUrl(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      return await tauriInvoke<string>("get_control_plane_url");
    } catch {
      // Fall through to the Vite override for local development.
    }
  }
  const configured = (import.meta.env.VITE_CONTROL_PLANE_URL as string | undefined) ?? "https://control.reportmaker.app";
  return configured.replace(/\/$/, "");
}

export async function getHostedRequestAuth(): Promise<{
  activationId: string;
  headers: Record<string, string>;
} | null> {
  const verified = await getVerifiedLease();
  if (!verified) return null;
  return {
    activationId: verified.activation_id,
    headers: {
      "X-Activation-Id": verified.activation_id,
      "X-Lease": verified.lease_encoded,
      "X-Lease-Signature": verified.signature,
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Sign a body proof with the device key held by Rust's OS keychain. */
export async function signHostedRequest(
  action: string,
  requestId: string,
  payload: unknown,
): Promise<string | null> {
  const verified = await getVerifiedLease();
  if (!verified || !isTauriRuntime()) return null;
  const payloadHash = await sha256Hex(canonicalJson(payload));
  return tauriInvoke<string>("sign_control_plane_request", {
    action,
    activationId: verified.activation_id,
    requestId,
    payloadHash,
  });
}

/** Fetch helper for hosted AI and other authenticated control-plane endpoints. */
export async function controlPlaneRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const auth = await getHostedRequestAuth();
  if (!auth) throw new Error("No valid signed license lease.");
  const base = await getControlPlaneUrl();
  const headers = new Headers(init.headers);
  Object.entries(auth.headers).forEach(([name, value]) => headers.set(name, value));
  return fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers });
}

export function loadLicense(): LicenseRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as LicenseRecord;
    // Only localhost web development uses this local fallback. Production
    // status is always re-verified by Rust against the signed lease.
    if (!isDev()) return null;
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
  // Tauri persists the signed lease and device identity through Rust/keychain;
  // never duplicate the license key or lease in webview localStorage.
  if (isTauriRuntime() || !isDev()) return;
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
