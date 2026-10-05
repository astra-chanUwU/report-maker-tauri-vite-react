import { useState } from "react";
import { CheckCircle2, Wrench, XCircle } from "lucide-react";
import type { MdbToolStatus } from "../lib/mdb";
import { loadMdbToolPath, saveMdbToolPath } from "../lib/settings";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Field } from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "./ui/sonner";
import { useUi } from "../lib/i18n";

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
  const { t } = useUi();
  const [toolPath, setToolPath] = useState(() => loadMdbToolPath());
  if (!isTauri) return null;

  const handleSave = () => {
    saveMdbToolPath(toolPath.trim());
    onRefresh();
    toast.success(t("toastToolPathSaved"));
  };

  return (
    <Panel
      icon={<Wrench />}
      title={t("mdbTitleLong")}
      description={t("mdbDesc")}
      contentClassName="grid gap-3"
    >
      <div className="flex items-center gap-2 text-[13px]">
        {status == null ? (
          <span className="text-muted-foreground">{t("checking")}</span>
        ) : status.found ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            <span>
              {t("mdbFound")} <span className="text-muted-foreground">({status.version})</span>
            </span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <span className="text-destructive">{t("mdbNotFound")}</span>
          </>
        )}
      </div>
      <Field label={t("mdbPathLabel")} htmlFor="mdb-tool" hint={t("mdbPathHint")}>
        <div className="flex gap-2">
          <Input
            id="mdb-tool"
            placeholder="D:\tools\mdbtools-win\mdb-export.exe"
            value={toolPath}
            onChange={(e) => setToolPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button variant="outline" onClick={handleSave}>
            {t("save")}
          </Button>
        </div>
      </Field>
    </Panel>
  );
}
