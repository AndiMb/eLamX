// Getting a WebGL2 context, and keeping the drawing buffer the size the
// browser actually shows.
//
// `alpha: true` with a fully transparent clear colour is deliberate: the canvas
// then composites over whatever CSS paints behind it, so the view's background
// is `--inset` in both themes without this module knowing either colour. The
// alternative - reading the computed style and clearing to it - duplicates a
// token in a second place and gets it wrong on the frame after a theme switch.

export function createGl(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      // The export reads the buffer back after a draw; without this the
      // contents are undefined by the time toBlob runs.
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
}

/**
 * Matches the drawing buffer to the element's CSS size times the device pixel
 * ratio. Returns whether anything changed, so callers can skip a redraw.
 *
 * The ratio is capped at 2: beyond that the extra pixels are invisible and the
 * fill rate is not - a phone at DPR 3 would shade 2.25x the fragments for a
 * difference nobody can see.
 */
export function resizeToDisplay(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): boolean {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
  return true;
}
