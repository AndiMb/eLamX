// The laminate as a plate: buckling, vibration, deflection - each only when
// the laminate is configured for it.

import { formatFixed, formatSignificant, formatScientific } from "../../numberFormat";
import { bucklingModesTable, vibrationModesTable } from "../../tables";
import { bucklingFormula, deformationFormula, vibrationFormula } from "../../formulas";
import { derivation, quantity, type ReportContext } from "../context";
import type { LaminateResults } from "../collect";
import type { Block } from "../model";
import type { MessageKey } from "../../../i18n";
import type { BoundaryConditionId, StiffenerDto } from "../../types";
import { plyGeometryOf } from "../../plateScene/plyGeometry";
import { scaleBounds } from "../../plateScene/scale";
import { anchorFraction, legendTicks } from "../../plateScene/legend";
import type { PlateLegendSpec, PlateViewLoad } from "../../plateScene/assemble";
import { createQuantityFormatter } from "../../quantityFormat";

interface PlateInput {
  length: number;
  width: number;
  bc_x: string;
  bc_y: string;
  m: number;
  n: number;
}

function plateRows(input: PlateInput, ctx: ReportContext): [string, string][] {
  const { t } = ctx;
  return [
    [t("report.plate.size"), `${quantity(ctx, "thickness", input.length)} × ${quantity(ctx, "thickness", input.width)}`],
    [t("buckling.bcX"), t(`buckling.bc.${input.bc_x}` as MessageKey)],
    [t("buckling.bcY"), t(`buckling.bc.${input.bc_y}` as MessageKey)],
    [t("report.plate.terms"), `${input.m} × ${input.n}`],
  ];
}

/** A mode shape's colour bar: a shape without a size, normalised to a peak
 *  of one - which the title and the caption say, since the picture looks
 *  exactly like a deflection in millimetres. No range line under the bar: on
 *  screen it is a sentence, and the caption carries it here. */
function modeLegend(title: string): PlateLegendSpec {
  return {
    title,
    unit: null,
    ticks: [
      { t: 0, text: "-1" },
      { t: 0.5, text: "0" },
      { t: 1, text: "+1" },
    ],
    anchor: 0.5,
    range: "",
    kind: "diverging",
  };
}

/** The plate as the module draws it, as a figure. The exaggeration is the
 *  module's default, and so is the camera. */
function plateFigure(
  results: LaminateResults,
  input: { length: number; width: number; bc_x: BoundaryConditionId; bc_y: BoundaryConditionId; stiffeners?: StiffenerDto[] },
  surface: number[][],
  options: { deflectionFraction: number; load?: PlateViewLoad; bounds?: [number, number]; legend: PlateLegendSpec; caption: string },
): Block {
  const plies = plyGeometryOf(results.base?.layer_contributions ?? null);
  return {
    t: "figure",
    caption: options.caption,
    widthMm: 165,
    request: {
      kind: "plate",
      plate: {
        surface,
        length: input.length,
        width: input.width,
        thickness: plies.thickness,
        plyBoundaries: plies.boundaries,
        plyAngles: plies.angles,
        deflectionFraction: options.deflectionFraction,
        bounds: options.bounds,
        bcX: input.bc_x,
        bcY: input.bc_y,
        load: options.load,
        stiffeners: input.stiffeners,
      },
      legend: options.legend,
    },
  };
}

export function bucklingSection(results: LaminateResults, ctx: ReportContext): Block[] {
  const { t, locale } = ctx;
  const outcome = results.buckling;
  if (!outcome) return [];
  const blocks: Block[] = [{ t: "heading", level: 2, text: t("report.section.buckling") }];
  if ("error" in outcome) return [...blocks, { t: "paragraph", text: t("report.error", { message: outcome.error }) }];
  const { input, result } = outcome;
  const rows = plateRows(input, ctx);
  rows.push([t("report.buckling.load"), `nx = ${input.n_x}, ny = ${input.n_y}, nxy = ${input.n_xy}`]);
  rows.push([
    t("buckling.loadFactor"),
    result.critical_factor === null ? "–" : formatSignificant(result.critical_factor, 5, locale),
  ]);
  if (result.n_crit) {
    rows.push([
      t("report.buckling.nCrit"),
      result.n_crit.map((v, i) => `n${["x", "y", "xy"][i]},crit = ${formatFixed(v, 3, locale)}`).join(", "),
    ]);
  }
  blocks.push({ t: "keyValue", rows });
  if (result.symmetry_warning) blocks.push({ t: "paragraph", text: t("buckling.symmetryWarning") });
  const eigenvalues = result.modes
    .map((m) => m.eigenvalue)
    .filter((v) => v >= 0 && Number.isFinite(v))
    .slice(0, 10);
  if (eigenvalues.length > 0) blocks.push({ t: "table", table: bucklingModesTable(eigenvalues, t) });
  const shape = results.shapes?.buckling;
  if (shape && eigenvalues.length > 0) {
    blocks.push(
      plateFigure(results, input, shape, {
        deflectionFraction: 0.12,
        load: { kind: "inPlane", nx: input.n_x, ny: input.n_y, nxy: input.n_xy },
        legend: modeLegend(t("buckling.legend.title")),
        caption: t("report.figure.bucklingMode", { factor: formatSignificant(eigenvalues[0], 5, locale) }),
      }),
    );
  }
  if (result.critical_factor !== null) {
    blocks.push(...derivation(ctx, bucklingFormula(result.critical_factor, { m: input.m, n: input.n }, ctx)));
  }
  return blocks;
}

