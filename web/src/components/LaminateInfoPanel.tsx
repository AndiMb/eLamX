import { memo } from "react";
import { useAtomValue } from "jotai";
import { laminateInfoFamily } from "../store/derivedAtoms";
import { ResponsiveTable } from "./ResponsiveTable";
import { Sym } from "./Sym";
import { QuantityDisplay } from "./QuantityDisplay";
import {
  formatMatrixEntry,
  formatFixed,
  formatScientific,
  matrixScale,
  NO_VALUE,
} from "../lib/numberFormat";
import type { EngineeringConstantsDto } from "../lib/types";
import { useLocale, useT } from "../i18n";

// The original's "Ingenieurskonstanten" window, which is where eLamX 3.x puts
// everything about the laminate that is not a load case: the full engineering
// constants, the inverse ABD, the laminate's own expansion coefficients, the
// non-dimensional bending parameters and the mass moments.
//
// All of it came out of the Rust core already - `EngineeringConstantsDto` has
// carried all twenty constants and the four non-dimensional parameters since
// the CLT module was ported, and the web showed five of them. This panel is
// the missing display, not a new calculation. The exception is
// alpha_global/beta_global, which the core computed but did not expose.

const AXIS_LABELS = ["1", "2", "6", "1", "2", "6"];

/** Rows of the constants table: one symbol and its four variants, in the
 *  column order membrane / bending x free / restrained.
 *
 *  `null` where the original leaves the cell empty. It shows E and G in all
 *  four variants but the Poisson ratios only without restraint - the four
 *  restrained ones are commented out in `EngineeringConstantsPanel.java`, and
 *  they are also the only constants eLamX's batch mode does not print, so the
 *  golden suite never sees them. Their formula (`-A[0][0]/A[0][1]`) returns
 *  -3.2 for a quasi-isotropic layup, which is not a Poisson ratio. Showing a
 *  number the original itself withholds would be inventing one. */
const CONSTANTS = [
  {
    symbol: { base: "E", sub: "x" },
    fields: ["ex_simple", "ex_fixed", "ex_bend_simple", "ex_bend_fixed"],
    category: "stiffness",
  },
  {
    symbol: { base: "E", sub: "y" },
    fields: ["ey_simple", "ey_fixed", "ey_bend_simple", "ey_bend_fixed"],
    category: "stiffness",
  },
  {
    symbol: { base: "G", sub: "xy" },
    fields: ["g_simple", "g_fixed", "g_bend_simple", "g_bend_fixed"],
    category: "stiffness",
  },
  {
    symbol: { base: "ν", sub: "xy" },
    fields: ["nuxy_simple", null, "nuxy_bend_simple", null],
    category: "poissonRatio",
  },
  {
    symbol: { base: "ν", sub: "yx" },
    fields: ["nuyx_simple", null, "nuyx_bend_simple", null],
    category: "poissonRatio",
  },
] as const satisfies readonly {
  symbol: { base: string; sub: string };
  fields: readonly (keyof EngineeringConstantsDto | null)[];
  category: "stiffness" | "poissonRatio";
}[];

/** The four parameters plate-buckling theory is written in, with the
 *  definition the original shows as a tooltip. */
const NON_DIMENSIONAL = [
  { field: "beta_d", symbol: { base: "β", sub: "D" }, formula: "(D₁₂ + 2·D₆₆) / √(D₁₁·D₂₂)" },
  { field: "nu_d", symbol: { base: "ν", sub: "D" }, formula: "D₁₂ / √(D₁₁·D₂₂)" },
  { field: "gamma_d", symbol: { base: "γ", sub: "D" }, formula: "D₁₆ / (D₁₁³·D₂₂)^¼" },
  { field: "delta_d", symbol: { base: "δ", sub: "D" }, formula: "D₂₆ / (D₁₁·D₂₂³)^¼" },
] as const satisfies readonly {
  field: keyof EngineeringConstantsDto;
  symbol: { base: string; sub: string };
  formula: string;
}[];

