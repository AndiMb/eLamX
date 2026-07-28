import { useAtomValue } from "jotai";
import { formatConfigFamily } from "../store/formatAtoms";
import { CATEGORY_DEFINITIONS, unitLabel, type QuantityCategory } from "../lib/units";
import { formatNumber } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

// Read-only counterpart to Quantity - same canonical -> display conversion
// and formatting, no editing/parsing concerns.
export function QuantityDisplay({ category, value }: { category: QuantityCategory; value: number }) {
  const t = useT();
  const locale = useLocale();
  const def = CATEGORY_DEFINITIONS[category];
  const format = useAtomValue(formatConfigFamily(category));
  const unit = def.units?.find((u) => u.id === format.unitId) ?? null;
  const displayValue = unit ? unit.fromCanonical(value) : value;

  return (
    <span className="quantity-display">
      {formatNumber(displayValue, format, locale)}
      {unit && <span className="quantity-unit"> {unitLabel(unit, t)}</span>}
    </span>
  );
}
