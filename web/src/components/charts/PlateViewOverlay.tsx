import { Anchor, ArrowDownToLine, Frame, RotateCcw } from "lucide-react";
import type { StandardViewId } from "../../lib/gl/camera";
import { useT, type MessageKey } from "../../i18n";

// Everything the plate view writes rather than draws: the load captions, the
// extremes, the readout under the pointer, the axis cross, and the switches
// for what is shown.
//
// All of it lives in the DOM and not in the GL scene. Text in WebGL means a
// glyph atlas, and with it the loss of the screen reader, of the number
// formatting the rest of the app agrees on, and of the second language
// (NFR-06, NFR-07, NFR-08) - for the sake of short strings that a positioned
// <span> places just as accurately.
//
// The positions arrive already projected, computed from the same camera as the
// frame being drawn. Anything that recomputed them a frame later would show as
// captions swimming behind their arrows while the plate is dragged.

export interface PlateViewCaption {
  key: string;
  text: string;
  /** Position within the canvas, in CSS pixels. */
  x: number;
  y: number;
}

/** An extreme of the displayed field, marked where it sits (FR-11). */
export interface PlateViewMarker extends PlateViewCaption {
  kind: "min" | "max";
}

export interface PlateViewLayers {
  supports: boolean;
  loads: boolean;
  /** The undeformed reference geometry (FR-09). */
  reference: boolean;
}

/** One world axis, as it points on screen right now. */
export interface PlateViewAxis {
  label: string;
  dx: number;
  dy: number;
}

export interface PlateViewOverlayProps {
  captions: PlateViewCaption[];
  markers: PlateViewMarker[];
  /** What the pointer is over, or null when it is off the plate. */
  readout: PlateViewCaption | null;
  axes: PlateViewAxis[];
  layers: PlateViewLayers;
  onToggle: (layer: keyof PlateViewLayers) => void;
  onStandardView: (view: StandardViewId) => void;
  /** Layers with nothing to show are offered as disabled rather than hidden,
   *  so the row of switches does not change length as the input changes. */
  available: { supports: boolean; loads: boolean };
}

const SWITCHES: {
  layer: keyof PlateViewLayers;
  labelKey: MessageKey;
  Icon: typeof Frame;
}[] = [
  { layer: "supports", labelKey: "plate3d.layer.supports", Icon: Anchor },
  { layer: "loads", labelKey: "plate3d.layer.loads", Icon: ArrowDownToLine },
  { layer: "reference", labelKey: "plate3d.layer.reference", Icon: Frame },
];

/**
 * The standard viewpoints, labelled by the plane they look at rather than by
 * "top" and "front": which face of a plate is its top depends on how it is
 * mounted, but the axes are on the drawing either way. The full names are in
 * the tooltips.
 */
const VIEWS: { id: StandardViewId; label: string; labelKey: MessageKey }[] = [
  { id: "top", label: "xy", labelKey: "plate3d.view.top" },
  { id: "front", label: "xz", labelKey: "plate3d.view.front" },
  { id: "side", label: "yz", labelKey: "plate3d.view.side" },
  { id: "isometric", label: "iso", labelKey: "plate3d.view.isometric" },
];

/** Half the side of the axis cross, in its own SVG units. */
const CROSS = 22;

export function PlateViewOverlay({
  captions,
  markers,
  readout,
  axes,
  layers,
  onToggle,
  onStandardView,
  available,
}: PlateViewOverlayProps) {
  const t = useT();

  const place = (item: PlateViewCaption) => ({
    transform: `translate(${item.x}px, ${item.y}px) translate(-50%, -50%)`,
  });

  return (
    <>
      {captions.map((caption) => (
        <span key={caption.key} className="plate3d-caption" style={place(caption)}>
          {caption.text}
        </span>
      ))}

      {markers.map((marker) => (
        <span
          key={marker.key}
          className={`plate3d-marker plate3d-marker-${marker.kind}`}
          style={place(marker)}
        >
          {marker.text}
        </span>
      ))}

      {readout && (
        <span className="plate3d-readout" style={place(readout)}>
          {readout.text}
        </span>
      )}

      <div className="plate3d-layers" role="group" aria-label={t("plate3d.layers")}>
        {SWITCHES.map(({ layer, labelKey, Icon }) => {
          const enabled = layer === "reference" || available[layer];
          const label = t(labelKey);
          return (
            <button
              key={layer}
              type="button"
              onClick={() => onToggle(layer)}
              disabled={!enabled}
              aria-pressed={layers[layer]}
              title={label}
              aria-label={label}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>

      <div className="plate3d-views" role="group" aria-label={t("plate3d.views")}>
        {VIEWS.map(({ id, label, labelKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => onStandardView(id)}
            title={t(labelKey)}
            aria-label={t(labelKey)}
          >
            {id === "isometric" ? <RotateCcw size={14} /> : label}
          </button>
        ))}
      </div>

      {/* The axis cross is drawn rather than written, because it carries a
          direction and not a number - but its labels stay text, so they are
          legible at any size and to a screen reader through the group label. */}
      <svg
        className="plate3d-axes"
        viewBox={`${-CROSS - 9} ${-CROSS - 9} ${(CROSS + 9) * 2} ${(CROSS + 9) * 2}`}
        role="img"
        aria-label={t("plate3d.axes")}
      >
        {axes.map((axis) => {
          const length = Math.hypot(axis.dx, axis.dy);
          // An axis pointing at the eye has no direction on screen. Drawing it
          // as an arrow of some arbitrary heading would be an invented fact; a
          // dot at the origin is what it actually looks like.
          if (length < 0.08) {
            return <circle key={axis.label} r={2.2} className="plate3d-axis-dot" />;
          }
          return (
            <g key={axis.label}>
              <line x1={0} y1={0} x2={axis.dx * CROSS} y2={axis.dy * CROSS} />
              <text x={axis.dx * (CROSS + 7)} y={axis.dy * (CROSS + 7)}>
                {axis.label}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
