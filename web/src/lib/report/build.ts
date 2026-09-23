// A template and the results it asked for, as a `ReportDoc`.
//
// Order: the materials, then one section per laminate with the parts the
// template chose, then the comparison. Each part comes from a builder in
// sections/, which takes the laminate's results and the context and returns
// blocks - nothing else, so a new part is a new builder and a line here.

import { createQuantityFormatter } from "../quantityFormat";
import { CATEGORY_DEFINITIONS, type QuantityCategory } from "../units";
import type { CollectedResults, LaminateResults } from "./collect";
import type { ReportContext } from "./context";
import type { Block, ReportDoc, ReportSection, ReportTemplate, SectionKind } from "./model";
import { abdSection, laminateCriteria, laminateNotation, laminateSection, loadCasesSection } from "./sections/laminate";
import { failureSequenceSection, layerResultsSection } from "./sections/results";
import { bucklingSection, deformationSection, vibrationSection } from "./sections/plate";
import { comparisonSection, materialsSection } from "./sections/project";
import { studiesSection } from "./sections/studies";

export interface ReportInfo {
  projectName: string;
  author: string;
  date: Date;
  /** `0.2.0 (abc1234)`. */
  version: string;
}

/** The builder of each per-laminate part, in report order. */
const LAMINATE_PARTS: [SectionKind, (r: LaminateResults, c: CollectedResults, ctx: ReportContext) => Block[]][] = [
  ["laminate", (r, c, ctx) => laminateSection(r, c.materials, ctx)],
  ["abd", (r, c, ctx) => abdSection(r, c.materials, ctx)],
  ["loadCases", (r, _c, ctx) => loadCasesSection(r, ctx)],
  ["layerResults", (r, _c, ctx) => layerResultsSection(r, ctx)],
  ["failureSequence", (r, _c, ctx) => failureSequenceSection(r, ctx)],
  ["buckling", (r, _c, ctx) => bucklingSection(r, ctx)],
  ["vibration", (r, _c, ctx) => vibrationSection(r, ctx)],
  ["deformation", (r, _c, ctx) => deformationSection(r, ctx)],
];

/** The units the report's numbers are in, for its header. */
function unitSystem(ctx: ReportContext): string {
  const categories: QuantityCategory[] = ["stiffness", "stress", "thickness", "angle", "temperatureDelta"];
  // Each unit with its quantity: "MPa, MPa" would not say which is which.
  return categories
    .map((c) => {
      const unit = createQuantityFormatter(c, ctx.formats(c), ctx.locale).unit;
      return unit ? `${ctx.t(CATEGORY_DEFINITIONS[c].labelKey)} ${unit}` : null;
    })
    .filter((u): u is string => !!u)
    .join(", ");
}

export function buildReport(
  template: ReportTemplate,
  collected: CollectedResults,
  ctx: ReportContext,
  info: ReportInfo,
): ReportDoc {
  const { t, locale } = ctx;
  const wants = (kind: SectionKind) => template.sections.includes(kind);
  const sections: ReportSection[] = [];

  if (wants("materials")) {
    const blocks = materialsSection(collected, ctx);
    if (blocks.length > 0) sections.push({ id: "materials", title: t("report.section.materials"), blocks });
  }
  for (const laminate of collected.laminates) {
    const blocks = LAMINATE_PARTS.filter(([kind]) => wants(kind)).flatMap(([, build]) =>
      build(laminate, collected, ctx),
    );
    if (blocks.length > 0) {
      sections.push({
        id: `laminate:${laminate.config.id}`,
        title: t("report.section.laminate", { name: laminate.config.name }),
        blocks,
      });
    }
  }
  if (wants("comparison")) {
    const blocks = comparisonSection(collected, ctx);
    if (blocks.length > 0) sections.push({ id: "comparison", title: t("compare.title"), blocks });
  }
  if (wants("studies")) {
    const blocks = studiesSection(collected.studies ?? [], ctx);
    if (blocks.length > 0) sections.push({ id: "studies", title: t("report.section.studies"), blocks });
  }

  // The header block (F3.2): what the report is about, at a glance.
  const laminates = collected.laminates;
  const criteria = [...new Set(laminates.flatMap((l) => laminateCriteria(l, ctx)))];
  const loadCases =
    template.loadCases === "all"
      ? t("report.header.allLoadCases", { count: laminates.reduce((n, l) => n + l.cases.length, 0) })
      : laminates.map((l) => l.cases.map((c) => c.loadCase.name).join(", ")).join("; ");
  const header: [string, string][] = [
    [t("report.header.project"), info.projectName],
    [
      t(laminates.length === 1 ? "report.header.laminate" : "report.header.laminates"),
      laminates.map((l) => `${l.config.name}  ${laminateNotation(l)}`).join("\n"),
    ],
    [t("report.header.criteria"), criteria.join(", ")],
    [t("report.header.loadCases"), loadCases],
    [t("report.header.units"), unitSystem(ctx)],
    [t("report.header.detail"), t(template.detail === "derivation" ? "report.detail.derivation" : "report.detail.results")],
    [t("report.header.date"), info.date.toLocaleDateString(locale === "de" ? "de-DE" : "en-GB")],
    [t("report.header.version"), `eLamX ${info.version}`],
  ];
  if (template.author || info.author) header.push([t("report.header.author"), template.author || info.author]);

  return {
    meta: {
      title: t("report.title"),
      projectName: info.projectName,
      date: info.date.toLocaleDateString(locale === "de" ? "de-DE" : "en-GB"),
      version: info.version,
      author: template.author || info.author,
      header,
      signature: template.signature,
      paper: template.paper,
      labels: {
        contents: t("report.contents"),
        pageOf: t("report.pageOf"),
        figure: t("report.figure"),
        preparedBy: t("report.preparedBy"),
        reviewedBy: t("report.reviewedBy"),
        signatureDate: t("report.signatureDate"),
        signature: t("report.signature"),
        withValues: t("howComputed.withValues"),
      },
    },
    sections,
  };
}
