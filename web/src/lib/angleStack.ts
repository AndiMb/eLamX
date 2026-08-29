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


// Unicode subscript digits, so a repeated ply group reads as "0\u2082/45" rather
// than "0/0/45" - the conventional stacking notation, and short enough for the
// context bar above every module page.
const SUBSCRIPTS = ["\u2080", "\u2081", "\u2082", "\u2083", "\u2084", "\u2085", "\u2086", "\u2087", "\u2088", "\u2089"];

function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPTS[Number(d)])
    .join("");
}

/**
 * The stack in the notation people write on a drawing: `[0\u2082/45/-45]s`.
 *
 * Consecutive equal angles collapse into a subscripted count, and a symmetric
 * laminate gets the trailing `s` instead of its mirrored half being spelled
 * out. Angles are the STORED ones, so this is the same half of the stack the
 * layer table shows.
 */
export function shortStackNotation(
  angles: number[],
  symmetric: boolean,
  withMiddleLayer: boolean,
): string {
  if (angles.length === 0) return "[ ]";

  const groups: { angle: number; count: number }[] = [];
  for (const angle of angles) {
    const last = groups[groups.length - 1];
    if (last && last.angle === angle) last.count += 1;
    else groups.push({ angle, count: 1 });
  }

  const parts = groups.map((g) => {
    const angle = formatAngle(g.angle);
    return g.count > 1 ? `${angle}${subscript(g.count)}` : angle;
  });

  // A middle layer is shared with the mirrored half rather than repeated, and
  // carries an overbar - over the ANGLE, which is what the bar refers to, not
  // after the closing bracket.
  if (symmetric && withMiddleLayer && parts.length > 0) {
    // U+0304 COMBINING MACRON: it renders as a bar over the angle before it.
    parts[parts.length - 1] += "̄";
  }

  const body = parts.join("/");
  return symmetric ? `[${body}]s` : `[${body}]`;
}

// Angles are data, not measurements: -45 stays "-45", 22.5 stays "22.5". No
// locale formatting, because this string is meant to be recognised and
// re-typed into the angle field, which parses both separators anyway.
function formatAngle(angle: number): string {
  return Number.isInteger(angle) ? String(angle) : String(Number(angle.toFixed(2)));
}

/**
 * Expanded ply count and total thickness of a stored stack, following
 * `Laminate::number_of_layers` / `Laminate::thickness` in the core: a
 * symmetric laminate is mirrored, and a shared middle layer - always the LAST
 * stored one - is counted once.
 */
export function expandedStack(
  thicknesses: number[],
  symmetric: boolean,
  withMiddleLayer: boolean,
): { plies: number; thickness: number } {
  let plies = thicknesses.length;
  let thickness = thicknesses.reduce((sum, t) => sum + t, 0);
  if (symmetric) {
    plies *= 2;
    thickness *= 2;
    if (withMiddleLayer && thicknesses.length > 0) {
      plies -= 1;
      thickness -= thicknesses[thicknesses.length - 1];
    }
  }
  return { plies, thickness };
}
