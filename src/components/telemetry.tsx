import { useState } from "react";
import { useUi } from "../lib/i18n";
import { loadTelemetry, saveTelemetry, track, type TelemetrySettings } from "../lib/telemetry";
import { Activity } from "lucide-react";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { CheckRow } from "./ui/form";
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
        description="Events: app started, report generated/failed, license validated, crash type. No personal data, no spectra."
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!settings.enabled}
          onClick={() => {
            void track("app_started", { manual_test: true }).then(() =>
              toast.success("Test event queued.")
            );
          }}
        >
          Send test event
        </Button>
      </div>
    </Panel>
  );
}
