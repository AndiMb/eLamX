// A report as data: what it says, in which order, and nothing about how it
// looks on a page.
//
// The builders (sections/*.ts) turn a project into this and the renderer
// (pdf/*.ts) turns this into a PDF. Keeping the two apart is what lets the
// builders be tested by their structure rather than by pixels, and what lets a
// second output - an HTML preview, a DOCX - be added without touching a
// builder. So nothing here knows about millimetres of a page except a figure's
// width, which is the one thing a builder has an opinion about.

import type { TableModel } from "../export/table";

/** A standalone SVG, as `chartToStandaloneSvg` returns it. */
export interface SvgFigure {
  source: string;
  /** Pixel size the chart was laid out at; its aspect ratio is kept. */
  width: number;
  height: number;
}

/** A bitmap, for what is drawn on a canvas (the 3D views). */
export interface PngFigure {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export type Block =
  | { t: "heading"; level: 1 | 2 | 3; text: string }
  | { t: "paragraph"; text: string; muted?: boolean }
  /** Label and value per row - a property list, not a data table. */
  | { t: "keyValue"; rows: [string, string][] }
  /** Numbers stay numbers in the canonical unit; the renderer formats them
   *  as the screen does, in the user's unit and language. */
  | { t: "table"; table: TableModel }
  | { t: "figure"; svg?: SvgFigure; png?: PngFigure; caption: string; widthMm: number }
  /** A set formula: the symbolic form and, where there are numbers to put in,
   *  the same with them. TeX, the same source the app shows with KaTeX. */
  | { t: "formula"; title: string; tex: string; substituted?: string; note?: string }
  | { t: "pageBreak" };

export interface ReportSection {
  /** Stable, e.g. `laminate:<id>:layerResults`; for tests and anchors. */
  id: string;
  title: string;
  blocks: Block[];
}

/** Everything the renderer needs besides the content: the header block, the
 *  running header and footer, and the words of the page furniture - the
 *  renderer has no catalog of its own. */
export interface ReportMeta {
  title: string;
  projectName: string;
  /** Already formatted for the report's language. */
  date: string;
  /** `0.2.0 (abc1234)`. */
  version: string;
  author: string;
  /** Rows of the header block under the title: laminate shorthand, criteria,
   *  load case, units, ... - labelled already. */
  header: [string, string][];
  /** Whether the cover carries lines for the author's and a reviewer's
   *  signature (O8). */
  signature: boolean;
  paper: "a4" | "letter";
  labels: ReportLabels;
}

export interface ReportLabels {
  contents: string;
  /** `Seite {page} von {pages}` with the two placeholders. */
  pageOf: string;
  figure: string;
  preparedBy: string;
  reviewedBy: string;
  signatureDate: string;
  signature: string;
  withValues: string;
}

export interface ReportDoc {
  meta: ReportMeta;
  sections: ReportSection[];
}

/** A saved choice of what a report contains, kept in the project file
 *  (`WebExtension.report_templates`). */
export interface ReportTemplate {
  name: string;
  /** Section kinds, in report order - see `SECTION_KINDS`. */
  sections: SectionKind[];
  /** Laminate ids; empty for all. */
  laminates: string[];
  /** `all` or only each laminate's active load case. */
  loadCases: "all" | "active";
  detail: "results" | "derivation";
  paper: "a4" | "letter";
  author: string;
  signature: boolean;
}

/** Every section a report can have, in the order it appears. */
export const SECTION_KINDS = [
  "materials",
  "laminate",
  "abd",
  "loadCases",
  "layerResults",
  "failureSequence",
  "buckling",
  "vibration",
  "deformation",
  "comparison",
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

export function defaultReportTemplate(): ReportTemplate {
  return {
    name: "",
    sections: SECTION_KINDS.filter((k) => k !== "comparison"),
    laminates: [],
    loadCases: "active",
    detail: "results",
    paper: "a4",
    author: "",
    signature: false,
  };
}
