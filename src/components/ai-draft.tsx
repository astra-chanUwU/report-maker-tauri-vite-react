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
      description={t("aiSettingsDesc")}
      contentClassName="grid gap-3"
    >
      <p className="text-sm text-muted-foreground">
        {t("aiSettingsDetail")}
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
      toast.error(t("dropFirst"));
      return;
    }
    const wait = COOLDOWN_MS - (Date.now() - lastRun);
    if (!offline && wait > 0) {
      toast.error(t("toastRateLimited", { sec: Math.ceil(wait / 1000) }));
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
        toast.success(t("toastOfflineDraftFilled"));
      } else {
        const res = await draftReport(input);
        onChange({ ...res.draft });
        setFallbackUsed(res.usedFallback);
        if (res.usedFallback) toast.success(res.warning ?? t("toastAiFallback"));
        else toast.success(t("toastAiDraftReady"));
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
      title={t("findings")}
      description={
        !parsed
          ? t("findingsDescNeedData")
          : fallbackUsed
            ? t("findingsDescOffline")
            : filled === 0
              ? t("findingsDescEmpty")
              : t("findingsDescFilled", { count: filled })
      }
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!parsed || busy}
            onClick={() => void handleDraft(true)}
            title={t("offlineDraftTitle")}
          >
            <FileText aria-hidden="true" />
            {t("offlineDraft")}
          </Button>
          <Button size="sm" disabled={!parsed || busy} onClick={() => void handleDraft(false)}>
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            {busy ? t("drafting") : t("draftWithAi")}
          </Button>
        </>
      }
      contentClassName="grid gap-4 lg:grid-cols-2"
    >
      {(
        [
          ["summary", "lg:col-span-2", 4],
          ["methodology", "", 5],
          ["observations", "", 5],
          ["recommendations", "", 5],
          ["conclusion", "", 5],
        ] as const
      ).map(([k, span, rows]) => (
        <Field key={k} label={t(k)} htmlFor={`ai-${k}`} className={span}>
          <Textarea
            id={`ai-${k}`}
            rows={rows}
            value={fields[k]}
            onChange={(e) => set({ [k]: e.target.value })}
            placeholder={`${t(k)}…`}
          />
        </Field>
      ))}
    </Panel>
  );
}
