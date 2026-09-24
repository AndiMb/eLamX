// A canvas figure that nothing can draw does not cost the report: it becomes
// a line saying which figure is missing. Here nothing can draw it because
// there is no DOM at all - the extreme case of a browser without WebGL and
// without a 2D canvas; the two real cases are checked in a browser.
import { describe, expect, test } from "vitest";
import { translate } from "../../i18n";
import { resolveFigures } from "./figures";
import type { ReportDoc } from "./model";

describe("resolveFigures", () => {
  test("replaces a canvas figure it cannot draw by a note naming it", async () => {
    const doc: ReportDoc = {
      meta: {} as ReportDoc["meta"],
      sections: [
        {
          id: "s",
          title: "S",
          blocks: [
            {
              t: "figure",
              caption: "First buckling mode",
              widthMm: 160,
              request: {
                kind: "plate",
                plate: {
                  surface: [
                    [0, 0],
                    [0, 1],
                  ],
                  length: 500,
                  width: 500,
                  thickness: 2,
                  plyBoundaries: [-0.5, 0.5],
                  deflectionFraction: 0.12,
                },
                legend: { title: "w", unit: null, ticks: [], anchor: null, range: "", kind: "diverging" },
              },
            },
          ],
        },
      ],
    };
    const t = (k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate("en", k, p);
    const resolved = await resolveFigures(doc, t, "en");
    expect(resolved.sections[0].blocks).toEqual([
      {
        t: "paragraph",
        muted: true,
        text: "Figure not available, the browser offers no canvas to draw it on: First buckling mode",
      },
    ]);
  });
});
