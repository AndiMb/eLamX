// The pointer state machine behind the three 3D views.
//
// A camera of `{ turn, scale }` stands in for the real ones: what is under
// test is which gesture is recognised and what it is handed, not what any
// particular view does with it - the two real gesture sets are checked at the
// end for the one thing that differs between them, the sense of the pinch.
import { describe, expect, it } from "vitest";
import { createOrbitGesture, type OrbitGestures } from "./orbitGesture";
import { CAMERA_GESTURES, DEFAULT_CAMERA } from "./plate3d";
import { clampDistance, DEFAULT_ORBIT, ORBIT_GESTURES } from "./gl/camera";

interface TestCamera {
  turn: number;
  scale: number;
}

const START: TestCamera = { turn: 0, scale: 1 };

const GESTURES: OrbitGestures<TestCamera> = {
  drag: (start, dx, dy) => ({ ...start, turn: start.turn + dx + dy * 1000 }),
  pinch: (start, factor) => ({ ...start, scale: start.scale * factor }),
  wheel: (current, deltaY) => ({ ...current, scale: current.scale + deltaY }),
};

/** Asserts the move produced a camera, and returns it. */
function cameraOf(move: ReturnType<ReturnType<typeof createOrbitGesture<TestCamera>>["move"]>) {
  expect(move.type).toBe("camera");
  if (move.type !== "camera") throw new Error("unreachable");
  return move.camera;
}

describe("dragging", () => {
  it("measures from where the drag began, not from the last event", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 100, y: 100 }, START);

    expect(cameraOf(gesture.move({ id: 1, x: 110, y: 100 })).turn).toBe(10);
    // Still 30 from the start, not 20 more than the last one.
    expect(cameraOf(gesture.move({ id: 1, x: 130, y: 100 })).turn).toBe(30);
  });

  it("turns from the camera the drag started on, so a re-render cannot move it", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 0, y: 0 }, { turn: 500, scale: 1 });
    expect(cameraOf(gesture.move({ id: 1, x: 7, y: 0 })).turn).toBe(507);
  });

  it("ignores a pointer it never saw go down", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 0, y: 0 }, START);
    // The view reads out what is under the cursor on this, rather than moving.
    expect(gesture.move({ id: 99, x: 50, y: 50 })).toEqual({ type: "hover" });
  });

  it("reports a hover when nothing is down at all", () => {
    const gesture = createOrbitGesture(GESTURES);
    expect(gesture.move({ id: 1, x: 10, y: 10 })).toEqual({ type: "hover" });
  });

  it("stops dragging once the pointer is lifted", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 0, y: 0 }, START);
    gesture.up(1);
    expect(gesture.active).toBe(0);
    expect(gesture.move({ id: 1, x: 40, y: 0 })).toEqual({ type: "hover" });
  });
});

describe("pinching", () => {
  it("scales by how far the fingers have spread since they went down", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 0, y: 0 }, START);
    gesture.down({ id: 2, x: 100, y: 0 }, START);

    // 100px apart to 150px: half again as far.
    expect(cameraOf(gesture.move({ id: 2, x: 150, y: 0 })).scale).toBeCloseTo(1.5, 12);
    // And back to where they started: back to the camera they started on.
    expect(cameraOf(gesture.move({ id: 2, x: 100, y: 0 })).scale).toBeCloseTo(1, 12);
  });

  it("does not also turn the view while two fingers are down", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 0, y: 0 }, START);
    gesture.down({ id: 2, x: 100, y: 0 }, START);
    // A drag would have moved `turn`; only the scale may change.
    expect(cameraOf(gesture.move({ id: 2, x: 200, y: 0 })).turn).toBe(0);
  });

  it("survives two fingers put down in the same place", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 50, y: 50 }, START);
    gesture.down({ id: 2, x: 50, y: 50 }, START);
    // Scaling by 0 separation would send the camera to infinity.
    expect(gesture.move({ id: 2, x: 60, y: 50 })).toEqual({ type: "none" });
  });

  it("does not turn the view when one of the two fingers is lifted", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 0, y: 0 }, START);
    gesture.down({ id: 2, x: 100, y: 0 }, START);
    gesture.up(2);

    // The remaining finger is still down, and moving it must not jump the
    // camera as though a drag had begun where the pinch left off.
    expect(gesture.active).toBe(1);
    expect(gesture.move({ id: 1, x: 80, y: 0 })).toEqual({ type: "none" });
  });

  it("drags again only after every finger has been lifted", () => {
    const gesture = createOrbitGesture(GESTURES);
    gesture.down({ id: 1, x: 0, y: 0 }, START);
    gesture.down({ id: 2, x: 100, y: 0 }, START);
    gesture.up(2);
    gesture.up(1);

    gesture.down({ id: 3, x: 10, y: 0 }, START);
    expect(cameraOf(gesture.move({ id: 3, x: 15, y: 0 })).turn).toBe(5);
  });
});

describe("the wheel", () => {
  it("works off the current camera, not off a gesture's starting point", () => {
    const gesture = createOrbitGesture(GESTURES);
    expect(gesture.wheel(-3, { turn: 0, scale: 10 }).scale).toBe(7);
  });
});

describe("what a pinch means for each of the real cameras", () => {
  it("spreading the fingers zooms the buckling plate in", () => {
    const zoomed = CAMERA_GESTURES.pinch(DEFAULT_CAMERA, 2);
    expect(zoomed.zoom).toBeGreaterThan(DEFAULT_CAMERA.zoom);
  });

  it("spreading the fingers brings the orbit camera closer", () => {
    // The opposite arithmetic for the opposite quantity: this camera holds the
    // distance to the subject, so a bigger pinch is a smaller number.
    const closer = ORBIT_GESTURES.pinch(DEFAULT_ORBIT, 2);
    expect(closer.distance).toBeLessThan(DEFAULT_ORBIT.distance);
    expect(closer.distance).toBeCloseTo(clampDistance(DEFAULT_ORBIT.distance / 2), 12);
  });

  it("both keep their zoom within the limits the view can draw", () => {
    expect(CAMERA_GESTURES.pinch(DEFAULT_CAMERA, 1e6).zoom).toBeLessThanOrEqual(6);
    expect(CAMERA_GESTURES.pinch(DEFAULT_CAMERA, 1e-6).zoom).toBeGreaterThanOrEqual(0.25);
    const far = ORBIT_GESTURES.pinch(DEFAULT_ORBIT, 1e-6).distance;
    const near = ORBIT_GESTURES.pinch(DEFAULT_ORBIT, 1e6).distance;
    expect(far).toBe(clampDistance(far));
    expect(near).toBe(clampDistance(near));
  });

  it("the wheel turns the same way for both", () => {
    // Scrolling up zooms in: a bigger zoom factor, a smaller orbit distance.
    expect(CAMERA_GESTURES.wheel(DEFAULT_CAMERA, -1).zoom).toBeGreaterThan(DEFAULT_CAMERA.zoom);
    expect(ORBIT_GESTURES.wheel(DEFAULT_ORBIT, -1).distance).toBeLessThan(DEFAULT_ORBIT.distance);
  });
});
