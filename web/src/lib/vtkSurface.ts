// Reading a surface out of the file eLamX's failure view calls "VTK".
//
// It is not a VTK reader, and calling it one would mislead whoever maintains
// it next. The original (FailureView3DTopComponent, the importVTKButton
// listener) skips four header lines, takes the point count off the fifth,
// reads that many points and groups them blindly in FOURS as quads. It never
// looks at the POLYGONS or CELLS section - the file is assumed to list its
// corners already in drawing order, four per face.
//
// So that assumption is what is ported: anything eLamX draws, this draws the
// same way. Two places are deliberately more permissive, and both accept a
// superset of what the original does, so no file that works there breaks here:
//
//   - the POINTS line is searched for rather than assumed to be line five;
//   - the coordinates are read as a stream of numbers rather than one point
//     per line, which is how most real VTK writers lay them out.
//
// What this cannot do is verify itself against a file eLamX produced - there
// is none in the repository. The tests below check the reading of the Java,
// which is the honest limit of it.

export interface VtkSurface {
  /** Faces, four corners each, in the file's own order. */
  quads: [number, number, number][][];
  /** How many points the header claimed. */
  pointCount: number;
}

export class VtkParseError extends Error {}

/**
 * Parses the text of one file.
 *
 * `scale` multiplies every coordinate, as the original's import dialog offers
 * - a surface computed in different units than the laminate's would otherwise
 * be drawn at the wrong size beside it.
 */
export function parseVtkSurface(text: string, scale = 1): VtkSurface {
  const lines = text.split(/\r?\n/);

  const headerIndex = lines.findIndex((line) => line.trimStart().toUpperCase().startsWith("POINTS"));
  if (headerIndex < 0) {
    throw new VtkParseError("no POINTS line");
  }

  const header = lines[headerIndex].trim().split(/\s+/);
  const pointCount = Number(header[1]);
  if (!Number.isInteger(pointCount) || pointCount <= 0) {
    throw new VtkParseError(`POINTS gives no usable count: '${lines[headerIndex].trim()}'`);
  }

  // Everything after the header, as one stream of numbers. Stops at the first
  // token that is not one, which is where the next section's keyword sits.
  const numbers: number[] = [];
  const wanted = pointCount * 3;
  outer: for (let i = headerIndex + 1; i < lines.length && numbers.length < wanted; i++) {
    for (const token of lines[i].trim().split(/\s+/)) {
      if (token === "") continue;
      const value = Number(token);
      if (!Number.isFinite(value)) break outer;
      numbers.push(value);
      if (numbers.length === wanted) break outer;
    }
  }

  if (numbers.length < wanted) {
    throw new VtkParseError(
      `POINTS says ${pointCount} points, but only ${Math.floor(numbers.length / 3)} were readable`,
    );
  }

  // Four points a face, as the original groups them. A trailing remainder is
  // dropped rather than guessed at - the same thing `nP / 4` does in Java.
  const quads: [number, number, number][][] = [];
  const faces = Math.floor(pointCount / 4);
  for (let face = 0; face < faces; face++) {
    const corners: [number, number, number][] = [];
    for (let corner = 0; corner < 4; corner++) {
      const at = (face * 4 + corner) * 3;
      corners.push([numbers[at] * scale, numbers[at + 1] * scale, numbers[at + 2] * scale]);
    }
    quads.push(corners);
  }

  if (quads.length === 0) {
    throw new VtkParseError("fewer than four points: nothing to draw");
  }

  return { quads, pointCount };
}
