import { describe, expect, it } from "vitest";
import { identity, lookAt, multiply, perspective, transformPoint } from "./mat4";

// Matrix code is the classic place where a wrong index compiles, runs and
// draws something almost right. These check the three properties that would
// otherwise only show up as a picture nobody can quite explain.

describe("mat4", () => {
  it("leaves a point alone under the identity", () => {
    expect(transformPoint(identity(), [3, -4, 5])).toEqual([3, -4, 5]);
  });

  it("multiplies in the order 'apply b first'", () => {
    const m = perspective(1, 1.5, 0.1, 10);
    const product = multiply(identity(), m);
    expect([...product]).toEqual([...m]);
  });

  it("puts the eye at the origin looking down -z", () => {
    const view = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
    // The target sits five units in front of the camera, and "in front" is -z.
    expect(transformPoint(view, [0, 0, 0])).toEqual([0, 0, -5]);
    // The eye itself lands on the origin of view space.
    expect(transformPoint(view, [0, 0, 5])).toEqual([0, 0, 0]);
  });

  it("orbits without mirroring: +x stays right of the target", () => {
    // Eye on +y looking back at the origin, z up. World +x must come out on
    // the left of the image (negative view x) - the check that catches a
    // handedness flip, which otherwise silently mirrors every plate.
    const view = lookAt([0, 5, 0], [0, 0, 0], [0, 0, 1]);
    const [x] = transformPoint(view, [1, 0, 0]);
    expect(x).toBeLessThan(0);
  });

  it("maps the near and far planes onto the clip range", () => {
    const near = 0.5;
    const far = 20;
    const projection = perspective(1, 1, near, far);
    // Looking down -z, so the planes sit at negative z in view space.
    expect(transformPoint(projection, [0, 0, -near])[2]).toBeCloseTo(-1, 6);
    expect(transformPoint(projection, [0, 0, -far])[2]).toBeCloseTo(1, 6);
  });
});
