import { useState } from "react";
import { useUi } from "../lib/i18n";
import { Plus, Trash2 } from "lucide-react";
import { loadClients, makeClient, saveClients, type ClientProfile } from "../lib/equipment";
import { DEFAULT_ADDRESS_BLOCK_EN, DEFAULT_ADDRESS_BLOCK_FA } from "../lib/fa";
import type { ReportOptions } from "../lib/parseSp3";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** Client profiles: set cover once, reuse for all reports (brochure p.3). */
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
    });
    if (!c.clientName && !c.clientUnit) return;
    save([c, ...clients]);
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
  };

  const setLogo = async (id: string, file: File | null) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    const logoBase64 = btoa(s);
    save(clients.map((c) => (c.id === id ? { ...c, logoBase64 } : c)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("clientsTitle")} ({clients.length})
        </CardTitle>
        <CardDescription>Save letterhead once, apply to the form.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOptions({ ...options, addressBlock: DEFAULT_ADDRESS_BLOCK_EN })}
          >
            EN letterhead
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onOptions({ ...options, addressBlock: DEFAULT_ADDRESS_BLOCK_FA, language: "fa" })
            }
          >
            FA letterhead
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={addCurrent}>
            <Plus className="h-4 w-4" /> Save current
          </Button>
        </div>
        {clients.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-md border p-2">
            <button type="button" className="flex-1 text-left text-sm" onClick={() => apply(c)}>
              <span className="font-medium">{c.clientName || "(no name)"}</span>
              {c.clientUnit ? (
                <span className="text-muted-foreground"> — {c.clientUnit}</span>
              ) : null}
              <span className="block truncate text-xs text-muted-foreground">{c.addressBlock}</span>
            </button>
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label={`Logo for ${c.clientName || "client"}`}
              className="max-w-28 text-xs"
              onChange={(e) => void setLogo(c.id, e.target.files?.[0] ?? null)}
            />
            <select
              className="rounded border bg-background px-1 py-1 text-xs"
              value={c.isoGroups ?? "all"}
              aria-label="ISO groups"
              onChange={(e) =>
                save(
                  clients.map((x) =>
                    x.id === c.id
                      ? { ...x, isoGroups: e.target.value as ClientProfile["isoGroups"] }
                      : x
                  )
                )
              }
            >
              <option value="all">ISO all</option>
              <option value="1+3">1+3</option>
              <option value="2+4">2+4</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => save(clients.filter((x) => x.id !== c.id))}
              aria-label="Delete client"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {clients.length === 0 ? (
          <div className="grid gap-1">
            <Label htmlFor="client-quick">Quick add (name — unit)</Label>
            <Input
              id="client-quick"
              placeholder="e.g. Mobarakeh Steel — Rolling unit"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = (e.target as HTMLInputElement).value;
                const [n, u] = v.split(/—|-/).map((s) => s.trim());
                if (!n) return;
                save([makeClient({ clientName: n, clientUnit: u ?? "" }), ...clients]);
                (e.target as HTMLInputElement).value = "";
              }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
