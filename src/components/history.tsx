import { useEffect, useMemo, useState } from "react";
import { FolderOpen, History as HistoryIcon, RotateCcw, Search, Trash2 } from "lucide-react";
import { clearHistory, deleteHistoryEntry, loadHistory, type HistoryEntry } from "../lib/history";
import type { ReportOptions } from "../lib/parseSp3";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { EmptyState } from "./ui/form";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
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
      toast.error(t("toastNoSavedPath"));
      return;
    }
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    } catch {
      toast.error(t("toastCouldNotReveal"));
    }
  };

  if (loaded && entries.length === 0) {
    return (
      <EmptyState icon={<HistoryIcon />} title={t("noReportsYet")}>
        {t("noReportsYetDesc")}
      </EmptyState>
    );
  }

  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute start-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="ps-8"
            placeholder={t("searchHistoryPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search history"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {loaded ? t("keepsLast100", { filtered: filtered.length, total: entries.length }) : t("reading")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            if (window.confirm(t("confirmClearHistory"))) {
              void clearHistory().then(() => setEntries([]));
            }
          }}
        >
          <Trash2 aria-hidden="true" />
          {t("clearAll")}
        </Button>
      </div>
      {filtered.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{t("noMatches")}</p>
      ) : (
        <Table containerClassName="max-h-[calc(100vh-15rem)]">
          <TableHeader>
            <TableRow>
              <TableHead>{t("projectCol")}</TableHead>
              <TableHead>{t("dateCol")}</TableHead>
              <TableHead>{t("engineerCol")}</TableHead>
              <TableHead>{t("sourceCol")}</TableHead>
              <TableHead>{t("peakCol")}</TableHead>
              <TableHead className="w-0 text-end">
                <span className="sr-only">{t("actionsCol")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="max-w-72">
                  <p className="truncate font-medium">{e.projectName || t("untitledProject")}</p>
                  <p className="truncate text-xs text-muted-foreground" title={e.savedPath ?? e.filename}>
                    {e.filename}
                  </p>
                </TableCell>
                <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                <TableCell className="max-w-40 truncate">{e.engineer}</TableCell>
                <TableCell className="max-w-48">
                  <p className="truncate">{e.sourceFile}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.spectraPoints} {t("pts")}
                  </p>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {e.peak.amp} <span className="text-muted-foreground">@ {e.peak.freq}</span>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => onReopen(e.options)} title={t("reopenHint")}>
                      <RotateCcw aria-hidden="true" />
                      {t("reopen")}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => void handleReveal(e.savedPath)}
                      title={t("showInFolder")}
                      aria-label={t("showInFolder")}
                      disabled={!e.savedPath}
                    >
                      <FolderOpen aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => void deleteHistoryEntry(e.id).then(setEntries)}
                      title={t("removeFromHistory")}
                      aria-label={t("removeFromHistory")}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export { type HistoryEntry };
