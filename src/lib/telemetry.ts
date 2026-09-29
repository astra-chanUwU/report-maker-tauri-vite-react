export type TelemetryEvent =
  "app_started" | "report_generated" | "report_failed" | "license_validated" | "app_crashed";

export interface TelemetrySettings {
  /** Default OFF. When off, zero network calls are made. */
  enabled: boolean;
  posthogKey: string;
  posthogHost: string;
}

const KEY = "report-maker:telemetry:v1";

export function loadTelemetry(): TelemetrySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { enabled: false, posthogKey: "", posthogHost: "https://us.i.posthog.com" };
    const o = JSON.parse(raw) as Partial<TelemetrySettings>;
    return {
      enabled: o.enabled === true,
      posthogKey: typeof o.posthogKey === "string" ? o.posthogKey : "",
      posthogHost:
        typeof o.posthogHost === "string" && o.posthogHost
          ? o.posthogHost
          : "https://us.i.posthog.com",
    };
  } catch {
    return { enabled: false, posthogKey: "", posthogHost: "https://us.i.posthog.com" };
  }
}

export function saveTelemetry(s: TelemetrySettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

let posthogReady = false;
let crashHooked = false;

/**
 * Anonymous event tracking. No PII, no spectra contents — only counts/sizes.
 * When disabled: returns immediately (zero network). Without a PostHog key:
 * logs to console (mock) so the flow is verifiable in devtools.
 */
export async function track(
  event: TelemetryEvent,
  props?: Record<string, string | number | boolean>
): Promise<void> {
  const s = loadTelemetry();
  if (!s.enabled) return;
  const safe = { app_version: "0.1.0", ...(props ?? {}) };
  if (!s.posthogKey) {
    console.debug(`[telemetry mock] ${event}`, safe);
    return;
  }
  try {
    const { default: posthog } = await import("posthog-js");
    if (!posthogReady) {
      posthog.init(s.posthogKey, {
        api_host: s.posthogHost,
        autocapture: false,
        capture_pageview: false,
      });
      posthogReady = true;
    }
    posthog.capture(event, safe);
  } catch {
    // telemetry must never break the app
  }
}

export function initCrashHooks(): void {
  if (crashHooked || typeof window === "undefined") return;
  crashHooked = true;
  window.addEventListener("error", (e) => {
    void track("app_crashed", { message: String(e.message ?? "unknown").slice(0, 200) });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "unknown");
    void track("app_crashed", { message: reason.slice(0, 200) });
  });
}
