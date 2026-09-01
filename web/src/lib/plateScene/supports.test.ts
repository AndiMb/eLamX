import { describe, expect, it } from "vitest";
import { plateFrame } from "./frame";
import { supportEdges, supportMesh, type SupportEdge } from "./supports";
import type { BoundaryCondition } from "../generated/BoundaryCondition";

const frame = plateFrame({ length: 400, width: 200, thickness: 2, thicknessScale: 10 });

function edgeOf(edges: SupportEdge[], id: string): SupportEdge {
  const found = edges.find((edge) => edge.id === id);
  if (!found) throw new Error(`no edge ${id}`);
  return found;
}

describe("supportEdges", () => {
  it("puts the first letter on the near edge and the second on the far one", () => {
    // The asymmetric conditions are the whole test: CC and SS come out right
    // whichever way the pair is read, so only CF, SC and SF can catch a swap.
    const edges = supportEdges("CF", "SF", frame);
    expect(edgeOf(edges, "x0").condition).toBe("C");
    expect(edgeOf(edges, "x1").condition).toBe("F");
    expect(edgeOf(edges, "y0").condition).toBe("S");
    expect(edgeOf(edges, "y1").condition).toBe("F");
  });

  it("reads bc_x on the edges normal to x and bc_y on those normal to y", () => {
    const edges = supportEdges("CC", "SS", frame);
    expect(edgeOf(edges, "x0").from[0]).toBeCloseTo(-frame.halfLength, 12);
    expect(edgeOf(edges, "x1").from[0]).toBeCloseTo(frame.halfLength, 12);
    expect(edgeOf(edges, "x0").condition).toBe("C");
    expect(edgeOf(edges, "y0").condition).toBe("S");
  });

  it("has every outward normal pointing away from the plate", () => {
    for (const edge of supportEdges("SS", "SS", frame)) {
      const middle = [
        (edge.from[0] + edge.to[0]) / 2,
        (edge.from[1] + edge.to[1]) / 2,
        0,
      ];
      // Away from the origin, which is the plate centre.
      expect(middle[0] * edge.outward[0] + middle[1] * edge.outward[1]).toBeGreaterThan(0);
      // And in the plane, not up or down.
      expect(edge.outward[2]).toBe(0);
      // Along and outward span the plane rather than repeating each other.
      expect(Math.abs(edge.along[0] * edge.outward[0] + edge.along[1] * edge.outward[1])).toBeCloseTo(0, 12);
    }
  });

  it("spaces the symbols inside the edge, never on a corner", () => {
    for (const edge of supportEdges("SS", "SS", frame)) {
      const span = Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]);
      expect(edge.marks.length).toBeGreaterThanOrEqual(2);
      for (const mark of edge.marks) {
        const s = Math.hypot(mark[0] - edge.from[0], mark[1] - edge.from[1]);
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(span);
        // On the undeformed mid-plane: the symbols mark where the edge WOULD
        // be, which is the only thing that stays put while the plate bends.
        expect(mark[2]).toBe(0);
      }
    }
  });

  it("gives the longer edge more symbols than the shorter one", () => {
    const edges = supportEdges("SS", "SS", frame);
    // y0 runs the 400 mm length, x0 the 200 mm width.
    expect(edgeOf(edges, "y0").marks.length).toBeGreaterThan(edgeOf(edges, "x0").marks.length);
  });
});

describe("supportMesh", () => {
  const meshFor = (bcX: BoundaryCondition, bcY: BoundaryCondition) =>
    supportMesh(supportEdges(bcX, bcY, frame), frame);

  it("draws pinned edges as solids and free edges as bare lines", () => {
    const pinned = meshFor("SS", "SS");
    expect(pinned.positions.length).toBeGreaterThan(0);
    expect(pinned.lines.length).toBe(0);

    const free = meshFor("FF", "FF");
    expect(free.positions.length).toBe(0);
    expect(free.lines.length).toBeGreaterThan(0);
  });

  it("draws a clamped edge as a hatched block: both a solid and lines", () => {
    const clamped = meshFor("CC", "CC");
    expect(clamped.positions.length).toBeGreaterThan(0);
    expect(clamped.lines.length).toBeGreaterThan(0);
  });

  it("carries one unit normal per vertex", () => {
    const mesh = meshFor("SC", "SS");
    expect(mesh.normals.length).toBe(mesh.positions.length);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it("keeps the symbols off the plate: nothing rises above the top face", () => {
    // A support drawn through the laminate would hide the result colour it is
    // meant to stand beside.
    const mesh = meshFor("CC", "SS");
    for (let i = 2; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeLessThanOrEqual(frame.halfThickness + 1e-9);
    }
  });

  it("mirrors the pinned symbols of a symmetric plate about the origin", () => {
    const mesh = meshFor("SS", "SS");
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      sumX += mesh.positions[i];
      sumY += mesh.positions[i + 1];
    }
    expect(sumX / (mesh.positions.length / 3)).toBeCloseTo(0, 9);
    expect(sumY / (mesh.positions.length / 3)).toBeCloseTo(0, 9);
  });

  it("has nothing to draw for a plate with no extent", () => {
    const empty = plateFrame({ length: 0, width: 0, thickness: 0, thicknessScale: 1 });
    const mesh = supportMesh(supportEdges("SS", "SS", empty), empty);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.lines.length).toBe(0);
  });
});
