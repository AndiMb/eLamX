// The renderer in Node, with jsdom standing in for the browser: it has to
// produce a PDF with the pages the layout promises, and the text has to be in
// the embedded font. Set REPORT_PDF_OUT to keep the file for a look.
import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { installPdfDom } from "../../../test/pdfDom";
import { reportFonts } from "../../../test/reportFonts";
import type { ReportDoc } from "../model";
import { normaliseSvgFonts, renderPdf } from "./render";

const fonts = reportFonts();
const parseSvg = installPdfDom(fonts);

const CHART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">
  <g transform="translate(40,10)">
    <line x1="0" x2="340" y1="170" y2="170" style="stroke:#555;stroke-width:1"/>
    <rect x="20" y="40" width="30" height="130" style="fill:#2a78d6"/>
    <rect x="80" y="90" width="30" height="80" style="fill:#e34948"/>
    <text x="35" y="185" style="font-size:11px;font-family:system-ui;text-anchor:middle">⌖ 1</text>
    <text x="95" y="185" style="font-size:11px;font-family:system-ui;font-weight:600;text-anchor:middle">σ₁₁ ≤ R∥</text>
  </g>
</svg>`;

function sampleDoc(sections = 2): ReportDoc {
  return {
    meta: {
      title: "Festigkeitsnachweis",
      projectName: "Flügelschale Süd",
      date: "24.09.2026",
      version: "0.2.0 (test)",
      author: "A. Prüfer",
      header: [
        ["Laminat", "[0/±45/90]s"],
        ["Kriterien", "Puck, Tsai-Wu"],
        ["Lastfall", "Nₓ = 200 N/mm"],
      ],
      signature: true,
      paper: "a4",
      labels: {
        contents: "Inhalt",
        pageOf: "Seite {page} von {pages}",
        figure: "Abbildung",
        preparedBy: "Erstellt",
        reviewedBy: "Geprüft",
        signatureDate: "Datum",
        signature: "Unterschrift",
        withValues: "Mit den Werten dieses Laminats:",
      },
    },
    sections: Array.from({ length: sections }, (_, s) => ({
      id: `s${s}`,
      title: `Abschnitt ${s + 1} – Lagen`,
      blocks: [
        { t: "heading", level: 2, text: "Tabelle" },
        {
          t: "table",
          table: {
            title: "Lagenergebnisse",
            columns: [
              { key: "nr", label: "Lage", decimals: 0 },
              { key: "angle", label: "θ [°]", decimals: 1 },
              { key: "rf", label: "RF" },
            ],
            rows: Array.from({ length: 40 }, (_, i) => [i + 1, (i * 15) % 180 - 45, 1.2345 + i / 10]),
          },
        },
        { t: "paragraph", text: "Äußere Lasten wirken; ε₂₂ = 0,42 ‰, ΔT = −80 °C." },
        { t: "keyValue", rows: [["E₁", "141 000 MPa"], ["ν₁₂", "0,28"]] },
        { t: "figure", svg: { source: CHART, width: 400, height: 200 }, caption: "Reservefaktoren", widthMm: 150 },
        {
          t: "formula",
          title: "ABD-Matrix",
          tex: "A_{ij} = \\sum_{k=1}^{n} \\bar Q_{ij,k}\\, t_k",
          substituted: "A_{11} = 42\\,187{,}5 \\cdot 0{,}125 + \\dots",
        },
        { t: "heading", level: 3, text: "Unterpunkt" },
        { t: "pageBreak" },
      ],
    })),
  };
}

describe("renderPdf", () => {
  test("lays out cover, contents and sections with the embedded font", async () => {
    const progress: number[] = [];
    const bytes = await renderPdf(sampleDoc(), {
      fonts,
      parseSvg,
      locale: "de",
      onProgress: (done) => progress.push(done),
    });
    if (process.env.REPORT_PDF_OUT) writeFileSync(process.env.REPORT_PDF_OUT, bytes);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    const pages = text.match(/\/Type \/Page\b/g)?.length ?? 0;
    // Cover, one contents page, and each section at least two pages (40 rows
    // of table, a chart and a formula, then a page break).
    expect(pages).toBeGreaterThanOrEqual(6);
    expect(text).toContain("/FontName /");
    expect(text).not.toMatch(/\/BaseFont \/Times/);
    expect(text).toContain("/Outlines");
    expect(progress).toEqual([1, 2]);
  }, 60000);

  test("snaps chart fonts to the embedded family and its two weights", () => {
    expect(normaliseSvgFonts('<text style="font-family:system-ui, sans-serif;font-weight:600">')).toBe(
      '<text style="font-family:ElamxSans;font-weight:bold">',
    );
    expect(normaliseSvgFonts('<text font-family="Arial" font-weight="400">')).toBe(
      '<text font-family="ElamxSans" font-weight="normal">',
    );
  });
});
