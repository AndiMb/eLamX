import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import {
  addVariantAtom,
  comparisonVariantsAtom,
  MAX_VARIANTS,
  removeVariantAtom,
  type Variant,
} from "../store/comparisonAtoms";
import { loadableVariantFamily, variantKey } from "../store/derivedAtoms";
import { laminateConfigFamily, laminateIdsAtom, loadCasesOf } from "../store/laminateAtoms";
import { expandedStack, shortStackNotation } from "../lib/angleStack";
import { DOF_NAMES } from "../lib/constants";
import type { CltResponse } from "../lib/types";
import { formatFixed, formatScientific, isFiniteResult, NO_VALUE } from "../lib/numberFormat";
import { ResponsiveTable } from "../components/ResponsiveTable";
import { QuantityDisplay } from "../components/QuantityDisplay";
import { Sym } from "../components/Sym";
import { useLocale, useT, type MessageKey } from "../i18n";

// Variants as columns, quantities as rows - the web answer to what the Java
// original solved with the platform's window tabs, and to the one thing a
// spreadsheet does that this app could not: put two variants side by side and
// see both at once.
//
// A variant is a (laminate, load case) pair, because that is what people
// actually compare: one stack under two loads, or two stacks under the same
// one. Cells that differ from the first column are marked - the point of the
// surface is the difference, not the numbers.
//
// Every cell is its own component. That is not indirection for its own sake:
// the number of columns changes as variants are added, and a hook called once
// per variant from the page would break the rules of hooks the moment someone
// removes one.

/** Everything a column knows without having computed anything. */
interface VariantFacts {
  laminateName: string;
  loadCaseName: string;
  notation: string;
  plies: number;
  thickness: number;
  dofValues: number[];
  useStrain: boolean[];
  deltaT: number;
  deltaH: number;
}

interface Row {
  key: string;
  group: MessageKey;
  label: ReactNode;
  render: (result: CltResponse | null, facts: VariantFacts) => ReactNode;
  /** The same cell as a string, so two columns can be told apart exactly. */
  compare: (result: CltResponse | null, facts: VariantFacts) => string;
}

