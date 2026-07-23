// A legend is always present for >=2 series (see the dataviz skill) - the
// dependable identity channel so the reader never has to color-match alone.
export interface LegendItem {
  label: string;
  color: string;
  shape?: "line" | "swatch";
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span className="chart-legend-item" key={item.label}>
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
