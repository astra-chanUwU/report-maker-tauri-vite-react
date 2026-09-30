import { useState } from "react";
import { CheckCircle2, Wrench, XCircle } from "lucide-react";
import type { MdbToolStatus } from "../lib/mdb";
import { loadMdbToolPath, saveMdbToolPath } from "../lib/settings";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Field } from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";

/** mdb-export location for raw .sp3 conversion. Renders nothing outside Tauri. */
export function MdbToolSettings({
  isTauri,
  status,
  onRefresh,
}: {
  isTauri: boolean;
  status: MdbToolStatus | null;
  onRefresh: () => void;
}) {
  const [toolPath, setToolPath] = useState(() => loadMdbToolPath());
  if (!isTauri) return null;

  const handleSave = () => {
    saveMdbToolPath(toolPath.trim());
    onRefresh();
    toast.success("Tool path saved.");
  };

  return (
    <Panel
      icon={<Wrench />}
      title="Spectra .sp3 converter"
      description="Uses mdb-export to read the Jet database inside .sp3 files."
      contentClassName="grid gap-3"
    >
      <div className="flex items-center gap-2 text-[13px]">
        {status == null ? (
          <span className="text-muted-foreground">Checking…</span>
        ) : status.found ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            <span>
              Found <span className="text-muted-foreground">({status.version})</span>
            </span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <span className="text-destructive">Not found. Set the path below.</span>
          </>
        )}
      </div>
      <Field
        label="mdb-export path"
        htmlFor="mdb-tool"
        hint="Leave blank to auto-detect (MDB_EXPORT_PATH or PATH)."
      >
        <div className="flex gap-2">
          <Input
            id="mdb-tool"
            placeholder="D:\tools\mdbtools-win\mdb-export.exe"
            value={toolPath}
            onChange={(e) => setToolPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button variant="outline" onClick={handleSave}>
            Save
          </Button>
        </div>
      </Field>
    </Panel>
  );
}
