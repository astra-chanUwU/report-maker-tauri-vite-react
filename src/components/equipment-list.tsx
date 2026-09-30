import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { bytesToBase64, buildMachineSpecs, joinCatalog, machineLabelMap, type SpectraMachine } from "../lib/spectra-catalog";
import { renderPointSchematic } from "../lib/spectra-schematic";
import { fetchMachinePicture, fetchSpectraCatalog, pickSp3Path } from "../lib/mdb";
import {
  EQUIPMENT_STATUSES,
  loadEquipments,
  makeEquipment,
  saveEquipments,
  type EquipmentItem,
} from "../lib/equipment";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/sonner";

/** Multi-equipment manager (brochure p.4): 1..N equipments → TOC + sections. */
export function EquipmentList({
  items,
  onChange,
}: {
  items: EquipmentItem[];
  onChange: (next: EquipmentItem[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ path: string; machines: SpectraMachine[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const importCatalog = async () => {
    setBusy(true);
    try {
      const path = await pickSp3Path();
      const csv = await fetchSpectraCatalog(path);
      const machines = joinCatalog(csv);
      setCatalog({ path, machines });
      toast.success(`${machines.length} machines from Spectra.`);
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
      toast.error(e instanceof Error ? e.message : "Could not read Spectra catalog.");
    } finally {
      setBusy(false);
    }
  };

  const addFromMachine = async (m: SpectraMachine) => {
    let schematicBase64: string | null = null;
    const drawn = renderPointSchematic(m.points);
    if (drawn) schematicBase64 = bytesToBase64(drawn);
    else if (catalog) {
      try {
        const jpeg = await fetchMachinePicture(catalog.path, m.machineId);
        if (jpeg.length > 8) schematicBase64 = bytesToBase64(jpeg);
      } catch {
        schematicBase64 = null;
      }
    }
    const item = makeEquipment({
      name: m.name || `Machine ${m.machineId}`,
      specs: buildMachineSpecs(m),
      sp3Path: catalog?.path ?? null,
      machineId: m.machineId,
      pointIds: m.points.map((p) => p.pointId),
      labels: machineLabelMap(m),
      schematicBase64,
    });
    set([...items, item]);
    setOpenId(item.id);
    toast.success(`Added ${item.name}.`);
  };

  const set = (next: EquipmentItem[]) => {
    onChange(next);
    saveEquipments(next);
  };

  const add = () => {
    const next = [...items, makeEquipment({ name: `Equipment ${items.length + 1}` })];
    set(next);
    setOpenId(next[next.length - 1].id);
  };

  const remove = (id: string) => {
    set(items.filter((e) => e.id !== id));
  };

  const patch = (id: string, p: Partial<EquipmentItem>) => {
    set(items.map((e) => (e.id === id ? { ...e, ...p } : e)));
  };

  const fillFromCurrent = (id: string, current: { name: string; specs: string }) => {
    patch(id, { name: current.name || "(untitled)", specs: current.specs });
    toast.success("Filled from current form.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Equipments ({items.length})</CardTitle>
        <CardDescription>Each becomes a section + TOC row. Empty = single-equipment mode.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {items.map((e, i) => (
          <div key={e.id} className="rounded-md border p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex-1 text-left text-sm font-medium"
                onClick={() => setOpenId(openId === e.id ? null : e.id)}
              >
                {i + 1}. {e.name || "(untitled)"} {e.status ? `· ${e.status}` : ""}
              </button>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(e.id)} aria-label={`Remove ${e.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {openId === e.id ? (
              <div className="mt-2 grid gap-2">
                <div className="grid gap-1">
                  <Label>Name</Label>
                  <Input value={e.name} onChange={(ev) => patch(e.id, { name: ev.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label>Status</Label>
                    <select
                      className="rounded-md border bg-background px-2 py-1.5 text-sm"
                      value={e.status}
                      onChange={(ev) => patch(e.id, { status: ev.target.value })}
                    >
                      <option value="">—</option>
                      {EQUIPMENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label>Last report</Label>
                    <Input value={e.lastReport} onChange={(ev) => patch(e.id, { lastReport: ev.target.value })} placeholder="2026-…: OK" />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label>Specs</Label>
                  <Textarea value={e.specs} onChange={(ev) => patch(e.id, { specs: ev.target.value })} rows={2} />
                </div>
                <div className="grid gap-1">
                  <Label>Problems (AI, editable)</Label>
                  <Textarea value={e.problems} onChange={(ev) => patch(e.id, { problems: ev.target.value })} rows={2} />
                </div>
                <div className="grid gap-1">
                  <Label>Corrective actions</Label>
                  <Textarea value={e.corrective} onChange={(ev) => patch(e.id, { corrective: ev.target.value })} rows={2} />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      fillFromCurrent(e.id, {
                        name: (document.getElementById("opt-equipment") as HTMLInputElement)?.value ?? "",
                        specs: (document.getElementById("opt-specs") as HTMLTextAreaElement)?.value ?? "",
                      })
                    }
                  >
                    Fill from form
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="h-4 w-4" /> Add equipment
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void importCatalog()} disabled={busy}>
            {busy ? "Reading…" : "Import from Spectra"}
          </Button>
        </div>
        {catalog ? (
          <div className="grid gap-1">
            <Label>Machines in {catalog.path.split(/[/\\]/).pop()}</Label>
            <div className="max-h-40 overflow-auto rounded-md border">
              {catalog.machines.map((m) => (
                <button
                  key={m.machineId}
                  type="button"
                  className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => void addFromMachine(m)}
                >
                  {m.name || m.machineId}
                  <span className="text-muted-foreground"> · {m.points.length} points</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function useEquipmentsState(): [EquipmentItem[], (n: EquipmentItem[]) => void] {
  const [items, setItems] = useState<EquipmentItem[]>(() => loadEquipments());
  return [items, setItems];
}
