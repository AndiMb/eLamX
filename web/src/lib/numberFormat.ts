// Intl.NumberFormat handles locale-aware, configurable display, but has no
// matching parser - this hand-writes the inverse for the decimal-input case.
// Returns null for anything that isn't (yet) a complete number, so callers
// (Quantity, SafeNumberInput) can tell "invalid" apart from "user is still
// mid-keystroke" and leave the field alone rather than force-correcting or
// clearing it - the specific mobile-safety hazard `type="number"` has.
export function parseLocaleNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(",", ".");
  if (!/^-?\d*\.?\d*(e-?\d+)?$/i.test(normalized)) return null;
  if (!/\d/.test(normalized)) return null; // "-", ".", "-." aren't numbers yet
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// JSON has no representation for NaN/Infinity, and serde_json writes `null`
// for both. A degenerate laminate - most easily produced by deleting every
// layer, which leaves a singular all-zero ABD matrix - therefore sends back
// nulls sitting in fields the DTOs type as `number`, and `.toFixed()` on one
// of those takes down the whole panel. Every display path that formats a
// solver result has to survive it, so they run the value through here first.
export const NO_VALUE = "–";

export function isFiniteResult(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface FormatConfig {
  decimals: number;
  notation: "fixed" | "scientific";
}

// The locale is passed in explicitly (rather than left to Intl's `undefined`
// = browser default) so the decimal separator follows the language the user
// picked IN THE APP: someone reading the English UI expects "1,234.5" even on
// a German Windows. Note the asymmetry with parseLocaleNumber above, which
// stays locale-agnostic on purpose - it accepts both separators, so switching
// language can never make a half-typed value unparseable.
export function formatNumber(value: number, config: FormatConfig, locale: string): string {
  if (!isFiniteResult(value)) return NO_VALUE;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
    notation: config.notation === "scientific" ? "scientific" : "standard",
  });
  return formatter.format(value);
}

// The three helpers below replace `value.toFixed(n)`, `value.toExponential(n)`
// and `value.toPrecision(n)` at every display site. Those three always write
// a POINT as the decimal separator, which in a German UI put "3.019e+4" next
// to "0,40" - the same character standing for a decimal separator in one place
// and a thousands separator in the other. Everything the user reads now goes
// through Intl with the locale the UI is running in.

/** Locale-aware `value.toFixed(digits)`. */
export function formatFixed(value: number | null | undefined, digits: number, locale: string): string {
  if (!isFiniteResult(value)) return NO_VALUE;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Locale-aware `value.toExponential(digits)`. */
export function formatScientific(
  value: number | null | undefined,
  digits: number,
  locale: string,
): string {
  if (!isFiniteResult(value)) return NO_VALUE;
  return new Intl.NumberFormat(locale, {
    notation: "scientific",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Locale-aware `value.toPrecision(digits)`. */
export function formatSignificant(
  value: number | null | undefined,
  digits: number,
  locale: string,
): string {
  if (!isFiniteResult(value)) return NO_VALUE;
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: digits }).format(value);
}

/**
 * Below this fraction of a matrix's largest entry, a value is the arithmetic's
 * own noise rather than a result: a balanced laminate's B matrix comes back as
 * ~1e-13 where it is exactly zero, and printed as `1,000E-13` that reads like
 * a coupling term nobody put there. eLamX 3.x never had the problem because
 * its stiffness format is a plain `0.0`, which collapses the same value to
 * `0,0`; this is that effect made explicit rather than a side effect of the
 * number of decimals.
 */
export const NEGLIGIBLE_FRACTION = 1e-10;

/** The largest absolute entry of a matrix, ignoring non-finite ones. */
export function matrixScale(matrix: number[][]): number {
  let scale = 0;
  for (const row of matrix) {
    for (const value of row) {
      if (isFiniteResult(value)) scale = Math.max(scale, Math.abs(value));
    }
  }
  return scale;
}

/** A matrix entry, with everything below the noise threshold shown as zero. */
export function formatMatrixEntry(
  value: number | null | undefined,
  scale: number,
  digits: number,
  locale: string,
): string {
  if (!isFiniteResult(value)) return NO_VALUE;
  if (Math.abs(value) < NEGLIGIBLE_FRACTION * scale) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(0);
  }
  return formatScientific(value, digits, locale);
}
