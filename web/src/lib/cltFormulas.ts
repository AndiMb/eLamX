// Small, deliberately-scoped mirror of elamx-core/core/src/clt/layer.rs's
// CltLayer::new local-Q formula - used ONLY to build the "Wie wurde das
// berechnet?" worked example (components/AbdExplanation.tsx), never for an
// actual displayed result (those always come straight from the Rust core's
// wasm response). This is a 4-line closed-form calculation directly off 4
// material constants, not a numerically-sensitive algorithm, which keeps the
// drift risk the architecture plan warns about (re-deriving core math in
// TypeScript) small and easy to eyeball against the Rust source if ever in
// doubt.
import { useCallback } from "react";
import { useLocale } from "../i18n";
import { isFiniteResult, NO_VALUE } from "./numberFormat";

export interface LocalQ {
  q11: number;
  q12: number;
  q22: number;
  q66: number;
}

export function localQMatrix(material: { e_par: number; e_nor: number; nue12: number; g: number }): LocalQ {
  const nue21 = (material.nue12 * material.e_nor) / material.e_par;
  const temp = 1 / (1 - material.nue12 * nue21);
  return {
    q11: temp * material.e_par,
    q12: temp * material.e_par * nue21,
    q22: temp * material.e_nor,
    q66: material.g,
  };
}

// Returns a locale-bound fmt() with the call-site-friendly (value, decimals)
// signature the worked-example builders use dozens of times. A hook rather
// than a module-level function reading some ambient "current locale": these
// numbers are baked into KaTeX source strings during render, so the value
// must be correct in the SAME render that the language changes in - an
// effect-synced module variable would be one render stale and then never
// recompute.
// Both formatters here emit KaTeX SOURCE, not display text - everything they
// produce is spliced into a math string. That is why the not-a-number case
// comes back wrapped in \text{}: a bare en dash in math mode is an unknown
// character to KaTeX and would throw rather than render.
export function useFmt(): (value: number, decimals?: number) => string {
  const locale = useLocale();
  return useCallback(
    (value: number, decimals = 2) =>
      isFiniteResult(value)
        ? value.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : `\\text{${NO_VALUE}}`,
    [locale],
  );
}

// abd_inv entries span many orders of magnitude (compliance terms), so they
// get scientific notation rather than a fixed decimal count. Both of these
// end up inside KaTeX source, so the not-a-number case has to be valid TeX
// too - \text{} keeps the dash from being typeset as a minus sign.
export function fmtExp(value: number, decimals = 3): string {
  if (!isFiniteResult(value)) return `\\text{${NO_VALUE}}`;
  const [mantissa, exponent] = value.toExponential(decimals).split("e");
  return `${mantissa}\\times 10^{${Number(exponent)}}`;
}
