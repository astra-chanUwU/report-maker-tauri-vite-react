export interface AiDraftInput {
  meta: { filename: string; source: string };
  spectra: { freq: number; amp: number }[];
  options: {
    locale?: string;
    projectName: string;
    engineer: string;
    reportDate: string;
    units: string;
    norm: string;
    notes: string;
  };
  stats: {
    spectra_points: number;
    freq_min: number;
    freq_max: number;
    amp_min: number;
    amp_max: number;
    peak: { freq: number; amp: number };
  };
}

export interface DraftResult {
  draft: {
    summary: string;
    methodology: string;
    observations: string;
    recommendations: string;
    conclusion: string;
  };
  usedFallback: boolean;
  warning?: string;
}

export function fallbackDraft(input: AiDraftInput): DraftResult["draft"] {
  const { stats, meta, options } = input;
  const name = options.projectName || "Untitled project";
  return {
    summary: `${name} — ${stats.spectra_points} spectral points from ${meta.filename} (${meta.source}). Peak ${stats.peak.amp} @ ${stats.peak.freq} ${options.units || "units"}.`,
    methodology: `Imported ${meta.filename} offline. Parsed ${stats.spectra_points} (freq ${stats.freq_min}–${stats.freq_max}, amp ${stats.amp_min}–${stats.amp_max}). Normalization: ${options.norm || "Default"}. No network calls.`,
    observations: `Peak response at ${stats.peak.freq} with amplitude ${stats.peak.amp}. Range ${stats.freq_min}–${stats.freq_max}. ${meta.source === "synthetic" ? "Synthetic demo data was used (input empty/unrecognized)." : `Source type: ${meta.source}.`}`,
    recommendations: `Verify peak neighborhood with finer sweep. Re-run with calibrated units (${options.units || "SI"}). ${options.notes ? `Notes: ${options.notes}` : "Add notes before export."}`,
    conclusion: `Data ingested and ready for export. Report dated ${options.reportDate || "today"} by ${options.engineer || "—"}.`,
  };
}

export async function draftReport(
  input: AiDraftInput,
  opts?: { timeoutMs?: number }
): Promise<DraftResult> {
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const license = (await import("./license")) as unknown as {
      getHostedRequestAuth?: () => Promise<{
        activationId: string;
        headers: Record<string, string>;
      } | null>;
      getControlPlaneUrl?: () => Promise<string>;
      signHostedRequest?: (action: string, requestId: string, payload: unknown) => Promise<string | null>;
    };
    const auth = await license.getHostedRequestAuth?.();
    if (!auth) {
      return {
        draft: fallbackDraft(input),
        usedFallback: true,
        warning: "Activate a license with hosted AI enabled to use Draft with AI.",
      };
    }
    const requestId = globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${Math.random()}`;
    const payload = {
      locale: input.options.locale ?? "en",
      units: input.options.units,
      norm: input.options.norm,
      statistics: input.stats,
      notes: input.options.notes,
      model: null,
    };
    const deviceSignature = await license.signHostedRequest?.("ai_draft", requestId, payload);
    if (!deviceSignature) {
      return {
        draft: fallbackDraft(input),
        usedFallback: true,
        warning: "Hosted AI requires the activated desktop app; used offline draft.",
      };
    }
    const base = (await license.getControlPlaneUrl?.()) ?? "http://127.0.0.1:8787";
    const res = await fetch(`${base}/v1/ai/draft`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...auth.headers },
      body: JSON.stringify({ ...payload, request_id: requestId, device_signature: deviceSignature }),
    });
    if (!res.ok) throw new Error(`Control plane ${res.status}`);
    const json = (await res.json()) as { draft?: unknown } & Record<string, unknown>;
    const parsed = isDraft(json.draft) ? json.draft : isDraft(json) ? json : null;
    if (!parsed) throw new Error("unparseable");
    return { draft: parsed, usedFallback: false };
  } catch (e) {
    return {
      draft: fallbackDraft(input),
      usedFallback: true,
      warning:
        e instanceof Error && e.name === "AbortError"
          ? "AI timed out — used offline draft."
          : "AI unavailable — used offline draft.",
    };
  } finally {
    clearTimeout(t);
  }
}

function isDraft(value: unknown): value is DraftResult["draft"] {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return ["summary", "methodology", "observations", "recommendations", "conclusion"].every(
    (k) => typeof o[k] === "string"
  );
}
