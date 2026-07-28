import { useState } from "react";
import { useAtomValue } from "jotai";
import { formatConfigFamily } from "../store/formatAtoms";
import { CATEGORY_DEFINITIONS, unitLabel, type QuantityCategory } from "../lib/units";
import { formatNumber, parseLocaleNumber } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

interface QuantityProps {
  category: QuantityCategory;
  /** Canonical value (the unit the Rust core expects), never the display unit. */
  value: number;
  onChange: (canonicalValue: number) => void;
  className?: string;
  "aria-label"?: string;
}

// Always <input type="text" inputMode="decimal"> - never type="number": mobile
// browsers blank a number input on invalid intermediate states ("-", a bare
// ",", mid-exponent), which under live recompute would silently zero out a
// value mid-keystroke. Instead this keeps an uncommitted local text buffer
// while focused, only calling onChange when the text currently parses to a
// full number, and reformats from the (possibly still-previous) canonical
// value on blur - so a value never gets force-corrected while being typed,
// and any leftover garbage snaps back once the field loses focus.
export function Quantity({ category, value, onChange, className, "aria-label": ariaLabel }: QuantityProps) {
  const t = useT();
  const locale = useLocale();
  const def = CATEGORY_DEFINITIONS[category];
  const format = useAtomValue(formatConfigFamily(category));
  const unit = def.units?.find((u) => u.id === format.unitId) ?? null;

  const toDisplay = (canonical: number) => (unit ? unit.fromCanonical(canonical) : canonical);
  const toCanonical = (display: number) => (unit ? unit.toCanonical(display) : display);

  // Non-null while the field is focused/being edited; null means "derive the
  // displayed text fresh from the (formatted) canonical value".
  const [buffer, setBuffer] = useState<string | null>(null);

  const displayText = buffer ?? formatNumber(toDisplay(value), format, locale);

  return (
    <span className="quantity">
      <input
        type="text"
        inputMode="decimal"
        className={className}
        aria-label={ariaLabel}
        value={displayText}
        onFocus={() => setBuffer(formatNumber(toDisplay(value), format, locale))}
        onChange={(e) => {
          setBuffer(e.target.value);
          const parsed = parseLocaleNumber(e.target.value);
          if (parsed !== null) {
            onChange(toCanonical(parsed));
          }
        }}
        onBlur={() => setBuffer(null)}
      />
      {unit && <span className="quantity-unit">{unitLabel(unit, t)}</span>}
    </span>
  );
}
