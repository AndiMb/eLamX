import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import type { FailureMetric } from "../lib/failureMetric";
import { isFailing } from "../lib/failureMetric";
import type { PointResult } from "../lib/study/evaluate";
import type { MatrixAxis, MatrixLayout } from "../lib/study/plan";
import { axisLabel, matrixValue } from "../lib/study/tables";
import { QuantityDisplay } from "./QuantityDisplay";
import { useT } from "../i18n";

// The criteria matrix of F4.1: many laminates against many load cases (or
// criteria) at once, where the comparison page stops at four columns.
//
// Each cell is the core's reserve factor for that pair, in the metric the
// user chose, tinted by pass or fail AND marked with an icon - the colour is
// never the only signal (N7). Both headers stay in view while scrolling, and
// past fifty rows only the rows on screen are rendered: a 400 x 20 matrix is
// 8000 cells, and drawing all of them on every progress tick is what would
// make the page stutter while the study streams in.
//
// A cell is a button: a click (or Enter) opens that laminate's module on that
// load case. The arrow keys move between cells, so the matrix can be read
// without a mouse.

const ROW_HEIGHT = 34;
const VIRTUAL_FROM = 50;
const OVERSCAN = 8;

export interface MatrixViewProps {
  layout: MatrixLayout;
  points: readonly (PointResult | undefined)[];
  metric: FailureMetric;
  transpose: boolean;
  corner: string;
  onOpen: (row: number, col: number) => void;
}

export function MatrixView({ layout, points, metric, transpose, corner, onOpen }: MatrixViewProps) {
  const t = useT();
  const rowAxes: MatrixAxis[] = transpose ? layout.cols : layout.rows;
  const colAxes: MatrixAxis[] = transpose ? layout.rows : layout.cols;
  // Back to the plan's orientation, where the points are.
  const plan = useCallback((r: number, c: number): [number, number] => (transpose ? [c, r] : [r, c]), [transpose]);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const pendingFocus = useRef(false);

  const virtual = rowAxes.length >= VIRTUAL_FROM;
  const first = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = virtual
    ? Math.min(rowAxes.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
    : rowAxes.length;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport(el.clientHeight || 600);
  }, [virtual]);

  // After an arrow key: bring the cell into view, then give it the focus.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const el = scroller.current;
    const cell = el?.querySelector<HTMLButtonElement>(`[data-cell="${focus[0]}:${focus[1]}"]`);
    cell?.focus();
  }, [focus, first, last]);

  const move = (event: KeyboardEvent) => {
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const r = Math.min(rowAxes.length - 1, Math.max(0, focus[0] + delta[0]));
    const c = Math.min(colAxes.length - 1, Math.max(0, focus[1] + delta[1]));
    const el = scroller.current;
    if (el && virtual) {
      const top = r * ROW_HEIGHT;
      if (top < el.scrollTop + ROW_HEIGHT) el.scrollTop = Math.max(0, top - ROW_HEIGHT);
      else if (top > el.scrollTop + el.clientHeight - 2 * ROW_HEIGHT) el.scrollTop = top - el.clientHeight + 2 * ROW_HEIGHT;
    }
    pendingFocus.current = true;
    setFocus([r, c]);
  };

  const cell = (r: number, c: number) => {
    const [pr, pc] = plan(r, c);
    const point = points[pr * layout.cols.length + pc];
    const focused = focus[0] === r && focus[1] === c;
    const common = {
      "data-cell": `${r}:${c}`,
      tabIndex: focused ? 0 : -1,
      onFocus: () => setFocus([r, c]),
      onClick: () => onOpen(pr, pc),
    };
    if (!point) {
      return (
        <td key={c} className="matrix-cell pending">
          <button type="button" className="matrix-cell-button" {...common} aria-label={t("study.pending")}>
            …
          </button>
        </td>
      );
    }
    if (!point.ok) {
      return (
        <td key={c} className="matrix-cell gap">
          <button type="button" className="matrix-cell-button" {...common} title={point.reason} aria-label={`${t("study.gap")}: ${point.reason}`}>
            –
          </button>
        </td>
      );
    }
    const value = matrixValue(layout, points, pr, pc, metric);
    if (value === null) {
      return (
        <td key={c} className="matrix-cell gap">
          <button type="button" className="matrix-cell-button" {...common} aria-label={t("study.gap")}>
            –
          </button>
        </td>
      );
    }
    const failing = isFailing(value, metric);
    return (
      <td key={c} className={`matrix-cell ${failing ? "fail" : "pass"}`}>
        <button
          type="button"
          className="matrix-cell-button"
          {...common}
          title={`${axisLabel(rowAxes[r], t)} · ${axisLabel(colAxes[c], t)}`}
        >
          {failing ? (
            <CircleX size={13} aria-label={t("compare.fails")} />
          ) : (
            <CircleCheck size={13} aria-label={t("compare.holds")} />
          )}
          <QuantityDisplay category="reserveFactor" value={value} />
        </button>
      </td>
    );
  };

  return (
    <div
      className={`matrix-view-scroll${virtual ? " virtual" : ""}`}
      ref={scroller}
      onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
      onKeyDown={move}
    >
      <table className="matrix-view">
        <thead>
          <tr>
            <th scope="col" className="matrix-corner">
              {corner}
            </th>
            {colAxes.map((axis) => (
              <th key={axis.id} scope="col" title={axisLabel(axis, t)}>
                {axisLabel(axis, t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }} />}
          {rowAxes.slice(first, last).map((axis, i) => {
            const r = first + i;
            return (
              <tr key={axis.id} style={virtual ? { height: ROW_HEIGHT } : undefined}>
                <th scope="row" title={axisLabel(axis, t)}>
                  {axisLabel(axis, t)}
                </th>
                {colAxes.map((_, c) => cell(r, c))}
              </tr>
            );
          })}
          {last < rowAxes.length && <tr aria-hidden="true" style={{ height: (rowAxes.length - last) * ROW_HEIGHT }} />}
        </tbody>
      </table>
    </div>
  );
}
