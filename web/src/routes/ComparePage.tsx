import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { ArrowDown, ArrowUp, Camera, Pin, Trash2, X } from "lucide-react";
import {
  addSnapshotAtom,
  addVariantAtom,
  comparisonVariantsAtom,
  compareShowAllRowsAtom,
  MAX_VARIANTS,
  removeSnapshotAtom,
  removeVariantAtom,
  renameSnapshotAtom,
  snapshotsAtom,
  snapshotVariant,
  type Variant,
} from "../store/comparisonAtoms";
import { MODULE_FIGURES } from "../store/moduleFigureAtoms";
import { buildCltRequest } from "../store/derivedAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { historyStep } from "../lib/history";
import { elamx } from "../lib/wasm";
import { keyFiguresOf, takeSnapshot, type Snapshot } from "../lib/compare/snapshot";
import { comparable, compareValues, directionOf, type Verdict } from "../lib/compare/direction";
import { useIsMobile } from "../lib/useIsMobile";
import {
  figureKey,
  moduleFigureFamily,
  visibleModuleFiguresAtom,
  type ModuleFigureId,
} from "../store/moduleFigureAtoms";
import { columnKey, laminateDtoOf, loadableVariantFamily } from "../store/derivedAtoms";
import { laminateConfigFamily, laminateIdsAtom, loadCasesOf } from "../store/laminateAtoms";
import { expandedStack, shortStackNotation } from "../lib/angleStack";
import { DOF_NAMES } from "../lib/constants";
import type { CltResponse } from "../lib/types";
import { formatFixed, formatScientific, isFiniteResult, NO_VALUE } from "../lib/numberFormat";
import { ResponsiveTable } from "../components/ResponsiveTable";
import { domTableModel } from "../lib/export/domTable";
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
  /** Shown on a phone before "show everything" is tapped. Measured: three
   *  variants make an 875 px table, and 390 px of screen showed the row
   *  labels and the left edge of the first column - values are right-aligned,
   *  so not one number was on screen. Fewer rows do not fix the width; they
   *  make the width worth scrolling. */
  essential?: true;
  label: ReactNode;
  render: (result: CltResponse | null, facts: VariantFacts) => ReactNode;
  /** The same cell as a string, so two columns can be told apart exactly. */
  compare: (result: CltResponse | null, facts: VariantFacts) => string;
  /** The cell as a number, where a row has a better and a worse - see
   *  lib/compare/direction. */
  value?: (result: CltResponse | null, facts: VariantFacts) => number | null;
}

/** A row fed by one of the other modules rather than by the CLT result.
 *
 *  Its own kind of row because it answers a different question about presence:
 *  a laminate HAS a CLT result as soon as it has plies, but it only has a
 *  buckling factor once someone has defined a plate. The figure itself comes
 *  from an atom (see store/moduleFigureAtoms), which is what keeps a buckling
 *  row from computing a deformation. */
interface ModuleRow {
  key: ModuleFigureId;
  essential?: true;
  labelKey: MessageKey;
  digits: number;
}

const MODULE_ROWS: ModuleRow[] = [
  { key: "bucklingFactor", essential: true, labelKey: "compare.row.bucklingFactor", digits: 3 },
  { key: "maxDeflection", labelKey: "compare.row.maxDeflection", digits: 3 },
  { key: "fundamentalFrequency", labelKey: "compare.row.fundamentalFrequency", digits: 4 },
  { key: "lpfFirstMatrix", labelKey: "compare.row.lpfFirstMatrix", digits: 3 },
  { key: "lpfFinal", labelKey: "compare.row.lpfFinal", digits: 3 },
];

