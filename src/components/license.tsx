import { useEffect, useState } from "react";
import { useUi } from "../lib/i18n";
import {
  APP_VERSION,
  checkForUpdates,
  clearLicense,
  deactivateLicense,
  licenseStatus,
  loadLicense,
  refreshLicense,
  validateLicense,
  type LicenseRecord,
} from "../lib/license";
import { track } from "../lib/telemetry";
import { KeyRound } from "lucide-react";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "./ui/sonner";

export function LicenseCard() {
  const { t } = useUi();
  const [record, setRecord] = useState<LicenseRecord | null>(() => loadLicense());
  const [key, setKey] = useState(record?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<{
    latest: string | null;
    url: string | null;
    error?: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void licenseStatus().then((status) => {
      if (status) {
        setRecord(status);
        if (status.key) setKey(status.key);
      }
    });
  }, []);

  const handleValidate = async () => {
    setBusy(true);
    try {
      const rec = await validateLicense(key);
      setRecord(rec);
      if (rec.valid) {
        void track("license_validated", {});
        toast.success(t("toastDeviceActivated"));
      } else toast.error(rec.reason);
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      const r = await checkForUpdates();
      setUpdate(r);
      if (r.error) toast.error(t("toastUpdateCheckFailed", { error: r.error }));
      else if (!r.latest) toast.success(t("toastNoReleases"));
      else if (r.latest.replace(/^v/, "") === APP_VERSION)
        toast.success(t("toastUpToDate", { version: APP_VERSION }));
      else toast.success(t("toastLatestIs", { version: r.latest }));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Panel
      icon={<KeyRound />}
      title={t("licenseTitle")}
      description="Activate this device with a signed offline lease."
      contentClassName="grid gap-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="license-key">License key</Label>
        <div className="flex gap-2">
          <Input
            id="license-key"
            placeholder="RM-0000-0000-0000"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button onClick={handleValidate} disabled={busy || !key.trim()}>
            {busy ? "Activating…" : "Activate"}
          </Button>
        </div>
        {record ? (
          <p className={`text-xs ${record.valid ? "text-success" : "text-muted-foreground"}`}>
            {record.valid ? `✓ ${record.reason}` : record.reason}
            {record.validatedAt ? ` · checked ${record.validatedAt.slice(0, 10)}` : ""}
            {record.dev ? " · dev build (no lock)" : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No activated device — localhost web development remains unlocked.
          </p>
        )}
        {record?.lease?.features ? (
          <p className="text-xs text-muted-foreground">
            Entitlements: {record.lease.features.core_export ? "local export" : ""}
            {record.lease.features.core_export && record.lease.features.hosted_ai ? " · " : ""}
            {record.lease.features.hosted_ai ? "hosted AI" : "none"}
          </p>
        ) : null}
        {record ? (
          <div className="flex gap-2">
            {record.activationId ? (
              <Button
                size="sm"
                variant="outline"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    const next = await refreshLicense();
                    setRecord(next);
                    if (next.valid) toast.success(t("toastLeaseRefreshed"));
                    else toast.error(next.reason);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                {refreshing ? "Refreshing…" : "Refresh lease"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await deactivateLicense();
                  clearLicense();
                  setRecord(null);
                  setKey("");
                  toast.success(t("toastDeviceDeactivated"));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : String(error));
                }
              }}
            >
              Deactivate
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t pt-3">
        <Button size="sm" variant="outline" onClick={handleCheck} disabled={checking}>
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        <p className="text-xs text-muted-foreground">
          v{APP_VERSION}
          {update?.latest ? ` · latest ${update.latest}` : ""}
          {update?.url ? (
            <>
              {" · "}
              <a className="underline" href={update.url} target="_blank" rel="noreferrer">
                release page
              </a>
            </>
          ) : null}
        </p>
      </div>
    </Panel>
  );
}
