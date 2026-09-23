// What a sweep varies, as transformations of the input - nothing else.
//
// Every function here takes a laminate, a load case and plate inputs and
// returns them with one value changed: an angle, a ply thickness, a load, a
// plate edge, or the mix of 0, +-45 and 90 degree plies. The mechanics stays
// in the core (N4); a sweep point is exactly the request a module page would
// send if the user had typed that value in.

import type { BucklingInputDto, DeformationInputDto, VibrationInputDto } from "../types";
import type { LayerRow } from "../constants";
import type { LaminateConfig, LoadCase } from "../../store/laminateAtoms";
import type { LoadComponent, VariationDef } from "./model";

/** The inputs a sweep point is made of. */
export interface SweepInput {
  laminate: LaminateConfig;
  loadCase: LoadCase;
  buckling: BucklingInputDto;
  vibration: VibrationInputDto;
  deformation: DeformationInputDto;
  /** Set by a `fraction` variation: the fractions of 0, +-45 and 90 degree
   *  plies, and which of them were given - the rest share what is left. */
  fractions: { value: [number, number, number]; given: [boolean, boolean, boolean] } | null;
}

/** The values a variation takes: `steps` points from `from` to `to`, both
 *  included. */
export function rangeValues(v: Pick<VariationDef, "from" | "to" | "steps">): number[] {
  const steps = Math.max(1, Math.round(v.steps));
  if (steps === 1) return [v.from];
  return Array.from({ length: steps }, (_, i) => v.from + ((v.to - v.from) * i) / (steps - 1));
}

const DOF_INDEX: Record<Exclude<LoadComponent, "factor">, number> = {
  n_x: 0,
  n_y: 1,
  n_xy: 2,
  m_x: 3,
  m_y: 4,
  m_xy: 5,
};

const FAMILY_INDEX = { "0": 0, "45": 1, "90": 2 } as const;

function mapLayers(laminate: LaminateConfig, map: (layer: LayerRow) => LayerRow): LaminateConfig {
  return { ...laminate, layers: laminate.layers.map(map) };
}

/** The input with one variation applied at one value. */
export function applyVariation(input: SweepInput, v: VariationDef, value: number): SweepInput {
  switch (v.kind) {
    case "angle": {
      // No layer named: every layer, which is what a single ply's sweep wants.
      const all = v.layers.length === 0 && v.negated.length === 0;
      return {
        ...input,
        laminate: mapLayers(input.laminate, (l) =>
          all || v.layers.includes(l.id)
            ? { ...l, angle: value }
            : v.negated.includes(l.id)
              ? { ...l, angle: -value }
              : l,
        ),
      };
    }
    case "thickness":
      return {
        ...input,
        laminate: mapLayers(input.laminate, (l) =>
          v.layers.length === 0 || v.layers.includes(l.id) ? { ...l, thickness: value } : l,
        ),
      };
    case "load": {
      const c = input.loadCase;
      if (v.component === "factor") {
        // Every prescribed load scaled; a prescribed strain is not a load and
        // stays, and so do temperature and moisture.
        return {
          ...input,
          loadCase: { ...c, dofValues: c.dofValues.map((d, i) => (c.useStrain[i] ? d : d * value)) },
        };
      }
      const i = DOF_INDEX[v.component];
      return {
        ...input,
        loadCase: {
          ...c,
          dofValues: c.dofValues.map((d, k) => (k === i ? value : d)),
          // The component becomes a load, whatever it was.
          useStrain: c.useStrain.map((s, k) => (k === i ? false : s)),
        },
      };
    }
    case "plate": {
      const key = v.dim === "a" ? "length" : "width";
      return {
        ...input,
        buckling: { ...input.buckling, [key]: value },
        vibration: { ...input.vibration, [key]: value },
        deformation: { ...input.deformation, [key]: value },
      };
    }
    case "fraction": {
      const at = FAMILY_INDEX[v.family];
      const current = input.fractions ?? { value: [0, 0, 0] as [number, number, number], given: [false, false, false] as [boolean, boolean, boolean] };
      const value3 = [...current.value] as [number, number, number];
      const given = [...current.given] as [boolean, boolean, boolean];
      value3[at] = value;
      given[at] = true;
      return { ...input, fractions: { value: value3, given } };
    }
  }
}

