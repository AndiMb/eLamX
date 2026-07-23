// Small, deliberately-scoped mirror of elamx-core/core/src/clt/layer.rs's
// CltLayer::new local-Q formula - used ONLY to build the "Wie wurde das
// berechnet?" worked example (components/AbdExplanation.tsx), never for an
// actual displayed result (those always come straight from the Rust core's
// wasm response). This is a 4-line closed-form calculation directly off 4
// material constants, not a numerically-sensitive algorithm, which keeps the
// drift risk the architecture plan warns about (re-deriving core math in
// TypeScript) small and easy to eyeball against the Rust source if ever in
// doubt.
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

export function fmt(value: number, decimals = 2): string {
  return value.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// abd_inv entries span many orders of magnitude (compliance terms), so they
// get scientific notation rather than a fixed decimal count.
export function fmtExp(value: number, decimals = 3): string {
  const [mantissa, exponent] = value.toExponential(decimals).split("e");
  return `${mantissa}\\times 10^{${Number(exponent)}}`;
}
