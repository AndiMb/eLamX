// Turning pointer events into camera moves, without React and without a DOM.
//
// The three 3D views - the buckling mode, the failure body and the deflected
// plate - all orbit the same way: drag to turn, two fingers to zoom, wheel to
// zoom. They had three copies of the bookkeeping that makes that work, alike
// to the line in two of them, and the copies had already started to drift (the
// non-passive wheel listener is commented in two of the three, and the plate's
// pinch runs the other way round because its camera measures distance where
// the others measure zoom).
//
// What differs between them is only what a gesture MEANS for their camera, so
// that is what they pass in: this module owns which pointers are down and what
// the camera was when the gesture started, and asks the caller to turn a drag
// of so many pixels, or a pinch that has spread the fingers by so much, into a
// new camera. Nothing here knows what a camera is.
//
// Kept free of React so it can be tested for what it actually is - a state
// machine over pointer ids - in the Node suite, rather than through a rendered
// component in a DOM that would have to be faked first.

/** A pointer as the caller sees it, in whatever coordinates it likes. */
export interface PointerSample {
  id: number;
  x: number;
  y: number;
}

/** What a gesture means for one particular camera. */
export interface OrbitGestures<C> {
  /** The camera after dragging (dx, dy) pixels from the one the drag started on. */
  drag: (start: C, dx: number, dy: number) => C;
  /**
   * The camera after a pinch that has multiplied the distance between the two
   * fingers by `factor` - so `factor > 1` is fingers spreading apart. A camera
   * that measures zoom scales by it, one that measures distance to the subject
   * divides by it.
   */
  pinch: (start: C, factor: number) => C;
  /** The camera after one wheel notch. `deltaY < 0` is scrolling up. */
  wheel: (current: C, deltaY: number) => C;
}

/** What a pointer movement came to. */
export type OrbitMove<C> =
  /** No pointer of ours is down: the caller may read out what is under it. */
  | { type: "hover" }
  /** The gesture moved the camera. */
  | { type: "camera"; camera: C }
  /** Tracked, but nothing to move - a second finger that has not yet spread. */
  | { type: "none" };

export interface OrbitGesture<C> {
  down(pointer: PointerSample, camera: C): void;
  move(pointer: PointerSample): OrbitMove<C>;
  up(pointerId: number): void;
  wheel(deltaY: number, camera: C): C;
  /** How many pointers are currently down. For tests and assertions. */
  readonly active: number;
}

export function createOrbitGesture<C>(gestures: OrbitGestures<C>): OrbitGesture<C> {
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; camera: C } | null = null;
  let pinch: { separation: number; camera: C } | null = null;

  /** The distance between the first two pointers down. */
  function separation(): number {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  return {
    down(pointer, camera) {
      pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
      if (pointers.size === 2) {
        pinch = { separation: separation(), camera };
        // A pinch is not a drag: keeping both would turn the plate as it zooms.
        drag = null;
      } else {
        drag = { x: pointer.x, y: pointer.y, camera };
      }
    },

    move(pointer) {
      if (!pointers.has(pointer.id)) return { type: "hover" };
      pointers.set(pointer.id, { x: pointer.x, y: pointer.y });

      if (pinch && pointers.size === 2) {
        // Two fingers put down in the same place: there is no separation to
        // scale by yet, and dividing by it would send the camera to infinity.
        if (pinch.separation <= 0) return { type: "none" };
        return {
          type: "camera",
          camera: gestures.pinch(pinch.camera, separation() / pinch.separation),
        };
      }

      if (!drag) return { type: "none" };
      return {
        type: "camera",
        camera: gestures.drag(drag.camera, pointer.x - drag.x, pointer.y - drag.y),
      };
    },

    up(pointerId) {
      pointers.delete(pointerId);
      // Lifting one of two fingers ends the pinch, but the other finger is
      // still down and must not become a drag from wherever it happens to be -
      // `drag` stays null until every pointer has been lifted.
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) drag = null;
    },

    wheel(deltaY, camera) {
      return gestures.wheel(camera, deltaY);
    },

    get active() {
      return pointers.size;
    },
  };
}
