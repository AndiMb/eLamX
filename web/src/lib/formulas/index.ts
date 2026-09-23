// Every "How was this computed?" formula of the app, as pure functions: the
// symbolic TeX and the same with the numbers of the laminate at hand.
//
// One place for them because two things show them - the collapsible
// explanations on screen and the report's derivation - and a formula shown in
// the app and printed in the report must be the same formula. The functions
// take the values they put in and a language, nothing from the store; what
// they return is KaTeX/MathJax source (the subset both understand: base and
// AMS).

import type { Locale, MessageKey, MessageParams } from "../../i18n";
import { isFiniteResult, NO_VALUE, formatFixed, formatScientific, formatSignificant } from "../numberFormat";
import type { EngineeringConstantsDto, LayerResultDto, MaterialDto } from "../types";
import { localQMatrix } from "../cltFormulas";

export interface FormulaContext {
  t: (key: MessageKey, params?: MessageParams) => string;
  locale: Locale;
}

/** One explanation: its title, the formula, the formula with the values,
 *  and the prose that goes with it on screen. */
export interface Formula {
  title: string;
  tex: string;
  substituted?: string;
  note?: string;
}

/**
 * A formatted number made safe for TeX: a comma in math mode is punctuation
 * and gets a space after it, which turns "0,25" into "0, 25" - in braces it is
 * an ordinary symbol, whether it is a German decimal comma or an English
 * thousands separator.
 */
export function num(text: string): string {
  return text.replace(/,/g, "{,}");
}

/**
 * A number as TeX source, in the language's notation.
 *
 * TeX, not display text: the not-a-number case comes back wrapped in \text{},
 * because a bare en dash in math mode is an unknown character to KaTeX.
 */
export function texNumber(locale: Locale): (value: number, decimals?: number) => string {
  return (value, decimals = 2) =>
    isFiniteResult(value)
      ? num(value.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }))
      : `\\text{${NO_VALUE}}`;
}

