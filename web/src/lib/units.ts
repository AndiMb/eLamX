// Two-layer unit system: every atom that feeds a CltRequest holds a
// *canonical* value (the unit the Rust core actually expects - verified
// against elamx-core, e.g. rho=1.6e-9 * t_ges=0.4mm reproduces the core's own
// area_weight=6.4e-10 test output, confirming the mm/N/MPa/kg canonical
// system). Display/edit only ever happens through toCanonical/fromCanonical
// at the UI boundary (see components/Quantity.tsx) - the canonical value
// itself never changes when the user picks a different display unit.
//
// This list matches the architecture plan's QuantityCategory union exactly.
// Two categories deliberately have no unit conversion table at all (line
// loads/moments N/mm & N, curvatures 1/mm, and the criteria's dimensionless
// model-fitting coefficients like Tsai-Wu's F12*): none of those map onto any
// category below, and inventing new ones wasn't part of the approved plan -
// those fields use SafeNumberInput instead of Quantity (see MaterialPage,
// CltModuleContent).
export type QuantityCategory =
  | "stiffness"
  | "poissonRatio"
  | "thickness"
  | "angle"
  | "density"
  | "force"
  | "stress"
  | "strain"
  | "temperature"
  | "temperatureDelta"
  | "reserveFactor"
  | "percent";

export interface UnitOption {
  id: string;
  label: string;
  toCanonical: (displayValue: number) => number;
  fromCanonical: (canonicalValue: number) => number;
}

export interface CategoryDefinition {
  category: QuantityCategory;
  label: string;
  /** null => genuinely dimensionless: no unit selector, just decimals/notation. */
  units: UnitOption[] | null;
  defaultUnitId: string | null;
  defaultDecimals: number;
  defaultNotation: "fixed" | "scientific";
}

const identity = (id: string, label: string): UnitOption => ({
  id,
  label,
  toCanonical: (v) => v,
  fromCanonical: (v) => v,
});

const scaling = (id: string, label: string, canonicalPerUnit: number): UnitOption => ({
  id,
  label,
  toCanonical: (v) => v * canonicalPerUnit,
  fromCanonical: (v) => v / canonicalPerUnit,
});

// MPa canonical - shared table for both "stiffness" (moduli) and "stress"
// (strengths): same physical dimension, but kept as separate categories (per
// the plan) since a user reasonably wants different precision/unit defaults
// for a modulus like 140000 MPa vs a strength like 70 MPa.
const stressLikeUnits: UnitOption[] = [
  identity("MPa", "MPa"),
  scaling("GPa", "GPa", 1000),
  scaling("psi", "psi", 0.00689476),
  scaling("ksi", "ksi", 6.89476),
];

const thicknessUnits: UnitOption[] = [
  scaling("um", "µm", 0.001),
  identity("mm", "mm"),
  scaling("cm", "cm", 10),
  scaling("m", "m", 1000),
  scaling("in", "in", 25.4),
];

const angleUnits: UnitOption[] = [
  identity("deg", "°"),
  scaling("rad", "rad", 180 / Math.PI),
];

const densityUnits: UnitOption[] = [
  identity("kg_mm3", "kg/mm³"),
  scaling("kg_m3", "kg/m³", 1e-9),
  scaling("g_cm3", "g/cm³", 1e-6),
];

const forceUnits: UnitOption[] = [
  identity("N", "N"),
  scaling("kN", "kN", 1000),
  scaling("lbf", "lbf", 4.44822),
];

// Absolute temperature is affine (°C -> K needs +273.15, not just scaling),
// unlike every other category here - kept separate from temperatureDelta
// (a pure ΔT, where Δ1°C == Δ1K exactly) so absolute/relative conversion
// never gets mixed up.
const temperatureUnits: UnitOption[] = [
  identity("C", "°C"),
  { id: "K", label: "K", toCanonical: (v) => v - 273.15, fromCanonical: (v) => v + 273.15 },
  { id: "F", label: "°F", toCanonical: (v) => ((v - 32) * 5) / 9, fromCanonical: (v) => (v * 9) / 5 + 32 },
];

const temperatureDeltaUnits: UnitOption[] = [
  identity("dC", "Δ°C / ΔK"),
  scaling("dF", "Δ°F", 5 / 9),
];

// Canonical = whatever raw number the app already sent to the Rust core for
// delta_h (a moisture-content change fed straight into a linear hygral
// strain term, beta * delta_h - the core is unit-agnostic, purely
// multiplicative). "%" is kept as the identity unit so existing values are
// unaffected; "‰" and "Anteil" are offered as convenience alternates defined
// relative to that same baseline.
const percentUnits: UnitOption[] = [
  identity("pct", "%"),
  scaling("permille", "‰", 0.1),
  scaling("fraction", "Anteil", 100),
];

export const CATEGORY_DEFINITIONS: Record<QuantityCategory, CategoryDefinition> = {
  stiffness: {
    category: "stiffness",
    label: "Steifigkeit",
    units: stressLikeUnits,
    defaultUnitId: "MPa",
    defaultDecimals: 0,
    defaultNotation: "fixed",
  },
  stress: {
    category: "stress",
    label: "Spannung / Festigkeit",
    units: stressLikeUnits,
    defaultUnitId: "MPa",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  poissonRatio: {
    category: "poissonRatio",
    label: "Querkontraktionszahl",
    units: null,
    defaultUnitId: null,
    defaultDecimals: 4,
    defaultNotation: "fixed",
  },
  thickness: {
    category: "thickness",
    label: "Dicke",
    units: thicknessUnits,
    defaultUnitId: "mm",
    defaultDecimals: 2,
    defaultNotation: "fixed",
  },
  angle: {
    category: "angle",
    label: "Winkel",
    units: angleUnits,
    defaultUnitId: "deg",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  density: {
    category: "density",
    label: "Dichte",
    units: densityUnits,
    defaultUnitId: "g_cm3",
    defaultDecimals: 3,
    defaultNotation: "fixed",
  },
  force: {
    category: "force",
    label: "Kraft",
    units: forceUnits,
    defaultUnitId: "N",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  strain: {
    category: "strain",
    label: "Dehnung",
    units: null,
    defaultUnitId: null,
    defaultDecimals: 4,
    defaultNotation: "fixed",
  },
  temperature: {
    category: "temperature",
    label: "Temperatur",
    units: temperatureUnits,
    defaultUnitId: "C",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  temperatureDelta: {
    category: "temperatureDelta",
    label: "Temperaturänderung",
    units: temperatureDeltaUnits,
    defaultUnitId: "dC",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  reserveFactor: {
    category: "reserveFactor",
    label: "Reservefaktor",
    units: null,
    defaultUnitId: null,
    defaultDecimals: 3,
    defaultNotation: "fixed",
  },
  percent: {
    category: "percent",
    label: "Feuchteänderung",
    units: percentUnits,
    defaultUnitId: "pct",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
};
