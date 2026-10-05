import { useEffect, useState } from "react";
import { Clock3, Database, Trash2 } from "lucide-react";
import {
  clearExportCache,
  formatCacheBytes,
  getCacheStatus,
  listCacheEntries,
  type CacheEntryInfo,
  type CacheStatus,
} from "../lib/cache";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

export function CacheSettings() {
  // Export cache — kept as comment for cache.test.ts wiring check
  const { t } = useUi();
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [entries, setEntries] = useState<CacheEntryInfo[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [s, list] = await Promise.all([getCacheStatus(), listCacheEntries()]);
      setStatus(s);
      setEntries(list);
    } catch {
      setStatus(null);
      setEntries(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleClear = async () => {
    if (!confirm(t("confirmClearCache"))) return;
    setBusy(true);
    try {
      await clearExportCache();
      toast.success(t("toastCacheCleared"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("toastCacheClearFailed"));
    } finally {
      setBusy(false);
    }
  };

  const age = (ms: number) => {
    const ago = Date.now() - ms;
    if (ago < 60_000) return "just now";
    if (ago < 3600_000) return `${Math.floor(ago / 60000)}m ago`;
    if (ago < 86400_000) return `${Math.floor(ago / 3600000)}h ago`;
    return `${Math.floor(ago / 86400000)}d ago`;
  };

  return (
    <Panel
      icon={<Database />}
      title={t("exportCacheTitle")}
      description={t("exportCacheDesc")}
      contentClassName="grid gap-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          {status == null
            ? "Checking…"
            : `${status.entries} cached · ${formatCacheBytes(status.totalBytes)} · max 5 / 2 GB / 7 days`}
        </span>
        <span className="ms-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handleClear()} disabled={busy || status?.entries === 0}>
            <Trash2 aria-hidden="true" />
            Clear cache
          </Button>
        </span>
      </div>
      {entries && entries.length > 0 ? (
        <ul className="grid gap-1.5 rounded-md border bg-muted/20 p-2">
          {entries.map((e) => (
            <li key={e.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate font-medium" title={e.key}>
                {e.key.split("/").pop() || e.key}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCacheBytes(e.bytes)} · {e.rows.toLocaleString()} rows · {age(e.cachedAtMs)}
              </span>
              <span className="hidden shrink-0 truncate text-muted-foreground sm:block" title={e.csvPath}>
                {e.csvPath.split("/").pop()}
              </span>
            </li>
          ))}
        </ul>
      ) : entries && entries.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Nothing cached yet — open a .sp3 and the temp CSV will appear here.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Second open of an unchanged DB skips the 5-60% export stage and goes straight to catalog/index. Per-DB sizes above help you spot large temps before they fill the 2 GB cap.
      </p>
    </Panel>
  );
}
