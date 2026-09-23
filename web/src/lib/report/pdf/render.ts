// A `ReportDoc` as a PDF: the page layout of the report.
//
// jsPDF writes the file, svg2pdf.js turns the charts' SVG into PDF paths (so
// they stay vectors and print sharp at any size), jspdf-autotable sets the
// tables and breaks them across pages, MathJax sets the formulas. All of it is
// plain JavaScript, so the same code makes the same PDF in a browser tab, in
// the desktop shell and - with a DOM stand-in - in a test.
//
// Everything here is behind a dynamic import: none of it is in the bundle the
// app starts with. See `index.ts` for the browser's entry.
//
// The page, top to bottom: a cover with the title, the header block and
// optionally lines to sign; the contents, on pages reserved before the rest is
// laid out and filled in after, when the page of every heading is known; then
// the sections. Every page but the cover has a running header, every page a
// footer with "page n of m" - also written last, when m is known.

import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { autoTable, type RowInput } from "jspdf-autotable";
import type { Block, ReportDoc } from "../model";
import { toDisplayTable, type SerializeOptions } from "../../export/table";
import type { Locale } from "../../../i18n";
import { texToSvg } from "./math";

/** The family name both weights are registered under. */
export const FONT = "ElamxSans";

export interface RenderEnv {
  /** The two TTFs of `fonts/`. */
  fonts: { regular: Uint8Array; bold: Uint8Array };
  /** SVG markup to an Element - `DOMParser` in a browser, jsdom in a test. */
  parseSvg: (source: string) => Element;
  locale: Locale;
  /** The user's unit and format settings, for the tables. */
  formats?: SerializeOptions["formats"];
  /** Called after each section; the total counts the sections. */
  onProgress?: (done: number, total: number) => void;
}

const PAPER: Record<ReportDoc["meta"]["paper"], [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};
const MARGIN = { left: 20, right: 20, top: 24, bottom: 22 };
const PT = 25.4 / 72; // one point in millimetres

const INK: [number, number, number] = [14, 19, 27];
const MUTED: [number, number, number] = [72, 80, 95];
const RULE: [number, number, number] = [195, 202, 214];
const HEAD_FILL: [number, number, number] = [236, 239, 244];

/** Size in points, line height in mm, gap before in mm. */
const HEADING = {
  1: { size: 15, gap: 4 },
  2: { size: 12, gap: 5 },
  3: { size: 10.5, gap: 3.5 },
} as const;
const BODY_SIZE = 9.5;
const SMALL_SIZE = 8;
/** Formulas are set at this size, in points. */
const FORMULA_SIZE = 10.5;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * svg2pdf matches a font-family against jsPDF's list and falls back to Times -
 * no umlauts, no Greek - for anything else, and it knows only the weights 400
 * and 700. So every family in the chart becomes ours and every weight snaps to
 * normal or bold.
 */
