import { useEditBuffer } from "./useEditBuffer";
import { formatEditable, parseLocaleNumber } from "../lib/numberFormat";
import { useLocale } from "../i18n";

// For numeric fields that don't cleanly map onto any QuantityCategory (line
// loads/moments, curvatures, dimensionless criterion-fitting coefficients
// like Tsai-Wu's F12*) - same safe text/inputMode="decimal" + local-buffer
// editing behavior as Quantity (see there for why), just without unit
// conversion or rounding: only the decimal separator follows the language.
export function SafeNumberInput({
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  /** Required wherever the field has no <label> of its own - a cell in a
   *  table is named by its column header for a sighted reader and by nothing
   *  at all for a screen reader. */
  "aria-label"?: string;
}) {
  const locale = useLocale();
  const buffer = useEditBuffer(value, (v) => formatEditable(v, locale));

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      aria-label={ariaLabel}
      value={buffer.text}
      onFocus={buffer.onFocus}
      onChange={(e) => {
        const parsed = parseLocaleNumber(e.target.value);
        buffer.onText(e.target.value, parsed);
        if (parsed !== null) {
          onChange(parsed);
        }
      }}
      onBlur={buffer.onBlur}
    />
  );
}
