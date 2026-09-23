// A result table as data, for everything that takes a table out of the app:
// the clipboard (TSV and HTML for Excel), a CSV file, later the PDF report.
//
// The screen formats numbers for reading - rounded to the chosen decimals,
// with thousands separators - and none of that belongs in a file someone
// will compute with. So a table here holds the CANONICAL numbers, the same
// ones the core returned, and each serializer decides how to write them:
// converted into the unit the user picked (a column says which quantity it
// is), at full precision unless asked for the display's rounding, and
// without grouping, which a spreadsheet would read as a decimal separator.

import { createQuantityFormatter } from "../quantityFormat";
import type { QuantityCategory } from "../units";
import type { FormatConfig } from "../../store/formatAtoms";
import type { Locale } from "../../i18n";

export interface TableModel {
  title: string;
  columns: Column[];
  rows: Cell[][];
}

export interface Column {
  key: string;
  label: string;
  /** The quantity a numeric column holds. Its unit goes into the header, and
   *  its numbers are converted into that unit; without one they are written
   *  as they are. */
  category?: QuantityCategory;
}

/** A number in the core's canonical unit, a text, or nothing. */
export type Cell = number | string | null;

export interface SerializeOptions {
  /** Language of the unit labels. */
  locale: Locale;
  /** Field separator; ignored by `toHtmlTable`. */
  sep: string;
  /** Decimal separator. */
  decimal: string;
  /** `full`: every digit the number has, so a value read back is the value
   *  written. `display`: rounded as the screen rounds it. */
  precision: "full" | "display";
  /** The user's unit and format setting for a quantity - in the app
   *  `(c) => store.get(formatConfigFamily(c))`. Without it every column is
   *  written in the core's canonical unit, with no unit in the header. */
  formats?: (category: QuantityCategory) => FormatConfig;
}

/** What a spreadsheet in that language expects when it opens a CSV: German
 *  Excel splits on `;`, because `,` is its decimal separator. */
export function delimitedDefaults(locale: Locale): Pick<SerializeOptions, "sep" | "decimal"> {
  return locale === "de" ? { sep: ";", decimal: "," } : { sep: ",", decimal: "." };
}

interface PreparedColumn {
  header: string;
  number: (value: number) => string;
}

function prepare(table: TableModel, options: SerializeOptions): PreparedColumn[] {
  return table.columns.map((column) => {
    const config = column.category && options.formats?.(column.category);
    const formatter =
      column.category && config
        ? createQuantityFormatter(column.category, config, options.locale)
        : null;
    const convert = formatter ? formatter.convert : (v: number) => v;
    const round = (v: number): string => {
      if (options.precision === "full" || !config) {
        // The shortest text that reads back as the same double - 17
        // significant digits where it needs them, and not "0.1000000000000000055".
        return String(v);
      }
      return config.notation === "scientific"
        ? v.toExponential(config.decimals)
        : v.toFixed(config.decimals);
    };
    return {
      header: formatter?.unit ? `${column.label} [${formatter.unit}]` : column.label,
      number: (value: number) => {
        // No value is an empty field rather than "NaN" or "–": a spreadsheet
        // treats an empty cell as missing and a text as a text.
        if (!Number.isFinite(value)) return "";
        return round(convert(value)).replace(".", options.decimal);
      },
    };
  });
}

function cellText(cell: Cell, column: PreparedColumn): string {
  if (cell === null) return "";
  return typeof cell === "number" ? column.number(cell) : cell;
}

/** Quotes a field that would otherwise be split or run into the next one. */
function quote(field: string, sep: string): string {
  return field.includes(sep) || /["\r\n]/.test(field) || field !== field.trim()
    ? `"${field.replaceAll('"', '""')}"`
    : field;
}

/**
 * The table as CSV or TSV: a header row with units, then one row per row.
 * Lines end in CRLF, which is what RFC 4180 and Excel expect. The title is
 * not part of it - a line above the header would be read as the header.
 */
export function toDelimited(table: TableModel, options: SerializeOptions): string {
  const columns = prepare(table, options);
  const lines = [
    columns.map((c) => quote(c.header, options.sep)),
    ...table.rows.map((row) =>
      columns.map((column, i) => quote(cellText(row[i] ?? null, column), options.sep)),
    ),
  ];
  return lines.map((fields) => fields.join(options.sep)).join("\r\n") + "\r\n";
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The table as HTML, for the clipboard: Excel and word processors paste it
 * as a real table, with the title as its caption. Numbers are written as in
 * `toDelimited`, so they arrive as numbers in the spreadsheet's language.
 */
export function toHtmlTable(table: TableModel, options: Omit<SerializeOptions, "sep">): string {
  const columns = prepare(table, { ...options, sep: "\t" });
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column, i) => {
            const cell = row[i] ?? null;
            const text = escapeHtml(cellText(cell, column));
            return typeof cell === "number" ? `<td align="right">${text}</td>` : `<td>${text}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return (
    `<table><caption>${escapeHtml(table.title)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  );
}
