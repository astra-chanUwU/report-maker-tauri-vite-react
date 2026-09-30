import { useState } from "react";
import { useUi } from "../lib/i18n";
import {
  APP_VERSION,
  checkForUpdates,
  clearLicense,
  loadLicense,
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

  const handleValidate = async () => {
    setBusy(true);
    try {
      const rec = await validateLicense(key);
      setRecord(rec);
      if (rec.valid) {
        void track("license_validated", {});
        toast.success("License valid.");
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
      if (r.error) toast.error(`Update check failed: ${r.error}`);
      else if (!r.latest) toast.success("No releases yet — you are current.");
      else if (r.latest.replace(/^v/, "") === APP_VERSION)
        toast.success(`Up to date (${APP_VERSION}).`);
      else toast.success(`Latest is ${r.latest} — see release page.`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Panel
      icon={<KeyRound />}
      title={t("licenseTitle")}
      description="Perpetual key, validated offline."
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
            {busy ? "Checking…" : "Validate"}
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
            No key entered — app runs unlocked in dev.
          </p>
        )}
        {record ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearLicense();
                setRecord(null);
                setKey("");
              }}
            >
              Remove key
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