export function normaliseSvgFonts(svg: string): string {
  return svg
    .replace(/font-family:\s*[^;"]*/g, `font-family:${FONT}`)
    .replace(/font-family="[^"]*"/g, `font-family="${FONT}"`)
    .replace(/font-weight:\s*(\d+)/g, (_, w) => `font-weight:${Number(w) >= 600 ? "bold" : "normal"}`)
    .replace(/font-weight="(\d+)"/g, (_, w) => `font-weight="${Number(w) >= 600 ? "bold" : "normal"}"`);
}

interface TocEntry {
  level: 1 | 2;
  label: string;
  page: number;
  y: number;
}

class Writer {
  readonly doc: jsPDF;
  readonly pageW: number;
  readonly pageH: number;
  readonly width: number;
  y = MARGIN.top;
  figureNumber = 0;
  readonly toc: TocEntry[] = [];
  readonly figureLabel: string;

  constructor(paper: ReportDoc["meta"]["paper"], fonts: RenderEnv["fonts"], figureLabel: string) {
    this.figureLabel = figureLabel;
    const [w, h] = PAPER[paper];
    // Only the fonts a page uses are written - not the fourteen standard fonts
    // jsPDF otherwise lists, which no page here uses.
    this.doc = new jsPDF({ unit: "mm", format: paper, compress: true, putOnlyUsedFonts: true });
    this.pageW = w;
    this.pageH = h;
    this.width = w - MARGIN.left - MARGIN.right;
    this.doc.addFileToVFS("ElamxSans-Regular.ttf", toBase64(fonts.regular));
    this.doc.addFont("ElamxSans-Regular.ttf", FONT, "normal");
    this.doc.addFileToVFS("ElamxSans-Bold.ttf", toBase64(fonts.bold));
    this.doc.addFont("ElamxSans-Bold.ttf", FONT, "bold");
    this.font("normal", BODY_SIZE);
  }

  get bottom() {
    return this.pageH - MARGIN.bottom;
  }

  get page() {
    return this.doc.getNumberOfPages();
  }

  font(style: "normal" | "bold", size: number, color: [number, number, number] = INK) {
    this.doc.setFont(FONT, style).setFontSize(size).setTextColor(...color);
  }

  newPage() {
    this.doc.addPage();
    this.y = MARGIN.top;
  }

  /** Starts a new page unless `height` still fits on this one. */
  ensure(height: number) {
    if (this.y + height > this.bottom) this.newPage();
  }

  /** Wrapped text at the current font; returns the height it took. */
  text(text: string, size: number, style: "normal" | "bold" = "normal", color = INK, indent = 0) {
    this.font(style, size, color);
    const lines = this.doc.splitTextToSize(text, this.width - indent) as string[];
    const lineH = size * PT * 1.35;
    for (const line of lines) {
      this.ensure(lineH);
      // jsPDF places text by its baseline; a line's box starts a cap height up.
      this.doc.text(line, MARGIN.left + indent, this.y + size * PT * 0.95);
      this.y += lineH;
    }
  }
}

function heading(w: Writer, level: 1 | 2 | 3, label: string) {
  const { size, gap } = HEADING[level];
  const lineH = size * PT * 1.3;
  // Kept with what follows: a heading alone at the foot of a page is a
  // heading for the next page.
  if (w.y !== MARGIN.top) w.y += gap;
  w.ensure(lineH + 25);
  if (level <= 2) w.toc.push({ level: level as 1 | 2, label, page: w.page, y: w.y });
  w.text(label, size, "bold");
  if (level === 1) {
    w.doc.setDrawColor(...RULE).setLineWidth(0.3);
    w.doc.line(MARGIN.left, w.y + 0.5, MARGIN.left + w.width, w.y + 0.5);
    w.y += 2.5;
  } else {
    w.y += 1;
  }
}

function keyValue(w: Writer, rows: [string, string][]) {
  if (rows.length === 0) return;
  autoTable(w.doc, {
    startY: w.y,
    margin: { ...MARGIN },
    body: rows as RowInput[],
    theme: "plain",
    styles: { font: FONT, fontStyle: "normal", fontSize: BODY_SIZE, cellPadding: { top: 0.8, bottom: 0.8, left: 0, right: 3 }, textColor: INK },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 52 } },
  });
  w.y = lastY(w) + 3;
}

