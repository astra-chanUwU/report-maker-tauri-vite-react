import { useState } from "react";
import { loadTelemetry, saveTelemetry, track, type TelemetrySettings } from "../lib/telemetry";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "./ui/sonner";

export function TelemetryCard() {
  const [settings, setSettings] = useState<TelemetrySettings>(() => loadTelemetry());

  const set = (patch: Partial<TelemetrySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveTelemetry(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage & crash reports</CardTitle>
        <CardDescription>
          Opt-in anonymous analytics. Default OFF — when off, the app makes zero telemetry network
          calls.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          Share anonymous usage & crash reports
        </label>
        <div className="grid gap-2">
          <Label htmlFor="ph-key">PostHog key (optional — without it events log to console)</Label>
          <Input
            id="ph-key"
            value={settings.posthogKey}
            placeholder="phc_…"
            onChange={(e) => set({ posthogKey: e.target.value.trim() })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ph-host">PostHog host</Label>
          <Input
            id="ph-host"
            value={settings.posthogHost}
            onChange={(e) => set({ posthogHost: e.target.value.trim() })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Events: app_started, report_generated, report_failed, license_validated, app_crashed. No
          PII, no spectra.
        </p>
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
      </CardContent>
    </Card>
  );
}
