import { describe, expect, it } from "vitest";
import { parseVtkSurface, VtkParseError } from "./vtkSurface";

// The layout eLamX's own importer assumes: four header lines, a POINTS line,
// then one point per line, four points to a face.
const ELAMX_STYLE = `# vtk DataFile Version 3.0
failure surface
ASCII
DATASET POLYDATA
POINTS 8 float
0 0 0
1 0 0
1 1 0
0 1 0
0 0 1
1 0 1
1 1 1
0 1 1
POLYGONS 2 10
4 0 1 2 3
4 4 5 6 7
`;

describe("parseVtkSurface", () => {
  it("reads the layout eLamX's own importer assumes", () => {
    const surface = parseVtkSurface(ELAMX_STYLE);
    expect(surface.pointCount).toBe(8);
    expect(surface.quads).toHaveLength(2);
    expect(surface.quads[0]).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    expect(surface.quads[1][3]).toEqual([0, 1, 1]);
  });

  it("stops at the section after the points rather than swallowing it", () => {
    // The POLYGONS block is numbers too. What ends the stream is the keyword,
    // and the count in the header - both have to hold or a connectivity list
    // would be read as coordinates.
    const surface = parseVtkSurface(ELAMX_STYLE);
    for (const quad of surface.quads) {
      for (const corner of quad) {
        for (const value of corner) expect(Math.abs(value)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("scales every coordinate, which is what the import dialog's factor is for", () => {
    const surface = parseVtkSurface(ELAMX_STYLE, 2.5);
    expect(surface.quads[0][1]).toEqual([2.5, 0, 0]);
    expect(surface.quads[1][2]).toEqual([2.5, 2.5, 2.5]);
  });

  it("takes several points per line, which most real writers produce", () => {
    // More permissive than the Java, which reads one point per line - but a
    // superset, so nothing that works there breaks here.
    const packed = `# vtk DataFile Version 3.0
packed
ASCII
DATASET POLYDATA
POINTS 4 float
0 0 0 1 0 0 1 1 0 0 1 0
`;
    expect(parseVtkSurface(packed).quads).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
    ]);
  });

  it("finds the POINTS line wherever it sits", () => {
    const shifted = `# vtk DataFile Version 3.0
a longer
header than
the original
assumes it to be
POINTS 4 float
0 0 0
1 0 0
1 1 0
0 1 0
`;
    expect(parseVtkSurface(shifted).quads).toHaveLength(1);
  });

  it("drops a trailing remainder rather than guessing at it", () => {
    // Six points are one quad and two orphans. `nP / 4` in Java does the same.
    const odd = `x
x
x
x
POINTS 6 float
0 0 0
1 0 0
1 1 0
0 1 0
2 0 0
3 0 0
`;
    expect(parseVtkSurface(odd).quads).toHaveLength(1);
  });

  it("says what is wrong rather than drawing nothing", () => {
    expect(() => parseVtkSurface("nothing here")).toThrow(VtkParseError);
    expect(() => parseVtkSurface("POINTS zero float\n")).toThrow(/no usable count/);
    expect(() => parseVtkSurface("POINTS 8 float\n0 0 0\n1 0 0\n")).toThrow(/only 2 were readable/);
    expect(() => parseVtkSurface("POINTS 2 float\n0 0 0\n1 0 0\n")).toThrow(/nothing to draw/);
  });
});
