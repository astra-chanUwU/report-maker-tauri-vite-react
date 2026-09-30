/** Multi-equipment list + client profiles (brochure p.3-4). Pure + localStorage. */

export interface EquipmentItem {
  id: string;
  name: string;
  specs: string;
  status: string;
  lastReport: string;
  problems: string;
  corrective: string;
  schematicBase64: string | null;
  /** Source Spectra .sp3, when imported from a catalog. */
  sp3Path?: string | null;
  /** Spectra MachineID inside that file. */
  machineId?: string | null;
  /** PointIDs belonging to this machine (filters vib rows). */
  pointIds?: string[];
  /** "pointId directionId" → brochure label such as "P1 V". */
  labels?: Record<string, string>;
  /** Per-machine condition narrative. Empty stays out of that section. */
  summary?: string;
  methodology?: string;
  observations?: string;
  recommendations?: string;
  conclusion?: string;
}

export const EQUIPMENT_STATUSES = ["Healthy", "Alert", "Danger", "Shutdown"] as const;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export function makeEquipment(partial: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    id: partial.id ?? uid(),
    name: partial.name ?? "",
    specs: partial.specs ?? "",
    status: partial.status ?? "",
    lastReport: partial.lastReport ?? "",
    problems: partial.problems ?? "",
    corrective: partial.corrective ?? "",
    schematicBase64: partial.schematicBase64 ?? null,
    sp3Path: partial.sp3Path ?? null,
    machineId: partial.machineId ?? null,
    pointIds: partial.pointIds ?? [],
    labels: partial.labels ?? {},
    summary: partial.summary ?? "",
    methodology: partial.methodology ?? "",
    observations: partial.observations ?? "",
    recommendations: partial.recommendations ?? "",
    conclusion: partial.conclusion ?? "",
  };
}

const EQ_KEY = "report-maker:equipments:v1";

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function loadEquipments(): EquipmentItem[] {
  try {
    const raw = lsGet(EQ_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as EquipmentItem[];
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

export function saveEquipments(list: EquipmentItem[]): void {
  lsSet(EQ_KEY, JSON.stringify(list.slice(0, 200)));
}

/** TOC rows: index + name + status. */
export function buildTocData(
  list: EquipmentItem[]
): { index: number; name: string; status: string }[] {
  return list.map((e, i) => ({
    index: i + 1,
    name: e.name.trim() || `Equipment ${i + 1}`,
    status: e.status || "—",
  }));
}

// ---- Client profiles ----

export interface ClientProfile {
  id: string;
  clientName: string;
  clientUnit: string;
  addressBlock: string;
  logoBase64: string | null;
  /** ISO appendix group filter: all | 1+3 | 2+4. */
  isoGroups?: "all" | "1+3" | "2+4";
}

const CLIENT_KEY = "report-maker:clients:v1";

export function loadClients(): ClientProfile[] {
  try {
    const raw = lsGet(CLIENT_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as ClientProfile[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveClients(list: ClientProfile[]): void {
  lsSet(CLIENT_KEY, JSON.stringify(list.slice(0, 50)));
}

export function makeClient(partial: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: partial.id ?? uid(),
    clientName: partial.clientName ?? "",
    clientUnit: partial.clientUnit ?? "",
    addressBlock: partial.addressBlock ?? "",
    logoBase64: partial.logoBase64 ?? null,
    isoGroups: partial.isoGroups ?? "all",
  };
}
