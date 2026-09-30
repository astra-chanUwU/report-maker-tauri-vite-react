import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  loadClients,
  makeClient,
  saveClients,
  type ClientProfile,
} from "../lib/equipment";
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
}: {
  options: ReportOptions;
  onOptions: (o: ReportOptions) => void;
}) {
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
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clients ({clients.length})</CardTitle>
        <CardDescription>Save letterhead once, apply to the form.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOptions({ ...options, addressBlock: DEFAULT_ADDRESS_BLOCK_EN })}>
            EN letterhead
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOptions({ ...options, addressBlock: DEFAULT_ADDRESS_BLOCK_FA, language: "fa" })}>
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
              {c.clientUnit ? <span className="text-muted-foreground"> — {c.clientUnit}</span> : null}
              <span className="block truncate text-xs text-muted-foreground">{c.addressBlock}</span>
            </button>
            <Button type="button" variant="ghost" size="sm" onClick={() => save(clients.filter((x) => x.id !== c.id))} aria-label="Delete client">
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
