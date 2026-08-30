import type { ReactNode } from "react";
import { useIsMobile } from "../lib/useIsMobile";

export interface ResponsiveTableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}

type ResponsiveTableProps<T> =
  // Real matrices (ABD, A/B/D blocks) - row/column position IS the meaning,
  // so this only ever gets a sticky-header horizontal-scroll wrapper around
  // the caller's own <table>, never reflowed into cards.
  | { variant: "matrix"; children: ReactNode; className?: string }
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
      className?: string;
    };

export function ResponsiveTable<T>(props: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();

  if (props.variant === "matrix") {
    return <div className={`responsive-table-scroll matrix${props.className ? ` ${props.className}` : ""}`}>{props.children}</div>;
  }

  const { columns, rows, rowKey, rowClassName, onRowClick, cardSummary, className } = props;

  if (isMobile) {
    return (
      <div className="responsive-cards">
        {rows.map((row) => {
          const fields = columns.map((col) => (
            <div className="responsive-card-row" key={col.key}>
              <span className="responsive-card-label">{col.label}</span>
              <span>{col.render(row)}</span>
            </div>
          ));
          const cls = `responsive-card${rowClassName?.(row) ? ` ${rowClassName(row)}` : ""}`;

          return cardSummary ? (
            <details className={`${cls} card-collapsed`} key={rowKey(row)}>
              <summary>{cardSummary(row)}</summary>
              {fields}
            </details>
          ) : (
            <div
              className={cls}
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {fields}
            </div>
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
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={rowClassName?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
