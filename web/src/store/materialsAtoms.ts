// Materials are a shared catalog, referenced by id from any laminate's
// layers - not owned by a single laminate, so (unlike layers/criterion/dof
// values, see laminateAtoms.ts) they stay a single global atom rather than an
// atomFamily.
import { atom } from "jotai";
import { defaultMaterial } from "../lib/constants";
import type { MaterialDto } from "../lib/types";

const initialMaterial = defaultMaterial();

export const DEFAULT_MATERIAL_ID = initialMaterial.id;

export const materialsAtom = atom<MaterialDto[]>([initialMaterial]);
