import { parseLocaleNumber } from "./numberFormat";

// Ply angles are conventionally given in (-90 deg, 90 deg] - a fiber line at
// theta is physically identical to one at theta+180 deg (no "front/back" to
// a fiber direction, and Qbar depends only on cos^2/sin^2/sin*cos of theta,
// all periodic in 180 deg), so any angle a user enters or a stack operation
// produces is reduced to its unique representative in [-90, 90] here. Using
// "> 90"/"< -90" (not >=/<=) keeps already-canonical -90 and 90 unchanged,
// so this is idempotent for values already in range.
export function normalizeLayerAngle(angle: number): number {
  let a = angle % 180;
  if (a < -90) a += 180;
  if (a > 90) a -= 180;
  return a;
}

// Web counterpart of the Java original's LaminateStringParser convenience:
// the add-layer angle field accepts a whole stacking notation like
// "0/45/-45/90" and creates one layer per angle. A single plain number is
// just the 1-element case of the same syntax.
export function parseAngleStack(text: string): number[] | null {
  const parts = text.split("/").map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => p === "")) return null;
  const angles: number[] = [];
  for (const part of parts) {
    const value = parseLocaleNumber(part);
    if (value === null) return null;
    angles.push(value);
  }
  return angles;
}
