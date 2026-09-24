// The report of the golden reference project, built with the real core: its
// structure - sections, headings, tables, figures, formulas - pinned as a
// snapshot, without a pixel of layout. Set REPORT_PDF_OUT to render it (with
// its figures left out, which need a browser) for a look.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { importProject } from "../projectFile";
import { elamx } from "../wasm";
import { translate } from "../../i18n";
import { collectResults } from "./collect";
import { buildReport } from "./build";
import { defaultFormats, type ReportContext } from "./context";
import { SECTION_KINDS, type Block, type ReportDoc, type ReportTemplate } from "./model";
import { BatchClient } from "../batchClient";
import { planStudy } from "../study/plan";
import { defaultMatrix, defaultSweep, defaultVariation, type StudyDef } from "../study/model";
import type { PointResult } from "../study/evaluate";

const REFERENCE = readFileSync(
  fileURLToPath(new URL("../../../../elamx-core/core/tests/golden/reference.elamx", import.meta.url)),
  "utf8",
);

function outline(doc: ReportDoc) {
  const describeBlock = (b: Block): string => {
    switch (b.t) {
      case "heading":
        return `h${b.level} ${b.text}`;
      case "table":
        return `table ${b.table.title} (${b.table.columns.length}x${b.table.rows.length})`;
      case "figure":
        return `figure ${b.request?.kind ?? "?"}: ${b.caption}`;
      case "formula":
        return `formula ${b.title}${b.substituted ? " +values" : ""}`;
      case "keyValue":
        return `keyValue ${b.rows.map((r) => r[0]).join(" | ")}`;
      default:
        return b.t;
    }
  };
  return doc.sections.map((s) => ({ id: s.id, title: s.title, blocks: s.blocks.map(describeBlock) }));
}

async function referenceReport(template: ReportTemplate, locale: "de" | "en" = "de") {
  const project = await importProject(REFERENCE);
  const ctx: ReportContext = {
    t: (k, p) => translate(locale, k, p),
    locale,
    formats: defaultFormats,
    metric: "rf",
    detail: template.detail,
  };
  const collected = await collectResults(template, project, elamx, () => undefined);
  return buildReport(template, collected, ctx, {
    projectName: "reference",
    author: "",
    date: new Date(Date.UTC(2026, 8, 24)),
    version: "0.2.0 (test)",
  });
}

const FULL: ReportTemplate = {
  name: "",
  sections: [...SECTION_KINDS],
  // GM-Kriterien (every criterion, LPF, buckling) and GM-SymMittellage
  // (symmetric with a middle ply, more buckling and an LPF of its own).
  laminates: ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000001a"],
  loadCases: "active",
  detail: "derivation",
  paper: "a4",
  author: "",
  signature: true,
};

describe("the reference project's report", () => {
  test("has the structure the template asks for", async () => {
    const doc = await referenceReport(FULL);
    expect(outline(doc)).toMatchSnapshot();
    expect(doc.meta.header.map(([k]) => k)).toEqual([
      "Projekt",
      "Laminate",
      "Versagenskriterien",
      "Lastfälle",
      "Einheiten",
      "Detailgrad",
      "Datum",
      "Programmversion",
    ]);
    // O9: the laminate in its condensed notation.
    expect(doc.meta.header[1][1]).toContain("GM-SymMittellage  [");
    if (process.env.REPORT_PDF_OUT) {
      const { renderPdf } = await import("./pdf/render");
      const { installPdfDom } = await import("../../test/pdfDom");
      const { reportFonts } = await import("../../test/reportFonts");
      const fonts = reportFonts();
      const bytes = await renderPdf(doc, { fonts, parseSvg: installPdfDom(fonts), locale: "de", formats: defaultFormats });
      writeFileSync(process.env.REPORT_PDF_OUT, bytes);
    }
  }, 120000);

  test("leaves the derivation out of a results-only report", async () => {
    const doc = await referenceReport({ ...FULL, detail: "results", laminates: [FULL.laminates[0]] });
    expect(doc.sections.flatMap((s) => s.blocks).some((b) => b.t === "formula")).toBe(false);
  }, 120000);

  test("covers every load case when asked, and nothing it was not asked for", async () => {
    const doc = await referenceReport(
      { ...FULL, sections: ["layerResults"], loadCases: "all", laminates: [FULL.laminates[0]] },
      "en",
    );
    expect(doc.sections.map((s) => s.id)).toEqual(["laminate:00000000-0000-4000-8000-00000000000a"]);
    const headings = doc.sections[0].blocks.filter((b) => b.t === "heading" && b.level === 2);
    expect(headings.map((h) => (h as { text: string }).text)).toEqual([
      "Ply results, load case GM-Krit-Zug",
      "Ply results, load case GM-Krit-Druck",
      "Ply results, load case GM-Krit-Schub",
      "Ply results, load case GM-Krit-Biegung",
      "Ply results, load case GM-Krit-Kombiniert",
    ]);
  }, 120000);

  test("contains the studies: a matrix as a table, a sweep as a table and a chart per output", async () => {
    const project = await importProject(REFERENCE);
    const [first, second] = project.laminates;
    const studies: StudyDef[] = [
      { id: "m", name: "Matrix", kind: "matrix", matrix: { ...defaultMatrix(), laminates: [first.id, second.id] } },
      {
        id: "s",
        name: "Winkel",
        kind: "sweep",
        sweep: { ...defaultSweep(first.id), x: { ...defaultVariation("angle"), steps: 7 }, outputs: ["min_rf", "ex"] },
      },
    ];
    const ctx: ReportContext = { t: (k, p) => translate("de", k, p), locale: "de", formats: defaultFormats, metric: "rf", detail: "results" };
    const client = new BatchClient({ createWorker: () => null });
    const template = { ...FULL, sections: ["studies" as const] };
    const collected = await collectResults(template, { ...project, studies }, elamx, () => undefined, undefined, {
      plan: (study) => planStudy(study, project, { lpfNeedsLoads: "", fractionsExceedOne: "", fractionsUndetermined: "", noLayers: "" }),
      run: async (_study, plan) => {
        const points: (PointResult | undefined)[] = [];
        await client.run({ kind: "points", points: plan.points }, { onPoint: (i, v) => (points[i] = v) }).promise;
        return points;
      },
    });
    const doc = buildReport(template, collected, ctx, { projectName: "r", author: "", date: new Date(0), version: "t" });
    const [section] = outline(doc);
    expect(section.id).toBe("studies");
    expect(section.blocks).toEqual([
      "h2 Matrix",
      "paragraph",
      expect.stringMatching(/^table Matrix \(RF\) \(\d+x2\)$/),
      "h2 Winkel",
      "paragraph",
      "table Winkel (3x7)",
      expect.stringMatching(/^figure sweep: Winkel: /),
      expect.stringMatching(/^figure sweep: Winkel: Ex/),
    ]);
    // Every matrix cell computed.
    const matrix = doc.sections[0].blocks[2] as Extract<Block, { t: "table" }>;
    expect(matrix.table.rows.flat().every((c) => c !== null)).toBe(true);
  }, 120000);
});
