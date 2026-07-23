import { atom, type Atom } from "jotai";
import { unwrap } from "jotai/utils";

export type Loadable<T> =
  | { state: "loading" }
  | { state: "hasData"; data: T }
  | { state: "hasError"; error: unknown };

const NONE = Symbol("none");

/**
 * A small userland replacement for jotai's own (deprecated) `loadable()`.
 * jotai's version wraps `unwrap` with a fixed `() => LOADING` fallback, so it
 * reports "loading" again on every recompute, even when a previous value is
 * already on screen. This version's fallback re-uses the last resolved value
 * while a new one is in flight, so live recompute (a value changing on every
 * keystroke) doesn't blank already-visible results between renders.
 */
export function loadableWithLastValue<T>(sourceAtom: Atom<Promise<T>>): Atom<Loadable<T>> {
  const unwrapped = unwrap(sourceAtom, (prev) => (prev === undefined ? NONE : prev));
  return atom((get) => {
    try {
      const value = get(unwrapped);
      if (value === NONE) {
        return { state: "loading" };
      }
      return { state: "hasData", data: value as T };
    } catch (error) {
      return { state: "hasError", error };
    }
  });
}
