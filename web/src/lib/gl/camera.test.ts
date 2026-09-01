import { describe, expect, it } from "vitest";
import {
  clampDistance,
  clampElevation,
  DEFAULT_ORBIT,
  eyeOf,
  orbitAfterDrag,
  projectToScreen,
  viewProjectionOf,
  type OrbitCamera,
  screenDirectionOf,
  STANDARD_VIEWS,
} from "./camera";

const WIDTH = 600;
const HEIGHT = 400;
const ASPECT = WIDTH / HEIGHT;

/**
 * A mark on the plate on the side facing the camera - the part of the picture
 * a hand would grab.
 */
function nearMark(camera: OrbitCamera): [number, number, number] {
  const eye = eyeOf(camera);
  const flat = Math.hypot(eye[0], eye[1]);
  return [(eye[0] / flat) * 0.5, (eye[1] / flat) * 0.5, 0];
}

function screenOf(camera: OrbitCamera, point: [number, number, number]) {
  const at = projectToScreen(viewProjectionOf(camera, ASPECT), point, WIDTH, HEIGHT);
  if (!at) throw new Error("the mark should be in front of the camera");
  return at;
}

describe("orbitAfterDrag", () => {
  // These two are the whole point of the function. `azimuth` places the EYE,
  // while the identically named angle in the 2D projector turns the OBJECT -
  // the two run opposite ways, so a shared sign turns this view against both
  // the fallback view and every other 3D viewer. Asserting on the sign of the
  // angle would not have caught that; asserting on where the mark LANDS does.
  it("carries the near side of the plate right when the pointer goes right", () => {
    const mark = nearMark(DEFAULT_ORBIT);
    const before = screenOf(DEFAULT_ORBIT, mark);
    const after = screenOf(orbitAfterDrag(DEFAULT_ORBIT, 60, 0), mark);
    expect(after.x).toBeGreaterThan(before.x);
  });

  it("carries it down when the pointer goes down", () => {
    const mark = nearMark(DEFAULT_ORBIT);
    const before = screenOf(DEFAULT_ORBIT, mark);
    const after = screenOf(orbitAfterDrag(DEFAULT_ORBIT, 0, 60), mark);
    expect(after.y).toBeGreaterThan(before.y);
  });

  it("turns by the same amount either way", () => {
    const right = orbitAfterDrag(DEFAULT_ORBIT, 40, 0);
    const left = orbitAfterDrag(DEFAULT_ORBIT, -40, 0);
    expect(right.azimuth - DEFAULT_ORBIT.azimuth).toBeCloseTo(
      DEFAULT_ORBIT.azimuth - left.azimuth,
      12,
    );
  });

  it("leaves the distance alone - that is the wheel's job", () => {
    expect(orbitAfterDrag(DEFAULT_ORBIT, 200, 200).distance).toBe(DEFAULT_ORBIT.distance);
  });

  it("holds the elevation short of the pole, where lookAt has no orientation", () => {
    const overshot = orbitAfterDrag(DEFAULT_ORBIT, 0, 100_000);
    expect(overshot.elevation).toBe(clampElevation(Infinity));
    expect(Math.abs(overshot.elevation)).toBeLessThan(Math.PI / 2);
  });
});

describe("projectToScreen", () => {
  it("puts the origin in the middle of the canvas", () => {
    const at = screenOf(DEFAULT_ORBIT, [0, 0, 0]);
    expect(at.x).toBeCloseTo(WIDTH / 2, 4);
    expect(at.y).toBeCloseTo(HEIGHT / 2, 4);
  });

  it("drops a point behind the eye instead of mirroring it into view", () => {
    const camera = DEFAULT_ORBIT;
    const eye = eyeOf(camera);
    // Twice the eye distance along the eye direction: well behind the camera.
    const behind: [number, number, number] = [eye[0] * 2, eye[1] * 2, eye[2] * 2];
    expect(projectToScreen(viewProjectionOf(camera, ASPECT), behind, WIDTH, HEIGHT)).toBeNull();
  });
});

describe("clamps", () => {
  it("keeps the eye off the up axis in both directions", () => {
    expect(clampElevation(10)).toBeLessThan(Math.PI / 2);
    expect(clampElevation(-10)).toBeGreaterThan(-Math.PI / 2);
    expect(clampElevation(0.4)).toBe(0.4);
  });

  it("keeps the eye out of the plate and within reach", () => {
    expect(clampDistance(0)).toBeGreaterThan(0);
    expect(clampDistance(1e6)).toBeLessThan(100);
    expect(clampDistance(2.6)).toBe(2.6);
  });
});

describe("screenDirectionOf", () => {
  it("flattens an axis pointing at the eye to nothing", () => {
    // Looking along +x from azimuth 0: the x axis is straight at the camera,
    // so it has no direction on screen and the cross must draw a dot rather
    // than an arrow whose heading is made up.
    const camera = { azimuth: 0, elevation: 0, distance: 3 };
    const [x, y] = screenDirectionOf(camera, [1, 0, 0]);
    expect(Math.hypot(x, y)).toBeCloseTo(0, 12);
  });

  it("puts z up the screen and y across it from the front", () => {
    const camera = { azimuth: 0, elevation: 0, distance: 3 };
    const [, zy] = screenDirectionOf(camera, [0, 0, 1]);
    expect(zy).toBeCloseTo(-1, 12); // CSS y grows downwards
    const [yx] = screenDirectionOf(camera, [0, 1, 0]);
    expect(yx).toBeCloseTo(1, 12);
  });

  it("turns with the camera", () => {
    const turned = screenDirectionOf({ azimuth: Math.PI / 2, elevation: 0, distance: 3 }, [1, 0, 0]);
    expect(turned[0]).toBeCloseTo(-1, 12);
  });
});

describe("STANDARD_VIEWS", () => {
  it("keeps every one of them off the pole and within reach", () => {
    for (const view of Object.values(STANDARD_VIEWS)) {
      expect(clampElevation(view.elevation)).toBe(view.elevation);
      expect(clampDistance(view.distance)).toBe(view.distance);
    }
  });

  it("looks down from the top and level from the front", () => {
    const down = screenDirectionOf(STANDARD_VIEWS.top, [0, 0, 1]);
    expect(Math.hypot(...down)).toBeLessThan(0.05);
    expect(STANDARD_VIEWS.front.elevation).toBe(0);
  });
});
