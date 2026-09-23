// The result tables as data: one function per table, used by the table's
// copy and CSV actions on screen and by the report.
//
// Pure, and in canonical units like everything a `TableModel` holds - the
// serializer converts into the user's units. What they take is what the
// screen shows the table from; what they add is only the words, through a
// `translate` bound to the language the table is for.

import type { Cell, Column, TableModel } from "../export/table";
import type { MessageKey, MessageParams, Locale } from "../../i18n";
import { failureModeLabel } from "../../i18n";
import {
  criterionName,
  type EngineeringConstantsDto,
  type FailureType,
  type LayerResultDto,
  type MaterialDto,
} from "../types";
import { criticalLayerIndex, governingSurface, METRIC_LABEL_KEYS, toMetric, type FailureMetric } from "../failureMetric";
import { matrixScale, NEGLIGIBLE_FRACTION } from "../numberFormat";
import type { LaminateConfig, LoadCase } from "../../store/laminateAtoms";
import { DOF_NAMES } from "../constants";
import { symText } from "../symbols";

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** A value the arithmetic left behind where there is exactly zero - a
 *  symmetric laminate's B block - as the zero the screen shows. */
function denoise(matrix: number[][]): number[][] {
  const scale = matrixScale(matrix);
  return matrix.map((row) => row.map((v) => (Math.abs(v) < scale * NEGLIGIBLE_FRACTION ? 0 : v)));
}

const AXIS = ["1", "2", "6", "1", "2", "6"];

function matrixTable(title: string, matrix: number[][]): TableModel {
  return {
    title,
    columns: [{ key: "row", label: "" }, ...AXIS.map((label, j) => ({ key: `c${j}`, label }))],
    rows: denoise(matrix).map((row, i) => [AXIS[i], ...row]),
  };
}

export function abdTable(abd: number[][], t: Translate): TableModel {
  return matrixTable(t("abd.title"), abd);
}

export function abdInverseTable(abdInv: number[][], t: Translate): TableModel {
  return matrixTable(t("info.abdInv"), abdInv);
}

/**
 * The engineering constants, one row per variant and one column per
 * constant - the screen's table turned on its side, because a column holds
 * one quantity here and a unit belongs to a column.
 */
export function engineeringConstantsTable(ec: EngineeringConstantsDto, t: Translate): TableModel {
  const variants: [string, "simple" | "fixed" | "bend_simple" | "bend_fixed"][] = [
    [`${t("info.membrane")}, ${t("info.withoutPoisson")}`, "simple"],
    [`${t("info.membrane")}, ${t("info.withPoisson")}`, "fixed"],
    [`${t("info.bending")}, ${t("info.withoutPoisson")}`, "bend_simple"],
    [`${t("info.bending")}, ${t("info.withPoisson")}`, "bend_fixed"],
  ];
  const columns: Column[] = [
    { key: "variant", label: "" },
    { key: "ex", label: "Ex", category: "stiffness" },
    { key: "ey", label: "Ey", category: "stiffness" },
    { key: "g", label: "Gxy", category: "stiffness" },
    { key: "nuxy", label: "νxy", category: "poissonRatio" },
    { key: "nuyx", label: "νyx", category: "poissonRatio" },
  ];
  // The restrained Poisson ratios are left empty, as on screen and in eLamX
  // (see LaminateInfoPanel).
  const poisson = (variant: string, name: "nuxy" | "nuyx"): Cell =>
    variant.endsWith("fixed") ? null : ec[`${name}_${variant}` as keyof EngineeringConstantsDto];
  return {
    title: t("info.constants"),
    columns,
    rows: variants.map(([label, v]) => [
      label,
      ec[`ex_${v}` as keyof EngineeringConstantsDto],
      ec[`ey_${v}` as keyof EngineeringConstantsDto],
      ec[`g_${v}` as keyof EngineeringConstantsDto],
      poisson(v, "nuxy"),
      poisson(v, "nuyx"),
    ]),
  };
}

export function expansionTable(alpha: number[], beta: number[], t: Translate): TableModel {
  return {
    title: t("info.expansion"),
    columns: [
      { key: "dir", label: "" },
      { key: "alpha", label: "αT", category: "thermalExpansion" },
      { key: "beta", label: "β", category: "hygralExpansion" },
    ],
    rows: ["x", "y", "xy"].map((d, i) => [d, alpha[i], beta[i]]),
  };
}

