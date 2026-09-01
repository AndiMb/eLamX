import { describe, expect, it } from "vitest";
import { pickPlate, type PickTarget } from "./pick";
import { DEFAULT_ORBIT, projectToScreen, viewProjectionOf, type OrbitCamera } from "./camera";

const WIDTH = 640;
const HEIGHT = 480;

const flat: PickTarget = { halfLength: 0.5, halfWidth: 0.5, height: () => 0 };

/** A dome, so a hit has to land on a curved surface rather than on a plane. */
const dome: PickTarget = {
  halfLength: 0.5,
  halfWidth: 0.5,
  height: (u, v) => 0.2 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v),
};

describe("pickPlate", () => {
  it("puts the centre of the picture at the centre of the plate", () => {
    const hit = pickPlate(DEFAULT_ORBIT, flat, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT);
    expect(hit).not.toBeNull();
    expect(hit!.u).toBeCloseTo(0.5, 3);
    expect(hit!.v).toBeCloseTo(0.5, 3);
  });

  it("misses when the ray goes past the plate", () => {
    // Top-left corner of a picture of a plate that fills the middle of it.
    expect(pickPlate(DEFAULT_ORBIT, flat, 2, 2, WIDTH, HEIGHT)).toBeNull();
  });

  // The real test: pick where a KNOWN point was drawn and get that point back.
  // Projection and picking are then each other's inverse, which is the only
  // property a readout actually needs - agreeing with itself proves nothing.
  it("inverts the projection, on a flat plate and on a curved one", () => {
    const cameras: OrbitCamera[] = [
      DEFAULT_ORBIT,
      { azimuth: 1.1, elevation: 0.4, distance: 3.2 },
      { azimuth: -2.4, elevation: 1.2, distance: 2.0 },
    ];
    for (const target of [flat, dome]) {
      for (const camera of cameras) {
        for (const [u, v] of [
          [0.5, 0.5],
          [0.25, 0.75],
          [0.8, 0.3],
        ]) {
          const world: [number, number, number] = [
            (u * 2 - 1) * target.halfLength,
            (v * 2 - 1) * target.halfWidth,
            target.height(u, v),
          ];
          const screen = projectToScreen(
            viewProjectionOf(camera, WIDTH / HEIGHT),
            world,
            WIDTH,
            HEIGHT,
          );
          expect(screen).not.toBeNull();
          const hit = pickPlate(camera, target, screen!.x, screen!.y, WIDTH, HEIGHT);
          expect(hit).not.toBeNull();
          expect(hit!.u).toBeCloseTo(u, 2);
          expect(hit!.v).toBeCloseTo(v, 2);
        }
      }
    }
  });

  it("finds the near face of a dome rather than the far one", () => {
    // Looking almost along the plate, the ray crosses the surface twice; the
    // readout has to report what the reader can see.
    const camera: OrbitCamera = { azimuth: 0, elevation: 0.15, distance: 3 };
    const hit = pickPlate(camera, dome, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT);
    expect(hit).not.toBeNull();
    expect(hit!.u).toBeGreaterThan(0.5);
  });

  it("answers nothing rather than dividing by a canvas with no size", () => {
    expect(pickPlate(DEFAULT_ORBIT, flat, 0, 0, 0, 0)).toBeNull();
  });
});
