// The two primitives the supports and the load arrows are made of, and the
// buffers they accumulate into.
//
// Both annotation kinds want the same things - a cone (an arrowhead, and a pin
// support upside down), a block, a line - so the tessellation lives here and
// supports.ts / loads.ts stay about WHERE symbols go, which is the part that
// can be wrong in a way a reader would notice.
//
// Normals are per triangle, duplicated across its three vertices: a faceted
// cone is what an arrowhead should look like, and smoothing one would only
// blur the silhouette that carries the meaning. The annotation shader lights
// them through `abs(dot(n, view))`, so a face that ends up wound the other way
// is still lit - these are symbols read from every orbit angle, not a closed
// body with a well-defined inside.

import { cross, normalize, subtract, type Vec3 } from "../gl/mat4";

export interface AnnotationMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Line segments, as vertex pairs. */
  lines: Float32Array;
}

export const EMPTY_MESH: AnnotationMesh = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  lines: new Float32Array(0),
};

export interface MeshBuilder {
  /** Cone with its apex at `apex`, opening backwards along `-direction`. */
  cone(apex: Vec3, direction: Vec3, length: number, radius: number, sides?: number): void;
  /** Rectangular block, `half` measured along each of the three `axes`. */
  box(centre: Vec3, axes: readonly [Vec3, Vec3, Vec3], half: readonly [number, number, number]): void;
  line(a: Vec3, b: Vec3): void;
  build(): AnnotationMesh;
}

export function meshBuilder(): MeshBuilder {
  const positions: number[] = [];
  const normals: number[] = [];
  const lines: number[] = [];

  const triangle = (a: Vec3, b: Vec3, c: Vec3, given?: Vec3) => {
    const n = given ?? normalize(cross(subtract(b, a), subtract(c, a)));
    for (const p of [a, b, c]) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
    }
  };

  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    const n = normalize(cross(subtract(b, a), subtract(c, a)));
    triangle(a, b, c, n);
    triangle(a, c, d, n);
  };

  return {
    cone(apex, direction, length, radius, sides = 8) {
      const axis = normalize(direction);
      const base = add(apex, scaled(axis, -length));
      const [u, v] = perpendicularsOf(axis);
      const ring: Vec3[] = [];
      for (let i = 0; i < sides; i++) {
        const angle = (2 * Math.PI * i) / sides;
        ring.push(
          add(base, add(scaled(u, Math.cos(angle) * radius), scaled(v, Math.sin(angle) * radius))),
        );
      }
      for (let i = 0; i < sides; i++) {
        const next = ring[(i + 1) % sides];
        triangle(apex, ring[i], next);
        // The cap keeps the cone from showing its hollow inside when the
        // camera comes round behind it.
        triangle(base, next, ring[i], scaled(axis, -1));
      }
    },

    box(centre, axes, half) {
      const corner = (sx: number, sy: number, sz: number): Vec3 =>
        add(
          centre,
          add(
            scaled(axes[0], sx * half[0]),
            add(scaled(axes[1], sy * half[1]), scaled(axes[2], sz * half[2])),
          ),
        );
      const c = [
        corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1),
        corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1),
      ];
      quad(c[0], c[3], c[2], c[1]);
      quad(c[4], c[5], c[6], c[7]);
      quad(c[0], c[1], c[5], c[4]);
      quad(c[3], c[7], c[6], c[2]);
      quad(c[0], c[4], c[7], c[3]);
      quad(c[1], c[2], c[6], c[5]);
    },

    line(a, b) {
      lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    },

    build() {
      return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        lines: new Float32Array(lines),
      };
    },
  };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scaled(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

/** Mix `a` and `b`, `t = 0` giving `a`. */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Two unit vectors spanning the plane normal to `axis`. */
function perpendicularsOf(axis: Vec3): [Vec3, Vec3] {
  // Cross with whichever cardinal axis is least parallel; picking a fixed one
  // collapses the cone to a line whenever the arrow happens to point along it,
  // and load arrows point straight down more often than not.
  const seed: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(axis, seed));
  return [u, cross(axis, u)];
}
