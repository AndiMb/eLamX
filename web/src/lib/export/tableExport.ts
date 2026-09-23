// A table out of the app: onto the clipboard, or into a CSV file (F3.1).
//
// The serializers in table.ts decide what the text is; this decides where it
// goes and with which settings - the user's units, their choice of precision
// and separators, the language's defaults where they chose none.

import type { Locale } from "../../i18n";
import type { QuantityCategory } from "../units";
import type { FormatConfig } from "../../store/formatAtoms";
import type { TableExportSettings } from "../../store/settingsAtoms";
import { saveFile } from "../saveFile";
import { delimitedDefaults, toDelimited, toHtmlTable, type SerializeOptions, type TableModel } from "./table";

/** The serializer options for a file, from the settings and the language. */
export function csvOptions(
  settings: TableExportSettings,
  locale: Locale,
  formats: (category: QuantityCategory) => FormatConfig,
): SerializeOptions {
  const defaults = delimitedDefaults(locale);
  const decimal = settings.decimal === "auto" ? defaults.decimal : settings.decimal;
  let sep = settings.separator === "auto" ? defaults.sep : settings.separator === "tab" ? "\t" : settings.separator;
  // A comma as separator AND decimal mark would split every number in two.
  if (sep === decimal) sep = decimal === "," ? ";" : ",";
  return { locale, sep, decimal, precision: settings.precision, formats };
}

/** The same for the clipboard: always tab-separated, which is what a
 *  spreadsheet splits a pasted text on, whatever its language. */
export function clipboardOptions(
  settings: TableExportSettings,
  locale: Locale,
  formats: (category: QuantityCategory) => FormatConfig,
): SerializeOptions {
  return { ...csvOptions(settings, locale, formats), sep: "\t" };
}

/**
 * Puts the table on the clipboard twice: as HTML, which Excel and a word
 * processor paste as a table with its caption, and as tab-separated text for
 * everything else. Resolves to whether it worked.
 */
export async function copyTable(table: TableModel, options: SerializeOptions): Promise<boolean> {
  const text = toDelimited(table, options);
  const html = toHtmlTable(table, options);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Refused - an insecure context, or a browser without the permission.
    // The copy event below needs neither.
  }
  let done = false;
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", text);
    event.clipboardData?.setData("text/html", html);
    event.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", onCopy);
  }
  return done;
}

/** A file name from a table's title: no characters a file system refuses. */
export function fileNameOf(title: string, extension: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${base || "table"}.${extension}`;
}

/** Writes the table as CSV. The byte-order mark is for Excel, which reads a
 *  file without one in the system's code page and garbles every umlaut. */
export async function saveTableCsv(table: TableModel, name: string, options: SerializeOptions): Promise<void> {
  const csv = `﻿${toDelimited(table, options)}`;
  await saveFile(new Blob([csv], { type: "text/csv;charset=utf-8" }), name.endsWith(".csv") ? name : `${name}.csv`, [
    "csv",
  ]);
}
