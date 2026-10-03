import { useState } from "react";
import { useUi } from "../lib/i18n";
import { draftReport, fallbackDraft, type AiDraftInput } from "../lib/ai";
import type { ParseResult, ReportOptions } from "../lib/parseSp3";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Field } from "./ui/form";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/sonner";

export interface AiDraftFields {
  summary: string;
  methodology: string;
  observations: string;
  recommendations: string;
  conclusion: string;
}

const EMPTY: AiDraftFields = {
  summary: "",
  methodology: "",
  observations: "",
  recommendations: "",
  conclusion: "",
};
const COOLDOWN_MS = 15000;

export function AiSettingsCard() {
  const { t } = useUi();

  return (
    <Panel
      icon={<Sparkles />}
      title={t("aiTitle")}
      description="Hosted AI uses the active license entitlement. No provider key is stored in the app."
      contentClassName="grid gap-3"
    >
      <p className="text-sm text-muted-foreground">
        The report data stays local unless you explicitly choose <strong>Draft with AI</strong>.
        Hosted requests contain only the fields needed to produce the five editable sections.
      </p>
    </Panel>
  );
}

export function AiDraftCard({
  parsed,
  options,
  draft,
  onChange,
}: {
  parsed: ParseResult | null;
  options: ReportOptions;
  draft: AiDraftFields | null;
  onChange: (d: AiDraftFields) => void;
}) {
  const { t } = useUi();
  const [busy, setBusy] = useState(false);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [lastRun, setLastRun] = useState(0);
  const fields = draft ?? EMPTY;

  const set = (patch: Partial<AiDraftFields>) => onChange({ ...fields, ...patch });

  const handleDraft = async (offline: boolean) => {
    if (!parsed) {
      toast.error("Drop a .sp3 file first.");
      return;
    }
    const wait = COOLDOWN_MS - (Date.now() - lastRun);
    if (!offline && wait > 0) {
      toast.error(`Rate-limited — wait ${Math.ceil(wait / 1000)}s.`);
      return;
    }
    setBusy(true);
    try {
      const input: AiDraftInput = {
        meta: parsed.meta,
        spectra: parsed.spectra,
        options: {
          locale: options.language,
          projectName: options.projectName,
          engineer: options.engineer,
          reportDate: options.reportDate,
          units: options.units,
          norm: options.norm,
          notes: options.notes,
        },
        stats: parsed.stats,
      };
      if (offline) {
        onChange({ ...fallbackDraft(input) });
        setFallbackUsed(true);
        toast.success("Offline draft filled — edit before export.");
      } else {
        const res = await draftReport(input);
        onChange({ ...res.draft });
        setFallbackUsed(res.usedFallback);
        if (res.usedFallback) toast.success(res.warning ?? "AI unavailable — offline draft used.");
        else toast.success("AI draft ready — edit before export.");
      }
      setLastRun(Date.now());
    } finally {
      setBusy(false);
    }
  };

  const filled = Object.values(fields).filter((v) => v.trim()).length;

  return (
    <Panel
      icon={<Sparkles />}
      title="Findings"
      description={
        !parsed
          ? "Load measurement data to draft automatically. You can still type your own text."
          : fallbackUsed
            ? "Offline draft in use. Edit freely before export."
            : filled === 0
              ? "Empty fields are filled from the measurement data when you generate the report."
              : `${filled} of 5 sections written.`
      }
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!parsed || busy}
            onClick={() => void handleDraft(true)}
            title="Build a draft from the measurement data without going online"
          >
            <FileText aria-hidden="true" />
            Offline draft
          </Button>
          <Button size="sm" disabled={!parsed || busy} onClick={() => void handleDraft(false)}>
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            {busy ? "Drafting…" : "Draft with AI"}
          </Button>
        </>
      }
      contentClassName="grid gap-4 lg:grid-cols-2"
    >
      {(
        [
          ["summary", "Summary", "lg:col-span-2", 4],
          ["methodology", "Methodology", "", 5],
          ["observations", "Observations", "", 5],
          ["recommendations", "Recommendations", "", 5],
          ["conclusion", "Conclusion", "", 5],
        ] as const
      ).map(([k, label, span, rows]) => (
        <Field key={k} label={t(k) || label} htmlFor={`ai-${k}`} className={span}>
          <Textarea
            id={`ai-${k}`}
            rows={rows}
            value={fields[k]}
            onChange={(e) => set({ [k]: e.target.value })}
            placeholder={`${label}…`}
          />
        </Field>
      ))}
    </Panel>
  );
}
