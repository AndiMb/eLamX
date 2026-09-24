import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useStore } from "jotai";
import { Download, FileBox, FileImage, FileCode2, FileSpreadsheet } from "lucide-react";
import { saveChartPng, saveChartSvg } from "../../lib/chartSnapshot";
import type { TableModel } from "../../lib/export/table";
import { csvOptions, saveTableCsv } from "../../lib/export/tableExport";
import { formatConfigFamily } from "../../store/formatAtoms";
import { tableExportSettingsAtom } from "../../store/settingsAtoms";
import { useLocale, useT } from "../../i18n";

// The export button eLamX puts in every view's toolbar - now a small menu
// (P3.2): PNG as before, SVG for a chart drawn as SVG, and the data behind it
// as CSV where the chart hands them over.
//
// It takes a ref rather than looking for the chart in the DOM around itself:
// the charts here have several shapes of wrapper, and a button that guesses
// which element is "the chart" would keep working until someone adds a second
// svg and then quietly save the wrong one.

export function ChartSnapshotButton({
  target,
  name,
  title,
  data,
  extra,
}: {
  /** The chart: an SVG, a canvas, or an element holding several SVGs that
   *  make one chart together. */
  target: RefObject<SVGSVGElement | null> | RefObject<HTMLCanvasElement | null> | RefObject<HTMLElement | null>;
  /** File name without the extension. */
  name: string;
  /** Written across the top of the picture, where the chart has a caption on
   *  the page that the SVG itself does not carry. */
  title?: string;
  /** The series the chart draws, as a table - offered as CSV. */
  data?: () => TableModel | null;
  /** Further formats of the same view, in the same menu - the VTK file of a
   *  3D body. One menu per view, rather than a PNG in the picture's corner
   *  and a second export as a button somewhere under it. */
  extra?: readonly { key: string; label: string; run: () => void | Promise<void> }[];
}) {
  const t = useT();
  const locale = useLocale();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [isSvg, setIsSvg] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);

  // Closed by a click elsewhere or Escape, like any menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (action: () => Promise<void>) => {
    setOpen(false);
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const png = () =>
    run(async () => {
      const element = target.current;
      if (element) await saveChartPng(element, name, title);
    });
  const svg = () =>
    run(async () => {
      const element = target.current;
      if (element && !(element instanceof HTMLCanvasElement)) await saveChartSvg(element, name);
    });
  const csv = () =>
    run(async () => {
      const table = data?.();
      if (!table) return;
      const formats = (c: Parameters<typeof formatConfigFamily>[0]) => store.get(formatConfigFamily(c));
      await saveTableCsv(table, name, csvOptions(store.get(tableExportSettingsAtom), locale, formats));
    });

  return (
    <div className="chart-export" ref={root}>
      <button
        type="button"
        className="icon-button chart-snapshot"
        disabled={busy}
        title={t("chart.export")}
        aria-label={t("chart.export")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          // Only an SVG chart can be saved as SVG; a canvas is a bitmap.
          setIsSvg(!!target.current && !(target.current instanceof HTMLCanvasElement));
          setOpen((o) => !o);
        }}
      >
        <Download size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="chart-export-menu" role="menu" id={menuId}>
          <button type="button" role="menuitem" autoFocus onClick={png}>
            <FileImage size={14} aria-hidden="true" /> {t("chart.export.png")}
          </button>
          {isSvg && (
            <button type="button" role="menuitem" onClick={svg}>
              <FileCode2 size={14} aria-hidden="true" /> {t("chart.export.svg")}
            </button>
          )}
          {data && (
            <button type="button" role="menuitem" onClick={csv}>
              <FileSpreadsheet size={14} aria-hidden="true" /> {t("chart.export.csv")}
            </button>
          )}
          {extra?.map((entry) => (
            <button key={entry.key} type="button" role="menuitem" onClick={() => run(async () => entry.run())}>
              <FileBox size={14} aria-hidden="true" /> {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
