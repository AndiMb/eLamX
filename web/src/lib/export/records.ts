// A table model from the columns of a records table: every column that says
// what its cell is as data (`value`) goes into the export.
import type { QuantityCategory } from "../units";
import type { Cell, TableModel } from "./table";

export interface RecordColumn<T> {
  key: string;
  label: string;
  value?: (row: T) => Cell;
  category?: QuantityCategory;
  decimals?: number;
}

/** The model the `value`s of the columns describe. */
export function recordsTableModel<T>(
  title: string,
  columns: readonly RecordColumn<T>[],
  rows: readonly T[],
): TableModel {
  const exported = columns.filter((c) => c.value);
  return {
    title,
    columns: exported.map((c) => ({ key: c.key, label: c.label, category: c.category, decimals: c.decimals })),
    rows: rows.map((row) => exported.map((c) => c.value!(row))),
  };
}
