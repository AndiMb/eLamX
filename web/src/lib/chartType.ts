// The chart type scale, for the views that draw text themselves on a canvas.
//
// The SVG charts take theirs from --chart-fs-tick / --chart-fs-label in
// index.css; a canvas cannot read custom properties per glyph, so the same
// numbers live here too. Change one, change both - a 3D view whose labels
// are a size away from the chart beside it is exactly what this is here to
// prevent.

export const CHART_FONT_FAMILY = 'system-ui, "Segoe UI", Roboto, sans-serif';

/** Tick values, marker labels, anything read against the drawing. */
export const CHART_FS_TICK = 11;
/** Axis names - what a direction IS, one step up from its numbers. */
export const CHART_FS_LABEL = 12;

/** A canvas `font` string at the given size, scaled by `scale` for a
 *  backing store drawn at more than one pixel per CSS pixel. */
export function chartFont(size: number, { weight = 400, scale = 1 }: { weight?: number; scale?: number } = {}): string {
  return `${weight === 400 ? "" : `${weight} `}${size * scale}px ${CHART_FONT_FAMILY}`;
}
