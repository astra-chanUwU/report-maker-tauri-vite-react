import { useState } from "react";
import { useUi } from "../lib/i18n";
import { draftReport, fallbackDraft, type AiDraftInput } from "../lib/ai";
import type { ParseResult, ReportOptions } from "../lib/parseSp3";
import { loadAiSettings, saveAiSettings } from "../lib/settings";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
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
  const [settings, setSettings] = useState(() => loadAiSettings());

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("aiTitle")}</CardTitle>
        <CardDescription>Key stays on this device (localStorage). Never committed.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="ai-key">OpenAI API key</Label>
          <Input
            id="ai-key"
            type="password"
            autoComplete="off"
            placeholder="sk-… (optional)"
            value={settings.apiKey}
            onChange={(e) => {
              const next = { ...settings, apiKey: e.target.value };
              setSettings(next);
              saveAiSettings(next);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ai-model">Model</Label>
          <Input
            id="ai-model"
            value={settings.model}
            onChange={(e) => {
              const next = { ...settings, model: e.target.value };
              setSettings(next);
              saveAiSettings(next);
            }}
          />
        </div>
      </CardContent>
    </Card>
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
        const { apiKey, model } = loadAiSettings();
        const res = await draftReport(input, { apiKey, model });
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("aiTitle")}</CardTitle>
        <CardDescription>
          Additive only — never required for export. Without a key or offline, the fallback fills
          these fields.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!parsed || busy} onClick={() => void handleDraft(false)}>
            {busy ? "Drafting…" : "Draft with AI"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!parsed || busy}
            onClick={() => void handleDraft(true)}
          >
            Use offline draft
          </Button>
          {!parsed ? (
            <p className="self-center text-xs text-muted-foreground">Drop a file to enable.</p>
          ) : null}
          {fallbackUsed ? (
            <p className="self-center text-xs text-muted-foreground">Offline draft in use.</p>
          ) : null}
        </div>
        {(
          [
            ["summary", "Summary"],
            ["methodology", "Methodology"],
            ["observations", "Observations"],
            ["recommendations", "Recommendations"],
            ["conclusion", "Conclusion"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="grid gap-2">
            <Label htmlFor={`ai-${k}`}>{label}</Label>
            <Textarea
              id={`ai-${k}`}
              value={fields[k]}
              onChange={(e) => set({ [k]: e.target.value })}
              placeholder={`${label}…`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
