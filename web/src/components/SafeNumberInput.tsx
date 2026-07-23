import { useState } from "react";
import { parseLocaleNumber } from "../lib/numberFormat";

// For numeric fields that don't cleanly map onto any QuantityCategory (line
// loads/moments, curvatures, dimensionless criterion-fitting coefficients
// like Tsai-Wu's F12*) - same safe text/inputMode="decimal" + local-buffer
// editing behavior as Quantity (see there for why), just without unit
// conversion or Intl formatting.
export function SafeNumberInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [buffer, setBuffer] = useState<string | null>(null);
  const displayText = buffer ?? String(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={displayText}
      onFocus={() => setBuffer(String(value))}
      onChange={(e) => {
        setBuffer(e.target.value);
        const parsed = parseLocaleNumber(e.target.value);
        if (parsed !== null) {
          onChange(parsed);
        }
      }}
      onBlur={() => setBuffer(null)}
    />
  );
}
