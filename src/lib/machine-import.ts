import { makeEquipment, type EquipmentItem } from "./equipment";
import { fetchMachinePicture, fetchSpectraCatalog } from "./mdb";
import {
  buildMachineSpecs,
  bytesToBase64,
  joinCatalog,
  machineLabelMap,
  type SpectraMachine,
} from "./spectra-catalog";
import { chooseSchematic, linesForMachine, renderGMachinePng } from "./spectra-gmachine";
import { renderPointSchematic } from "./spectra-schematic";

export interface SpectraCatalog {
  path: string;
  machines: SpectraMachine[];
  gmachineCsv: string;
  gdirectionCsv: string;
}

export async function loadSpectraCatalog(path: string): Promise<SpectraCatalog> {
  const csv = await fetchSpectraCatalog(path);
  return {
    path,
    machines: joinCatalog(csv),
    gmachineCsv: csv.gmachineCsv ?? "",
    gdirectionCsv: csv.gdirectionCsv ?? "",
  };
}

/** Report machine from the Spectra tree: points, labels, specs, DB alarm limits, schematic. */
export async function equipmentFromMachine(
  catalog: SpectraCatalog,
  m: SpectraMachine
): Promise<EquipmentItem> {
  let jpeg: Uint8Array | null = null;
  try {
    const bytes = await fetchMachinePicture(catalog.path, m.machineId);
    if (bytes.length > 8) jpeg = bytes;
  } catch {
    jpeg = null;
  }
  const vectors = renderGMachinePng(
    linesForMachine(catalog.gmachineCsv, catalog.gdirectionCsv, m.machineId)
  );
  const chosen = chooseSchematic(jpeg, vectors, renderPointSchematic(m.points));
  return makeEquipment({
    name: m.name || `Machine ${m.machineId}`,
    specs: buildMachineSpecs(m),
    sp3Path: catalog.path,
    machineId: m.machineId,
    pointIds: m.points.map((p) => p.pointId),
    labels: machineLabelMap(m),
    plant: m.plantName,
    limits: m.limits,
    dbLimits: m.limits,
    schematicBase64: chosen ? bytesToBase64(chosen) : null,
  });
}

export function isMachineAdded(
  items: EquipmentItem[],
  catalogPath: string,
  machineId: string
): boolean {
  return items.some((e) => e.machineId === machineId && e.sp3Path === catalogPath);
}
