// The orbit camera: azimuth, elevation, distance, always looking at the origin.
//
// The scene is built centred on the origin and scaled so the plate's longer
// edge is one world unit (see plateScene/body.ts), which is what lets the
// camera be three numbers instead of a full transform - there is nothing to
// pan towards that is not already in view.
//
// Angles keep the meaning the old 2D projector gave them, and the defaults are
// its defaults, so switching a module over does not move the picture.

import { lookAt, multiply, perspective, transformPoint, type Mat4, type Vec3 } from "./mat4";

export interface OrbitCamera {
  /** Rotation about the plate's z axis, radians. */
  azimuth: number;
  /** Rotation towards the viewer. 0 = edge on, PI/2 = straight down. */
  elevation: number;
  /** Eye distance from the origin, in world units. */
  distance: number;
}

export const DEFAULT_ORBIT: OrbitCamera = {
  azimuth: -0.6,
  elevation: 0.9,
  distance: 2.6,
};

/** Radians of orbit per pixel of drag. */
const DRAG_SPEED = 0.01;

/**
 * The camera after dragging `dx`, `dy` pixels from `start`.
 *
 * The azimuth term is negative ON PURPOSE, and that is the whole reason this
 * is a function rather than two lines in the pointer handler. `azimuth` here
 * places the EYE; the identically named angle in `plate3d.ts`, which the 2D
 * fallback still uses, turns the OBJECT. The two run opposite ways, so sharing
 * their sign turns this view against the fallback beside it and against the
 * grab metaphor every 3D viewer uses - what you drag right must come right.
 *
 * Down raises the elevation for the same reason: pulling the near edge down
 * tips the far side up, which is more of the plate seen from above.
 */
export function orbitAfterDrag(start: OrbitCamera, dx: number, dy: number): OrbitCamera {
  return {
    azimuth: start.azimuth - dx * DRAG_SPEED,
    elevation: clampElevation(start.elevation + dy * DRAG_SPEED),
    distance: start.distance,
  };
}

/** Keeps the eye off the up axis, where `lookAt` has no unique orientation. */
export function clampElevation(value: number): number {
  const limit = Math.PI / 2 - 0.02;
  return Math.min(limit, Math.max(-limit, value));
}

export function clampDistance(value: number): number {
  return Math.min(12, Math.max(0.6, value));
}

export function eyeOf(camera: OrbitCamera): Vec3 {
  const ce = Math.cos(camera.elevation);
  return [
    camera.distance * ce * Math.cos(camera.azimuth),
    camera.distance * ce * Math.sin(camera.azimuth),
    camera.distance * Math.sin(camera.elevation),
  ];
}

export function viewOf(camera: OrbitCamera): Mat4 {
  return lookAt(eyeOf(camera), [0, 0, 0], [0, 0, 1]);
}

// The projection lives here rather than in the scene because two things need
// it: the draw call, and the DOM labels that have to land on top of what it
// drew. A second copy of the field of view somewhere else is a label that
// creeps away from its arrow as the camera moves - the kind of drift nobody
// traces back to a constant.
export const FIELD_OF_VIEW = 0.62;
export const NEAR_PLANE = 0.05;
export const FAR_PLANE = 40;

export function viewProjectionOf(camera: OrbitCamera, aspect: number): Mat4 {
  return multiply(perspective(FIELD_OF_VIEW, aspect, NEAR_PLANE, FAR_PLANE), viewOf(camera));
}

/**
 * Where a world point lands on a canvas of `width` x `height` CSS pixels, or
 * null when it is behind the eye.
 *
 * The w check is the whole reason this is not just `transformPoint`: dividing
 * by a negative w mirrors the point back into view, so a label anchored behind
 * the camera would otherwise reappear on the opposite side of the picture.
 */
export function projectToScreen(
  viewProjection: Mat4,
  point: Vec3,
  width: number,
  height: number,
): { x: number; y: number; depth: number } | null {
  const m = viewProjection;
  const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
  if (w <= 0) return null;
  const ndc = transformPoint(m, point);
  return {
    x: ((ndc[0] + 1) / 2) * width,
    y: ((1 - ndc[1]) / 2) * height,
    depth: ndc[2],
  };
}
