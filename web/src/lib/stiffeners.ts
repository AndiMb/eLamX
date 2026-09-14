// Making and reshaping a stiffener in the editor.
//
// The arithmetic all lives in the core (elamx-core/core/src/plate/stiffener.rs);
// what is left here is what the editor needs and the core has no opinion on:
// what a freshly added stiffener contains, and what happens to the numbers
// already typed in when the profile is switched.
//
// eLamX's own no-arg constructors fill every property with 0.0 and make you
// walk a wizard to replace them. A stiffener of zero E·I and zero G·J is a
// stiffener that does nothing, and here - where the result recomputes on every
// keystroke - adding one and seeing the plate not move reads as a broken
// feature rather than as an empty form. So a new stiffener is a real one: a
// 30 x 3 blade of aluminium across the middle of the plate, which is the same
// call the deformation module already makes by opening with a surface load.

import type { StiffenerDto, StiffenerProfileId } from "./types";

/** Aluminium, to go with the blade: E, G in MPa and rho in t/mm^3. */
const E = 70000;
const G = 27000;
const RHO = 2.7e-9;

export function defaultStiffener(
  profile: StiffenerProfileId,
  name: string,
  direction: StiffenerDto["direction"] = "x",
): StiffenerDto {
  return withProfile({ name, direction, position: 0, profile: "i_profile", w1: 30, t1: 3, e: E, g: G, rho: RHO }, profile);
}

/**
 * The same stiffener under a different profile.
 *
 * Name, direction and position always survive, and so do the material
 * constants - they mean the same thing under every profile. The geometry does
 * not carry over, because `w1` is a blade's height and a T's flange width;
 * keeping the number would silently turn a 30 mm blade into a 30 mm flange.
 */
export function withProfile(
  stiffener: StiffenerDto,
  profile: StiffenerProfileId,
): StiffenerDto {
  if (stiffener.profile === profile) return stiffener;
  const { name, direction, position } = stiffener;
  const e = stiffener.e;
  const g = stiffener.g;
  const rho = stiffener.rho;

  switch (profile) {
    case "i_profile":
      return { name, direction, position, profile, w1: 30, t1: 3, e, g, rho };
    case "t_profile":
      return { name, direction, position, profile, w1: 24, t1: 2, w2: 30, t2: 3, e, g, rho };
    default:
      // The direct input is the one case where something can be carried over
      // rather than defaulted: the section properties the other profiles would
      // have computed are exactly what it asks for. Computing them here would
      // mean a second copy of the formulas, so it starts from the blade's.
      return { name, direction, position, profile, e, i: 27000, g, j: 270, a: 90, rho };
  }
}

/**
 * A plate input with its stiffener list guaranteed to exist.
 *
 * Both plate inputs are persisted in localStorage, and everything stored
 * before stiffeners existed has no `stiffeners` key. Rust fills it in on the
 * way into the core (`#[serde(default)]`), but the editor reads it first, and
 * `undefined.map` is a blank module rather than a missing feature.
 */
export function withStiffeners<T extends { stiffeners: StiffenerDto[] }>(input: T): T {
  return input.stiffeners ? input : { ...input, stiffeners: [] };
}
