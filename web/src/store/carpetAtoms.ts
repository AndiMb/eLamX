// The carpet plot of one material.
//
// The lightest store in the app: there is no input to persist, only which of
// the three constants is being looked at, and that is a view setting rather
// than project data - so it lives in a plain atom and is gone on reload, like
// the chart series pickers elsewhere.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { selectAtom } from "jotai/utils";
import { loadableWithLastValue } from "../lib/loadable";
import type { CarpetPlotDto, CarpetValueId, MaterialDto } from "../lib/types";
import { elamx } from "../lib/wasm";
import { materialsAtom } from "./materialsAtoms";

export const carpetValueAtom = atom<CarpetValueId>("ex");

export const carpetPlotFamily = atomFamily((materialId: string) =>
  atom<Promise<CarpetPlotDto>>(async (get) => {
    const materials: MaterialDto[] = get(materialsAtom);
    const material = materials.find((m) => m.id === materialId);
    if (!material) {
      throw new Error(`Unbekannter Werkstoff: ${materialId}`);
    }
    const value = get(carpetValueAtom);
    const json = await elamx.compute_carpet_plot(JSON.stringify({ material, value }), materialId);
    return JSON.parse(json) as CarpetPlotDto;
  }),
);

export const loadableCarpetPlotFamily = atomFamily((materialId: string) =>
  loadableWithLastValue(carpetPlotFamily(materialId)),
);

export const carpetErrorFamily = atomFamily((materialId: string) =>
  selectAtom(loadableCarpetPlotFamily(materialId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
