// The laminate as a plate: buckling, vibration, deflection - each only when
// the laminate is configured for it.

import { formatFixed, formatSignificant, formatScientific } from "../../numberFormat";
import { bucklingModesTable, vibrationModesTable } from "../../tables";
import { bucklingFormula, deformationFormula, vibrationFormula } from "../../formulas";
import { derivation, quantity, type ReportContext } from "../context";
import type { LaminateResults } from "../collect";
import type { Block } from "../model";
import type { MessageKey } from "../../../i18n";

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
  blocks.push(...derivation(ctx, deformationFormula(result.max_deflection, { m: input.m, n: input.n }, ctx)));
  return blocks;
}
