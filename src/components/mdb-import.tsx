import { useEffect, useState } from "react";
import { useUi } from "../lib/i18n";
import { DatabaseZap } from "lucide-react";
import type { ParseResult } from "../lib/parseSp3";
import { loadMdbToolPath, saveMdbToolPath } from "../lib/settings";
import { convertSp3FromDisk, isTauriRuntime, mdbToolStatus, type MdbToolStatus } from "../lib/mdb";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "./ui/sonner";

/** Raw .sp3 conversion via backend mdb-export. Renders nothing outside Tauri. */
export function MdbImportCard({ onConverted }: { onConverted: (r: ParseResult) => void }) {
  const { t } = useUi();
  const [isTauri, setIsTauri] = useState(false);
  const [status, setStatus] = useState<MdbToolStatus | null>(null);
  const [toolPath, setToolPath] = useState(() => loadMdbToolPath());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void isTauriRuntime().then((t) => {
      if (!alive || !t) return;
      setIsTauri(true);
      void mdbToolStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus({ found: false, version: "backend unreachable" }));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!isTauri) return null;

  const handleConvert = async () => {
    setBusy(true);
    try {
      const result = await convertSp3FromDisk();
      onConverted(result);
      toast.success(`Converted ${result.meta.filename}`);
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
      toast.error(e instanceof Error ? e.message : "Conversion failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSavePath = () => {
    saveMdbToolPath(toolPath.trim());
    void mdbToolStatus()
      .then(setStatus)
      .catch(() => setStatus({ found: false, version: "backend unreachable" }));
    toast.success("Tool path saved.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mdbTitle")}</CardTitle>
        <CardDescription>
          Converts the Jet database via <code>mdb-export</code> (Data table) — no manual CSV step.{" "}
          {status
            ? status.found
              ? `Tool OK (${status.version})`
              : "Tool NOT found — set the path below."
            : "Checking tool…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Button onClick={handleConvert} disabled={busy || status?.found === false}>
          <DatabaseZap />
          {busy ? "Converting…" : "Open .sp3 file"}
        </Button>
        <div className="grid gap-2">
          <Label htmlFor="mdb-tool">mdb-export path (optional override)</Label>
          <div className="flex gap-2">
            <Input
              id="mdb-tool"
              placeholder="e.g. D:\tools\mdbtools-win\mdb-export.exe (blank = auto)"
              value={toolPath}
              onChange={(e) => setToolPath(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={handleSavePath}>
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
