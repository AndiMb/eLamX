import { useLayoutEffect, useRef, useState } from "react";

// The width an SVG chart is drawn at: the width it actually has on screen.
//
// A chart drawn into a fixed viewBox and stretched to 100% scales its TEXT
// with it - a 10px label came out at 6px on a phone and at 18px on a wide
// desktop card, and every chart at a different size from the next. Laying
// the chart out at its real pixel width instead keeps the viewBox at one unit
// per CSS pixel, so the type scale in index.css arrives as written, and the
// plot area is what grows and shrinks.
//
// `fixed` skips the measuring: the report draws its figures off screen at a
// set width and must get the same drawing every time. Before the first
// measurement - and in a test, where nothing has a layout - the chart is
// drawn at `fallback`, which is the width it was designed at.

/** Narrower than this and the margins would leave no plot - the default
 *  floor; a chart with narrower margins may pass its own. */
export const MIN_CHART_WIDTH = 260;

export function useChartWidth<T extends Element = HTMLDivElement>(fallback: number, fixed?: number, min = MIN_CHART_WIDTH) {
  const ref = useRef<T | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (fixed !== undefined) return;
    const element = ref.current;
    if (!element) return;
    const read = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      // Zero is "not laid out" (a hidden tab, jsdom), not a width.
      if (width > 0) setMeasured(width);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fixed]);

  const width = fixed ?? measured ?? fallback;
  return { ref, width: Math.max(min, width) };
}
