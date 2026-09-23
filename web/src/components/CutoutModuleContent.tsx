import { useAtom, useAtomValue } from "jotai";
import { cutoutErrorFamily, cutoutInputFamily, loadableCutoutFamily } from "../store/cutoutAtoms";
import {
  CUTOUT_SHAPES,
  MAX_CUTOUT_TERMS,
  type CutoutGeometryDto,
  type CutoutInputDto,
  type CutoutShapeId,
} from "../lib/types";
import { Quantity } from "./Quantity";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { CutoutEdgeChart } from "./charts/CutoutEdgeChart";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { ResponsiveTable } from "./ResponsiveTable";
import { formatSignificant } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

// What a hole does to the load path.
//
// A closed-form elasticity solution, not a mesh: Lekhnitskii's complex
// potentials evaluated exactly on the hole edge. The question it answers is
// the one a drawing raises - the load has to go round this hole, so how much
// worse does it get at the edge? For an isotropic sheet the answer is the
// textbook three; for a unidirectional carbon ply it is seven, and that
// difference is the reason the module is worth having.

function withShape(current: CutoutGeometryDto, shape: CutoutShapeId): CutoutGeometryDto {
  // Dimensions are carried across a shape change rather than reset: switching
  // between a square and a rectangle to see what the second side costs is the
  // everyday use, and retyping the first one each time would be noise.
  const a = current.a;
  const b = "b" in current ? current.b : a;
  const terms = "terms" in current ? current.terms : 11;
  switch (shape) {
    case "circular":
      return { shape, a };
    case "elliptical":
      return { shape, a, b };
    case "square":
      return { shape, a, terms };
    case "rectangular":
      return { shape, a, b, terms };
  }
}

