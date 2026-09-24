import { useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { materialsAtom } from "../store/materialsAtoms";
import { stackVizOptionsAtom, type StackColorBy } from "../store/uiAtoms";
import type { LayerRow } from "../lib/constants";
import {
  STACK_WINDOW,
  angleColor,
  drawnPlies,
  materialColor,
  midplaneIndex,
  placePlies,
} from "../lib/stackLayout";
import { ToggleGroup } from "./ToggleGroup";
import { useT } from "../i18n";
import { useChartWidth } from "../lib/useChartWidth";

const WIDTH = 320;
/** The height of a stack of a few plies. */
const MIN_HEIGHT = 150;
/** Height per drawn ply beyond that: enough for its angle and glyph, which
 *  need 11 px. A 16-ply stack drawn in 150 px had room for neither. */
const PLY_HEIGHT = 12;
const MIN_BAR = 4;
// The context-bar thumbnail: one line of text tall, so the stack stays on
// screen without taking space from the module it sits above.
const STRIP_WIDTH = 26;
const STRIP_HEIGHT = 34;
const STRIP_MIN_BAR = 1.2;
/** Room at the left edge for the fibre-direction glyph. */
const GLYPH_BOX = 22;

export interface StackVizViewProps {
  /** The stored plies - for a symmetric laminate, the defined half. */
  layers: Pick<LayerRow, "id" | "angle" | "thickness" | "materialId">[];
  symmetric: boolean;
  withMiddleLayer: boolean;
  /** The material catalogue, for the colour slot of a ply's material. */
  materials: { id: string; name: string }[];
  colorBy?: StackColorBy;
  /** A fibre-direction glyph at the left of each ply that is tall enough. */
  showGlyphs?: boolean;
  /** For a symmetric laminate: draw the mirrored half, greyed, below the
   *  midplane, or only the defined half. */
  showMirror?: boolean;
  /** Only the expanded plies `from` (inclusive) to `to` (exclusive). */
  window?: [number, number];
  /** "strip" is the thumbnail for the context bar: no angle labels, no
   *  midplane line, and sized to a row of text rather than to a panel. */
  variant?: "full" | "strip";
  /** Keep to the height of a few plies however many there are - for a
   *  thumbnail of the whole stack rather than a drawing to read plies off. */
  compact?: boolean;
  ariaLabel: string;
  /** Drawn at this width instead of the width it has on screen - the report. */
  width?: number;
}

/**
 * The stack drawn to scale - bar height proportional to thickness, colour by
 * angle or by material, the angle as text and as a fibre glyph, the midplane
 * dashed and the mirrored half faded when the laminate is symmetric. Ply 1 is
 * at the TOP, matching the core's z-convention (first ply at +t/2).
 *
 * Pure: everything it shows comes in through its props, nothing from the
 * store, so the report and the through-thickness sheet can draw the same
 * picture from their own data. `StackViz` below is the connected version.
 */
export function StackVizView({
  layers,
  symmetric,
  withMiddleLayer,
  materials,
  colorBy = "material",
  showGlyphs = false,
  showMirror = true,
  window,
  variant = "full",
  compact = false,
  ariaLabel,
  width: fixedWidth,
}: StackVizViewProps) {
  // The SVG's own box is set by CSS (the full width, at most WIDTH), so it can
  // be measured without feeding back into itself; the drawing then uses that
  // width as its viewBox, which keeps the angle labels at the charts' size.
  const { ref, width: measured } = useChartWidth<SVGSVGElement>(WIDTH, fixedWidth, 120);
  if (layers.length === 0) return null;
  const strip = variant === "strip";
  const width = strip ? STRIP_WIDTH : Math.min(WIDTH, measured);
  const mirror = showMirror || strip;

  const all = drawnPlies(layers, symmetric, withMiddleLayer, mirror);
  const [from, to] = window ?? [0, all.length];
  const { bars: placed, total: totalHeight, midY } = placePlies(all.slice(from, to), {
    height: strip ? STRIP_HEIGHT : compact ? MIN_HEIGHT : Math.max(MIN_HEIGHT, (to - from) * PLY_HEIGHT),
    minBar: strip ? STRIP_MIN_BAR : MIN_BAR,
    midplane: strip ? null : midplaneIndex(layers.length, symmetric, withMiddleLayer, mirror),
  });
  const glyphs = showGlyphs && !strip;

  const bars = placed.map((entry) => {
    const { y, height: h } = entry;
    const tall = !strip && h >= 11;
    return (
      <g key={`${entry.layer.id}-${entry.mirror ? "m" : "o"}-${entry.index}`} opacity={entry.mirror ? 0.35 : 1}>
        <rect
          x={0}
          y={y}
          width={width}
          height={strip ? h : h - 1}
          rx={2}
          fill={colorBy === "angle" ? angleColor(entry.layer.angle) : materialColor(materials, entry.layer.materialId)}
          opacity={0.35}
        />
        {glyphs && tall && (
          <FibreGlyph cx={GLYPH_BOX / 2} cy={y + (h - 1) / 2} angle={entry.layer.angle} size={Math.min(h - 3, 14)} />
        )}
        {tall && (
          <text x={width / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central">
            {entry.layer.angle}°
          </text>
        )}
      </g>
    );
  });

  return (
    <svg
      ref={strip ? undefined : ref}
      className={strip ? "stack-viz stack-strip viz" : "stack-viz viz"}
      viewBox={`0 0 ${width} ${totalHeight}`}
      width={strip ? STRIP_WIDTH : "100%"}
      height={strip ? STRIP_HEIGHT : undefined}
      style={strip ? undefined : { maxWidth: 320 }}
      role="img"
      aria-label={ariaLabel}
    >
      {bars}
      {midY !== null && (
        <line
          x1={0}
          x2={width}
          y1={midY}
          y2={midY}
          stroke="var(--viz-text-muted)"
          strokeWidth={1}
          strokeDasharray="5 4"
        />
      )}
      <style>{`.stack-viz text { fill: var(--viz-text-primary); font-size: var(--chart-fs-tick, 11px); }`}</style>
    </svg>
  );
}

/** The fibre direction seen from above: a line at the ply angle, measured
 *  from the x axis counter-clockwise, in a circle for scale. */
function FibreGlyph({ cx, cy, angle, size }: { cx: number; cy: number; angle: number; size: number }) {
  const r = size / 2;
  const rad = (angle * Math.PI) / 180;
  // SVG's y axis points down, so a positive angle rotates towards -y.
  const dx = Math.cos(rad) * r;
  const dy = -Math.sin(rad) * r;
  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--viz-text-muted)" strokeWidth={0.75} />
      <line
        x1={cx - dx}
        y1={cy - dy}
        x2={cx + dx}
        y2={cy + dy}
        stroke="var(--viz-text-primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * The stack of a laminate as the app shows it: the drawing, and with
 * `controls` the switches for colour, glyphs and the mirrored half, the
 * window slider once there are more than `STACK_WINDOW` plies, and a legend.
 */
export function StackViz({
  layers,
  symmetric,
  withMiddleLayer,
  variant = "full",
  controls = false,
  compact = false,
}: {
  layers: LayerRow[];
  symmetric: boolean;
  withMiddleLayer: boolean;
  variant?: "full" | "strip";
  controls?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const materials = useAtomValue(materialsAtom);
  const [options, setOptions] = useAtom(stackVizOptionsAtom);
  const [offset, setOffset] = useState(0);
  if (layers.length === 0) return null;

  const strip = variant === "strip";
  const showMirror = options.showMirror || !symmetric;
  const count = drawnPlies(layers, symmetric, withMiddleLayer, showMirror).length;
  // Only with the slider to move it: a window nobody can move hides plies.
  const windowed = controls && count > STACK_WINDOW;
  const start = windowed ? Math.min(offset, count - STACK_WINDOW) : 0;
  const window: [number, number] | undefined = windowed ? [start, start + STACK_WINDOW] : undefined;

  const view = (
    <StackVizView
      layers={layers}
      symmetric={symmetric}
      withMiddleLayer={withMiddleLayer}
      materials={materials}
      colorBy={strip ? "material" : options.colorBy}
      showGlyphs={options.showGlyphs}
      showMirror={showMirror}
      window={window}
      variant={variant}
      compact={compact}
      ariaLabel={t("layers.viz.aria")}
    />
  );
  if (strip || !controls) return view;

  // The legend names what the colours mean - materials, or the angles that
  // are in this stack - in the order they first appear.
  const legend: { key: string; color: string; label: string }[] = [];
  for (const layer of layers) {
    if (options.colorBy === "angle") {
      const color = angleColor(layer.angle);
      const key = `a${layer.angle}`;
      if (!legend.some((l) => l.key === key)) legend.push({ key, color, label: `${layer.angle}°` });
    } else {
      const key = `m${layer.materialId}`;
      if (!legend.some((l) => l.key === key)) {
        legend.push({
          key,
          color: materialColor(materials, layer.materialId),
          label: materials.find((m) => m.id === layer.materialId)?.name ?? "",
        });
      }
    }
  }

  return (
    <div className="stack-viz-panel">
      <div className="stack-viz-options">
        <div className="segmented" role="radiogroup" aria-label={t("layers.viz.colorBy")}>
          {(["angle", "material"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={options.colorBy === mode}
              className={options.colorBy === mode ? "active" : undefined}
              onClick={() => setOptions((o) => ({ ...o, colorBy: mode }))}
            >
              {t(mode === "angle" ? "layers.viz.byAngle" : "layers.viz.byMaterial")}
            </button>
          ))}
        </div>
        {/* View switches, so buttons like the colour switch beside them. */}
        <ToggleGroup
          label={t("layers.viz.show")}
          items={[
            { key: "glyphs" as const, label: t("layers.viz.glyphs") },
            ...(symmetric ? [{ key: "mirror" as const, label: t("layers.viz.mirror") }] : []),
          ]}
          isOn={(k) => (k === "glyphs" ? options.showGlyphs : options.showMirror)}
          onToggle={(k) =>
            setOptions((o) =>
              k === "glyphs" ? { ...o, showGlyphs: !o.showGlyphs } : { ...o, showMirror: !o.showMirror },
            )
          }
        />
      </div>
      {view}
      {windowed && (
        <label className="stack-viz-window">
          <input
            type="range"
            min={0}
            max={count - STACK_WINDOW}
            value={start}
            onChange={(e) => setOffset(Number(e.target.value))}
            aria-label={t("layers.viz.window")}
          />
          <span>{t("layers.viz.windowRange", { from: start + 1, to: start + STACK_WINDOW, count })}</span>
        </label>
      )}
      <ul className="stack-viz-legend viz">
        {legend.map((entry) => (
          <li key={entry.key}>
            <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
