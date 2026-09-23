// A table as the page shows it, read back from the DOM.
//
// For the few tables whose cells are not data the caller holds - the
// comparison, where every column is computed by a cell of its own - the
// rendered text is what there is. That is the screen's rounding rather than
// full precision, which the export says nothing false about: it is the table
// as displayed.

import type { TableModel } from "./table";

function text(cell: Element): string {
  return (cell.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The table's rows as texts, the first header row as the columns. A row
 *  that spans the whole width - a group heading - becomes a row with its
 *  text in the first cell. */
export function domTableModel(table: HTMLTableElement, title: string): TableModel {
  const headRow = table.tHead?.rows[0];
  const width = Math.max(...Array.from(table.rows, (r) => r.cells.length));
  const columns = Array.from({ length: width }, (_, i) => ({
    key: `c${i}`,
    label: headRow?.cells[i] ? text(headRow.cells[i]) : "",
  }));
  const bodyRows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
  return {
    title,
    columns,
    rows: bodyRows.map((row) => {
      const cells = Array.from(row.cells, text);
      return [...cells, ...Array<string | null>(width - cells.length).fill(null)];
    }),
  };
}
