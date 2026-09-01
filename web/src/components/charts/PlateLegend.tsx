import { useMemo } from "react";
import { buildColormap, sampleColormap, type ColormapKind } from "../../lib/plateScene/colormap";
import { useChartColors } from "../../lib/chartColors";
import { useT } from "../../i18n";

// The colour bar (FR-05).
//
// Built from the same 256-entry table the shader samples, so the legend cannot
// claim a colour the surface does not use - which is the whole reason the value
// travels to the GPU as a number and becomes a colour there rather than being
// turned into one on the way.
//
// The model arrives ready-made rather than being derived here, because the
// exported image needs the same one: an export whose ticks sat at different
// values from the ones on screen would be worse than no export at all.

/** Stops in the CSS gradient. Enough that the eye sees no banding. */
const GRADIENT_STOPS = 17;

export interface PlateLegendModel {
  title: string;
  /** The unit's label, or null for a dimensionless quantity. */
  unit: string | null;
  /** Bottom to top, matching the bar. */
  ticks: { t: number; text: string }[];
  /** Where the quantity's neutral value sits, 0..1, or null. */
  anchor: number | null;
  /** What the data itself reaches, which the scale need not cover. */
  range: string;
  /** Which ramp the values are painted with. */
  kind: ColormapKind;
  /** How many points carried no answer. */
  gaps: number;
}

export function PlateLegend({ model }: { model: PlateLegendModel }) {
  const t = useT();
  const colors = useChartColors();

  const gradient = useMemo(() => {
    const table = buildColormap(colors, model.kind);
    const stops = Array.from({ length: GRADIENT_STOPS }, (_, i) => {
      const t01 = i / (GRADIENT_STOPS - 1);
      const [r, g, b] = sampleColormap(table, t01);
      // Bottom of the bar is the low end, so the gradient runs upwards.
      return `rgb(${r} ${g} ${b}) ${(t01 * 100).toFixed(1)}%`;
    });
    return `linear-gradient(to top, ${stops.join(", ")})`;
  }, [colors, model.kind]);

  const first = model.ticks[0];
  const last = model.ticks[model.ticks.length - 1];

  return (
    <div
      className="plate3d-legend"
      role="img"
      aria-label={t("plate3d.legend.aria", {
        field: model.title,
        min: first?.text ?? "",
        max: last?.text ?? "",
      })}
    >
      <span className="plate3d-legend-title">
        {model.title}
        {model.unit && <span className="plate3d-legend-unit"> [{model.unit}]</span>}
      </span>
      <div className="plate3d-legend-body">
        <div className="plate3d-legend-bar" style={{ background: gradient }}>
          {model.anchor !== null && (
            <span
              className="plate3d-legend-anchor"
              style={{ bottom: `${model.anchor * 100}%` }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="plate3d-legend-ticks">
          {model.ticks.map((tick, i) => (
            <span key={i} style={{ bottom: `${tick.t * 100}%` }}>
              {tick.text}
            </span>
          ))}
        </div>
      </div>
      <span className="plate3d-legend-range">{model.range}</span>
      {model.gaps > 0 && (
        <span className="plate3d-legend-gaps">{t("plateView.holes", { count: model.gaps })}</span>
      )}
    </div>
  );
}
