// The React side of orbitGesture: the handlers a canvas needs, and the one
// listener it cannot get from React.
import {
  useEffect,
  useMemo,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { createOrbitGesture, type OrbitGestures } from "./orbitGesture";

export interface OrbitHandlers<E extends HTMLElement> {
  onPointerDown: (event: PointerEvent<E>) => void;
  onPointerMove: (event: PointerEvent<E>) => void;
  onPointerUp: (event: PointerEvent<E>) => void;
  onPointerCancel: (event: PointerEvent<E>) => void;
}

/**
 * Drag to turn, two fingers or the wheel to zoom.
 *
 * `gestures` says what each of those means for this view's camera; see
 * orbitGesture.ts. `onHover` is called for pointer movement with nothing held
 * down, which is how the plate reads off the value under the cursor - the
 * views that have nothing to read out simply leave it off.
 */
export function useOrbitControls<C, E extends HTMLElement = HTMLCanvasElement>(
  canvasRef: RefObject<E | null>,
  camera: C,
  setCamera: Dispatch<SetStateAction<C>>,
  gestures: OrbitGestures<C>,
  onHover?: (event: PointerEvent<E>) => void,
): OrbitHandlers<E> {
  // `gestures` must be the same object every render - a module-level constant,
  // as all three views pass. The machine below remembers what the camera was
  // when the current drag or pinch began, and rebuilding it mid-gesture would
  // lose that; these views re-render on every keystroke, so "mid-gesture" is
  // the normal case rather than an unlucky one.
  const gesture = useMemo(() => createOrbitGesture<C>(gestures), [gestures]);

  // React's onWheel is passive and so cannot preventDefault: without a
  // listener of our own the page scrolls while the wheel is zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setCamera((current) => gesture.wheel(event.deltaY, current));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvasRef, gesture, setCamera]);

  return {
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.down({ id: event.pointerId, x: event.clientX, y: event.clientY }, camera);
    },
    onPointerMove: (event) => {
      const moved = gesture.move({
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      });
      if (moved.type === "hover") onHover?.(event);
      else if (moved.type === "camera") setCamera(moved.camera);
    },
    onPointerUp: (event) => gesture.up(event.pointerId),
    onPointerCancel: (event) => gesture.up(event.pointerId),
  };
}
