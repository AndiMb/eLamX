import { useState, type RefObject } from "react";
import { Camera } from "lucide-react";
import { saveChartPng } from "../../lib/chartSnapshot";
import { useT } from "../../i18n";

// The camera button eLamX puts in every view's toolbar.
//
// It takes a ref rather than looking for the chart in the DOM around itself:
// the charts here have several shapes of wrapper, and a button that guesses
// which element is "the chart" would keep working until someone adds a second
// svg and then quietly save the wrong one.

export function ChartSnapshotButton({
  target,
  name,
  title,
}: {
  target: RefObject<SVGSVGElement | null> | RefObject<HTMLCanvasElement | null>;
  /** File name without the extension. */
  name: string;
  /** Written across the top of the picture, where the chart has a caption on
   *  the page that the SVG itself does not carry. */
  title?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="icon-button chart-snapshot"
      disabled={busy}
      title={t("chart.snapshot")}
      aria-label={t("chart.snapshot")}
      onClick={async () => {
        const element = target.current;
        if (!element) return;
        setBusy(true);
        try {
          await saveChartPng(element, name, title);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Camera size={16} aria-hidden="true" />
    </button>
  );
}
