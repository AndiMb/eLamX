// What every section builder is handed: the language, the settings the
// numbers are shown with, and how much to show.

import type { Locale, MessageKey, MessageParams } from "../../i18n";
import { createQuantityFormatter } from "../quantityFormat";
import type { QuantityCategory } from "../units";
import { CATEGORY_DEFINITIONS } from "../units";
import type { FormatConfig } from "../../store/formatAtoms";
import type { FailureMetric } from "../failureMetric";
import type { FormulaContext } from "../formulas";
import type { Block, ReportTemplate } from "./model";
import type { Formula } from "../formulas";

export interface ReportContext extends FormulaContext {
  t: (key: MessageKey, params?: MessageParams) => string;
  locale: Locale;
  /** The user's unit and format setting per quantity. */
  formats: (category: QuantityCategory) => FormatConfig;
  /** RF, IRF or MoS, as the screen shows it. */
  metric: FailureMetric;
  detail: ReportTemplate["detail"];
}

/** The settings a fresh app has - for a test, or a report made without a
 *  store. */
export function defaultFormats(category: QuantityCategory): FormatConfig {
  const def = CATEGORY_DEFINITIONS[category];
  return { unitId: def.defaultUnitId, decimals: def.defaultDecimals, notation: def.defaultNotation };
}

/** A value with its unit, as the screen shows it: `57.381 MPa`. */
export function quantity(ctx: ReportContext, category: QuantityCategory, value: number | null | undefined): string {
  const formatter = createQuantityFormatter(category, ctx.formats(category), ctx.locale);
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return formatter.unit ? `${formatter.text(value)} ${formatter.unit}` : formatter.text(value);
}

/** The formula block of an explanation - only in a report "with derivation". */
export function derivation(ctx: ReportContext, ...formulas: (Formula | null | undefined)[]): Block[] {
  if (ctx.detail !== "derivation") return [];
  return formulas
    .filter((f): f is Formula => !!f)
    .map((f) => ({ t: "formula" as const, title: f.title, tex: f.tex, substituted: f.substituted, note: f.note }));
}