/** A number in scientific notation as TeX, `1,234\times 10^{-5}`. */
export function texExp(value: number, locale: Locale, decimals = 3): string {
  if (!isFiniteResult(value)) return `\\text{${NO_VALUE}}`;
  const [mantissa, exponent] = value.toExponential(decimals).split("e");
  const localizedMantissa = Number(mantissa).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${num(localizedMantissa)}\\times 10^{${Number(exponent)}}`;
}

// --- CLT --------------------------------------------------------------------

/** The first ply's stiffness in its own axes. */
export function localQFormula(material: MaterialDto, { t, locale }: FormulaContext): Formula {
  const fmt = texNumber(locale);
  const localQ = localQMatrix(material);
  const nue21 = (material.nue12 * material.e_nor) / material.e_par;
  return {
    title: t("abdExplanation.localQ.title"),
    tex:
      "\\nu_{21} = \\nu_{12}\\dfrac{E_\\perp}{E_\\parallel},\\quad " +
      "Q_{11} = \\dfrac{E_\\parallel}{1-\\nu_{12}\\nu_{21}},\\quad " +
      "Q_{12} = \\nu_{21}Q_{11},\\quad " +
      "Q_{22} = \\dfrac{E_\\perp}{1-\\nu_{12}\\nu_{21}},\\quad " +
      "Q_{66} = G",
    substituted: `\\begin{aligned}
\\nu_{21} &= ${fmt(material.nue12, 3)} \\cdot \\dfrac{${fmt(material.e_nor, 0)}}{${fmt(material.e_par, 0)}} = ${fmt(nue21, 4)} \\\\
Q_{11} &= \\dfrac{${fmt(material.e_par, 0)}}{1 - ${fmt(material.nue12, 3)} \\cdot ${fmt(nue21, 4)}} = ${fmt(localQ.q11, 1)}\\ \\text{MPa} \\\\
Q_{12} &= ${fmt(nue21, 4)} \\cdot ${fmt(localQ.q11, 1)} = ${fmt(localQ.q12, 1)}\\ \\text{MPa} \\\\
Q_{22} &= \\dfrac{${fmt(material.e_nor, 0)}}{1 - ${fmt(material.nue12, 3)} \\cdot ${fmt(nue21, 4)}} = ${fmt(localQ.q22, 1)}\\ \\text{MPa} \\\\
Q_{66} &= G = ${fmt(localQ.q66, 1)}\\ \\text{MPa}
\\end{aligned}`,
    note: t("abdExplanation.localQ.hint", { material: material.name }),
  };
}

/** The first ply turned into the laminate's axes. */
export function qBarFormula(
  layer: { angle_deg: number; q_global: number[][] },
  material: MaterialDto,
  { t, locale }: FormulaContext,
): Formula {
  const fmt = texNumber(locale);
  const localQ = localQMatrix(material);
  const angleRad = (layer.angle_deg * Math.PI) / 180;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const c2s2 = c * c * s * s;
  return {
    title: t("abdExplanation.qBar.title"),
    tex: "\\bar Q_{11} = c^4 Q_{11} + 2c^2s^2 Q_{12} + s^4 Q_{22} + 4c^2s^2 Q_{66}, \\quad c=\\cos\\theta,\\ s=\\sin\\theta",
    substituted: `\\begin{aligned}
\\theta &= ${fmt(layer.angle_deg, 1)}^\\circ, \\quad c = ${fmt(c, 3)}, \\quad s = ${fmt(s, 3)} \\\\
\\bar Q_{11} &= ${fmt(c ** 4, 3)}\\cdot ${fmt(localQ.q11, 1)} + 2\\cdot ${fmt(c2s2, 3)}\\cdot ${fmt(localQ.q12, 1)} + ${fmt(s ** 4, 3)}\\cdot ${fmt(localQ.q22, 1)} + 4\\cdot ${fmt(c2s2, 3)}\\cdot ${fmt(localQ.q66, 1)} \\\\
&= ${fmt(layer.q_global[0][0], 1)}\\ \\text{MPa} \\quad (\\text{${t("abdExplanation.qBar.actualValue")}})
\\end{aligned}`,
    note: t("abdExplanation.qBar.hint"),
  };
}

/** A11 as the sum of the plies' contributions. */
export function aMatrixFormula(
  contributions: readonly { a_contribution: number[][] }[],
  abd: number[][],
  { t, locale }: FormulaContext,
  /** Beyond this many plies the sum is shortened to its first and last
   *  terms - a page has no horizontal scrollbar. All of them by default. */
  maxTerms = Number.POSITIVE_INFINITY,
): Formula {
  const fmt = texNumber(locale);
  const all = contributions.map((c) => fmt(c.a_contribution[0][0], 1));
  const terms = (all.length > maxTerms ? [...all.slice(0, maxTerms - 2), "\\dots", ...all.slice(-2)] : all).join(" + ");
  return {
    title: t("abdExplanation.aMatrix.title"),
    tex: "A_{11} = \\sum_k \\bar Q_{11,k} \\cdot t_k",
    substituted: `A_{11} = ${terms} = ${fmt(abd[0][0], 1)}\\ \\text{N/mm}`,
    note: t("abdExplanation.aMatrix.hint"),
  };
}

export function exFormula(
  abdInv: number[][],
  tges: number,
  ec: EngineeringConstantsDto,
  { t, locale }: FormulaContext,
): Formula {
  const fmt = texNumber(locale);
  return {
    title: t("summary.ex.title"),
    tex: "E_x = \\dfrac{1}{(ABD^{-1})_{11}\\cdot t_{ges}}",
    substituted: `E_x = \\dfrac{1}{${texExp(abdInv[0][0], locale)} \\cdot ${fmt(tges, 2)}} = ${fmt(ec.ex_simple, 1)}\\ \\text{MPa}`,
    note: t("summary.ex.hint"),
  };
}

export function nuxyFormula(abdInv: number[][], ec: EngineeringConstantsDto, { t, locale }: FormulaContext): Formula {
  const fmt = texNumber(locale);
  return {
    title: t("summary.nuxy.title"),
    tex: "\\nu_{xy} = -\\dfrac{(ABD^{-1})_{12}}{(ABD^{-1})_{11}}",
    substituted: `\\nu_{xy} = -\\dfrac{${texExp(abdInv[0][1], locale)}}{${texExp(abdInv[0][0], locale)}} = ${fmt(ec.nuxy_simple, 4)}`,
  };
}

/** A ply's reserve factor over its criteria, worked for the ply with the
 *  most criteria; null when no ply has more than one. */
export function criterionMatrixFormula(layers: readonly LayerResultDto[], { t, locale }: FormulaContext): Formula | null {
  if (!layers.some((l) => l.by_criterion.length > 0)) return null;
  const example = layers.reduce((a, b) => (b.by_criterion.length > a.by_criterion.length ? b : a));
  const values = example.by_criterion.map((b) => {
    const value = Math.min(b.rr_lower.minimal_reserve_factor, b.rr_upper.minimal_reserve_factor);
    return Number.isFinite(value) ? num(formatFixed(value, 3, locale)) : "\\infty";
  });
  const governing = Math.min(example.rr_lower.minimal_reserve_factor, example.rr_upper.minimal_reserve_factor);
  return {
    title: t("criterionMatrix.howTitle"),
    tex: `RF_{\\text{${t("criterionMatrix.word.layer")}}} = \\min_{k\\,\\in\\,\\text{${t("criterionMatrix.word.criteria")}}} \\min\\left(RF_k^{\\text{${t("criterionMatrix.word.bottom")}}},\\; RF_k^{\\text{${t("criterionMatrix.word.top")}}}\\right)`,
    substituted: `RF_{${example.layer_number}} = \\min\\left(${values.join(",\\; ")}\\right) = ${
      Number.isFinite(governing) ? num(formatFixed(governing, 3, locale)) : "\\infty"
    }`,
    note: t("criterionMatrix.howHint"),
  };
}

/** Strain and stress through the thickness, worked at one height. */
export function sheetFormula(
  example: { number: number; zExample: number; epsilonX0: number; kappaX: number; epsilonX: number },
  { t, locale }: FormulaContext,
): Formula {
  const sig = (v: number) => num(formatSignificant(v, 4, locale));
  const { zExample, epsilonX0, kappaX, epsilonX } = example;
  return {
    title: t("sheet.howTitle"),
    tex: "\\varepsilon(z) = \\varepsilon^0 + z\\,\\kappa, \\qquad \\sigma(z) = \\bar{Q}\\,\\varepsilon(z)",
    substituted: `\\varepsilon_x(${sig(zExample)}) = ${sig(epsilonX0)} + (${sig(zExample)}) \\cdot (${sig(kappaX)}) = ${sig(epsilonX)}`,
    note: t("sheet.howHint", { nr: example.number }),
  };
}

/** Where the load ray meets the laminate's failure surface. */
export function envelopeRayFormula(
  ray: { rf: number; failure_load: readonly number[] },
  load: readonly number[],
  { t, locale }: FormulaContext,
): Formula {
  const fmt = (v: number) => num(formatSignificant(v, 4, locale));
  const [nx, ny, nxy] = load;
  const [fx, fy, fxy] = ray.failure_load;
  return {
    title: t("laminateFailure.ray.howTitle"),
    tex: `\\vec n_{\\text{${t("laminateFailure.ray.surfaceWord")}}} = RF \\cdot \\vec n, \\qquad \\vec n = (n_x;\\, n_y;\\, n_{xy})`,
    // Semicolons between the components: a German number has a comma.
    substituted: `(${fmt(fx)};\\; ${fmt(fy)};\\; ${fmt(fxy)}) = ${fmt(ray.rf)} \\cdot (${fmt(nx)};\\; ${fmt(ny)};\\; ${fmt(nxy)})`,
    note: t("laminateFailure.ray.howHint"),
  };
}

// --- modules ------------------------------------------------------------------

export function bucklingFormula(
  criticalFactor: number,
  terms: { m: number; n: number },
  { t, locale }: FormulaContext,
): Formula {
  return {
    title: t("buckling.how.title"),
    tex: "\\left(\\mathbf{K} + \\lambda\\,\\mathbf{K}_g\\right)\\mathbf{a} = \\mathbf{0}",
    substituted: `\\lambda_{crit} = ${num(formatSignificant(criticalFactor, 6, locale))}`,
    note: t("buckling.how.hint", terms),
  };
}

export function vibrationFormula(
  fundamentalFrequency: number,
  terms: { m: number; n: number },
  { t, locale }: FormulaContext,
): Formula {
  return {
    title: t("vibration.how.title"),
    tex: "\\left(\\mathbf{K} - \\omega^2\\,\\mathbf{M}\\right)\\mathbf{a} = \\mathbf{0}",
    substituted: `f_1 = ${num(formatSignificant(fundamentalFrequency, 6, locale))}\\ \\mathrm{Hz}`,
    note: t("vibration.how.hint", terms),
  };
}

export function deformationFormula(
  maxDeflection: number,
  terms: { m: number; n: number },
  { t, locale }: FormulaContext,
): Formula {
  return {
    title: t("deformation.how.title"),
    tex: "\\mathbf{K}\\,\\mathbf{a} = \\mathbf{f}",
    substituted: `w_{max} = ${num(formatScientific(maxDeflection, 4, locale))}`,
    note: t("deformation.how.hint", terms),
  };
}

export function lastPlyFailureFormula(degradationFactor: number, steps: number, { t, locale }: FormulaContext): Formula {
  return {
    title: t("lpf.how.title"),
    tex: "E_{\\perp} \\leftarrow \\eta\\,E_{\\perp}, \\quad G_{\\perp\\parallel} \\leftarrow \\eta\\,G_{\\perp\\parallel}",
    substituted: `\\eta = ${num(formatSignificant(degradationFactor, 6, locale))}`,
    note: t("lpf.how.hint", { steps }),
  };
}

export function cutoutFormula(peakNTheta: number, { t, locale }: FormulaContext): Formula {
  return {
    title: t("cutout.how.title"),
    tex: "n_{\\vartheta} = n_x \\sin^2\\alpha + n_y \\cos^2\\alpha - 2 n_{xy} \\sin\\alpha \\cos\\alpha",
    substituted: `n_{\\vartheta,\\max} = ${num(formatSignificant(peakNTheta, 6, locale))}\\ \\mathrm{N/mm}`,
    note: t("cutout.how.hint"),
  };
}

export function pressureVesselFormula(meanRadius: number, { t, locale }: FormulaContext): Formula {
  return {
    title: t("vessel.how.title"),
    tex: "n_x = \\dfrac{p\\,r}{2}, \\quad n_u = p\\,r, \\quad \\kappa = 0",
    substituted: `r = ${num(formatScientific(meanRadius, 4, locale))}`,
    note: t("vessel.how.hint"),
  };
}

export function springInFormula(
  result: { delta_angle: number; alpha_circumferential: number; delta_t: number },
  { t, locale }: FormulaContext,
): Formula {
  return {
    title: t("springIn.how.title"),
    tex: "\\frac{\\Delta\\varphi}{\\varphi} = \\frac{\\left(\\alpha_{u} - \\alpha_{d}\\right)\\Delta T}{1 + \\alpha_{d}\\,\\Delta T}",
    substituted: `\\Delta\\varphi = ${num(formatSignificant(result.delta_angle, 6, locale))}^\\circ`,
    note: t("springIn.how.hint", {
      alpha: formatSignificant(result.alpha_circumferential * 1e6, 4, locale),
      deltaT: formatSignificant(result.delta_t, 4, locale),
    }),
  };
}

/** The props `HowWasThisComputed` shows a formula with. */
export function howProps(formula: Formula): { title: string; formula: string; substituted?: string } {
  return { title: formula.title, formula: formula.tex, substituted: formula.substituted };
}
