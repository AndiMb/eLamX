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
import type { MessageKey } from "../i18n";

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
  | "thermalExpansion"
  | "hygralExpansion"
  | "reserveFactor"
  | "percent";

// Unit SYMBOLS ("MPa", "kg/mm³", "°") are not translated - they are SI/ISO
// notation, identical in every language, and translating them would be an
// error rather than a service. Only the two labels that are actual words get
// a message key: the category names ("Steifigkeit"/"Stiffness") and the one
// unit whose "symbol" is a word, `fraction` ("Anteil").
export interface UnitOption {
  id: string;
  /** A unit symbol; language-independent unless `labelKey` overrides it. */
  label: string;
  labelKey?: MessageKey;
  toCanonical: (displayValue: number) => number;
  fromCanonical: (canonicalValue: number) => number;
}

export interface CategoryDefinition {
  category: QuantityCategory;
  labelKey: MessageKey;
  /** null => genuinely dimensionless: no unit selector, just decimals/notation. */
  units: UnitOption[] | null;
  defaultUnitId: string | null;
  defaultDecimals: number;
  defaultNotation: "fixed" | "scientific";
}

/** Resolves a unit's display label, translating the rare word-valued ones. */
export function unitLabel(unit: UnitOption, t: (key: MessageKey) => string): string {
  return unit.labelKey ? t(unit.labelKey) : unit.label;
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
// unaffected; "‰" and the fraction unit are offered as convenience alternates defined
// relative to that same baseline.
const percentUnits: UnitOption[] = [
  identity("pct", "%"),
  scaling("permille", "‰", 0.1),
  { ...scaling("fraction", "fraction", 100), labelKey: "unit.fraction" },
];

// alpha_t: canonical 1/K. Typical CFRP values are ~1e-6, so the default
// display unit is 10^-6/K ("ppm/K") - entering "28" beats entering "0.000028".
const thermalExpansionUnits: UnitOption[] = [
  identity("per_K", "1/K"),
  scaling("ppm_K", "10⁻⁶/K", 1e-6),
  scaling("ppm_F", "10⁻⁶/°F", 1e-6 * (9 / 5)),
];

// beta: canonical 1/%, i.e. the reciprocal of whatever unit delta_h is given
// in. The core only ever forms beta * delta_h, so the two must share a unit
// convention - see percentUnits, whose identity unit is likewise "%".
const hygralExpansionUnits: UnitOption[] = [
  identity("per_pct", "1/%"),
  scaling("per_permille", "1/‰", 10),
  { ...scaling("per_fraction", "per fraction", 0.01), labelKey: "unit.perFraction" },
];

export const CATEGORY_DEFINITIONS: Record<QuantityCategory, CategoryDefinition> = {
  stiffness: {
    category: "stiffness",
    labelKey: "quantity.stiffness",
    units: stressLikeUnits,
    defaultUnitId: "MPa",
    defaultDecimals: 0,
    defaultNotation: "fixed",
  },
  stress: {
    category: "stress",
    labelKey: "quantity.stress",
    units: stressLikeUnits,
    defaultUnitId: "MPa",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  poissonRatio: {
    category: "poissonRatio",
    labelKey: "quantity.poissonRatio",
    units: null,
    defaultUnitId: null,
    defaultDecimals: 4,
    defaultNotation: "fixed",
  },
  thickness: {
    category: "thickness",
    labelKey: "quantity.thickness",
    units: thicknessUnits,
    defaultUnitId: "mm",
    defaultDecimals: 2,
    defaultNotation: "fixed",
  },
  angle: {
    category: "angle",
    labelKey: "quantity.angle",
    units: angleUnits,
    defaultUnitId: "deg",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  density: {
    category: "density",
    labelKey: "quantity.density",
    units: densityUnits,
    defaultUnitId: "g_cm3",
    defaultDecimals: 3,
    defaultNotation: "fixed",
  },
  force: {
    category: "force",
    labelKey: "quantity.force",
    units: forceUnits,
    defaultUnitId: "N",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  strain: {
    category: "strain",
    labelKey: "quantity.strain",
    units: null,
    defaultUnitId: null,
    defaultDecimals: 4,
    defaultNotation: "fixed",
  },
  temperature: {
    category: "temperature",
    labelKey: "quantity.temperature",
    units: temperatureUnits,
    defaultUnitId: "C",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  temperatureDelta: {
    category: "temperatureDelta",
    labelKey: "quantity.temperatureDelta",
    units: temperatureDeltaUnits,
    defaultUnitId: "dC",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
  thermalExpansion: {
    category: "thermalExpansion",
    labelKey: "quantity.thermalExpansion",
    units: thermalExpansionUnits,
    defaultUnitId: "ppm_K",
    defaultDecimals: 2,
    defaultNotation: "fixed",
  },
  hygralExpansion: {
    category: "hygralExpansion",
    labelKey: "quantity.hygralExpansion",
    units: hygralExpansionUnits,
    defaultUnitId: "per_pct",
    defaultDecimals: 4,
    defaultNotation: "fixed",
  },
  reserveFactor: {
    category: "reserveFactor",
    labelKey: "quantity.reserveFactor",
    units: null,
    defaultUnitId: null,
    defaultDecimals: 3,
    defaultNotation: "fixed",
  },
  percent: {
    category: "percent",
    labelKey: "quantity.percent",
    units: percentUnits,
    defaultUnitId: "pct",
    defaultDecimals: 1,
    defaultNotation: "fixed",
  },
};
