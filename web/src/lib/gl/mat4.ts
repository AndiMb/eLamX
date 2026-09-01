// The four matrix operations a single orbiting scene needs, and nothing else.
//
// Column-major Float32Array(16), which is what WebGL's uniformMatrix4fv wants
// without transposing: element (row r, column c) sits at m[c * 4 + r]. Every
// function returns a fresh array - these run once per frame at most, and a
// scratch-buffer API would trade a real class of aliasing bugs for an
// allocation nobody can measure.

export type Mat4 = Float32Array;
export type Vec3 = readonly [number, number, number];

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** Right-handed perspective projection onto clip space z in [-1, 1]. */
export function perspective(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRadians / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);

  const m = new Float32Array(16);
  m[0] = x[0];
  m[1] = y[0];
  m[2] = z[0];
  m[4] = x[1];
  m[5] = y[1];
  m[6] = z[1];
  m[8] = x[2];
  m[9] = y[2];
  m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}

/** `a * b` - apply b first, then a. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      m[c * 4 + r] = sum;
    }
  }
  return m;
}

/**
 * Transforms a point and divides by w. Used to place the DOM labels over the
 * canvas, which is why it returns the perspective-divided result rather than
 * homogeneous coordinates - the caller wants a screen position, not a vector.
 */
export function transformPoint(m: Mat4, p: Vec3): [number, number, number] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    out.push(m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
  }
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w !== 0) {
    out[0] /= w;
    out[1] /= w;
    out[2] /= w;
  }
  return [out[0], out[1], out[2]];
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
}
