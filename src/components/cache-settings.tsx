import { useEffect, useState } from "react";
import { Database, Trash2 } from "lucide-react";
import { clearExportCache, formatCacheBytes, getCacheStatus, type CacheStatus } from "../lib/cache";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { toast } from "./ui/sonner";

export function CacheSettings() {
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await getCacheStatus());
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleClear = async () => {
    if (!confirm("Clear all cached exports? Next open will re-export.")) return;
    setBusy(true);
    try {
      await clearExportCache();
      toast.success("Cache cleared.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear cache.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      icon={<Database />}
      title="Export cache"
      description="Re-uses the Data-table CSV for the same .sp3 without re-running mdb-export. Invalidates when the file changes, temp is cleaned, or after 7 days."
      contentClassName="grid gap-3"
    >
      <div className="flex items-center gap-3 text-[13px]">
        <span className="text-muted-foreground">
          {status == null
            ? "Checking…"
            : `${status.entries} cached · ${formatCacheBytes(status.totalBytes)} · max 5 / 2 GB / 7 days`}
        </span>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Refresh
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void handleClear()} disabled={busy || status?.entries === 0}>
          <Trash2 aria-hidden="true" />
          Clear cache
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Second open of an unchanged DB skips the 5-60% export stage and goes straight to catalog/index.
      </p>
    </Panel>
  );
}
