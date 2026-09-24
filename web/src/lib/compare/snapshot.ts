// A snapshot (F4.3): a laminate under one load case, frozen under a name.
//
// It copies the laminate and every material the laminate uses, so it means
// the same after the laminate is edited or deleted - the point of pinning a
// state is to compare against it after changing things. Its results are
// computed afresh from the copy, by the same core call as a live column;
// `key_figures` only records what they were when it was taken, for the
// "then" beside the "now".

import type { Snapshot } from "../generated/Snapshot";
import type { CltRequest, CltResponse, MaterialDto } from "../types";
import { buildCltRequest, laminateDtoOf } from "../../store/derivedAtoms";
import type { LaminateConfig, LoadCase } from "../../store/laminateAtoms";
import { minReserveFactorOf } from "../study/evaluate";

export type { Snapshot };

/** The figures a snapshot records, by name. */
export function keyFiguresOf(clt: CltResponse | null, modules: Record<string, number | null> = {}): Record<string, number> {
  const figures: Record<string, number> = {};
  const put = (key: string, value: number | null | undefined) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) figures[key] = value;
  };
  if (clt) {
    put("min_rf", minReserveFactorOf(clt));
    put("ex", clt.engineering_constants.ex_simple);
    put("ey", clt.engineering_constants.ey_simple);
    put("gxy", clt.engineering_constants.g_simple);
    put("nuxy", clt.engineering_constants.nuxy_simple);
    put("area_weight", clt.area_weight);
    put("tges", clt.tges);
  }
  for (const [key, value] of Object.entries(modules)) put(key, value);
  return figures;
}

export function takeSnapshot(
  name: string,
  config: LaminateConfig,
  loadCase: LoadCase,
  materials: MaterialDto[],
  keyFigures: Record<string, number>,
  at: Date = new Date(),
): Snapshot {
  const used = new Set(config.layers.map((l) => l.materialId));
  return {
    id: crypto.randomUUID(),
    name,
    at: at.toISOString(),
    laminate: laminateDtoOf(config),
    materials: materials.filter((m) => used.has(m.id)).map((m) => structuredClone(m)),
    load_case: {
      name: loadCase.name,
      dof_values: [...loadCase.dofValues],
      use_strain: [...loadCase.useStrain],
      delta_t: loadCase.deltaT,
      delta_h: loadCase.deltaH,
    },
    key_figures: keyFigures,
  };
}

/** The snapshot's load case in the shape the app computes with. */
export function snapshotLoadCase(snapshot: Snapshot): LoadCase {
  const c = snapshot.load_case;
  return {
    id: `snapshot:${snapshot.id}`,
    name: c.name,
    dofValues: [...c.dof_values],
    useStrain: [...c.use_strain],
    deltaT: c.delta_t,
    deltaH: c.delta_h,
  };
}

/** The request a snapshot's column is computed with - from its own copies
 *  of the laminate and the materials, never from the project's. */
export function snapshotCltRequest(snapshot: Snapshot): CltRequest {
  return buildCltRequest(
    snapshot.laminate,
    Object.fromEntries(snapshot.materials.map((m) => [m.id, m])),
    snapshotLoadCase(snapshot),
  );
}
