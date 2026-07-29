// A very small 3D projector for the buckling plate view.
//
// Why hand-rolled rather than three.js: this needs exactly one thing - project
// a height field's quads and draw them back-to-front. three.js would add
// ~150 KB gzipped to a bundle that has to stay mobile-friendly, and would pull
// a WebGL context into a page that otherwise renders fine without one. The
// whole projector is the ~60 lines below; the painter's algorithm is exact for
// a single-valued height field viewed from outside, which is the only scene
// this ever draws.

export interface Camera {
  /** Rotation about the plate's z axis, radians. */
  azimuth: number;
  /** Rotation towards the viewer, radians. 0 = edge on, PI/2 = straight down. */
  elevation: number;
  /** Uniform scale factor applied after projection. */
  zoom: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Distance along the view direction; larger is farther away. */
  depth: number;
}

/**
 * Isometric-style projection: rotate about z by `azimuth`, tilt by
 * `elevation`, then drop the view-direction component. No perspective divide -
 * an orthographic view keeps equal deflections equally tall wherever they sit
 * on the plate, which is what makes two humps comparable by eye.
 */
export function project(
  x: number,
  y: number,
  z: number,
  camera: Camera,
  centre: { x: number; y: number },
): Projected {
  const dx = x - centre.x;
  const dy = y - centre.y;

  const ca = Math.cos(camera.azimuth);
  const sa = Math.sin(camera.azimuth);
  const rx = dx * ca - dy * sa;
  const ry = dx * sa + dy * ca;

  const ce = Math.cos(camera.elevation);
  const se = Math.sin(camera.elevation);

  return {
    x: rx * camera.zoom,
    // Screen y grows downward, hence the negations.
    y: (-ry * se - z * ce) * camera.zoom,
    depth: ry * ce - z * se,
  };
}

export const DEFAULT_CAMERA: Camera = {
  azimuth: -0.6,
  elevation: 0.9,
  zoom: 1,
};

/** Keeps the plate from being tipped past vertical or turned inside out. */
export function clampElevation(value: number): number {
  const limit = Math.PI / 2 - 0.02;
  return Math.min(limit, Math.max(-limit, value));
}

export function clampZoom(value: number): number {
  return Math.min(6, Math.max(0.25, value));
}
