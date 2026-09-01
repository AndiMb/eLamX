// Where on the plate the pointer is (FR-11).
//
// A ray march against the height field, not a ray against the triangle soup.
// The drawn body is a single-valued surface over a rectangle - that is exactly
// the property the old 2D view relied on and the reason the annotation broke
// it - so a march that walks the ray and watches the sign of "above or below
// the surface" answers in a few dozen samples, whatever the grid resolution.
// Against 12800 triangles it would be a fresh intersection test per triangle
// per frame of pointer movement.
//
// The ray is built from the camera's own basis rather than by inverting the
// view-projection, because there is no matrix inversion in this module and
// adding one to invert a matrix we assembled ourselves from three numbers
// would be the long way round.

import { cross, normalize, type Vec3 } from "./mat4";
import { eyeOf, FIELD_OF_VIEW, type OrbitCamera } from "./camera";

export interface PlateHit {
  /** Position across the plate, 0..1 from the corner at (-x, -y). */
  u: number;
  v: number;
  /** Where the ray met the surface, in world units. */
  at: Vec3;
}

export interface PickTarget {
  /** Half the plate extent in x and y, world units. */
  halfLength: number;
  halfWidth: number;
  /** Drawn z of the mid-surface at (u, v). */
  height: (u: number, v: number) => number;
}

/** Coarse steps along the ray before the sign change is bisected. */
const MARCH_STEPS = 96;
const BISECTIONS = 24;

/**
 * The point of the plate under a pixel, or null if the ray misses it.
 *
 * `x` and `y` are CSS pixels within a canvas of `width` x `height`.
 */
export function pickPlate(
  camera: OrbitCamera,
  target: PickTarget,
  x: number,
  y: number,
  width: number,
  height: number,
): PlateHit | null {
  if (width <= 0 || height <= 0) return null;

  const eye = eyeOf(camera);
  const direction = rayThrough(camera, x, y, width / height, width, height);

  // The whole body lies within one camera distance of the origin plus the
  // plate's own half diagonal, so there is no need to march further.
  const reach = camera.distance + Math.hypot(target.halfLength, target.halfWidth) + 1;
  const step = reach / MARCH_STEPS;

  let previous: { t: number; gap: number } | null = null;
  for (let i = 1; i <= MARCH_STEPS; i++) {
    const t = i * step;
    const gap = gapAt(eye, direction, t, target);
    if (gap === null) {
      // Outside the plate's footprint: no comparison to make, and a sample
      // pair straddling the edge would bisect towards a crossing that is not
      // on the plate.
      previous = null;
      continue;
    }
    if (previous && Math.sign(gap) !== Math.sign(previous.gap)) {
      return hitAt(eye, direction, bisect(eye, direction, previous.t, t, target), target);
    }
    if (gap === 0) return hitAt(eye, direction, t, target);
    previous = { t, gap };
  }
  return null;
}

/** Ray direction through a pixel, from the camera's own basis. */
function rayThrough(
  camera: OrbitCamera,
  x: number,
  y: number,
  aspect: number,
  width: number,
  height: number,
): Vec3 {
  const eye = eyeOf(camera);
  const back = normalize(eye); // from the origin towards the eye
  const right = normalize(cross([0, 0, 1], back));
  const up = cross(back, right);

  const ndcX = (2 * x) / width - 1;
  const ndcY = 1 - (2 * y) / height;
  const tan = Math.tan(FIELD_OF_VIEW / 2);

  return normalize([
    -back[0] + ndcX * aspect * tan * right[0] + ndcY * tan * up[0],
    -back[1] + ndcX * aspect * tan * right[1] + ndcY * tan * up[1],
    -back[2] + ndcX * aspect * tan * right[2] + ndcY * tan * up[2],
  ]);
}

/** Height of the ray above the surface at `t`, or null off the plate. */
function gapAt(eye: Vec3, direction: Vec3, t: number, target: PickTarget): number | null {
  const px = eye[0] + direction[0] * t;
  const py = eye[1] + direction[1] * t;
  if (Math.abs(px) > target.halfLength || Math.abs(py) > target.halfWidth) return null;
  const pz = eye[2] + direction[2] * t;
  return pz - target.height(toU(px, target.halfLength), toU(py, target.halfWidth));
}

function bisect(eye: Vec3, direction: Vec3, near: number, far: number, target: PickTarget): number {
  let low = near;
  let high = far;
  const sign = Math.sign(gapAt(eye, direction, low, target) ?? 0);
  for (let i = 0; i < BISECTIONS; i++) {
    const mid = (low + high) / 2;
    const gap = gapAt(eye, direction, mid, target);
    if (gap === null) return mid;
    if (Math.sign(gap) === sign) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function hitAt(eye: Vec3, direction: Vec3, t: number, target: PickTarget): PlateHit {
  const at: Vec3 = [
    eye[0] + direction[0] * t,
    eye[1] + direction[1] * t,
    eye[2] + direction[2] * t,
  ];
  return {
    u: clamp01(toU(at[0], target.halfLength)),
    v: clamp01(toU(at[1], target.halfWidth)),
    at,
  };
}

function toU(coordinate: number, half: number): number {
  return half > 0 ? (coordinate + half) / (2 * half) : 0.5;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