/** The fractions a p-laminate is made of: the given ones as they are, the
 *  others sharing the rest in the proportions of `base`. A string names why
 *  there are none. */
export function resolveFractions(
  given: { value: [number, number, number]; given: [boolean, boolean, boolean] },
  base: [number, number, number],
): [number, number, number] | "exceedsOne" | "undetermined" {
  const eps = 1e-9;
  const fixed = given.value.reduce((sum, f, i) => sum + (given.given[i] ? f : 0), 0);
  if (given.value.some((f, i) => given.given[i] && f < -eps)) return "exceedsOne";
  if (fixed > 1 + eps) return "exceedsOne";
  const rest = Math.max(0, 1 - fixed);
  const shares = base.map((b, i) => (given.given[i] ? 0 : Math.max(0, b)));
  const total = shares.reduce((a, b) => a + b, 0);
  if (rest > eps && total <= eps) return "undetermined";
  return given.value.map((f, i) => (given.given[i] ? Math.max(0, f) : total > eps ? (rest * shares[i]) / total : 0)) as [
    number,
    number,
    number,
  ];
}

/**
 * Ply counts of a symmetric `[0_a / (+45/-45)_b / 90_c]s` with `plies` in the
 * whole stack: `a` 0-degree plies, `b` +-45 PAIRS and `c` 90-degree plies in
 * the stored half.
 *
 * Largest remainders, so the counts are as close to the fractions as whole
 * plies allow and always add up: the half's `plies / 2` plies are shared out
 * by quota, rounded down, and the plies left over go to the largest
 * remainders. A +-45 pair takes two plies, so it only gets a left-over ply
 * where two are left.
 */
export function pliesByFraction(plies: number, fractions: [number, number, number]): { a: number; b: number; c: number } {
  const half = Math.max(1, Math.floor(plies / 2));
  const quota = [fractions[0] * half, (fractions[1] * half) / 2, fractions[2] * half];
  const counts = quota.map(Math.floor);
  let left = half - (counts[0] + 2 * counts[1] + counts[2]);
  const order = [0, 1, 2].sort((i, j) => quota[j] - Math.floor(quota[j]) - (quota[i] - Math.floor(quota[i])) || i - j);
  for (const i of order) {
    const size = i === 1 ? 2 : 1;
    if (left >= size && quota[i] - counts[i] > 1e-9) {
      counts[i] += 1;
      left -= size;
    }
  }
  // An odd ply left where only a pair was owed: to the larger of 0 and 90.
  while (left > 0) {
    const i = quota[0] >= quota[2] ? 0 : 2;
    counts[i] += 1;
    left -= 1;
  }
  return { a: counts[0], b: counts[1], c: counts[2] };
}

/** The p-laminate itself, from the base laminate's first ply: its material,
 *  thickness and criteria for every ply, in the fixed order 0, +-45, 90. */
export function pLaminate(base: LaminateConfig, plies: number, fractions: [number, number, number]): LaminateConfig {
  const template = base.layers[0];
  const { a, b, c } = pliesByFraction(plies, fractions);
  const angles = [...Array(a).fill(0), ...Array.from({ length: 2 * b }, (_, i) => (i % 2 === 0 ? 45 : -45)), ...Array(c).fill(90)];
  return {
    ...base,
    symmetric: true,
    withMiddleLayer: false,
    layers: angles.map((angle, i) => ({
      ...template,
      id: `p${i}`,
      name: `${i + 1}`,
      angle,
    })),
  };
}