function lastY(w: Writer): number {
  return (w.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function table(w: Writer, block: Extract<Block, { t: "table" }>, env: RenderEnv) {
  const shown = toDisplayTable(block.table, { locale: env.locale, formats: env.formats });
  if (block.table.title) {
    w.ensure(18);
    w.text(block.table.title, BODY_SIZE, "bold");
    w.y += 1;
  }
  const columns = shown.headers.length;
  // A wide table is set smaller rather than broken across the page width.
  const size = columns > 10 ? 6.5 : columns > 7 ? 7.5 : 8.5;
  const columnStyles: Record<number, { halign?: "right"; cellWidth?: "wrap" }> = {};
  shown.numeric.forEach((numeric, i) => {
    if (numeric) columnStyles[i] = { halign: "right" };
  });
  // A ply or step number is never broken over two lines - the critical
  // ply's marker would otherwise push its number onto a second one.
  block.table.columns.forEach((column, i) => {
    if (column.key === "nr" || column.key === "step" || column.key === "layer") {
      columnStyles[i] = { ...columnStyles[i], cellWidth: "wrap" };
    }
  });
  autoTable(w.doc, {
    startY: w.y,
    margin: { ...MARGIN },
    head: [shown.headers],
    body: shown.rows,
    theme: "grid",
    styles: { font: FONT, fontStyle: "normal", fontSize: size, cellPadding: 1.2, textColor: INK, lineColor: RULE, lineWidth: 0.15 },
    headStyles: { font: FONT, fontStyle: "bold", fillColor: HEAD_FILL, textColor: INK },
    columnStyles,
    // A number column's header sits over its numbers, at the right.
    didParseCell: (data) => {
      if (data.section === "head" && shown.numeric[data.column.index]) data.cell.styles.halign = "right";
    },
    // The header row is repeated on every page the table runs onto.
    showHead: "everyPage",
  });
  w.y = lastY(w) + 4;
}

async function figure(w: Writer, block: Extract<Block, { t: "figure" }>, env: RenderEnv) {
  const source = block.svg ?? block.png;
  if (!source) return;
  let width = Math.min(block.widthMm, w.width);
  let height = (width * source.height) / source.width;
  const captionH = 8;
  const bodyH = w.bottom - MARGIN.top;
  // Taller than a page: shrunk until it fits one, caption included.
  if (height + captionH > bodyH) {
    const scale = (bodyH - captionH) / height;
    width *= scale;
    height *= scale;
  }
  w.ensure(height + captionH);
  const x = MARGIN.left + (w.width - width) / 2;
  if (block.svg) {
    const element = env.parseSvg(normaliseSvgFonts(block.svg.source));
    // svg2pdf switches the font only when its own state changes, so text at
    // the default weight inherits whatever jsPDF was set to last.
    w.doc.setFont(FONT, "normal");
    await svg2pdf(element, w.doc, { x, y: w.y, width, height });
  } else if (block.png) {
    w.doc.addImage(block.png.bytes, "PNG", x, w.y, width, height, undefined, "FAST");
  }
  w.y += height + 1.5;
  w.figureNumber += 1;
  w.font("normal", SMALL_SIZE, MUTED);
  const caption = `${w.figureLabel} ${w.figureNumber}: ${block.caption}`;
  const lines = w.doc.splitTextToSize(caption, w.width) as string[];
  w.doc.text(lines, MARGIN.left + w.width / 2, w.y + SMALL_SIZE * PT, { align: "center" });
  w.y += lines.length * SMALL_SIZE * PT * 1.35 + 4;
}

async function formula(w: Writer, block: Extract<Block, { t: "formula" }>, env: RenderEnv, withValues: string) {
  const emMm = FORMULA_SIZE * PT;
  const bodyH = w.bottom - MARGIN.top;
  const place = async (tex: string) => {
    const math = await texToSvg(tex);
    let width = math.widthEm * emMm;
    let height = math.heightEm * emMm;
    // Too wide for the column, or too tall for a page: shrunk to fit.
    const scale = Math.min(1, (w.width - 6) / width, (bodyH - 10) / height);
    width *= scale;
    height *= scale;
    return { math, width, height };
  };
  const symbolic = await place(block.tex);
  const substituted = block.substituted ? await place(block.substituted) : null;

  const titleH = BODY_SIZE * PT * 1.35 + 1;
  w.ensure(titleH + symbolic.height + 4);
  w.y += 1;
  w.text(block.title, BODY_SIZE, "bold");
  w.y += 1;
  const draw = async (part: { math: { svg: string }; width: number; height: number }) => {
    w.ensure(part.height + 2);
    // A character outside MathJax's font comes out as <text>; it gets ours.
    w.doc.setFont(FONT, "normal");
    await svg2pdf(env.parseSvg(normaliseSvgFonts(part.math.svg)), w.doc, { x: MARGIN.left + 6, y: w.y, width: part.width, height: part.height });
    w.y += part.height + 2;
  };
  await draw(symbolic);
  if (substituted) {
    w.ensure(titleH + substituted.height + 2);
    w.text(withValues, SMALL_SIZE, "normal", MUTED, 6);
    w.y += 0.5;
    await draw(substituted);
  }
  if (block.note) {
    w.text(block.note, SMALL_SIZE, "normal", MUTED, 6);
  }
  w.y += 2.5;
}

async function blockOut(w: Writer, block: Block, env: RenderEnv, doc: ReportDoc) {
  switch (block.t) {
    case "heading":
      heading(w, block.level, block.text);
      return;
    case "paragraph":
      w.text(block.text, BODY_SIZE, "normal", block.muted ? MUTED : INK);
      w.y += 2;
      return;
    case "keyValue":
      keyValue(w, block.rows);
      return;
    case "table":
      table(w, block, env);
      return;
    case "figure":
      await figure(w, block, env);
      return;
    case "formula":
      await formula(w, block, env, doc.meta.labels.withValues);
      return;
    case "pageBreak":
      if (w.y !== MARGIN.top) w.newPage();
      return;
  }
}

function cover(w: Writer, doc: ReportDoc) {
  const { meta } = doc;
  w.y = MARGIN.top + 8;
  w.text("eLamX", 11, "bold", MUTED);
  w.y += 2;
  w.text(meta.title, 22, "bold");
  w.y += 1;
  w.text(meta.projectName, 13, "normal", MUTED);
  w.y += 6;
  keyValue(w, meta.header);
  if (meta.signature) signatureLines(w, doc);
}

function signatureLines(w: Writer, doc: ReportDoc) {
  const { labels, author } = doc.meta;
  w.y = Math.max(w.y + 10, w.bottom - 42);
  const columns = [0, 0.42, 0.66].map((f) => MARGIN.left + f * w.width);
  const widths = [0.38, 0.2, 0.34].map((f) => f * w.width);
  const heads = ["", labels.signatureDate, labels.signature];
  for (const [who, name] of [
    [labels.preparedBy, author],
    [labels.reviewedBy, ""],
  ]) {
    w.font("bold", SMALL_SIZE, MUTED);
    w.doc.text(who, columns[0], w.y);
    w.y += 9;
    w.font("normal", BODY_SIZE);
    if (name) w.doc.text(name, columns[0], w.y - 1.2);
    w.doc.setDrawColor(...MUTED).setLineWidth(0.2);
    columns.forEach((x, i) => {
      w.doc.line(x, w.y, x + widths[i], w.y);
      if (heads[i]) {
        w.font("normal", SMALL_SIZE - 1, MUTED);
        w.doc.text(heads[i], x, w.y + 3.2);
      }
    });
    w.y += 10;
  }
}

/** Lines the contents take per page. */
const TOC_LINE = 6.2;

function tocEntriesOf(doc: ReportDoc): number {
  return doc.sections.reduce(
    (n, s) => n + 1 + s.blocks.filter((b) => b.t === "heading" && b.level <= 2).length,
    0,
  );
}

function writeToc(w: Writer, doc: ReportDoc, firstPage: number, pages: number) {
  const perPage = Math.floor((w.bottom - MARGIN.top - 14) / TOC_LINE);
  let index = 0;
  for (let p = 0; p < pages; p++) {
    w.doc.setPage(firstPage + p);
    let y = MARGIN.top;
    if (p === 0) {
      w.font("bold", HEADING[1].size);
      w.doc.text(doc.meta.labels.contents, MARGIN.left, y + HEADING[1].size * PT);
      y += 14;
    }
    for (let line = 0; line < perPage && index < w.toc.length; line++, index++) {
      const entry = w.toc[index];
      const indent = entry.level === 1 ? 0 : 7;
      w.font(entry.level === 1 ? "bold" : "normal", entry.level === 1 ? 10 : 9.5);
      const baseline = y + 4;
      const pageText = String(entry.page);
      const right = MARGIN.left + w.width;
      const labelW = w.width - indent - 14;
      const label = (w.doc.splitTextToSize(entry.label, labelW) as string[])[0];
      w.doc.text(label, MARGIN.left + indent, baseline);
      w.doc.text(pageText, right, baseline, { align: "right" });
      // Dotted leader between the label and the page number.
      const from = MARGIN.left + indent + w.doc.getTextWidth(label) + 2;
      const to = right - w.doc.getTextWidth(pageText) - 2;
      w.doc.setDrawColor(...RULE).setLineWidth(0.25).setLineDashPattern([0.4, 1.2], 0);
      if (to > from) w.doc.line(from, baseline, to, baseline);
      w.doc.setLineDashPattern([], 0);
      w.doc.link(MARGIN.left, y, w.width, TOC_LINE, { pageNumber: entry.page });
      y += TOC_LINE;
    }
  }
}

function furniture(w: Writer, doc: ReportDoc) {
  const n = w.page;
  const { meta } = doc;
  for (let p = 1; p <= n; p++) {
    w.doc.setPage(p);
    w.font("normal", SMALL_SIZE - 0.5, MUTED);
    if (p > 1) {
      w.doc.text(meta.title, MARGIN.left, 13);
      w.doc.text(meta.projectName, w.pageW - MARGIN.right, 13, { align: "right" });
      w.doc.setDrawColor(...RULE).setLineWidth(0.2);
      w.doc.line(MARGIN.left, 15, w.pageW - MARGIN.right, 15);
    }
    const footY = w.pageH - 10;
    w.doc.text(`eLamX ${meta.version}`, MARGIN.left, footY);
    w.doc.text(
      meta.labels.pageOf.replace("{page}", String(p)).replace("{pages}", String(n)),
      w.pageW / 2,
      footY,
      { align: "center" },
    );
    w.doc.text(meta.date, w.pageW - MARGIN.right, footY, { align: "right" });
  }
}

function outline(w: Writer) {
  let parent: unknown = null;
  for (const entry of w.toc) {
    if (entry.level === 1) {
      parent = w.doc.outline.add(null, entry.label, { pageNumber: entry.page });
    } else {
      w.doc.outline.add(parent, entry.label, { pageNumber: entry.page });
    }
  }
}

/** Lets the page paint between sections; the report is made on the main
 *  thread, and a progress bar that never moves is no progress bar. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The report as PDF bytes. */
export async function renderPdf(doc: ReportDoc, env: RenderEnv): Promise<Uint8Array> {
  const w = new Writer(doc.meta.paper, env.fonts, doc.meta.labels.figure);
  w.doc.setProperties({
    title: `${doc.meta.title} - ${doc.meta.projectName}`,
    subject: doc.meta.projectName,
    author: doc.meta.author,
    creator: `eLamX ${doc.meta.version}`,
  });
  w.doc.setLanguage(env.locale === "de" ? "de-DE" : "en-US");

  cover(w, doc);

  // The contents come right after the cover, on pages set aside now and
  // written last - their page numbers are not known before the end.
  const perPage = Math.floor((w.bottom - MARGIN.top - 14) / TOC_LINE);
  const tocPages = Math.max(1, Math.ceil(tocEntriesOf(doc) / perPage));
  const tocFirst = w.page + 1;
  for (let i = 0; i < tocPages; i++) w.newPage();

  const total = doc.sections.length;
  for (const [index, section] of doc.sections.entries()) {
    w.newPage();
    heading(w, 1, `${index + 1}  ${section.title}`);
    let sub = 0;
    for (const block of section.blocks) {
      if (block.t === "heading" && block.level === 2) {
        sub += 1;
        await blockOut(w, { ...block, text: `${index + 1}.${sub}  ${block.text}` }, env, doc);
      } else {
        await blockOut(w, block, env, doc);
      }
    }
    env.onProgress?.(index + 1, total);
    await breathe();
  }

  writeToc(w, doc, tocFirst, tocPages);
  furniture(w, doc);
  outline(w);
  return new Uint8Array(w.doc.output("arraybuffer"));
}
