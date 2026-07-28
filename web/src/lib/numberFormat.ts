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
