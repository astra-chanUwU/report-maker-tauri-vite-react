import { useEffect, useMemo, useState } from "react";
import { FolderOpen, RotateCcw, Search, Trash2 } from "lucide-react";
import { clearHistory, deleteHistoryEntry, loadHistory, type HistoryEntry } from "../lib/history";
import type { ReportOptions } from "../lib/parseSp3";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

export function HistoryTab({ onReopen }: { onReopen: (options: ReportOptions) => void }) {
  const { t } = useUi();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadHistory().then((h) => {
      setEntries(h);
      setLoaded(true);
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.projectName, e.engineer, e.filename, e.sourceFile].some((s) => s.toLowerCase().includes(q))
    );
  }, [entries, query]);

  const handleReveal = async (path: string | null) => {
    if (!path) {
      toast.error("No saved path (web download).");
      return;
    }
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    } catch {
      toast.error("Could not reveal file.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("historyTitle")}</CardTitle>
        <CardDescription>
          {loaded ? `${entries.length} stored (cap 100), no server.` : "Loading…"} Reopen restores
          form options.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search project, engineer, file…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {entries.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void clearHistory().then(() => setEntries([]))}
            >
              Clear all
            </Button>
          ) : null}
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {entries.length === 0
              ? "No reports yet — generate one from the Report tab."
              : "No matches."}
          </p>
        ) : (
          <ul className="grid gap-2">
            {filtered.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {e.projectName || "Untitled"} · {e.date}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.engineer} · {e.filename} · {e.spectraPoints} pts · peak {e.peak.amp} @{" "}
                    {e.peak.freq}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReopen(e.options)}
                    title="Reopen options"
                  >
                    <RotateCcw />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleReveal(e.savedPath)}
                    title="Reveal in folder"
                  >
                    <FolderOpen />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void deleteHistoryEntry(e.id).then(setEntries)}
                    title="Delete"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export { type HistoryEntry };
