// What a load case does to a square of laminate.
//
// Port of eLamX2/Classical_Laminated_Plate_Theory_3DView/.../Plate.java. The
// CLT solves for six numbers - three mid-plane strains and three curvatures -
// and every ply result in the app follows from them. They are also the one
// part of the answer that has no natural picture in a table: a reader can see
// that kappa_xy is 1.4e-4 without seeing that the plate is being twisted.
//
// So: a unit square, displaced by exactly those six numbers, over an
// exaggeration the reader controls.
//
//   u = x eps_x + gamma_xy y / 2
//   v = y eps_y + gamma_xy x / 2
//   w = -(kappa_x x^2 + kappa_y y^2 + kappa_xy x y) / 2
//
// The halved shear in u and v is the engineering shear strain split evenly
// between the two directions, and the minus on w is the original's sign - the
// same convention the plate modules settled on (see the curvature-sign note in
// plate::deformation).
//
// Pure functions of six numbers, so the part that can be quietly wrong - a
// swapped index, a missing half - is checked in Node rather than by eye.

export interface StrainState {
  epsilon_x: number;
  epsilon_y: number;
  gamma_xy: number;
  kappa_x: number;
  kappa_y: number;
  kappa_xy: number;
}

export interface StrainShapePoint {
  /** Displaced position, in units of the square's own side length. */
  position: [number, number, number];
  /** Magnitude of the displacement there, before exaggeration. */
  magnitude: number;
}

export interface StrainShape {
  /** Rows along y, columns along x - the layout every grid in this app uses. */
  points: StrainShapePoint[][];
  /** Largest displacement magnitude on the grid, before exaggeration. */
  peak: number;
}

/**
 * The displaced square.
 *
 * `samples` nodes per direction; `scale` multiplies the displacement only, so
 * the undeformed square is always the unit square whatever the exaggeration.
 */
export function strainShape(strains: StrainState, samples: number, scale: number): StrainShape {
  const n = Math.max(2, Math.floor(samples));
  const points: StrainShapePoint[][] = [];
  let peak = 0;

  for (let row = 0; row < n; row++) {
    const y = row / (n - 1) - 0.5;
    const line: StrainShapePoint[] = [];
    for (let col = 0; col < n; col++) {
      const x = col / (n - 1) - 0.5;

      const u = x * strains.epsilon_x + 0.5 * strains.gamma_xy * y;
      const v = y * strains.epsilon_y + 0.5 * strains.gamma_xy * x;
      // The `+ 0` normalises negative zero: an unloaded plate would otherwise
      // report a w of -0 at every node, which compares unequal to 0 and reads
      // as a signed quantity where there is no sign.
      const w =
        -(
          strains.kappa_x * x * x +
          strains.kappa_y * y * y +
          strains.kappa_xy * x * y
        ) /
          2 +
        0;

      const magnitude = Math.hypot(u, v, w);
      if (magnitude > peak) peak = magnitude;

      line.push({
        position: [x + u * scale + 0, y + v * scale + 0, w * scale + 0],
        magnitude,
      });
    }
    points.push(line);
  }

  return { points, peak };
}

/**
 * An exaggeration that makes the displacement visible without leaving the
 * frame: the peak displacement becomes `target` of the square's side.
 *
 * Automatic because the six numbers span everything from 1e-6 to 1e-1
 * depending on the load, and a fixed factor would show either a flat square or
 * a scribble. The factor is reported beside the picture, as the plate views
 * report theirs.
 */
export function autoStrainScale(peak: number, target = 0.25): number {
  if (!(peak > 0) || !Number.isFinite(peak)) return 1;
  return target / peak;
}
