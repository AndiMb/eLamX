import { useRef } from "react";

/**
 * Counts how many times the calling component has rendered. Used to
 * empirically verify the reactive store's core promise: each result panel
 * subscribes to its own slice atom and should only re-render when that
 * specific slice's value actually changed - not on every unrelated edit.
 */
export function useRenderCount(): number {
  const count = useRef(0);
  count.current += 1;
  return count.current;
}
