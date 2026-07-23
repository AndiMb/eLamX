import type { ReactNode } from "react";

// Tooltips enhance, they never gate: every value they show must also be
// reachable without hovering (a legend, an axis, or the chart's table view).
export function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="chart-tooltip" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}