export function ComparePage() {
  const t = useT();
  const locale = useLocale();
  const variants = useAtomValue(comparisonVariantsAtom);
  const removeVariant = useSetAtom(removeVariantAtom);
  const allRows = useMemo(() => buildRows(t, locale), [t, locale]);
  const compareTable = useRef<HTMLTableElement>(null);
  const isMobile = useIsMobile();
  const [showAll, setShowAll] = useAtom(compareShowAllRowsAtom);
  const condensed = isMobile && !showAll;
  const rows = condensed ? allRows.filter((r) => r.essential) : allRows;
  const visibleFigures = useAtomValue(visibleModuleFiguresAtom);
  const moduleRows = MODULE_ROWS.filter(
    (row) => (!condensed || row.essential) && visibleFigures.includes(row.key),
  );

  return (
    <>
      <header className="page-header">
        <div className="page-header-text">
          <h1>{t("compare.title")}</h1>
          <p className="page-header-sub">{t("compare.intro")}</p>
        </div>
      </header>

      <VariantPicker />
      <SnapshotList />

      {variants.length === 0 ? (
        <p className="empty-note">{t("compare.empty")}</p>
      ) : (
        <section className="panel">
          <ResponsiveTable
            variant="matrix"
            actions={{
              table: () => (compareTable.current ? domTableModel(compareTable.current, t("compare.title")) : null),
              name: "vergleich",
            }}
          >
            <table className="matrix compare-table" ref={compareTable}>
              <thead>
                <tr>
                  <th />
                  {variants.map((variant, i) => (
                    <th key={columnKey(variant)}>
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
                          key={columnKey(variant)}
                          variant={variant}
                          reference={i === 0 ? null : variants[0]}
                          row={row}
                        />
                      ))}
                    </tr>
                  </Fragment>
                ))}
                {moduleRows.map((row, i) => (
                  <Fragment key={row.key}>
                    {i === 0 && (
                      <tr className="compare-group">
                        <th colSpan={variants.length + 1} scope="colgroup">
                          {t("compare.group.modules")}
                        </th>
                      </tr>
                    )}
                    <tr>
                      <th scope="row">{t(row.labelKey)}</th>
                      {variants.map((variant, column) => (
                        <ModuleCell
                          key={columnKey(variant)}
                          variant={variant}
                          reference={column === 0 ? null : variants[0]}
                          row={row}
                        />
                      ))}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          {isMobile && (
            <button type="button" className="compare-rows-toggle" onClick={() => setShowAll(!showAll)}>
              {t(showAll ? "compare.fewerRows" : "compare.moreRows")}
            </button>
          )}
          <p className="hint">{t("compare.hint")}</p>
        </section>
      )}
    </>
  );
}

/** A column's own facts, read from the store - or from the snapshot, whose
 *  laminate and load case are its own copies. */
function useFacts(variant: Variant): VariantFacts {
  const config = useAtomValue(laminateConfigFamily(variant.laminateId));
  const snapshots = useAtomValue(snapshotsAtom);
  const snapshot = variant.snapshotId ? snapshots.find((s) => s.id === variant.snapshotId) : undefined;
  if (snapshot) {
    const lam = snapshot.laminate;
    const { plies, thickness } = expandedStack(
      lam.layers.map((l) => l.thickness),
      lam.symmetric,
      lam.with_middle_layer,
    );
    return {
      laminateName: snapshot.name,
      loadCaseName: snapshot.load_case.name,
      notation: shortStackNotation(
        lam.layers.map((l) => l.angle),
        lam.symmetric,
        lam.with_middle_layer,
      ),
      plies,
      thickness,
      dofValues: snapshot.load_case.dof_values,
      useStrain: snapshot.load_case.use_strain,
      deltaT: snapshot.load_case.delta_t,
      deltaH: snapshot.load_case.delta_h,
    };
  }
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
  const state = useAtomValue(loadableVariantFamily(columnKey(variant)));
  return state.state === "hasData" ? state.data : null;
}

/** Why a column has no numbers, when the core refused them. Without it a
 *  failed column - a ply pointing at a deleted material, say - looked exactly
 *  like one still computing. */
function useResultError(variant: Variant): string | null {
  const state = useAtomValue(loadableVariantFamily(columnKey(variant)));
  if (state.state !== "hasError") return null;
  return state.error instanceof Error ? state.error.message : String(state.error);
}

