export type TelemetryEvent =
  "app_started" | "report_generated" | "report_failed" | "license_validated" | "app_crashed";

export interface TelemetrySettings {
  /** Default OFF. When off, zero network calls are made. */
  enabled: boolean;
}

const KEY = "report-maker:telemetry:v1";

export function loadTelemetry(): TelemetrySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { enabled: false };
    const o = JSON.parse(raw) as Partial<TelemetrySettings>;
    return { enabled: o.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function saveTelemetry(s: TelemetrySettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

let crashHooked = false;
const INSTALL_ID_KEY = "report-maker:install-id:v1";

function installId(): string {
  try {
    const current = localStorage.getItem(INSTALL_ID_KEY);
    if (current) return current;
    const next = globalThis.crypto?.randomUUID?.() ?? `install-${Date.now()}-${Math.random()}`;
    localStorage.setItem(INSTALL_ID_KEY, next);
    return next;
  } catch {
    return "ephemeral-install";
  }
}

/**
 * Anonymous event tracking. The control plane owns the PostHog project and
 * validates the event/property allowlist. When disabled, this returns before
 * any network or identifier access.
 */
export async function track(
  event: TelemetryEvent,
  props?: Record<string, string | number | boolean>
): Promise<void> {
  const s = loadTelemetry();
  if (!s.enabled) return;
  const safeProps = props ?? {};
  const counts: Record<string, number> = {};
  const timingsMs: Record<string, number> = {};
  for (const [key, value] of Object.entries(safeProps)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      if (key.endsWith("_ms")) timingsMs[key] = value;
      else counts[key] = value;
    } else if (typeof value === "boolean") {
      counts[key] = value ? 1 : 0;
    }
  }
  const platform = typeof navigator !== "undefined" ? navigator.platform || "unknown" : "unknown";
  try {
    const { getControlPlaneUrl } = await import("./license");
    const controlPlaneUrl = await getControlPlaneUrl();
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 8000);
    try {
      await fetch(`${controlPlaneUrl}/v1/telemetry/batch`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          events: [
            {
              event_name: event,
              app_version: "0.1.0",
              platform,
              anonymous_install_id: installId(),
              timings_ms: timingsMs,
              counts,
            },
          ],
        }),
      });
    } finally {
      window.clearTimeout(timeout);
    }
  } catch {
    // telemetry must never break the app
  }
}

export function initCrashHooks(): void {
  if (crashHooked || typeof window === "undefined") return;
  crashHooked = true;
  window.addEventListener("error", (e) => {
    void track("app_crashed", { error_type: e.error?.name ?? "Error" });
  });
  window.addEventListener("unhandledrejection", (e) => {
    void track("app_crashed", {
      error_type: e.reason instanceof Error ? e.reason.name : "UnhandledRejection",
    });
  });
}
