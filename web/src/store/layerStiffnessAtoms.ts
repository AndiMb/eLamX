// A single ply's stiffness and compliance, in both coordinate systems.
//
// Keyed by material and angle rather than by laminate and position, because
// that is what it depends on: the same ply at the same angle has the same Q
// wherever it sits in whatever stack, and two plies that share both share the
// answer and the request.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { loadableWithLastValue } from "../lib/loadable";
import type { LayerStiffnessDto, MaterialDto } from "../lib/types";
import { elamx } from "../lib/wasm";
import { materialsAtom } from "./materialsAtoms";

export function layerStiffnessKey(materialId: string, angleDeg: number): string {
  return `${materialId}@${angleDeg}`;
}

export const layerStiffnessFamily = atomFamily((key: string) =>
  atom<Promise<LayerStiffnessDto>>(async (get) => {
    const [materialId, angle] = key.split("@");
    const materials: MaterialDto[] = get(materialsAtom);
    const material = materials.find((m) => m.id === materialId);
    if (!material) throw new Error(`Unbekannter Werkstoff: ${materialId}`);
    const json = await elamx.compute_layer_stiffness(
      JSON.stringify({ material, angle_deg: Number(angle) }),
      key,
    );
    return JSON.parse(json) as LayerStiffnessDto;
  }),
);

export const loadableLayerStiffnessFamily = atomFamily((key: string) =>
  loadableWithLastValue(layerStiffnessFamily(key)),
);
