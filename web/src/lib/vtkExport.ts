// Writing a surface back out in the format eLamX's 3D views export.
//
// The counterpart of `vtkSurface.ts`, and the same caveat in reverse: this is
// legacy VTK as `View3D.exportQuadArrays` writes it, which is an unstructured
// grid of four-cornered cells whose points are listed once per corner rather
// than shared between faces. A point-sharing writer would produce a smaller and
// equally valid file - and one that eLamX's own reader, which groups points
// blindly in fours, could not read back. So the redundancy is kept.
//
// One deliberate difference: the original writes Java `float`s, because that is
// what its scene graph holds. The numbers here come from the core as doubles,
// and they are written as doubles - rounding a coordinate to seven digits to
// imitate a rendering detail would be a strange thing to do to an export meant
// for another program.

/** A face: four corners in drawing order. */
export type Quad = [number, number, number][];

/**
 * A grid of sampled points as quads, the way a surface computed here arrives.
 *
 * A null point is a direction the core could not evaluate; a face touching one
 * is dropped rather than closed over, which is what the 3D view draws too.
 */
export function gridToQuads(points: ([number, number, number] | null)[][]): Quad[] {
  const quads: Quad[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const row = points[i];
    const next = points[i + 1];
    for (let j = 0; j + 1 < row.length; j++) {
      const corners = [row[j], row[j + 1], next[j + 1], next[j]];
      if (corners.some((c) => c === null)) continue;
      quads.push(corners as Quad);
    }
  }
  return quads;
}

/** The file, as text. */
export function quadsToVtk(quads: Quad[]): string {
  const lines: string[] = [
    "# vtk DataFile Version 4.0",
    "eLamX2",
    "ASCII",
    "DATASET UNSTRUCTURED_GRID",
    `POINTS ${quads.length * 4} double`,
  ];
  for (const quad of quads) {
    for (const [x, y, z] of quad) {
      lines.push(`${x} ${y} ${z}`);
    }
  }

  // Each cell names its four corners by index, and they are consecutive
  // because every face brought its own copies.
  lines.push(`CELLS ${quads.length} ${quads.length * 5}`);
  for (let i = 0; i < quads.length; i++) {
    lines.push(`4 ${i * 4} ${i * 4 + 1} ${i * 4 + 2} ${i * 4 + 3}`);
  }

  // 9 is VTK_QUAD.
  lines.push(`CELL_TYPES ${quads.length}`);
  for (let i = 0; i < quads.length; i++) lines.push("9");

  return lines.join("\n") + "\n";
}

/** Hands the file to the browser as a download. */
export function downloadVtk(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".vtk") ? filename : `${filename}.vtk`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
