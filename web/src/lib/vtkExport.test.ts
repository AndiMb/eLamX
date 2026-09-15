import { describe, expect, it } from "vitest";
import { gridToQuads, quadsToVtk, type Quad } from "./vtkExport";
import { parseVtkSurface } from "./vtkSurface";

// The exporter and the importer are the two halves of the same assumption, so
// the strongest check available is that they agree: a surface written here and
// read back by the reader that was ported from eLamX's own importer has to come
// out unchanged. That is what the reader could not be tested against before -
// there is no eLamX-produced VTK file in the repository, and now there is a way
// to produce one.

const SQUARE: Quad = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
];

describe("der VTK-Export", () => {
  it("schreibt den Kopf, den die Datei braucht", () => {
    const text = quadsToVtk([SQUARE]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("# vtk DataFile Version 4.0");
    expect(lines[2]).toBe("ASCII");
    expect(lines[3]).toBe("DATASET UNSTRUCTURED_GRID");
    expect(lines[4]).toBe("POINTS 4 double");
    expect(text).toContain("CELLS 1 5");
    expect(text).toContain("4 0 1 2 3");
    expect(text).toContain("CELL_TYPES 1");
  });

  it("kommt durch den eigenen Leser unverändert zurück", () => {
    const quads: Quad[] = [
      SQUARE,
      [
        [0, 0, 1],
        [2, 0, 1],
        [2, 2, 1],
        [0, 2, 1],
      ],
    ];
    const surface = parseVtkSurface(quadsToVtk(quads), 1);
    expect(surface.pointCount).toBe(8);
    expect(surface.quads).toEqual(quads);
  });

  /// Coordinates are written as they are: a surface with real numbers in it
  /// must not come back rounded.
  it("rundet die Koordinaten nicht", () => {
    const quad: Quad = [
      [1 / 3, -2.5e-7, 141000.125],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ];
    const surface = parseVtkSurface(quadsToVtk([quad]), 1);
    expect(surface.quads[0][0]).toEqual(quad[0]);
  });

  /// A grid becomes one face per cell, and a direction the core could not
  /// evaluate takes its faces with it rather than being closed over.
  it("macht aus einem Gitter Vierecke und lässt Lücken aus", () => {
    const grid: ([number, number, number] | null)[][] = [
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      [
        [0, 1, 0],
        [1, 1, 0],
        [2, 1, 0],
      ],
    ];
    expect(gridToQuads(grid)).toHaveLength(2);

    grid[1][1] = null;
    expect(gridToQuads(grid)).toHaveLength(0);
  });
});
