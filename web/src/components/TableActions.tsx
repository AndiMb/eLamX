import { useState } from "react";
import { useStore } from "jotai";
import { Check, ClipboardCopy, FileSpreadsheet } from "lucide-react";
import type { TableModel } from "../lib/export/table";
import { clipboardOptions, copyTable, csvOptions, saveTableCsv } from "../lib/export/tableExport";
import { formatConfigFamily } from "../store/formatAtoms";
import { tableExportSettingsAtom } from "../store/settingsAtoms";
import { useLocale, useT } from "../i18n";

// Copy and CSV for a result table (F3.1).
//
// The table is asked for only when a button is pressed: building the model
// on every render would cost every table a second pass over its rows for an
// action that is rarely taken. The settings are read at the same moment and
// from the store, for the same reason.

export function TableActions({
  table,
  name,
}: {
  table: () => TableModel | null;
  /** File name without the extension. */
  name: string;
}) {
  const t = useT();
  const locale = useLocale();
  const store = useStore();
  const [copied, setCopied] = useState(false);

  const options = (kind: "clipboard" | "csv") => {
    const settings = store.get(tableExportSettingsAtom);
    const formats = (c: Parameters<typeof formatConfigFamily>[0]) => store.get(formatConfigFamily(c));
    return kind === "csv" ? csvOptions(settings, locale, formats) : clipboardOptions(settings, locale, formats);
  };

  return (
    <div className="table-actions" role="group" aria-label={t("table.actions")}>
      <button
        type="button"
        className="icon-button"
        title={t("table.copy.hint")}
        aria-label={t("table.copy")}
        onClick={async () => {
          const model = table();
          if (!model) return;
          if (await copyTable(model, options("clipboard"))) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="icon-button"
        title={t("table.csv.hint")}
        aria-label={t("table.csv")}
        onClick={async () => {
          const model = table();
          if (model) await saveTableCsv(model, name, options("csv"));
        }}
      >
        <FileSpreadsheet size={15} aria-hidden="true" />
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? t("table.copied") : ""}
      </span>
    </div>
  );
}
