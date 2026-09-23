import { describe, expect, it } from "vitest";
import { drawnPlies, midplaneIndex, placePlies } from "./stackLayout";

const ply = (id: string, thickness = 1, angle = 0) => ({ id, angle, thickness, materialId: "m" });

describe("die Geometrie der Stapelansicht", () => {
  it("zeichnet die gespiegelte Hälfte in umgekehrter Folge, die Mittellage einmal", () => {
    const layers = [ply("a"), ply("b"), ply("c")];
    const ids = (plies: ReturnType<typeof drawnPlies>) => plies.map((p) => `${p.layer.id}${p.mirror ? "'" : ""}`);
    expect(ids(drawnPlies(layers, true, false))).toEqual(["a", "b", "c", "c'", "b'", "a'"]);
    expect(ids(drawnPlies(layers, true, true))).toEqual(["a", "b", "c", "b'", "a'"]);
    expect(ids(drawnPlies(layers, true, false, false))).toEqual(["a", "b", "c"]);
  });

  it("legt die Mittelebene zwischen die Hälften oder mitten durch die Mittellage", () => {
    const layers = [ply("a"), ply("b"), ply("c")];
    const even = placePlies(drawnPlies(layers, true, false), {
      height: 60,
      minBar: 0,
      midplane: midplaneIndex(3, true, false, true),
    });
    expect(even.total).toBe(60);
    expect(even.midY).toBe(30);
    const odd = placePlies(drawnPlies(layers, true, true), {
      height: 50,
      minBar: 0,
      midplane: midplaneIndex(3, true, true, true),
    });
    expect(odd.midY).toBe(25);
    expect(midplaneIndex(3, false, false, true)).toBeNull();
    expect(midplaneIndex(3, true, false, false)).toBeNull();
  });

  it("skaliert ein Fenster auf die volle Höhe und lässt die Mittelebene außerhalb weg", () => {
    const layers = Array.from({ length: 32 }, (_, i) => ply(String(i)));
    const all = drawnPlies(layers, true, false);
    const top = placePlies(all.slice(0, 10), { height: 100, minBar: 0, midplane: 32 });
    expect(top.total).toBe(100);
    expect(top.midY).toBeNull();
    const middle = placePlies(all.slice(30, 40), { height: 100, minBar: 0, midplane: 32 });
    expect(middle.midY).toBe(20);
  });
});
