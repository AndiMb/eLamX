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

export interface FormatConfig {
  decimals: number;
  notation: "fixed" | "scientific";
}

export function formatNumber(value: number, config: FormatConfig): string {
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
    notation: config.notation === "scientific" ? "scientific" : "standard",
  });
  return formatter.format(value);
}
