// Materials are a shared catalog, referenced by id from any laminate's
// layers - not owned by a single laminate, so (unlike layers/criterion/dof
// values, see laminateAtoms.ts) they stay a single global atom rather than an
// atomFamily.
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_MATERIAL_ID, defaultMaterial } from "../lib/constants";
import type { MaterialDto } from "../lib/types";

export { DEFAULT_MATERIAL_ID };

// Persisted, unlike in the first version: a tool that loses the whole session
// on a reload cannot replace the spreadsheet it is meant to replace.
export const materialsAtom = atomWithStorage<MaterialDto[]>("elamx.materials", [defaultMaterial()]);
