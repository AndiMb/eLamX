// Which way is better, per key figure - for the comparison to say not only
// that two columns differ but which one is ahead.
//
// Higher is better for what a design is checked against: reserve factors,
// stiffnesses, the buckling factor, the first frequency. Lower is better
// for what it costs: mass, deflection, failed plies. The rest - the layup,
// the loads, Poisson's ratio - are inputs or neither, and only differ.

export type Direction = "higher" | "lower" | "neutral";
export type Verdict = "better" | "worse" | "same" | "neutral";

export const DIRECTIONS: Record<string, Direction> = {
  minRf: "higher",
  verdict: "higher",
  ex_simple: "higher",
  ey_simple: "higher",
  g_simple: "higher",
  bucklingFactor: "higher",
  fundamentalFrequency: "higher",
  lpfFirstMatrix: "higher",
  lpfFinal: "higher",
  areaWeight: "lower",
  maxDeflection: "lower",
  failedPlies: "lower",
};

export function directionOf(key: string): Direction {
  return DIRECTIONS[key] ?? "neutral";
}

/** How `value` compares with `reference` for a figure that goes `direction`.
 *  Relative tolerance, so rounding noise is not a verdict. */
export function compareValues(direction: Direction, value: number | null, reference: number | null): Verdict {
  if (value === null || reference === null || !Number.isFinite(value) || !Number.isFinite(reference)) return "neutral";
  const scale = Math.max(Math.abs(value), Math.abs(reference), 1e-300);
  if (Math.abs(value - reference) <= 1e-9 * scale) return "same";
  if (direction === "neutral") return "neutral";
  const higher = value > reference;
  return higher === (direction === "higher") ? "better" : "worse";
}

/** For a maximum deflection the magnitude is what matters: a plate
 *  deflecting -3 mm is not doing better than one deflecting +1 mm. */
export function comparable(key: string, value: number | null): number | null {
  return key === "maxDeflection" && value !== null ? Math.abs(value) : value;
}