export function vibrationSection(results: LaminateResults, ctx: ReportContext): Block[] {
  const { t, locale } = ctx;
  const outcome = results.vibration;
  if (!outcome) return [];
  const blocks: Block[] = [{ t: "heading", level: 2, text: t("report.section.vibration") }];
  if ("error" in outcome) return [...blocks, { t: "paragraph", text: t("report.error", { message: outcome.error }) }];
  const { input, result } = outcome;
  const rows = plateRows(input, ctx);
  rows.push([t("vibration.fundamental"), `${formatSignificant(result.fundamental_frequency, 5, locale)} Hz`]);
  blocks.push({ t: "keyValue", rows });
  const frequencies = result.modes.map((m) => m.frequency).slice(0, 10);
  if (frequencies.length > 1) blocks.push({ t: "table", table: vibrationModesTable(frequencies, t) });
  const shape = results.shapes?.vibration;
  if (shape && frequencies.length > 0) {
    blocks.push(
      plateFigure(results, input, shape, {
        deflectionFraction: 0.12,
        legend: modeLegend(t("vibration.legend.title")),
        caption: t("report.figure.vibrationMode", { frequency: formatSignificant(frequencies[0], 5, locale) }),
      }),
    );
  }
  blocks.push(...derivation(ctx, vibrationFormula(result.fundamental_frequency, { m: input.m, n: input.n }, ctx)));
  return blocks;
}

export function deformationSection(results: LaminateResults, ctx: ReportContext): Block[] {
  const { t, locale } = ctx;
  const outcome = results.deformation;
  if (!outcome) return [];
  const blocks: Block[] = [{ t: "heading", level: 2, text: t("report.section.deformation") }];
  if ("error" in outcome) return [...blocks, { t: "paragraph", text: t("report.error", { message: outcome.error }) }];
  const { input, result } = outcome;
  const rows = plateRows(input, ctx);
  rows.push(
    [t("report.deformation.loads"), input.loads.map((l) => `${l.name}: ${l.force}`).join("; ") || "–"],
    [t("report.deformation.max"), quantity(ctx, "thickness", result.max_deflection)],
    [
      t("deformation.maxAt"),
      `${formatScientific(result.max_at[0], 3, locale)} / ${formatScientific(result.max_at[1], 3, locale)}`,
    ],
  );
  if (input.max_displacement_z > 0) {
    rows.push([t("deformation.allowable"), quantity(ctx, "thickness", input.max_displacement_z)]);
  }
  blocks.push({ t: "keyValue", rows });
  if (result.symmetry_warning) blocks.push({ t: "paragraph", text: t("buckling.symmetryWarning") });
  const field = results.shapes?.deflection;
  if (field) {
    // The deflection cannot carry holes - only a failure criterion refuses
    // to answer - so a null would be a bug in the core, drawn as flat.
    const surface = field.values.map((row) => row.map((v) => v ?? 0));
    const bounds = scaleBounds("diverging", field.min, field.max);
    const format = createQuantityFormatter("thickness", ctx.formats("thickness"), locale);
    blocks.push(
      plateFigure(results, input, surface, {
        deflectionFraction: 0.15,
        load: { kind: "transverse", loads: input.loads },
        bounds,
        legend: {
          title: t("plateField.deflection"),
          unit: format.unit || null,
          ticks: legendTicks(bounds).map(({ t: at, value }) => ({ t: at, text: format.compact(value) })),
          anchor: anchorFraction("diverging", bounds),
          range: `${format.compact(field.min)} … ${format.compact(field.max)}`,
          kind: "diverging",
        },
        caption: t("report.figure.deflection"),
      }),
    );
  }
  blocks.push(...derivation(ctx, deformationFormula(result.max_deflection, { m: input.m, n: input.n }, ctx)));
  return blocks;
}
