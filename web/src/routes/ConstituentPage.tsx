import { useAtom, useAtomValue } from "jotai";
import { useParams } from "react-router-dom";
import { Spline, Droplet } from "lucide-react";
import { fibresAtom, matricesAtom, dependentMaterialsAtom } from "../store/micromechanicsAtoms";
import { Quantity } from "../components/Quantity";
import { BackLink } from "../components/BackLink";
import { useLocale, useT } from "../i18n";
import { formatSignificant } from "../lib/numberFormat";
import type { FibreDto, MatrixMaterialDto } from "../lib/types";

// The fibre and the matrix pages.
//
// One file for both because they are the same page with a different list of
// numbers, and because what makes them worth having is identical: a fibre is
// not a ply material, so it has no laminate, no modules and no results - only
// properties, and the list of materials that were built from it.
//
// The matrix has no shear modulus to edit. eLamX's `Matrix.setG` throws
// outright and its `getG()` returns E / (2 (1 + nu)); the value is shown read
// only, because a number that decides a ply's shear stiffness should not be
// invisible just because it is not typed in.

export function FibrePage() {
  const t = useT();
  const { fibreId } = useParams<{ fibreId: string }>();
  const [fibres, setFibres] = useAtom(fibresAtom);
  const fibre = fibres.find((f) => f.id === fibreId);

  if (!fibre) return <p className="empty-note">{t("fibre.notFound")}</p>;

  const update = (key: keyof FibreDto, value: number) =>
    setFibres((list) => list.map((f) => (f.id === fibre.id ? { ...f, [key]: value } : f)));
  const rename = (name: string) =>
    setFibres((list) => list.map((f) => (f.id === fibre.id ? { ...f, name } : f)));

  return (
    <>
      <BackLink to="/materials" label={t("nav.materials")} />
      <h1 className="visually-hidden">{fibre.name}</h1>

      <section className="panel">
        <h2>
          <Spline size={16} strokeWidth={1.75} />
          {t("fibre.properties")}
        </h2>
        <p className="hint">{t("fibre.hint")}</p>
        <label className="material-name compact">
          {t("common.name")}
          <input type="text" value={fibre.name} onChange={(e) => rename(e.target.value)} />
        </label>
        <div className="field-grid">
          <Field label={<>E<sub>&#8741;</sub></>} category="stiffness" value={fibre.e_par} onChange={(v) => update("e_par", v)} />
          <Field label={<>E<sub>&perp;</sub></>} category="stiffness" value={fibre.e_nor} onChange={(v) => update("e_nor", v)} />
          <Field label={<>&nu;<sub>12</sub></>} category="poissonRatio" value={fibre.nue12} onChange={(v) => update("nue12", v)} />
          <Field label={<>G</>} category="stiffness" value={fibre.g} onChange={(v) => update("g", v)} />
          <Field label={<>&rho;</>} category="density" value={fibre.rho} onChange={(v) => update("rho", v)} />
          <Field label={<>&alpha;<sub>T,&#8741;</sub></>} category="thermalExpansion" value={fibre.alpha_t_par} onChange={(v) => update("alpha_t_par", v)} />
          <Field label={<>&alpha;<sub>T,&perp;</sub></>} category="thermalExpansion" value={fibre.alpha_t_nor} onChange={(v) => update("alpha_t_nor", v)} />
          <Field label={<>&beta;<sub>&#8741;</sub></>} category="hygralExpansion" value={fibre.beta_par} onChange={(v) => update("beta_par", v)} />
          <Field label={<>&beta;<sub>&perp;</sub></>} category="hygralExpansion" value={fibre.beta_nor} onChange={(v) => update("beta_nor", v)} />
        </div>
        <Dependents id={fibre.id} />
      </section>
    </>
  );
}

export function MatrixPage() {
  const t = useT();
  const locale = useLocale();
  const { matrixId } = useParams<{ matrixId: string }>();
  const [matrices, setMatrices] = useAtom(matricesAtom);
  const matrix = matrices.find((m) => m.id === matrixId);

  if (!matrix) return <p className="empty-note">{t("matrix.notFound")}</p>;

  const update = (key: keyof MatrixMaterialDto, value: number) =>
    setMatrices((list) => list.map((m) => (m.id === matrix.id ? { ...m, [key]: value } : m)));
  const rename = (name: string) =>
    setMatrices((list) => list.map((m) => (m.id === matrix.id ? { ...m, name } : m)));

  const g = matrix.e / (2 * (1 + matrix.nue));

  return (
    <>
      <BackLink to="/materials" label={t("nav.materials")} />
      <h1 className="visually-hidden">{matrix.name}</h1>

      <section className="panel">
        <h2>
          <Droplet size={16} strokeWidth={1.75} />
          {t("matrix.properties")}
        </h2>
        <p className="hint">{t("matrix.hint")}</p>
        <label className="material-name compact">
          {t("common.name")}
          <input type="text" value={matrix.name} onChange={(e) => rename(e.target.value)} />
        </label>
        <div className="field-grid">
          <Field label={<>E</>} category="stiffness" value={matrix.e} onChange={(v) => update("e", v)} />
          <Field label={<>&nu;</>} category="poissonRatio" value={matrix.nue} onChange={(v) => update("nue", v)} />
          <Field label={<>&rho;</>} category="density" value={matrix.rho} onChange={(v) => update("rho", v)} />
          <Field label={<>&alpha;<sub>T</sub></>} category="thermalExpansion" value={matrix.alpha} onChange={(v) => update("alpha", v)} />
          <Field label={<>&beta;</>} category="hygralExpansion" value={matrix.beta} onChange={(v) => update("beta", v)} />
        </div>
        <p className="hint">
          {t("matrix.derivedG", { value: formatSignificant(g, 5, locale) })}
        </p>
        <Dependents id={matrix.id} />
      </section>
    </>
  );
}

function Field({
  label,
  category,
  value,
  onChange,
}: {
  label: React.ReactNode;
  category: React.ComponentProps<typeof Quantity>["category"];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="field-label">{label}</span>
      <Quantity category={category} value={value} onChange={onChange} />
    </label>
  );
}

/** Which ply materials this constituent feeds - the only consequence editing
 *  it has, and one a reader cannot see from the page otherwise. */
function Dependents({ id }: { id: string }) {
  const t = useT();
  const dependents = useAtomValue(dependentMaterialsAtom)(id);
  return (
    <p className="hint">
      {dependents.length === 0
        ? t("constituent.unused")
        : t("constituent.usedBy", {
            count: dependents.length,
            names: dependents.map((m) => m.name).join(", "),
          })}
    </p>
  );
}
