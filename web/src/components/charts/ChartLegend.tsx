import type { ReactNode } from "react";

// A legend is always present for >=2 series (see the dataviz skill) - the
// dependable identity channel so the reader never has to color-match alone.
//
// `label` is a ReactNode so series names can carry real <sub> markup (this is
// ordinary HTML, not SVG - see lib/symbols.ts); that is also why `key` is now
// its own field rather than the label doubling as one.
export interface LegendItem {
  key: string;
  label: ReactNode;
  color: string;
  shape?: "line" | "swatch";
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span className="chart-legend-item" key={item.key}>
          <span
            className={`chart-legend-swatch${item.shape === "line" ? " line" : ""}`}
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