export function CutoutModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const [input, setInput] = useAtom(cutoutInputFamily(laminateId));
  const error = useAtomValue(cutoutErrorFamily(laminateId));
  const state = useAtomValue(loadableCutoutFamily(laminateId));
  const result = state.state === "hasData" ? state.data : null;

  const update = <K extends keyof CutoutInputDto>(key: K, value: CutoutInputDto[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
  };
  const updateGeometry = (patch: Partial<Record<"a" | "b" | "terms", number>>) => {
    setInput((current) => ({ ...current, geometry: { ...current.geometry, ...patch } }));
  };

  const loadFields: [keyof CutoutInputDto, string, string][] = [
    ["n_x", "n", "x"],
    ["n_y", "n", "y"],
    ["n_xy", "n", "xy"],
    ["m_x", "m", "x"],
    ["m_y", "m", "y"],
    ["m_xy", "m", "xy"],
  ];

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("cutout.intro")}</p>

      <div className="module-split">
        <section className="panel module-input">
          <h2>{t("cutout.input.title")}</h2>

          <h3>{t("cutout.shape")}</h3>
          <div className="field-grid">
            <label className="wide">
              <span className="field-label">{t("cutout.shape")}</span>
              <select
                value={input.geometry.shape}
                onChange={(e) =>
                  update("geometry", withShape(input.geometry, e.target.value as CutoutShapeId))
                }
              >
                {CUTOUT_SHAPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">
                <Sym base="a" />
              </span>
              <Quantity
                category="thickness"
                value={input.geometry.a}
                onChange={(v) => updateGeometry({ a: v })}
              />
            </label>
            {"b" in input.geometry && (
              <label>
                <span className="field-label">
                  <Sym base="b" />
                </span>
                <Quantity
                  category="thickness"
                  value={input.geometry.b}
                  onChange={(v) => updateGeometry({ b: v })}
                />
              </label>
            )}
            {"terms" in input.geometry && (
              <label>
                <span className="field-label">{t("cutout.terms")}</span>
                <SafeNumberInput
                  value={input.geometry.terms}
                  onChange={(v) =>
                    updateGeometry({ terms: Math.max(2, Math.min(MAX_CUTOUT_TERMS, Math.round(v))) })
                  }
                />
              </label>
            )}
          </div>
          <p className="hint">{t(`cutout.shape.hint.${input.geometry.shape}`)}</p>

          <h3>{t("cutout.loads")}</h3>
          <div className="field-grid">
            {loadFields.map(([key, base, sub]) => (
              <label key={key}>
                <span className="field-label">
                  <Sym base={base} sub={sub} />
                </span>
                {/* Plain number inputs, as in the CLT and last-ply-failure
                    panels: the six degrees of freedom mix force flows (N/mm)
                    with moment flows (N·mm/mm), so no single unit category
                    covers them. */}
                <SafeNumberInput
                  value={input[key] as number}
                  onChange={(v) => update(key, v as CutoutInputDto[typeof key])}
                />
              </label>
            ))}
          </div>
          <p className="hint">{t("cutout.loads.hint")}</p>

          <h3>{t("cutout.method")}</h3>
          <div className="field-grid">
            <label>
              <span className="field-label">{t("cutout.values")}</span>
              <SafeNumberInput
                value={input.values}
                onChange={(v) => update("values", Math.max(5, Math.min(3601, Math.round(v))))}
              />
            </label>
          </div>
          <p className="hint">{t("cutout.values.hint")}</p>
        </section>

        <div className="module-results">
          {error && <p className="error">{t("cutout.error", { message: error })}</p>}
          {state.state === "loading" && <p className="hint">{t("results.computing")}</p>}

          {result && (
            <>
              <section className="panel">
                <h2>{t("cutout.result.title")}</h2>

                <div className="stat-tiles">
                  <div className="stat-tile">
                    <span className="label">{t("cutout.peakN")}</span>
                    <span className="value">
                      {formatSignificant(result.peak_n_theta, 5, locale)}
                      <span className="quantity-unit"> N/mm</span>
                    </span>
                  </div>
                  <div className="stat-tile">
                    <span className="label">{t("cutout.peakNAlpha")}</span>
                    <span className="value">
                      {formatSignificant(result.peak_n_theta_alpha, 4, locale)}
                      <span className="quantity-unit">°</span>
                    </span>
                  </div>
                  {result.peak_m_theta !== 0 && (
                    <div className="stat-tile">
                      <span className="label">{t("cutout.peakM")}</span>
                      <span className="value">
                        {formatSignificant(result.peak_m_theta, 5, locale)}
                        <span className="quantity-unit"> N</span>
                      </span>
                    </div>
                  )}
                </div>

                <CutoutEdgeChart points={result.points} peakAlpha={result.peak_n_theta_alpha} />
                <p className="hint">{t("cutout.chart.hint")}</p>

                <HowWasThisComputed
                  title={t("cutout.how.title")}
                  formula={
                    "n_{\\vartheta} = n_x \\sin^2\\alpha + n_y \\cos^2\\alpha - 2 n_{xy} \\sin\\alpha \\cos\\alpha"
                  }
                  substituted={`n_{\\vartheta,\\max} = ${formatSignificant(result.peak_n_theta, 6, locale)}\\ \\mathrm{N/mm}`}
                >
                  <p className="hint">{t("cutout.how.hint")}</p>
                </HowWasThisComputed>
              </section>

              <section className="panel">
                <h2>{t("cutout.table.title")}</h2>
                <ResponsiveTable
                  variant="records"
                  columns={[
                    {
                      key: "alpha",
                      label: t("cutout.table.alpha"),
                      render: (row) => `${formatSignificant(row.alpha, 4, locale)}°`,
                    },
                    {
                      key: "n_theta",
                      label: t("cutout.series.nTheta"),
                      numeric: true,
                      render: (row) => formatSignificant(row.n_theta, 5, locale),
                    },
                    {
                      key: "m_theta",
                      label: t("cutout.series.mTheta"),
                      numeric: true,
                      render: (row) => formatSignificant(row.m_theta, 5, locale),
                    },
                    {
                      key: "n_x",
                      label: t("cutout.table.nx"),
                      numeric: true,
                      render: (row) => formatSignificant(row.n_x, 5, locale),
                    },
                    {
                      key: "n_y",
                      label: t("cutout.table.ny"),
                      numeric: true,
                      render: (row) => formatSignificant(row.n_y, 5, locale),
                    },
                    {
                      key: "n_xy",
                      label: t("cutout.table.nxy"),
                      numeric: true,
                      render: (row) => formatSignificant(row.n_xy, 5, locale),
                    },
                  ]}
                  rows={everySoOften(result.points)}
                  rowKey={(row) => row.alpha}
                  actions={{
                    // Every point, not the thinned rows the screen lists.
                    table: () => ({
                      title: t("cutout.table.title"),
                      columns: [
                        { key: "alpha", label: t("cutout.table.alpha"), category: "angle" },
                        { key: "n_theta", label: t("cutout.series.nTheta") },
                        { key: "m_theta", label: t("cutout.series.mTheta") },
                        { key: "n_x", label: t("cutout.table.nx") },
                        { key: "n_y", label: t("cutout.table.ny") },
                        { key: "n_xy", label: t("cutout.table.nxy") },
                      ],
                      rows: result.points.map((p) => [p.alpha, p.n_theta, p.m_theta, p.n_x, p.n_y, p.n_xy]),
                    }),
                    name: "ausschnitt-rand",
                  }}
                />
                <p className="hint">{t("cutout.table.hint", { total: result.points.length })}</p>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Every fifteen degrees, whatever the sample count.
 *
 * The full 721 points are what the curve is drawn from and what the peak is
 * found in; a table of 721 rows is not something anyone reads. Twenty-four
 * rows are, and the chart above carries the rest.
 */
function everySoOften<T>(points: T[]): T[] {
  const wanted = 24;
  const step = Math.max(1, Math.floor((points.length - 1) / wanted));
  return points.filter((_, i) => i % step === 0);
}