/** Pins a laminate under a load case as a snapshot (F4.3): its figures now,
 *  computed here, and the module figures the laminate has. */
function usePin() {
  const store = useStore();
  const t = useT();
  const locale = useLocale();
  return async (laminateId: string, loadCaseId: string) => {
    const config = store.get(laminateConfigFamily(laminateId));
    const loadCase = loadCasesOf(config).find((c) => c.id === loadCaseId) ?? loadCasesOf(config)[0];
    const materials = store.get(materialsAtom);
    let clt: CltResponse | null = null;
    try {
      clt = JSON.parse(
        await elamx.compute_clt(
          JSON.stringify(buildCltRequest(laminateDtoOf(config), Object.fromEntries(materials.map((m) => [m.id, m])), loadCase)),
        ),
      ) as CltResponse;
    } catch {
      clt = null;
    }
    const modules: Record<string, number | null> = {};
    for (const { id } of MODULE_FIGURES) modules[id] = store.get(moduleFigureFamily(figureKey(id, laminateId)));
    const at = new Date();
    const name = t("compare.snapshot.defaultName", {
      laminate: config.name,
      loadCase: loadCase.name,
      date: at.toLocaleString(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short" }),
    });
    const snapshot = takeSnapshot(name, config, loadCase, materials, keyFiguresOf(clt, modules), at);
    historyStep(t("compare.snapshot.pin"), () => store.set(addSnapshotAtom, snapshot));
  };
}

function ColumnHeader({ variant, onRemove }: { variant: Variant; onRemove: () => void }) {
  const t = useT();
  const facts = useFacts(variant);
  const pin = usePin();
  const error = useResultError(variant);
  return (
    <>
      <span className="compare-column-title">
        {variant.snapshotId && <Camera size={12} aria-label={t("compare.snapshot")} />} {facts.laminateName}
      </span>
      <span className="compare-column-sub">
        {variant.snapshotId ? t("compare.snapshot.column", { loadCase: facts.loadCaseName }) : facts.loadCaseName}
      </span>
      {error && (
        <span className="compare-column-error" role="alert" title={error}>
          {t("compare.columnError", { message: error })}
        </span>
      )}
      {!variant.snapshotId && (
        <button
          type="button"
          className="icon-button"
          onClick={() => void pin(variant.laminateId, variant.loadCaseId)}
          title={t("compare.snapshot.pin")}
          aria-label={t("compare.snapshot.pin")}
        >
          <Pin size={12} />
        </button>
      )}
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

/** Better or worse than the first column, said with an arrow as well as a
 *  colour (N7). */
function DiffMark({ verdict }: { verdict: Verdict }) {
  const t = useT();
  if (verdict === "better") return <ArrowUp size={12} className="compare-mark" aria-label={t("compare.better")} />;
  if (verdict === "worse") return <ArrowDown size={12} className="compare-mark" aria-label={t("compare.worse")} />;
  return null;
}

function diffClass(differs: boolean, verdict: Verdict): string | undefined {
  if (!differs) return undefined;
  if (verdict === "better") return "compare-differs compare-better";
  if (verdict === "worse") return "compare-differs compare-worse";
  return "compare-differs";
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
  const verdict: Verdict =
    differs && row.value
      ? compareValues(directionOf(row.key), row.value(result, facts), row.value(referenceResult, referenceFacts))
      : "neutral";

  return (
    <td className={diffClass(differs, verdict)}>
      <DiffMark verdict={verdict} />
      {row.render(result, facts)}
    </td>
  );
}

/** A module figure of a column: computed for a laminate, and for a snapshot
 *  the figure it recorded then - a snapshot keeps no module inputs, so there
 *  is nothing to compute it again from. */
function useModuleFigure(variant: Variant, row: ModuleRow): { value: number | null; then: boolean } {
  const live = useAtomValue(moduleFigureFamily(figureKey(row.key, variant.laminateId)));
  const snapshots = useAtomValue(snapshotsAtom);
  if (!variant.snapshotId) return { value: live, then: false };
  const recorded = snapshots.find((s) => s.id === variant.snapshotId)?.key_figures[row.key];
  return { value: recorded ?? null, then: true };
}

function ModuleCell({
  variant,
  reference,
  row,
}: {
  variant: Variant;
  reference: Variant | null;
  row: ModuleRow;
}) {
  const t = useT();
  const locale = useLocale();
  const { value, then } = useModuleFigure(variant, row);
  const { value: referenceValue } = useModuleFigure(reference ?? variant, row);

  const asText = (v: number | null) => (isFiniteResult(v) ? v.toFixed(6) : "-");
  const differs = reference !== null && asText(value) !== asText(referenceValue);
  const verdict = differs
    ? compareValues(directionOf(row.key), comparable(row.key, value), comparable(row.key, referenceValue))
    : "neutral";

  return (
    <td className={diffClass(differs, verdict)}>
      <DiffMark verdict={verdict} />
      {value === null ? (
        <span className="hint" title={t("compare.notConfigured")}>
          {NO_VALUE}
        </span>
      ) : isFiniteResult(value) ? (
        <span className={then ? "compare-then" : undefined} title={then ? t("compare.snapshot.then") : undefined}>
          {formatFixed(value, row.digits, locale)}
        </span>
      ) : (
        NO_VALUE
      )}
    </td>
  );
}

function VariantPicker() {
  const t = useT();
  const ids = useAtomValue(laminateIdsAtom);
  const variants = useAtomValue(comparisonVariantsAtom);
  const snapshots = useAtomValue(snapshotsAtom);
  const addVariant = useSetAtom(addVariantAtom);
  const pin = usePin();
  const [source, setSource] = useState<"laminate" | "snapshot">("laminate");
  const [laminateId, setLaminateId] = useState<string>(ids[0] ?? "");
  const [loadCaseId, setLoadCaseId] = useState<string>("");
  const [snapshotId, setSnapshotId] = useState<string>("");

  const chosenLaminate = ids.includes(laminateId) ? laminateId : (ids[0] ?? "");
  const config = useAtomValue(laminateConfigFamily(chosenLaminate));
  const cases = loadCasesOf(config);
  const chosenCase = cases.find((c) => c.id === loadCaseId) ?? cases[0];
  const chosenSnapshot = snapshots.find((s) => s.id === snapshotId) ?? snapshots[0];
  const full = variants.length >= MAX_VARIANTS;

  return (
    <section className="panel compare-picker">
      <h2>{t("compare.add")}</h2>
      <div className="segmented" role="radiogroup" aria-label={t("compare.source")}>
        {(["laminate", "snapshot"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={source === s}
            className={source === s ? "active" : undefined}
            onClick={() => setSource(s)}
            disabled={s === "snapshot" && snapshots.length === 0}
          >
            {t(s === "laminate" ? "compare.source.laminate" : "compare.source.snapshot")}
          </button>
        ))}
      </div>
      {source === "laminate" || snapshots.length === 0 ? (
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
          {/* The one action of this card, and the only place on the page where
              something is created. */}
          <button
            type="button"
            className="btn-primary"
            disabled={full || !chosenCase}
            onClick={() =>
              chosenCase && addVariant({ laminateId: chosenLaminate, loadCaseId: chosenCase.id })
            }
          >
            {t("compare.addButton")}
          </button>
          <button type="button" disabled={!chosenCase} onClick={() => chosenCase && void pin(chosenLaminate, chosenCase.id)}>
            <Pin size={14} /> {t("compare.snapshot.pin")}
          </button>
        </div>
      ) : (
        <div className="field-grid">
          <label className="wide">
            <span className="field-label">{t("compare.snapshot")}</span>
            <select value={chosenSnapshot?.id ?? ""} onChange={(e) => setSnapshotId(e.target.value)}>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={full || !chosenSnapshot}
            onClick={() => chosenSnapshot && addVariant(snapshotVariant(chosenSnapshot.id))}
          >
            {t("compare.addButton")}
          </button>
        </div>
      )}
      {full && <p className="hint">{t("compare.full", { max: MAX_VARIANTS })}</p>}
      <p className="hint">{t("compare.snapshot.hint")}</p>
    </section>
  );
}

/** The project's snapshots: named, dated, renamed and deleted here. */
function SnapshotList() {
  const t = useT();
  const locale = useLocale();
  const snapshots = useAtomValue(snapshotsAtom);
  const rename = useSetAtom(renameSnapshotAtom);
  const remove = useSetAtom(removeSnapshotAtom);
  if (snapshots.length === 0) return null;
  const date = (s: Snapshot) =>
    new Date(s.at).toLocaleString(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  return (
    <section className="panel compare-snapshots">
      <h2>
        <Camera size={16} aria-hidden="true" /> {t("compare.snapshots")}
      </h2>
      <ul className="snapshot-list">
        {snapshots.map((s) => (
          <li key={s.id}>
            <input
              type="text"
              value={s.name}
              aria-label={t("compare.snapshot.name")}
              onChange={(e) => rename({ id: s.id, name: e.target.value })}
            />
            <span className="hint">
              {date(s)} · <code>{shortStackNotation(s.laminate.layers.map((l) => l.angle), s.laminate.symmetric, s.laminate.with_middle_layer)}</code> ·{" "}
              {s.load_case.name}
            </span>
            <button
              type="button"
              className="icon-button danger"
              title={t("compare.snapshot.delete")}
              aria-label={t("compare.snapshot.delete")}
              onClick={() => historyStep(t("history.label.snapshots"), () => remove(s.id))}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
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
      essential: true,
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
      essential: true,
      label: <Sym base="t" sub="ges" />,
      render: (_r, f) => <QuantityDisplay category="thickness" value={f.thickness} />,
      compare: (_r, f) => f.thickness.toFixed(6),
    },
    {
      key: "areaWeight",
      group: "compare.group.layup",
      label: t("compare.row.areaWeight"),
      render: (r) => (r ? <QuantityDisplay category="arealMass" value={r.area_weight} /> : NO_VALUE),
      compare: (r) => (r ? r.area_weight.toExponential(6) : "-"),
      value: (r) => (r ? r.area_weight : null),
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
      ...(field === "ex_simple" ? { essential: true as const } : {}),
      label: <Sym {...symbol} />,
      render: (r) =>
        r && isFiniteResult(r.engineering_constants[field])
          ? formatFixed(r.engineering_constants[field], digits, locale)
          : NO_VALUE,
      compare: (r) => (r ? r.engineering_constants[field].toFixed(6) : "-"),
      value: (r) => (r ? r.engineering_constants[field] : null),
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
      essential: true,
      label: t("compare.row.minRf"),
      render: (r) => {
        const min = minReserveFactor(r);
        return min === null ? NO_VALUE : <QuantityDisplay category="reserveFactor" value={min} />;
      },
      compare: (r) => {
        const min = minReserveFactor(r);
        return min === null ? "-" : min.toFixed(6);
      },
      value: (r) => minReserveFactor(r),
    },
    {
      key: "verdict",
      group: "compare.group.result",
      essential: true,
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
      value: (r) => {
        const min = minReserveFactor(r);
        return min === null ? null : min < 1 ? 0 : 1;
      },
    },
    {
      key: "failedPlies",
      group: "compare.group.result",
      label: t("compare.row.failedPlies"),
      render: (r) =>
        r ? `${r.layer_results.filter((l) => l.failed).length} / ${r.layer_results.length}` : NO_VALUE,
      compare: (r) => (r ? String(r.layer_results.filter((l) => l.failed).length) : "-"),
      value: (r) => (r ? r.layer_results.filter((l) => l.failed).length : null),
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