/** The ply results as the ply table shows them, in the chosen metric. */
export function layerResultsTable(
  layers: readonly LayerResultDto[],
  options: { metric: FailureMetric; minOnly: boolean; t: Translate; locale: Locale },
): TableModel {
  const { metric, minOnly, t, locale } = options;
  const metricName = t(METRIC_LABEL_KEYS[metric]);
  const critical = criticalLayerIndex(layers);
  const mode = (name: string) => failureModeLabel(locale, name) || null;
  const status = (l: LayerResultDto) => t(l.failed ? "layerResults.failed" : "layerResults.passed");
  const nr = (l: LayerResultDto, i: number) => (i === critical ? `⌖ ${l.layer_number}` : String(l.layer_number));
  if (minOnly) {
    return {
      title: t("layerResults.title"),
      columns: [
        { key: "nr", label: t("layers.column.nr") },
        { key: "metric", label: metricName, category: "reserveFactor" },
        { key: "surface", label: t("layerResults.surface") },
        { key: "mode", label: t("layerResults.mode") },
        { key: "criterion", label: t("layerResults.criterion") },
        { key: "status", label: t("layerResults.status") },
      ],
      rows: layers.map((l, i) => {
        const g = governingSurface(l);
        return [
          nr(l, i),
          toMetric(g.rf.minimal_reserve_factor, metric),
          t(g.position === "lower" ? "common.bottom" : "common.top"),
          mode(g.rf.failure_name),
          criterionName(g.criterion, t),
          status(l),
        ];
      }),
    };
  }
  return {
    title: t("layerResults.title"),
    columns: [
      { key: "nr", label: t("layers.column.nr") },
      { key: "rf-lower", label: t("layerResults.metricLower", { metric: metricName }), category: "reserveFactor" },
      { key: "mode-lower", label: t("layerResults.modeLower") },
      { key: "rf-upper", label: t("layerResults.metricUpper", { metric: metricName }), category: "reserveFactor" },
      { key: "mode-upper", label: t("layerResults.modeUpper") },
      { key: "criterion", label: t("layerResults.criterion") },
      { key: "status", label: t("layerResults.status") },
    ],
    rows: layers.map((l, i) => [
      nr(l, i),
      toMetric(l.rr_lower.minimal_reserve_factor, metric),
      mode(l.rr_lower.failure_name),
      toMetric(l.rr_upper.minimal_reserve_factor, metric),
      mode(l.rr_upper.failure_name),
      criterionName(governingSurface(l).criterion, t),
      status(l),
    ]),
  };
}

/** Whether a laminate's plies have more than one criterion, so that the
 *  criterion matrix says something the ply table does not. */
export function hasCriterionMatrix(layers: readonly LayerResultDto[]): boolean {
  return layers.some((l) => l.by_criterion.length > 0);
}

/** Every criterion's own value per ply (F2.3); an empty cell where a ply is
 *  not checked against that criterion. See CriterionMatrix. */
export function criterionMatrixTable(
  layers: readonly LayerResultDto[],
  options: { metric: FailureMetric; t: Translate },
): TableModel {
  const { metric, t } = options;
  const governingOf = (l: LayerResultDto) =>
    l.rr_upper.minimal_reserve_factor < l.rr_lower.minimal_reserve_factor ? l.governing_upper : l.governing_lower;
  const ids: string[] = [];
  for (const layer of layers) {
    const own = layer.by_criterion.length > 0 ? layer.by_criterion.map((b) => b.id) : [governingOf(layer)];
    for (const id of own) if (!ids.includes(id)) ids.push(id);
  }
  const rf = (layer: LayerResultDto, id: string): number | null => {
    if (layer.by_criterion.length === 0) {
      return id === governingOf(layer)
        ? Math.min(layer.rr_lower.minimal_reserve_factor, layer.rr_upper.minimal_reserve_factor)
        : null;
    }
    const entry = layer.by_criterion.find((b) => b.id === id);
    return entry ? Math.min(entry.rr_lower.minimal_reserve_factor, entry.rr_upper.minimal_reserve_factor) : null;
  };
  return {
    title: t("criterionMatrix.title"),
    columns: [
      { key: "nr", label: t("layers.column.nr") },
      ...ids.map((id) => ({ key: id, label: criterionName(id, t), category: "reserveFactor" as const })),
      { key: "governing", label: t("layerResults.criterion") },
    ],
    rows: layers.map((layer) => {
      const values = ids.map((id) => {
        const value = rf(layer, id);
        return value === null ? null : toMetric(value, metric);
      });
      return [String(layer.layer_number), ...values, criterionName(governingOf(layer), t)];
    }),
  };
}

const FAILURE_TYPE_KEYS: Record<FailureType, MessageKey> = {
  FiberFailure: "lpf.type.ff",
  MatrixFailure: "lpf.type.iff",
  GeneralMaterialFailure: "lpf.type.gmf",
  Undamaged: "lpf.type.none",
};

/** One step of the last-ply-failure path, as the module lists it. */
export interface LpfPathRow {
  index: number;
  layerNumber: number;
  reserveFactor: number;
  failureName: string;
  failureType: FailureType;
  criterionId: string;
  matrixFailedCount: number;
  fibreFailedCount: number;
  plyCount: number;
}