export function ComparePage() {
  const t = useT();
  const locale = useLocale();
  const variants = useAtomValue(comparisonVariantsAtom);
  const removeVariant = useSetAtom(removeVariantAtom);
  const rows = useMemo(() => buildRows(t, locale), [t, locale]);

  return (
    <>
      <h1>{t("compare.title")}</h1>
      <p className="hint">{t("compare.intro")}</p>

      <VariantPicker />

      {variants.length === 0 ? (
        <p className="hint">{t("compare.empty")}</p>
      ) : (
        <section className="panel">
          <ResponsiveTable variant="matrix">
            <table className="matrix compare-table">
              <thead>
                <tr>
                  <th />
                  {variants.map((variant, i) => (
                    <th key={variantKey(variant.laminateId, variant.loadCaseId)}>
                      <ColumnHeader variant={variant} onRemove={() => removeVariant(i)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <Fragment key={row.key}>
                    {(rowIndex === 0 || rows[rowIndex - 1].group !== row.group) && (
                      <tr className="compare-group">
                        <th colSpan={variants.length + 1} scope="colgroup">
                          {t(row.group)}
                        </th>
                      </tr>
                    )}
                    <tr>
                      <th scope="row">{row.label}</th>
                      {variants.map((variant, i) => (
                        <Cell
                          key={variantKey(variant.laminateId, variant.loadCaseId)}
                          variant={variant}
                          reference={i === 0 ? null : variants[0]}
                          row={row}
                        />
                      ))}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          <p className="hint">{t("compare.hint")}</p>
        </section>
      )}
    </>
  );
}

/** A column's own facts, read from the store. */
function useFacts(variant: Variant): VariantFacts {
  const config = useAtomValue(laminateConfigFamily(variant.laminateId));
  const cases = loadCasesOf(config);
  const loadCase = cases.find((c) => c.id === variant.loadCaseId) ?? cases[0];
  const { plies, thickness } = expandedStack(
    config.layers.map((l) => l.thickness),
    config.symmetric,
    config.withMiddleLayer,
  );
  return {
    laminateName: config.name,
    loadCaseName: loadCase.name,
    notation: shortStackNotation(
      config.layers.map((l) => l.angle),
      config.symmetric,
      config.withMiddleLayer,
    ),
    plies,
    thickness,
    dofValues: loadCase.dofValues,
    useStrain: loadCase.useStrain,
    deltaT: loadCase.deltaT,
    deltaH: loadCase.deltaH,
  };
}

function useResult(variant: Variant): CltResponse | null {
  const state = useAtomValue(
    loadableVariantFamily(variantKey(variant.laminateId, variant.loadCaseId)),
  );
  return state.state === "hasData" ? state.data : null;
}

function ColumnHeader({ variant, onRemove }: { variant: Variant; onRemove: () => void }) {
  const t = useT();
  const facts = useFacts(variant);
  return (
    <>
      <span className="compare-column-title">{facts.laminateName}</span>
      <span className="compare-column-sub">{facts.loadCaseName}</span>
      <button
        type="button"
        className="icon-button"
        onClick={onRemove}
        title={t("compare.remove")}
        aria-label={t("compare.remove")}
      >
        <X size={12} />
      </button>
    </>
  );
}

function Cell({
  variant,
  reference,
  row,
}: {
  variant: Variant;
  /** The first column, or null when this IS the first column. */
  reference: Variant | null;
  row: Row;
}) {
  const facts = useFacts(variant);
  const result = useResult(variant);
  // Reading the reference column here rather than passing its value down keeps
  // the hook count per cell constant; jotai hands out the same atom instance,
  // so this costs a subscription, not a second computation.
  const referenceFacts = useFacts(reference ?? variant);
  const referenceResult = useResult(reference ?? variant);

  const differs =
    reference !== null &&
    row.compare(result, facts) !== row.compare(referenceResult, referenceFacts);

  return <td className={differs ? "compare-differs" : undefined}>{row.render(result, facts)}</td>;
}

function VariantPicker() {
  const t = useT();
  const ids = useAtomValue(laminateIdsAtom);
  const variants = useAtomValue(comparisonVariantsAtom);
  const addVariant = useSetAtom(addVariantAtom);
  const [laminateId, setLaminateId] = useState<string>(ids[0] ?? "");
  const [loadCaseId, setLoadCaseId] = useState<string>("");

  const chosenLaminate = ids.includes(laminateId) ? laminateId : (ids[0] ?? "");
  const config = useAtomValue(laminateConfigFamily(chosenLaminate));
  const cases = loadCasesOf(config);
  const chosenCase = cases.find((c) => c.id === loadCaseId) ?? cases[0];
  const full = variants.length >= MAX_VARIANTS;

  return (
    <section className="panel compare-picker">
      <h2>{t("compare.add")}</h2>
      <div className="field-grid">
        <label>
          <span className="field-label">{t("compare.laminate")}</span>
          <select
            value={chosenLaminate}
            onChange={(e) => {
              setLaminateId(e.target.value);
              setLoadCaseId("");
            }}
          >
            {ids.map((id) => (
              <LaminateOption key={id} id={id} />
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">{t("compare.loadCase")}</span>
          <select value={chosenCase?.id ?? ""} onChange={(e) => setLoadCaseId(e.target.value)}>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={full || !chosenCase}
          onClick={() =>
            chosenCase && addVariant({ laminateId: chosenLaminate, loadCaseId: chosenCase.id })
          }
        >
          {t("compare.addButton")}
        </button>
      </div>
      {full && <p className="hint">{t("compare.full", { max: MAX_VARIANTS })}</p>}
    </section>
  );
}

function LaminateOption({ id }: { id: string }) {
  const config = useAtomValue(laminateConfigFamily(id));
  return <option value={id}>{config.name}</option>;
}

function buildRows(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  locale: string,
): Row[] {
  const rows: Row[] = [
    {
      key: "stack",
      group: "compare.group.layup",
      label: t("compare.row.stack"),
      render: (_r, f) => <code>{f.notation}</code>,
      compare: (_r, f) => f.notation,
    },
    {
      key: "plies",
      group: "compare.group.layup",
      label: t("compare.row.plies"),
      render: (_r, f) => f.plies,
      compare: (_r, f) => String(f.plies),
    },
    {
      key: "thickness",
      group: "compare.group.layup",
      label: <Sym base="t" sub="ges" />,
      render: (_r, f) => <QuantityDisplay category="thickness" value={f.thickness} />,
      compare: (_r, f) => f.thickness.toFixed(6),
    },
    {
      key: "areaWeight",
      group: "compare.group.layup",
      label: t("compare.row.areaWeight"),
      render: (r) => (r ? formatScientific(r.area_weight, 3, locale) : NO_VALUE),
      compare: (r) => (r ? r.area_weight.toExponential(6) : "-"),
    },
  ];

  // Symbol SPECS, not elements: a list of JSX elements would read as a render
  // array (and lint would rightly ask for keys); each label is built below.
  const constants = [
    ["ex_simple", { base: "E", sub: "x" }, 1],
    ["ey_simple", { base: "E", sub: "y" }, 1],
    ["g_simple", { base: "G", sub: "xy" }, 1],
    ["nuxy_simple", { base: "ν", sub: "xy" }, 4],
  ] as const;
  for (const [field, symbol, digits] of constants) {
    rows.push({
      key: field,
      group: "compare.group.stiffness",
      label: <Sym {...symbol} />,
      render: (r) =>
        r && isFiniteResult(r.engineering_constants[field])
          ? formatFixed(r.engineering_constants[field], digits, locale)
          : NO_VALUE,
      compare: (r) => (r ? r.engineering_constants[field].toFixed(6) : "-"),
    });
  }

  DOF_NAMES.forEach((names, i) => {
    rows.push({
      key: `dof-${i}`,
      group: "compare.group.load",
      label: (
        <>
          <Sym {...names.load} /> / <Sym {...names.strain} />
        </>
      ),
      render: (_r, f) =>
        f.useStrain[i] ? (
          <>
            {formatScientific(f.dofValues[i], 3, locale)}{" "}
            <span className="hint">{t("compare.prescribedStrain")}</span>
          </>
        ) : (
          formatFixed(f.dofValues[i], 1, locale)
        ),
      compare: (_r, f) => `${f.useStrain[i] ? "e" : "n"}:${f.dofValues[i]}`,
    });
  });

  rows.push({
    key: "hygrothermal",
    group: "compare.group.load",
    label: "ΔT / ΔH",
    render: (_r, f) => `${formatFixed(f.deltaT, 1, locale)} / ${formatFixed(f.deltaH, 2, locale)}`,
    compare: (_r, f) => `${f.deltaT}/${f.deltaH}`,
  });

  rows.push(
    {
      key: "minRf",
      group: "compare.group.result",
      label: t("compare.row.minRf"),
      render: (r) => {
        const min = minReserveFactor(r);
        return min === null ? NO_VALUE : <QuantityDisplay category="reserveFactor" value={min} />;
      },
      compare: (r) => {
        const min = minReserveFactor(r);
        return min === null ? "-" : min.toFixed(6);
      },
    },
    {
      key: "verdict",
      group: "compare.group.result",
      label: t("compare.row.verdict"),
      render: (r) => {
        const min = minReserveFactor(r);
        if (min === null) return NO_VALUE;
        return min < 1 ? (
          <span className="chip danger">{t("compare.fails")}</span>
        ) : (
          <span className="chip ok">{t("compare.holds")}</span>
        );
      },
      compare: (r) => {
        const min = minReserveFactor(r);
        return min === null ? "-" : min < 1 ? "fail" : "ok";
      },
    },
    {
      key: "failedPlies",
      group: "compare.group.result",
      label: t("compare.row.failedPlies"),
      render: (r) =>
        r ? `${r.layer_results.filter((l) => l.failed).length} / ${r.layer_results.length}` : NO_VALUE,
      compare: (r) => (r ? String(r.layer_results.filter((l) => l.failed).length) : "-"),
    },
  );

  return rows;
}

/** The governing reserve factor over every ply and both ply surfaces - the one
 *  number that answers "does it hold". */
function minReserveFactor(result: CltResponse | null): number | null {
  if (!result || result.layer_results.length === 0) return null;
  let min = Infinity;
  for (const layer of result.layer_results) {
    min = Math.min(
      min,
      layer.rr_lower.minimal_reserve_factor,
      layer.rr_upper.minimal_reserve_factor,
    );
  }
  return Number.isFinite(min) ? min : null;
}