export const LaminateInfoPanel = memo(function LaminateInfoPanel({
  laminateId,
}: {
  laminateId: string;
}) {
  const t = useT();
  const locale = useLocale();
  const info = useAtomValue(laminateInfoFamily(laminateId));

  if (!info) return null;
  const ec = info.engineeringConstants;
  const invScale = matrixScale(info.abdInv);

  return (
    <section className="panel">
      <h2>{t("info.title")}</h2>

      <h3>{t("info.constants")}</h3>
      <p className="hint">{t("info.constants.hint")}</p>
      <p className="hint">{t("info.constants.poissonNote")}</p>
      <ResponsiveTable variant="matrix">
        <table className="matrix info-constants">
          <thead>
            <tr>
              <th />
              <th colSpan={2}>{t("info.membrane")}</th>
              <th colSpan={2}>{t("info.bending")}</th>
            </tr>
            <tr>
              <th />
              <th>{t("info.withoutPoisson")}</th>
              <th>{t("info.withPoisson")}</th>
              <th>{t("info.withoutPoisson")}</th>
              <th>{t("info.withPoisson")}</th>
            </tr>
          </thead>
          <tbody>
            {CONSTANTS.map((row) => (
              <tr key={row.symbol.sub + row.symbol.base}>
                <th scope="row">
                  <Sym {...row.symbol} />
                </th>
                {row.fields.map((field, column) => (
                  <td key={field ?? `empty-${column}`}>
                    {field === null ? (
                      <span className="hint">{NO_VALUE}</span>
                    ) : (
                      <QuantityDisplay category={row.category} value={ec[field]} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>

      <h3>{t("info.expansion")}</h3>
      <p className="hint">{t("info.expansion.hint")}</p>
      <ResponsiveTable variant="matrix">
        <table className="matrix">
          <thead>
            <tr>
              <th />
              <th>x</th>
              <th>y</th>
              <th>xy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                α<sup>T</sup>
              </th>
              {info.alphaGlobal.map((value, i) => (
                <td key={`alpha-${i}`}>{formatScientific(value, 3, locale)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">β</th>
              {info.betaGlobal.map((value, i) => (
                <td key={`beta-${i}`}>{formatScientific(value, 3, locale)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </ResponsiveTable>

      <h3>{t("info.nonDimensional")}</h3>
      <p className="hint">{t("info.nonDimensional.hint")}</p>
      <div className="stat-tiles">
        {NON_DIMENSIONAL.map((entry) => (
          <div className="stat-tile" key={entry.field} title={entry.formula}>
            <span className="label">
              <Sym {...entry.symbol} />
            </span>
            <span className="value">{formatFixed(ec[entry.field], 4, locale)}</span>
            <span className="hint">{entry.formula}</span>
          </div>
        ))}
      </div>

      {info.massMoments && (
        <>
          <h3>{t("info.massMoments")}</h3>
          <p className="hint">{t("info.massMoments.hint")}</p>
          <div className="stat-tiles">
            {(["i0", "i1", "i2"] as const).map((key, i) => (
              <div className="stat-tile" key={key}>
                <span className="label">
                  <Sym base="I" sub={String(i)} />
                </span>
                <span className="value">
                  {formatScientific(info.massMoments![key], 3, locale)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>{t("info.abdInv")}</h3>
      <p className="hint">{t("info.abdInv.hint")}</p>
      <ResponsiveTable variant="matrix">
        <table className="matrix">
          <thead>
            <tr>
              <th />
              {AXIS_LABELS.map((label, j) => (
                <th key={`col-${j}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {info.abdInv.map((row, i) => (
              <tr key={`row-${i}`}>
                <th scope="row">{AXIS_LABELS[i]}</th>
                {row.map((value, j) => (
                  <td key={`cell-${i}-${j}`}>
                    {formatMatrixEntry(value, invScale, 4, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
    </section>
  );
});
