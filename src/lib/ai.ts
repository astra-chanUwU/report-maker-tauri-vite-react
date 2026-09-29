export interface AiDraftInput {
  meta: { filename: string; source: string };
  spectra: { freq: number; amp: number }[];
  options: {
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
  opts?: { apiKey?: string; model?: string; timeoutMs?: number }
): Promise<DraftResult> {
  const apiKey = opts?.apiKey?.trim();
  if (!apiKey) return { draft: fallbackDraft(input), usedFallback: true };
  const model = opts?.model?.trim() || "gpt-4o-mini";
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "Write a concise engineering spectral report. Return JSON with keys summary, methodology, observations, recommendations, conclusion.",
          },
          {
            role: "user",
            content: `Project ${input.options.projectName} by ${input.options.engineer}. File ${input.meta.filename} (${input.meta.source}), points ${input.stats.spectra_points}, freq ${input.stats.freq_min}-${input.stats.freq_max}, amp ${input.stats.amp_min}-${input.stats.amp_max}, peak ${input.stats.peak.amp}@${input.stats.peak.freq}. Units ${input.options.units}. Norm ${input.options.norm}. Notes ${input.options.notes}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = tryParseDraftJson(content);
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

function tryParseDraftJson(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    for (const k of ["summary", "methodology", "observations", "recommendations", "conclusion"]) {
      if (typeof o[k] !== "string") return null;
    }
    return o as DraftResult["draft"];
  } catch {
    return null;
  }
}
