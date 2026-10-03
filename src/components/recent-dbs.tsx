import { useEffect, useState } from "react";
import { Clock3, DatabaseZap, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import type { RecentDb } from "../lib/recentDbs";
import { loadRecentDbs, removeRecentDb } from "../lib/recentDbs";
import { useUi } from "../lib/i18n";
import { cn } from "../lib/utils";

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

function formatSize(n?: number): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function RecentDbsCard({ onOpen, tick }: { onOpen: (path: string) => void; tick: number }) {
  const { t } = useUi();
  const [recents, setRecents] = useState<RecentDb[] | null>(null);
  const [cachedSet, setCachedSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadRecentDbs().then(setRecents);
  }, [tick]);

  useEffect(() => {
    if (!recents || recents.length === 0) return;
    let alive = true;
    void (async () => {
      const { isCached } = await import("../lib/cache");
      const checks = await Promise.all(recents.map(async (r) => [r.path, await isCached(r.path)] as const));
      if (!alive) return;
      setCachedSet(new Set(checks.filter(([, v]) => v).map(([k]) => k)));
    })();
    return () => {
      alive = false;
    };
  }, [recents]);

  if (recents === null) {
    return (
      <Card className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{t("reading")}</p>
      </Card>
    );
  }

  if (recents.length === 0) return null;

  const handleRemove = async (path: string) => {
    const next = await removeRecentDb(path);
    setRecents(next);
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Recent databases</h2>
        <span className="text-xs text-muted-foreground">— pick up where you left off</span>
      </div>
      <ul className="divide-y">
        {recents.map((r) => {
          const size = formatSize(r.size);
          const ago = timeAgo(r.lastOpenedAt);
          return (
            <li
              key={r.path}
              className={cn(
                "flex items-center gap-3 px-4 py-3",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <DatabaseZap className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="block truncate text-sm font-medium" title={r.path}>
                    {r.filename}
                  </span>
                  {cachedSet.has(r.path) ? (
                    <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success" title="Cached — opens instantly">
                      Cached
                    </span>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="Not cached — will re-export">
                      Not cached
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground" title={r.path}>
                  {r.path} {size ? `· ${size}` : ""} {r.rows ? `· ${r.rows} meas.` : ""} · {ago}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpen(r.path)}
                  title="Reopen this database"
                >
                  <FolderOpen aria-hidden="true" />
                  Open
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void handleRemove(r.path)}
                  aria-label={`Remove ${r.filename} from recents`}
                  title="Remove from list"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
