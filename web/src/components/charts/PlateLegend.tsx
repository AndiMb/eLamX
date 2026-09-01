import { useMemo } from "react";
import { buildColormap, sampleColormap } from "../../lib/plateScene/colormap";
import { useChartColors } from "../../lib/chartColors";
import { plateFieldDefinition } from "../../lib/plateFields";
import { useQuantityFormat } from "../../lib/quantityFormat";
import type { PlateFieldId } from "../../lib/types";
import { useT } from "../../i18n";

// The colour bar (FR-05).
//
// It is built from the same 256-entry table the shader samples, so the legend
// cannot claim a colour the surface does not use - which is the whole reason
// the value travels to the GPU as a number and becomes a colour there rather
// than being turned into one on the way.
//
// The scale is anchored, not merely stretched: zero sits in the middle for a
// signed quantity and 1.0 for a reserve factor. The anchor is marked, because
// a reader who has to work out where "safe" begins by reading two end labels
// has been given a picture that needs a manual.

/** Stops in the CSS gradient. Enough that the eye sees no banding. */
const GRADIENT_STOPS = 17;
/** Labelled ticks along the bar, ends included. */
const TICKS = 5;

export interface PlateLegendProps {
  field: PlateFieldId;
  /** The limits the colours are stretched over. */
  bounds: [number, number];
  /** The data's own extremes, which need not be the limits. */
  min: number;
  max: number;
  /** How many points carried no answer. */
  gaps: number;
}

export function PlateLegend({ field, bounds, min, max, gaps }: PlateLegendProps) {
  const t = useT();
  const colors = useChartColors();
  const definition = plateFieldDefinition(field);
  const { unit, compact } = useQuantityFormat(definition.category);

  const gradient = useMemo(() => {
    const table = buildColormap(colors, definition.scale);
    const stops = Array.from({ length: GRADIENT_STOPS }, (_, i) => {
      const t01 = i / (GRADIENT_STOPS - 1);
      const [r, g, b] = sampleColormap(table, t01);
      // Bottom of the bar is the low end, so the gradient runs upwards.
      return `rgb(${r} ${g} ${b}) ${(t01 * 100).toFixed(1)}%`;
    });
    return `linear-gradient(to top, ${stops.join(", ")})`;
  }, [colors, definition.scale]);

  const [low, high] = bounds;
  const span = high - low;
  const at = (value: number) => (span > 0 ? ((value - low) / span) * 100 : 50);

  const ticks = Array.from({ length: TICKS }, (_, i) => low + (span * i) / (TICKS - 1));
  const anchor = definition.scale === "reserve" ? 1 : definition.scale === "diverging" ? 0 : null;
  const anchorInside = anchor !== null && anchor > low && anchor < high;

  return (
    <div
      className="plate3d-legend"
      role="img"
      aria-label={t("plate3d.legend.aria", {
        field: t(definition.labelKey),
        min: compact(low),
        max: compact(high),
      })}
    >
      <span className="plate3d-legend-title">
        {t(definition.labelKey)}
        {unit && <span className="plate3d-legend-unit"> [{unit}]</span>}
      </span>
      <div className="plate3d-legend-body">
        <div className="plate3d-legend-bar" style={{ background: gradient }}>
          {anchorInside && (
            <span
              className="plate3d-legend-anchor"
              style={{ bottom: `${at(anchor)}%` }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="plate3d-legend-ticks">
          {ticks.map((value, i) => (
            <span key={i} style={{ bottom: `${at(value)}%` }}>
              {compact(value)}
            </span>
          ))}
        </div>
      </div>
      {/* What the data actually reaches, which is not the same as what the
          scale covers once the scale is anchored or set by hand. */}
      <span className="plate3d-legend-range">
        {compact(min)} … {compact(max)}
      </span>
      {gaps > 0 && <span className="plate3d-legend-gaps">{t("plateView.holes", { count: gaps })}</span>}
    </div>
  );
}