export function lpfPathTable(path: readonly LpfPathRow[], t: Translate, locale: Locale): TableModel {
  return {
    title: t("lpf.path.title"),
    columns: [
      { key: "step", label: t("lpf.path.column.step"), decimals: 0 },
      { key: "layer", label: t("lpf.path.column.layer"), decimals: 0 },
      { key: "type", label: t("lpf.path.column.type") },
      { key: "criterion", label: t("lpf.path.column.criterion") },
      { key: "mode", label: t("lpf.path.column.mode") },
      { key: "rf", label: t("lpf.path.column.rf"), category: "reserveFactor" },
      { key: "damage", label: t("lpf.path.column.damage") },
    ],
    rows: path.map((r) => [
      r.index,
      r.layerNumber,
      t(FAILURE_TYPE_KEYS[r.failureType]),
      criterionName(r.criterionId, t),
      failureModeLabel(locale, r.failureName) || null,
      r.reserveFactor,
      t("lpf.path.damage", { iff: r.matrixFailedCount, ff: r.fibreFailedCount, total: r.plyCount }),
    ]),
  };
}

export function bucklingModesTable(eigenvalues: readonly number[], t: Translate): TableModel {
  return {
    title: t("buckling.modes.list"),
    columns: [
      { key: "nr", label: t("buckling.modes.column.nr"), decimals: 0 },
      { key: "factor", label: t("buckling.loadFactor") },
      { key: "ratio", label: t("buckling.modes.column.ratio"), decimals: 2 },
    ],
    rows: eigenvalues.map((value, i) => [i + 1, value, value / eigenvalues[0]]),
  };
}

export function vibrationModesTable(frequencies: readonly number[], t: Translate): TableModel {
  return {
    title: t("vibration.modes.title"),
    columns: [
      { key: "nr", label: t("vibration.modes.nr"), decimals: 0 },
      { key: "frequency", label: `${t("vibration.modes.frequency")}` },
      { key: "ratio", label: t("vibration.modes.ratio") },
    ],
    rows: frequencies.map((f, i) => [i + 1, f, f / frequencies[0]]),
  };
}

/** The materials a set of laminates uses, their elastic constants and
 *  strengths. */
export function materialsTable(materials: readonly MaterialDto[], t: Translate): TableModel {
  return {
    title: t("report.section.materials"),
    columns: [
      { key: "name", label: t("report.material.name") },
      { key: "e_par", label: "E∥", category: "stiffness" },
      { key: "e_nor", label: "E⊥", category: "stiffness" },
      { key: "nue12", label: "ν∥⊥", category: "poissonRatio" },
      { key: "g", label: "G∥⊥", category: "stiffness" },
      { key: "rho", label: "ρ", category: "density" },
      { key: "r_par_ten", label: "R∥t", category: "stress" },
      { key: "r_par_com", label: "R∥c", category: "stress" },
      { key: "r_nor_ten", label: "R⊥t", category: "stress" },
      { key: "r_nor_com", label: "R⊥c", category: "stress" },
      { key: "r_shear", label: "R⊥∥", category: "stress" },
    ],
    rows: materials.map((m) => [
      m.name,
      m.e_par,
      m.e_nor,
      m.nue12,
      m.g,
      m.rho,
      m.r_par_ten,
      m.r_par_com,
      m.r_nor_ten,
      m.r_nor_com,
      m.r_shear,
    ]),
  };
}

/** The plies as they are defined - the half that is edited, for a symmetric
 *  laminate; the report says so beside it. */
export function layupTable(
  config: LaminateConfig,
  materials: readonly MaterialDto[],
  t: Translate,
): TableModel {
  const materialName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;
  return {
    title: t("report.layup.title"),
    columns: [
      { key: "nr", label: t("layers.column.nr"), decimals: 0 },
      { key: "name", label: t("report.layup.name") },
      { key: "material", label: t("report.layup.material") },
      { key: "angle", label: t("report.layup.angle"), category: "angle" },
      { key: "thickness", label: t("report.layup.thickness"), category: "thickness" },
      { key: "criteria", label: t("layerResults.criterion") },
    ],
    rows: config.layers.map((l, i) => [
      i + 1,
      l.name,
      materialName(l.materialId),
      l.angle,
      l.thickness,
      [l.criterionId, ...(l.extraCriteria ?? [])].map((c) => criterionName(c, t)).join(", "),
    ]),
  };
}

/** One row per load case, each degree of freedom as the load or the strain
 *  it prescribes. */
export function loadCasesTable(cases: readonly LoadCase[], t: Translate): TableModel {
  return {
    title: t("report.section.loadCases"),
    columns: [
      { key: "name", label: t("report.loadCase.name") },
      ...DOF_NAMES.map((d, i) => ({ key: `dof${i}`, label: `${symText(d.load)} | ${symText(d.strain)}` })),
      { key: "dt", label: "ΔT", category: "temperatureDelta" as const },
      { key: "dh", label: "ΔH", category: "percent" as const },
    ],
    rows: cases.map((c) => [
      c.name,
      ...c.dofValues.map((v, i) => (c.useStrain[i] ? `${symText(DOF_NAMES[i].strain)} = ${v}` : v)),
      c.deltaT,
      c.deltaH,
    ]),
  };
}
