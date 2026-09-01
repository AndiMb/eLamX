// The eight quantities the deformation module can show, and what each one is.
//
// One table rather than a switch in every component: the label, the unit
// category the app's own format settings apply to it, and which colour scale
// the quantity wants. That last one is not decoration - it says where the
// scale is anchored, and a reserve factor on the diverging scale would put its
// neutral colour at zero, nowhere near the 1.0 that decides anything.

import type { MessageKey } from "../i18n";
import type { ColormapKind } from "./plateScene/colormap";
import type { PlateFieldId } from "./types";
import type { QuantityCategory } from "./units";

export interface PlateFieldDefinition {
  id: PlateFieldId;
  labelKey: MessageKey;
  /** Which of the app's format/unit settings this quantity follows (NFR-08). */
  category: QuantityCategory;
  /** Which colour scale the quantity wants, and where it is anchored. */
  scale: ColormapKind;
  /** Whether the value depends on which ply and which face of it. */
  perPly: boolean;
}

export const PLATE_FIELDS: PlateFieldDefinition[] = [
  {
    id: "Deflection",
    labelKey: "plateField.deflection",
    category: "thickness",
    scale: "diverging",
    perPly: false,
  },
  { id: "StrainPar", labelKey: "plateField.strainPar", category: "strain", scale: "diverging", perPly: true },
  { id: "StrainNor", labelKey: "plateField.strainNor", category: "strain", scale: "diverging", perPly: true },
  {
    id: "StrainShear",
    labelKey: "plateField.strainShear",
    category: "strain",
    scale: "diverging",
    perPly: true,
  },
  { id: "StressPar", labelKey: "plateField.stressPar", category: "stress", scale: "diverging", perPly: true },
  { id: "StressNor", labelKey: "plateField.stressNor", category: "stress", scale: "diverging", perPly: true },
  {
    id: "StressShear",
    labelKey: "plateField.stressShear",
    category: "stress",
    scale: "diverging",
    perPly: true,
  },
  {
    id: "ReserveFactor",
    labelKey: "plateField.reserveFactor",
    category: "reserveFactor",
    // Anchored at 1.0 - the value that decides whether the ply holds - and
    // coloured danger to safe rather than negative to positive.
    scale: "reserve",
    perPly: true,
  },
];

const BY_ID = new Map(PLATE_FIELDS.map((definition) => [definition.id, definition]));

export function plateFieldDefinition(id: PlateFieldId): PlateFieldDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown plate field ${id}`);
  return found;
}

export const LAYER_POSITIONS = ["Upper", "Middle", "Lower"] as const;
