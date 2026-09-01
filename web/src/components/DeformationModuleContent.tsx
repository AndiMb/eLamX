import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  addDeformationLoadAtom,
  deformationErrorFamily,
  deformationInputFamily,
  deformationSummaryFamily,
  deformationSurfaceFamily,
  loadableDeformationFamily,
  removeDeformationLoadAtom,
} from "../store/deformationAtoms";
import {
  BOUNDARY_CONDITIONS,
  D_MATRIX_KINDS,
  MAX_RITZ_TERMS,
  type BoundaryConditionId,
  type DeformationInputDto,
  type DMatrixKindId,
  type NamedLoadDto,
} from "../lib/types";
import { formatScientific } from "../lib/numberFormat";
import { Quantity } from "./Quantity";
import { QuantityDisplay } from "./QuantityDisplay";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { PlateView3D, type PlateViewLoad } from "./charts/PlateView3D";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { PlateCheckList } from "./PlateCheckList";
import { hasBlockingCheck, plateChecks } from "../lib/plateChecks";
import { plyGeometryOf } from "../lib/plateScene/plyGeometry";
import { layerContributionsFamily } from "../store/derivedAtoms";
import { useLocale, useT } from "../i18n";

// The content behind the "deformation" entry in MODULE_REGISTRY: how far a
// rectangular plate of this laminate deflects under transverse load.
//
// The same Ritz series as the buckling module, with a load vector instead of a
// geometric stiffness matrix - which is why the 3D view is literally the same
// component. One difference matters for reading it: a buckling mode has a
// shape but no amplitude, a deflection has both, so the numbers under the
// picture are real millimetres.
export function DeformationModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const [input, setInput] = useAtom(deformationInputFamily(laminateId));
  const summary = useAtomValue(deformationSummaryFamily(laminateId));
  const surface = useAtomValue(deformationSurfaceFamily(laminateId));
  const error = useAtomValue(deformationErrorFamily(laminateId));
  // Same guard rails as the buckling module - the plate and its edges are the
  // same input, and eLamX 3.x checks both modules with the same code.
  const checks = plateChecks(input);
  const blocked = hasBlockingCheck(checks);
  const loadableState = useAtomValue(loadableDeformationFamily(laminateId));
  // The 3D body is drawn as the laminate it is, so it needs the expanded
  // stack - thickness and where one ply ends and the next begins.
  const plies = plyGeometryOf(useAtomValue(layerContributionsFamily(laminateId)));
  const addLoad = useSetAtom(addDeformationLoadAtom);
  const removeLoad = useSetAtom(removeDeformationLoadAtom);
  // The list itself is the atom value, so this only changes when a load does -
  // which is exactly when the arrows in the picture should be rebuilt.
  const load = useMemo<PlateViewLoad>(
    () => ({ kind: "transverse", loads: input.loads }),
    [input.loads],
  );

  const update = <K extends keyof DeformationInputDto>(key: K, value: DeformationInputDto[K]) =>
    setInput((c) => ({ ...c, [key]: value }));

  const updateLoad = (index: number, patch: Partial<NamedLoadDto>) =>
    setInput((c) => ({
      ...c,
      loads: c.loads.map((load, i) => (i === index ? ({ ...load, ...patch } as NamedLoadDto) : load)),
    }));

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("deformation.intro")}</p>

      <div className="module-split">
        <section className="panel module-input">
          <h2>{t("deformation.input.title")}</h2>

          <h3>{t("buckling.geometry")}</h3>
          <div className="field-grid">
            <label>
              <span className="field-label">
                <Sym base="a" sub="x" />
              </span>
              <Quantity
                category="thickness"
                value={input.length}
                onChange={(v) => update("length", v)}
              />
            </label>
            <label>
              <span className="field-label">
                <Sym base="b" sub="y" />
              </span>
              <Quantity
                category="thickness"
                value={input.width}
                onChange={(v) => update("width", v)}
              />
            </label>
          </div>

          <h3>{t("deformation.loads")}</h3>
          <p className="hint">{t("deformation.loads.hint")}</p>
          {input.loads.map((load, index) => (
            <div className="deformation-load" key={`${load.kind}-${index}`}>
              <div className="field-grid">
                <label>
                  <span className="field-label">{t("deformation.load.name")}</span>
                  <input
                    type="text"
                    value={load.name}
                    onChange={(e) => updateLoad(index, { name: e.target.value })}
                  />
                </label>
                <label>
                  <span className="field-label">
                    {load.kind === "Surface" ? t("deformation.load.pressure") : t("deformation.load.force")}
                  </span>
                  <SafeNumberInput
                    value={load.force}
                    onChange={(v) => updateLoad(index, { force: v })}
                  />
                </label>
                {load.kind === "Point" && (
                  <>
                    <label>
                      <span className="field-label">
                        <Sym base="x" />
                      </span>
                      <SafeNumberInput
                        value={load.x}
                        onChange={(v) => updateLoad(index, { x: v } as Partial<NamedLoadDto>)}
                      />
                    </label>
                    <label>
                      <span className="field-label">
                        <Sym base="y" />
                      </span>
                      <SafeNumberInput
                        value={load.y}
                        onChange={(v) => updateLoad(index, { y: v } as Partial<NamedLoadDto>)}
                      />
                    </label>
                  </>
                )}
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => removeLoad({ laminateId, index })}
                title={t("deformation.load.remove")}
                aria-label={t("deformation.load.remove")}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="flags">
            <button type="button" onClick={() => addLoad({ laminateId, kind: "Surface" })}>
              <Plus size={14} /> {t("deformation.load.addSurface")}
            </button>
            <button type="button" onClick={() => addLoad({ laminateId, kind: "Point" })}>
              <Plus size={14} /> {t("deformation.load.addPoint")}
            </button>
          </div>
          {input.loads.some((l) => l.kind === "Point") && (
            <p className="hint">{t("deformation.load.point.hint")}</p>
          )}

          <h3>{t("buckling.boundary")}</h3>
          <div className="field-grid">
            <label>
              <span className="field-label">{t("buckling.bcX")}</span>
              <select
                value={input.bc_x}
                onChange={(e) => update("bc_x", e.target.value as BoundaryConditionId)}
              >
                {BOUNDARY_CONDITIONS.map((bc) => (
                  <option key={bc} value={bc}>
                    {bc} — {t(`buckling.bc.${bc}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">{t("buckling.bcY")}</span>
              <select
                value={input.bc_y}
                onChange={(e) => update("bc_y", e.target.value as BoundaryConditionId)}
              >
                {BOUNDARY_CONDITIONS.map((bc) => (
                  <option key={bc} value={bc}>
                    {bc} — {t(`buckling.bc.${bc}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>{t("buckling.method")}</h3>
          <div className="field-grid">
            {/* As in buckling: the page's longest option needs two grid
                columns, or it is cut off mid-formula. */}
            <label className="wide">
              <span className="field-label">{t("buckling.dMatrix")}</span>
              <select
                value={input.d_matrix}
                onChange={(e) => update("d_matrix", e.target.value as DMatrixKindId)}
              >
                {D_MATRIX_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {t(k.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">
                <Sym base="m" />
              </span>
              <SafeNumberInput value={input.m} onChange={(v) => update("m", clampTerms(v))} />
            </label>
            <label>
              <span className="field-label">
                <Sym base="n" />
              </span>
              <SafeNumberInput value={input.n} onChange={(v) => update("n", clampTerms(v))} />
            </label>
          </div>
          <p className="hint">{t("buckling.terms.hint", { max: MAX_RITZ_TERMS })}</p>
        </section>

        <div className="module-results">
          <PlateCheckList checks={checks} severity="error" />
          {error && !blocked && (
            <p className="error">{t("deformation.error", { message: error })}</p>
          )}
          {loadableState.state === "loading" && <p className="hint">{t("results.computing")}</p>}

          {summary && (
            <section className="panel">
              <h2>{t("deformation.result.title")}</h2>

              {/* The whole analysis is linear: the plate's stiffness is taken
                  at its undeformed shape, which stops being true once the
                  deflection approaches the plate's own thickness. eLamX does
                  not warn about it; a plate deflecting more than a tenth of
                  its shorter edge is far outside that assumption and worth
                  saying out loud. */}
              {Math.abs(summary.maxDeflection) >
                LARGE_DEFLECTION_FRACTION * Math.min(input.length, input.width) && (
                <p className="warning">
                  <TriangleAlert size={14} /> {t("deformation.largeDeflection")}
                </p>
              )}

              <PlateCheckList checks={checks} severity="warning" />

              {summary.symmetryWarning && (
                <p className="warning">
                  <TriangleAlert size={14} /> {t("buckling.symmetryWarning")}{" "}
                  <Link to={`/laminates/${laminateId}`}>{t("buckling.symmetryWarning.link")}</Link>
                </p>
              )}

              <div className="stat-tiles">
                <div className="stat-tile">
                  <span className="label">
                    <Sym base="w" sub="max" />
                  </span>
                  <span className="value">
                    <QuantityDisplay category="thickness" value={summary.maxDeflection} />
                  </span>
                </div>
                <div className="stat-tile">
                  <span className="label">
                    <Sym base="w" sub="min" />
                  </span>
                  <span className="value">
                    <QuantityDisplay category="thickness" value={summary.minDeflection} />
                  </span>
                </div>
                <div className="stat-tile">
                  <span className="label">{t("deformation.maxAt")}</span>
                  <span className="value">
                    {formatScientific(summary.maxAt[0], 3, locale)} /{" "}
                    {formatScientific(summary.maxAt[1], 3, locale)}
                  </span>
                </div>
              </div>

              <HowWasThisComputed
                title={t("deformation.how.title")}
                formula={"\\mathbf{K}\\,\\mathbf{a} = \\mathbf{f}"}
                substituted={`w_{max} = ${formatScientific(summary.maxDeflection, 4, locale)}`}
              >
                <p className="hint">{t("deformation.how.hint", { m: input.m, n: input.n })}</p>
              </HowWasThisComputed>
            </section>
          )}

          {surface && surface.length > 1 && (
            <section className="panel">
              <h2>{t("deformation.shape.title")}</h2>
              {/* The same view as the buckling mode, on purpose: it is the same
                  Ritz field. The exaggeration is a fraction of the shorter
                  edge and is written into the picture, because the real
                  amplitude is on the tiles above and the body is not to
                  scale in either direction. */}
              <PlateView3D
                surface={surface}
                length={input.length}
                width={input.width}
                thickness={plies.thickness}
                plyBoundaries={plies.boundaries}
                deflectionFraction={0.15}
                bcX={input.bc_x}
                bcY={input.bc_y}
                load={load}
                ariaLabel={t("plate3d.aria.deformation")}
              />
              <p className="hint">{t("deformation.shape.hint")}</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** Above this fraction of the shorter edge, a linear plate theory is being
 *  asked a question it cannot answer. */
const LARGE_DEFLECTION_FRACTION = 0.1;

// Same clamp as the buckling module: the core refuses anything outside
// 1..MAX_RITZ_TERMS outright.
function clampTerms(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_RITZ_TERMS, Math.max(1, Math.round(value)));
}
