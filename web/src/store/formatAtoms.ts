// Global per-category display preferences (unit + decimals + notation) -
// deliberately kept separate from the domain data atoms (laminateAtoms.ts,
// materialsAtoms.ts): these are cross-cutting UI preferences, not part of
// any laminate/material, and persist across reloads via atomWithStorage
// (localStorage) while domain data currently doesn't.
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { CATEGORY_DEFINITIONS, type QuantityCategory } from "../lib/units";
import type { FormatConfig as NumberFormatConfig } from "../lib/numberFormat";

export interface FormatConfig extends NumberFormatConfig {
  unitId: string | null;
}

export const formatConfigFamily = atomFamily((category: QuantityCategory) => {
  const def = CATEGORY_DEFINITIONS[category];
  return atomWithStorage<FormatConfig>(`elamx.format.${category}`, {
    unitId: def.defaultUnitId,
    decimals: def.defaultDecimals,
    notation: def.defaultNotation,
  });
});
