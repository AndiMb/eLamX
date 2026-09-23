import type { ComponentType, ReactNode } from "react";
import { useIsMobile } from "../lib/useIsMobile";
import type { Cell, TableModel } from "../lib/export/table";
import { recordsTableModel } from "../lib/export/records";
import type { QuantityCategory } from "../lib/units";
import { TableActions } from "./TableActions";

export interface ResponsiveTableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** A column of measured values. Right-aligns cell AND header and switches
   *  the cell to tabular figures, so the digits of a column line up under
   *  each other and two reserve factors can be compared by their shape
   *  rather than by reading them. Set it on everything that is a number with
   *  a unit or a magnitude - not on ordinals like the ply number, which read
   *  as labels and belong at the left edge with the rest of the row's
   *  identity. */
  numeric?: boolean;
  /** Left out of the mobile cards - for a control that only makes sense in
   *  a table row, like a drag handle a card has in its summary instead. */
  hideInCards?: boolean;
  /** The cell as data, for copy and CSV (F3.1): a number in the canonical
   *  unit, a text, or null. A column without it is left out of the export -
   *  a drag handle, a button. */
  value?: (row: T) => Cell;
  /** The quantity `value` returns, for the unit in the export's header. */
  category?: QuantityCategory;
  /** Decimals of an uncategorised number, for "as displayed". */
  decimals?: number;
}

/** Where a table's copy and CSV actions get their data: a model the caller
 *  builds, or the columns' own `value`s under a title. */
export type TableExport =
  | { table: () => TableModel | null; name: string }
  | { title: string; name: string };


/** What a row is rendered into: a table row, or a card - open/closable when
 *  the table has a card summary. */
export interface RowShellProps<T> {
  row: T;
  kind: "tr" | "details" | "div";
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}

function DefaultRowShell<T>({ kind, className, onClick, children }: RowShellProps<T>) {
  if (kind === "tr") {
    return (
      <tr className={className} onClick={onClick}>
        {children}
      </tr>
    );
  }
  if (kind === "details") return <details className={className}>{children}</details>;
  return (
    <div className={className} onClick={onClick}>
      {children}
    </div>
  );
}

type ResponsiveTableProps<T> =
  // Real matrices (ABD, A/B/D blocks) - row/column position IS the meaning,
  // so this only ever gets a sticky-header horizontal-scroll wrapper around
  // the caller's own <table>, never reflowed into cards.
  | {
      variant: "matrix";
      children: ReactNode;
      className?: string;
      /** Copy and CSV above the matrix. */
      actions?: { table: () => TableModel | null; name: string };
    }
  // Per-entry tables (layer results) - a normal table on wide screens,
  // stacked label:value cards on mobile, since scanning one entry at a time
  // beats a cramped horizontally-scrolled row there.
  | {
      variant: "records";
      columns: ResponsiveTableColumn<T>[];
      rows: T[];
      rowKey: (row: T) => string | number;
      rowClassName?: (row: T) => string | undefined;
      /** Makes rows act as buttons - both in the table and in the mobile
       *  cards, so a detail view is reachable on either. */
      onRowClick?: (row: T) => void;
      /** One line summarising the row, shown on the CLOSED card; the full set
       *  of fields appears when it is opened.
       *
       *  Without it every column stacks, which is right for a handful of
       *  read-only values and wrong for an editable list: a ply card with
       *  eight labelled fields is 330 px tall, so a 16-ply stack was 5300 px
       *  of cards and the stack was never visible as a whole. Return display
       *  values here, not inputs - a control inside a <summary> fights the
       *  toggle for the tap. */
      cardSummary?: (row: T) => ReactNode;
      /** Renders the row's element in place of the plain `<tr>` or card -
       *  for rows that need a ref or props of their own, such as sortable
       *  ones. It must render the element `kind` names. */
      RowShell?: ComponentType<RowShellProps<T>>;
      className?: string;
      /** Copy and CSV above the table (F3.1). */
      actions?: TableExport;
    };

export function ResponsiveTable<T>(props: ResponsiveTableProps<T>) {
  if (props.variant === "matrix") {
    const matrix = (
      <div className={`responsive-table-scroll matrix${props.className ? ` ${props.className}` : ""}`}>{props.children}</div>
    );
    return props.actions ? (
      <>
        <div className="table-toolbar">
          <TableActions {...props.actions} />
        </div>
        {matrix}
      </>
    ) : (
      matrix
    );
  }

  const { actions } = props;
  const toolbar = actions ? (
    <div className="table-toolbar">
      {"table" in actions ? (
        <TableActions table={actions.table} name={actions.name} />
      ) : (
        <TableActions table={() => recordsTableModel(actions.title, props.columns, props.rows)} name={actions.name} />
      )}
    </div>
  ) : null;
  return (
    <>
      {toolbar}
      <RecordsTable {...props} />
    </>
  );
}

function RecordsTable<T>(props: Extract<ResponsiveTableProps<T>, { variant: "records" }>) {
  const isMobile = useIsMobile();

  const { columns, rows, rowKey, rowClassName, onRowClick, cardSummary, className } = props;
  const Row = props.RowShell ?? DefaultRowShell;

  if (isMobile) {
    return (
      <div className="responsive-cards">
        {rows.map((row) => {
          const fields = columns
            .filter((col) => !col.hideInCards)
            .map((col) => (
              <div className="responsive-card-row" key={col.key}>
                <span className="responsive-card-label">{col.label}</span>
                <span className={col.numeric ? "num" : undefined}>{col.render(row)}</span>
              </div>
            ));
          const cls = `responsive-card${rowClassName?.(row) ? ` ${rowClassName(row)}` : ""}`;

          return cardSummary ? (
            <Row row={row} kind="details" className={`${cls} card-collapsed`} key={rowKey(row)}>
              <summary>{cardSummary(row)}</summary>
              {fields}
            </Row>
          ) : (
            <Row
              row={row}
              kind="div"
              className={cls}
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {fields}
            </Row>
          );
        })}
      </div>
    );
  }

  return (
    <div className="responsive-table-scroll">
      <table className={className}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.numeric ? "num" : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row
              row={row}
              kind="tr"
              key={rowKey(row)}
              className={rowClassName?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.numeric ? "num" : undefined}>
                  {col.render(row)}
                </td>
              ))}
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  );
}
