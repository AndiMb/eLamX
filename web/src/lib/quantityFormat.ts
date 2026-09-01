// The app's unit and format settings, resolved for one quantity (NFR-08).
//
// The same conversion `QuantityDisplay` does, but as a function the caller can
// apply to many numbers - a colour bar formats five tick labels and a range,
// and mounting a component per label to do it would be five subscriptions to
// the same atom.
import { useAtomValue } from "jotai";
import { CATEGORY_DEFINITIONS, unitLabel, type QuantityCategory } from "./units";
import { formatConfigFamily } from "../store/formatAtoms";
import { formatNumber, formatScientific } from "./numberFormat";
import { useLocale, useT } from "../i18n";

export interface QuantityFormat {
  /** The unit's label, or null for a dimensionless quantity. */
  unit: string | null;
  /** A canonical value, converted and formatted for display. */
  text: (value: number) => string;
  /**
   * The same, but falling back to scientific notation outside the band where
   * a fixed-decimal setting still says anything.
   *
   * For a legend rather than for a field. A strain of 8.1e-5 under a two
   * decimal setting prints as "0,00", and a reserve factor at an unloaded edge
   * prints as seventeen digits of noise; both are the format setting being
   * applied outside the range it was chosen for.
   */
  compact: (value: number) => string;
}

/** Outside this band a fixed-decimal setting stops carrying information. */
const COMPACT_MAX = 1e5;
const COMPACT_MIN = 1e-3;

export function useQuantityFormat(category: QuantityCategory): QuantityFormat {
  const t = useT();
  const locale = useLocale();
  const definition = CATEGORY_DEFINITIONS[category];
  const format = useAtomValue(formatConfigFamily(category));
  const unit = definition.units?.find((u) => u.id === format.unitId) ?? null;
  const display = (value: number) => (unit ? unit.fromCanonical(value) : value);
  return {
    unit: unit ? unitLabel(unit, t) : null,
    text: (value: number) => formatNumber(display(value), format, locale),
    compact: (value: number) => {
      const shown = display(value);
      const magnitude = Math.abs(shown);
      return magnitude !== 0 && (magnitude >= COMPACT_MAX || magnitude < COMPACT_MIN)
        ? formatScientific(shown, 2, locale)
        : formatNumber(shown, format, locale);
    },
  };
}
