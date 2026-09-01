import { Anchor, ArrowDownToLine, Frame } from "lucide-react";
import { useT, type MessageKey } from "../../i18n";

// Everything the plate view writes rather than draws: the load captions, and
// the switches for what is shown.
//
// The captions live in the DOM and not in the GL scene. Text in WebGL means a
// glyph atlas, and with it the loss of the screen reader, of the number
// formatting the rest of the app agrees on, and of the second language
// (NFR-06, NFR-07, NFR-08) - for the sake of a few short strings that a
// positioned <span> places just as accurately.
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

export interface PlateViewLayers {
  /** The undeformed reference geometry (FR-09). */
  outline: boolean;
  supports: boolean;
  loads: boolean;
}

export interface PlateViewOverlayProps {
  captions: PlateViewCaption[];
  layers: PlateViewLayers;
  onToggle: (layer: keyof PlateViewLayers) => void;
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
  { layer: "outline", labelKey: "plate3d.layer.reference", Icon: Frame },
];

export function PlateViewOverlay({
  captions,
  layers,
  onToggle,
  available,
}: PlateViewOverlayProps) {
  const t = useT();

  return (
    <>
      {captions.map((caption) => (
        <span
          key={caption.key}
          className="plate3d-caption"
          style={{ transform: `translate(${caption.x}px, ${caption.y}px) translate(-50%, -50%)` }}
        >
          {caption.text}
        </span>
      ))}

      <div className="plate3d-layers" role="group" aria-label={t("plate3d.layers")}>
        {SWITCHES.map(({ layer, labelKey, Icon }) => {
          const enabled = layer === "outline" || available[layer];
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
    </>
  );
}
