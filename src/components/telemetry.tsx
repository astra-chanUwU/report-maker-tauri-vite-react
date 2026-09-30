import { useState } from "react";
import { useUi } from "../lib/i18n";
import { loadTelemetry, saveTelemetry, track, type TelemetrySettings } from "../lib/telemetry";
import { Activity } from "lucide-react";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { CheckRow, Field } from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";

export function TelemetryCard() {
  const { t } = useUi();
  const [settings, setSettings] = useState<TelemetrySettings>(() => loadTelemetry());

  const set = (patch: Partial<TelemetrySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveTelemetry(next);
  };

  return (
    <Panel
      icon={<Activity />}
      title={t("telemetryTitle")}
      description="Off by default. While off, the app makes no telemetry network calls."
      contentClassName="grid gap-3"
    >
      <CheckRow
        className="-mx-2"
        checked={settings.enabled}
        onChange={(v) => set({ enabled: v })}
        label="Share anonymous usage & crash reports"
        description="Events: app started, report generated/failed, license validated, crash. No personal data, no spectra."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="PostHog key"
          htmlFor="ph-key"
          hint="Optional. Without it events go to the console."
        >
          <Input
            id="ph-key"
            value={settings.posthogKey}
            placeholder="phc_…"
            disabled={!settings.enabled}
            onChange={(e) => set({ posthogKey: e.target.value.trim() })}
          />
        </Field>
        <Field label="PostHog host" htmlFor="ph-host">
          <Input
            id="ph-host"
            value={settings.posthogHost}
            disabled={!settings.enabled}
            onChange={(e) => set({ posthogHost: e.target.value.trim() })}
          />
        </Field>
      </div>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!settings.enabled}
          onClick={() => {
            void track("app_started", { manual_test: true }).then(() =>
              toast.success(
                settings.posthogKey ? "Test event sent." : "Mock event logged to console."
              )
            );
          }}
        >
          Send test event
        </Button>
      </div>
    </Panel>
  );
}
