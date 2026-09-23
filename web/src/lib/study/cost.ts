// What a study will cost, said before it runs.
//
// A matrix of CLT cells is over before anyone could read a warning; a sweep
// of plate buckling at twenty terms would take a quarter of an hour. So every
// study is priced from its point count and the per-call times below, and
// the page warns from ten seconds on and asks from two minutes on.
//
// The times were measured on the release core (per call, one laminate):
// the CLT 0.13 ms at 4 plies to 0.6 ms at 64; last ply failure, which is up
// to 2n CLT solves, 0.35 ms at 4 plies to 24 ms at 64 - quadratic in the
// plies; buckling 3 ms at 10x10 terms and 6.6 ms at 12x12, the eigenvalue
// problem growing with (m n)^3; vibration a little below buckling;
// deformation about 1 ms. A browser tab is slower than that bench, and a
// phone slower still, hence the margin.

import type { PointCall } from "./evaluate";

/** Warn from this estimate on. */
export const WARN_MS = 10_000;
/** Ask before starting from this estimate on. */
export const CONFIRM_MS = 120_000;
/** The Ritz terms a plate solve in a study may use, per direction. More is a
 *  question for the module page, one solve at a time. */
export const MAX_STUDY_TERMS = 12;

/** Bench to browser, with room for a slower machine. */
const MARGIN = 2;

export interface CallSize {
  /** Plies of the whole stack. */
  plies: number;
  /** Ritz terms m and n of a plate solve. */
  terms?: [number, number];
}

/** Estimated milliseconds of one core call. */
export function callCostMs(call: PointCall, size: CallSize): number {
  const plies = Math.max(1, size.plies);
  const [m, n] = size.terms ?? [10, 10];
  const unknowns = m * n;
  let ms: number;
  switch (call) {
    case "clt":
      ms = 0.12 + 0.0075 * plies;
      break;
    case "lpf":
      ms = 0.2 + 0.006 * plies * plies;
      break;
    case "buckling":
      ms = 0.8 + 3e-6 * unknowns ** 3;
      break;
    case "vibration":
      ms = 0.6 + 2.2e-6 * unknowns ** 3;
      break;
    case "deformation":
      ms = 0.6 + 4e-7 * unknowns ** 3;
      break;
  }
  return ms * MARGIN;
}

export type CostLevel = "ok" | "warn" | "confirm";

export interface CostEstimate {
  points: number;
  ms: number;
  level: CostLevel;
}

export function costLevel(ms: number): CostLevel {
  return ms >= CONFIRM_MS ? "confirm" : ms >= WARN_MS ? "warn" : "ok";
}

export function estimate(points: number, ms: number): CostEstimate {
  return { points, ms, level: costLevel(ms) };
}

/** A plate input with its terms capped for a study, and whether it was. */
export function capTerms<T extends { m: number; n: number }>(input: T): { input: T; capped: boolean } {
  const m = Math.min(input.m, MAX_STUDY_TERMS);
  const n = Math.min(input.n, MAX_STUDY_TERMS);
  return { input: m === input.m && n === input.n ? input : { ...input, m, n }, capped: m !== input.m || n !== input.n };
}

/** A short, stable fingerprint of a string - FNV-1a over UTF-16 units, two
 *  lanes for 53 bits. Only compared with itself, never stored. */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(36)}-${(h2 & 0x1fffff).toString(36)}-${text.length.toString(36)}`;
}
