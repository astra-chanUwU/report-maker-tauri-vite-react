import { useRef, useState } from "react";
import { useUi } from "../lib/i18n";
import { BookUser, Check, ImagePlus, Plus, Trash2 } from "lucide-react";
import { loadClients, makeClient, saveClients, type ClientProfile } from "../lib/equipment";
import type { ReportOptions } from "../lib/parseSp3";
import { cn } from "../lib/utils";
import { imageDataUrl } from "./report-form";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Select } from "./ui/form";
import { toast } from "./ui/sonner";

/** Client profiles: set the letterhead once, reuse it for every report (brochure p.3). */
export function ClientProfiles({
  options,
  onOptions,
  onLogo,
}: {
  options: ReportOptions;
  onOptions: (o: ReportOptions) => void;
  onLogo?: (logoBase64: string | null) => void;
}) {
  const { t } = useUi();
  const [clients, setClients] = useState<ClientProfile[]>(() => loadClients());

  const save = (next: ClientProfile[]) => {
    setClients(next);
    saveClients(next);
  };

  const addCurrent = () => {
    const c = makeClient({
      clientName: options.clientName ?? "",
      clientUnit: options.clientUnit ?? "",
      addressBlock: options.addressBlock ?? "",
      isoGroups: options.isoGroups,
    });
    if (!c.clientName && !c.clientUnit) {
      toast.error("Enter a client name or unit first.");
      return;
    }
    save([c, ...clients]);
    toast.success(`Saved ${c.clientName || c.clientUnit}.`);
  };

  const apply = (c: ClientProfile) => {
    onOptions({
      ...options,
      clientName: c.clientName,
      clientUnit: c.clientUnit,
      addressBlock: c.addressBlock,
      isoGroups: c.isoGroups ?? options.isoGroups,
    });
    if (c.logoBase64) onLogo?.(c.logoBase64);
    toast.success(`Applied ${c.clientName || "client"}.`);
  };

  const setLogo = async (id: string, file: File | null) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    const logoBase64 = btoa(s);
    save(clients.map((c) => (c.id === id ? { ...c, logoBase64 } : c)));
  };

  const isApplied = (c: ClientProfile) =>
    c.clientName === (options.clientName ?? "") &&
    c.clientUnit === (options.clientUnit ?? "") &&
    c.addressBlock === (options.addressBlock ?? "");

  return (
    <Panel
      icon={<BookUser />}
      title={`${t("clientsTitle")} (${clients.length})`}
      description={t("clientsDesc")}
      actions={
        <Button variant="outline" size="sm" onClick={addCurrent}>
          <Plus aria-hidden="true" />
          {t("saveCurrent")}
        </Button>
      }
    >
      {clients.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-[13px] text-muted-foreground">
          {t("noClients")}
        </p>
      ) : (
        <ul className="grid max-h-80 gap-1.5 overflow-auto">
          {clients.map((c) => (
            <ClientRow
              key={c.id}
              client={c}
              applied={isApplied(c)}
              onApply={() => apply(c)}
              onLogo={(f) => void setLogo(c.id, f)}
              onIso={(iso) =>
                save(clients.map((x) => (x.id === c.id ? { ...x, isoGroups: iso } : x)))
              }
              onDelete={() => save(clients.filter((x) => x.id !== c.id))}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ClientRow({
  client: c,
  applied,
  onApply,
  onLogo,
  onIso,
  onDelete,
}: {
  client: ClientProfile;
  applied: boolean;
  onApply: () => void;
  onLogo: (f: File | null) => void;
  onIso: (iso: ClientProfile["isoGroups"]) => void;
  onDelete: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const logo = imageDataUrl(c.logoBase64);
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5",
        applied && "border-primary/50 bg-accent/60"
      )}
    >
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex h-9 w-12 shrink-0 cursor-default items-center justify-center overflow-hidden rounded border",
          logo ? "bg-white" : "bg-muted/50"
        )}
        title="Set client logo"
        aria-label={`Logo for ${c.clientName || "client"}`}
      >
        {logo ? (
          <img src={logo} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImagePlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          onLogo(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">
          {c.clientName || "(no name)"}
          {c.clientUnit ? (
            <span className="font-normal text-muted-foreground"> — {c.clientUnit}</span>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{c.addressBlock || "No address"}</p>
      </div>
      <Select
        className="h-7 w-auto text-xs"
        value={c.isoGroups ?? "all"}
        aria-label="ISO groups"
        title="ISO groups for this client"
        onChange={(e) => onIso(e.target.value as ClientProfile["isoGroups"])}
      >
        <option value="all">ISO 1–4</option>
        <option value="1+3">ISO 1+3</option>
        <option value="2+4">ISO 2+4</option>
      </Select>
      <Button variant={applied ? "secondary" : "outline"} size="sm" onClick={onApply}>
        {applied ? <Check aria-hidden="true" /> : null}
        {applied ? "Applied" : "Apply"}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        aria-label="Delete client"
        title="Delete"
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}
