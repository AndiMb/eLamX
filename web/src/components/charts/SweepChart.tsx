import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { ChartColors } from "../../lib/chartColors";
import { metricLimit, type FailureMetric } from "../../lib/failureMetric";
import { formatSignificant } from "../../lib/numberFormat";
import type { PointResult, StudyOutput } from "../../lib/study/evaluate";
import { OUTPUT_INFO, outputValue, variationValue } from "../../lib/study/outputs";
import type { SweepLayout } from "../../lib/study/sweep";

// One output of a sweep over its input: a line for one varied input, a family
// of lines - one per value of the second input, labelled on the line - for
// two. The carpet plot's way of drawing, for any pair of inputs rather than
// only the ply fractions of a material.
//
// A point the core could not compute is a gap in its line, never a zero, and
// the tooltip at that x says why. For a reserve factor the limit (RF 1, or
// its equivalent in the chosen metric) is drawn as a dashed line. The chart
// takes the keyboard too: the arrow keys move a cursor over the points, and
// Enter picks the one under it, like a click.

const WIDTH = 640;
const HEIGHT = 300;
const MARGIN = { top: 14, right: 104, bottom: 40, left: 64 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export interface SweepChartLabels {
  aria: string;
  x: string;
  y: string;
  /** How a curve of the family is named: `b = 500`. */
  series: (value: string) => string;
  gap: string;
}

export interface SweepChartViewProps {
  layout: SweepLayout;
  points: readonly (PointResult | undefined)[];
  output: StudyOutput;
  metric: FailureMetric;
  locale: string;
  colors: ChartColors;
  labels: SweepChartLabels;
  svgRef?: RefObject<SVGSVGElement | null>;
  /** A point was picked: x index, y index (0 for one input). */
  onPick?: (i: number, j: number) => void;
}

function ticks(low: number, high: number, count = 5): number[] {
  if (!(high > low)) return [low];
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const first = Math.ceil(low / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = first; v <= high + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function SweepChartView({ layout, points, output, metric, locale, colors, labels, svgRef, onPick }: SweepChartViewProps) {
  const own = useRef<SVGSVGElement>(null);
  const ref = svgRef ?? own;
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const xs = layout.x.values.map((v) => variationValue(layout.x.variation, v));
  const ys = layout.y ? layout.y.values : [null];
  const nx = xs.length;

  const series = useMemo(
    () => ys.map((_, j) => xs.map((_, i) => outputValue(points[j * nx + i], output, metric))),
    [points, output, metric, nx, ys.length], // oxlint-disable-line react-hooks/exhaustive-deps
  );

  const limit = OUTPUT_INFO[output].metric ? metricLimit(metric) : null;
  const scale = useMemo(() => {
    const values = series.flat().filter((v): v is number => v !== null);
    if (limit !== null) values.push(limit);
    let low = values.length ? Math.min(...values) : 0;
    let high = values.length ? Math.max(...values) : 1;
    if (high - low < 1e-12 * Math.max(1, Math.abs(high))) {
      low -= Math.abs(low) * 0.1 || 1;
      high += Math.abs(high) * 0.1 || 1;
    }
    const pad = (high - low) * 0.06;
    low -= pad;
    high += pad;
    const xLow = Math.min(...xs);
    const xHigh = Math.max(...xs);
    const xSpan = xHigh - xLow || 1;
    return {
      low,
      high,
      xLow,
      xHigh,
      x: (v: number) => MARGIN.left + ((v - xLow) / xSpan) * PLOT_W,
      y: (v: number) => MARGIN.top + PLOT_H - ((v - low) / (high - low)) * PLOT_H,
      xInv: (px: number) => xLow + ((px - MARGIN.left) / PLOT_W) * xSpan,
    };
  }, [series, xs, limit]);

  // Each curve as runs of computed points: a gap breaks the line.
  const paths = series.map((values) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${scale.x(xs[i]).toFixed(2)},${scale.y(v).toFixed(2)} `;
      pen = true;
    });
    return d.trim();
  });

  const fmt = (v: number) => formatSignificant(v, 4, locale);

  // Curves that coincide - an output the second input does not affect, like
  // the reserve factor over the plate size - are drawn once and named
  // together, "a = 300 … 900", rather than stacked under each other's labels.
  const same = (a: (number | null)[], b: (number | null)[]) =>
    a.every((v, i) => (v === null ? b[i] === null : b[i] !== null && Math.abs(v - b[i]!) <= 1e-9 * Math.max(1, Math.abs(v))));
  const hidden = new Set<number>();
  const groups: number[][] = [];
  series.forEach((values, j) => {
    const group = groups.find((g) => same(series[g[0]], values));
    if (group) {
      group.push(j);
      hidden.add(j);
    } else groups.push([j]);
  });
  // The end labels, pushed apart so that no two overlap.
  const endLabels = layout.y
    ? groups
        .map((group) => {
          const values = series[group[0]];
          const last = values.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
          if (last < 0) return null;
          const name = (k: number) => fmt(variationValue(layout.y!.variation, ys[k]!));
          const text = labels.series(group.length > 1 ? `${name(group[0])} … ${name(group[group.length - 1])}` : name(group[0]));
          return { j: group[0], x: scale.x(xs[last]) + 5, y: scale.y(values[last]!), text };
        })
        .filter((l): l is { j: number; x: number; y: number; text: string } => l !== null)
        .sort((a, b) => a.y - b.y)
        .map((label, k, all) => {
          if (k > 0 && label.y - all[k - 1].y < 11) label.y = all[k - 1].y + 11;
          return label;
        })
    : [];

  const nearest = (event: PointerEvent<SVGSVGElement>): [number, number] | null => {
    const svg = ref.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * WIDTH;
    const py = ((event.clientY - box.top) / box.height) * HEIGHT;
    const xv = scale.xInv(px);
    let i = 0;
    for (let k = 1; k < nx; k++) if (Math.abs(xs[k] - xv) < Math.abs(xs[i] - xv)) i = k;
    let j = 0;
    let best = Infinity;
    series.forEach((values, k) => {
      const v = values[i];
      if (v === null) return;
      const distance = Math.abs(scale.y(v) - py);
      if (distance < best) {
        best = distance;
        j = k;
      }
    });
    return [i, j];
  };

  const place = (i: number, j: number) => {
    const v = series[j][i];
    setTip({ left: (scale.x(xs[i]) / WIDTH) * 100, top: ((v === null ? MARGIN.top + PLOT_H : scale.y(v)) / HEIGHT) * 100 });
  };

  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const [i, j] = cursor ?? [0, 0];
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [i - 1, j],
      ArrowRight: [i + 1, j],
      ArrowUp: [i, j + 1],
      ArrowDown: [i, j - 1],
    };
    if (event.key === "Enter" && cursor) {
      event.preventDefault();
      onPick?.(...cursor);
      return;
    }
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    const at: [number, number] = [Math.min(nx - 1, Math.max(0, next[0])), Math.min(ys.length - 1, Math.max(0, next[1]))];
    setCursor(at);
    place(...at);
  };

  const seriesName = (j: number) => (ys[j] === null ? "" : labels.series(fmt(variationValue(layout.y!.variation, ys[j]!))));

  return (
    <div className="chart viz sweep-chart">
      <svg
        ref={ref}
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={labels.aria}
        tabIndex={onPick ? 0 : undefined}
        onKeyDown={onPick ? onKey : undefined}
        onPointerMove={(e) => {
          const at = nearest(e);
          if (!at) return;
          setCursor(at);
          place(...at);
        }}
        onPointerLeave={() => {
          setCursor(null);
          setTip(null);
        }}
        onClick={(e) => {
          const at = nearest(e as unknown as PointerEvent<SVGSVGElement>);
          if (at) onPick?.(...at);
        }}
      >
        {ticks(scale.low, scale.high).map((v) => (
          <g key={`y${v}`}>
            <line x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={scale.y(v)} y2={scale.y(v)} className="chart-gridline" />
            <text x={MARGIN.left - 6} y={scale.y(v) + 4} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {ticks(scale.xLow, scale.xHigh, 6).map((v) => (
          <g key={`x${v}`}>
            <line x1={scale.x(v)} x2={scale.x(v)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} className="chart-gridline" />
            <text x={scale.x(v)} y={MARGIN.top + PLOT_H + 16} textAnchor="middle">
              {fmt(v)}
            </text>
          </g>
        ))}
        <line x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={MARGIN.top + PLOT_H} y2={MARGIN.top + PLOT_H} className="chart-axis" />
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} className="chart-axis" />
        <text x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 6} textAnchor="middle" className="chart-axis-label">
          {labels.x}
        </text>
        <text
          x={14}
          y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle"
          className="chart-axis-label"
          transform={`rotate(-90 14 ${MARGIN.top + PLOT_H / 2})`}
        >
          {labels.y}
        </text>
        {limit !== null && (
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + PLOT_W}
            y1={scale.y(limit)}
            y2={scale.y(limit)}
            stroke={colors.status.danger}
            strokeDasharray="6 4"
            strokeWidth={1.25}
          />
        )}
        {paths.map((d, j) => {
          if (hidden.has(j)) return null;
          const color = colors.series[j % colors.series.length];
          const values = series[j];
          return (
            <g key={j}>
              <path d={d} fill="none" stroke={color} strokeWidth={1.75} />
              {/* A single computed point between gaps would be invisible as a
                  line; every point gets a dot. */}
              {values.map((v, i) =>
                v === null ? null : <circle key={i} cx={scale.x(xs[i])} cy={scale.y(v)} r={2.2} fill={color} />,
              )}
            </g>
          );
        })}
        {endLabels.map((label) => (
          <text key={label.j} x={label.x} y={label.y + 4} className="chart-inline-label">
            {label.text}
          </text>
        ))}
        {cursor && series[cursor[1]][cursor[0]] !== null && (
          <circle
            cx={scale.x(xs[cursor[0]])}
            cy={scale.y(series[cursor[1]][cursor[0]]!)}
            r={5}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          />
        )}
      </svg>
      {cursor && tip && (
        // Placed in percent of the chart, which scales with its width.
        <div className={`chart-tooltip sweep-tip${tip.left > 60 ? " left" : ""}`} style={{ left: `${tip.left}%`, top: `${tip.top}%` }}>
          <strong>
            {labels.x} = {fmt(xs[cursor[0]])}
          </strong>
          {ys.map((_, j) => {
            const point = points[j * nx + cursor[0]];
            const v = series[j][cursor[0]];
            return (
              <div key={j} className="chart-tooltip-row">
                {layout.y ? `${seriesName(j)}: ` : ""}
                {v !== null ? fmt(v) : point && !point.ok ? `${labels.gap}: ${point.reason}` : "…"}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
