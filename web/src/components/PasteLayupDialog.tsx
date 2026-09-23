import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import {
  CREATE_MATERIAL,
  parseClipboard,
  resolvePaste,
  unknownMaterials,
  type MaterialMapping,
  type ParsedLayup,
  type PasteDefaults,
  type PasteWarning,
} from "../lib/layupClipboard";
import { expandedStack, parseLayup, type LayupError } from "../lib/angleStack";
import type { LayerRow } from "../lib/constants";
import { CRITERIA, type MaterialDto } from "../lib/types";
import { QuantityDisplay } from "./QuantityDisplay";
import { useT, type MessageKey } from "../i18n";

export interface PasteResult {
  layers: LayerRow[];
  newMaterials: MaterialDto[];
  /** Set the laminate's symmetry flags - the plies are its defined half. */
  symmetry: { symmetric: boolean; withMiddleLayer: boolean } | null;
}

const ERROR_KEYS: Record<LayupError, MessageKey> = {
  empty: "paste.error.empty",
  angle: "paste.error.angle",
  unclosed: "paste.error.unclosed",
  unexpected: "paste.error.unexpected",
  middle: "paste.error.middle",
  count: "paste.error.count",
};

/**
 * What a paste would insert, shown before it happens (F1.4): how many plies
 * and how thick, what could not be read, and - for material names this
 * project does not have - the question which material they mean. Nothing is
 * inserted or created until Apply; Cancel leaves everything as it was.
 *
 * `initial` is what the clipboard held. Without it the dialog starts with a
 * text field to paste or type into - the way in on a phone, which has no
 * Ctrl+V for a table, and from the command palette.
 */
export function PasteLayupDialog({
  initial,
  materials,
  defaults,
  laminateEmpty,
  onApply,
  onClose,
}: {
  initial: ParsedLayup | null;
  materials: MaterialDto[];
  defaults: PasteDefaults;
  /** Whether the laminate has no plies yet - only then can a symmetric
   *  notation set the laminate's symmetry instead of being written out. */
  laminateEmpty: boolean;
  onApply: (result: PasteResult) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const parsed = useMemo(() => initial ?? parseClipboard({ text }), [initial, text]);
  const unknown = useMemo(() => (parsed ? unknownMaterials(parsed, materials) : []), [parsed, materials]);
  const [mapping, setMapping] = useState<MaterialMapping>({});
  const [keepSymmetric, setKeepSymmetric] = useState(laminateEmpty);

  // A modal <dialog>: the browser traps the focus in it, Escape closes it and
  // the page behind is inert, which a hand-made overlay would have to redo.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  // What each unknown name is mapped to until the user says otherwise: its
  // own definition when the clipboard carried one - asked about here, so
  // nothing is created without the question - and otherwise the default.
  const effectiveMapping: MaterialMapping = {};
  for (const u of unknown) {
    effectiveMapping[u.key] = mapping[u.key] ?? (u.definition ? CREATE_MATERIAL : defaults.materialId);
  }
  const symmetricChoice = parsed?.symmetric ? keepSymmetric && laminateEmpty : false;
  let preview: { layers: LayerRow[]; newMaterials: MaterialDto[] } | null = null;
  if (parsed) {
    let n = 0;
    preview = resolvePaste(parsed, {
      materials,
      defaults,
      mapping: effectiveMapping,
      keepSymmetric: symmetricChoice,
      newId: () => `preview-${n++}`,
      plyName: (i) => t("default.layerName", { nr: i + 1 }),
    });
  }
  const totals = preview
    ? expandedStack(
        preview.layers.map((l) => l.thickness),
        symmetricChoice,
        symmetricChoice && (parsed?.withMiddleLayer ?? false),
      )
    : null;

  const apply = () => {
    if (!parsed || !preview || preview.layers.length === 0) return;
    const result = resolvePaste(parsed, {
      materials,
      defaults,
      mapping: effectiveMapping,
      keepSymmetric: symmetricChoice,
      newId: () => crypto.randomUUID(),
      plyName: (i) => t("default.layerName", { nr: i + 1 }),
    });
    onApply({
      ...result,
      symmetry: symmetricChoice ? { symmetric: true, withMiddleLayer: parsed.withMiddleLayer } : null,
    });
  };

  const materialName = (id: string) =>
    materials.find((m) => m.id === id)?.name ?? preview?.newMaterials.find((m) => m.id === id)?.name ?? "";
  const criterionName = (id: string) => {
    const entry = CRITERIA.find((c) => c.id === id);
    return entry ? t(entry.labelKey) : id;
  };
  const warningText = (w: PasteWarning) =>
    w.kind === "skippedRows"
      ? t("paste.warning.skippedRows", { count: w.count })
      : t("paste.warning.unknownCriterion", { value: w.value });

  // Why typed text does not read, if it is meant as notation.
  const notationError = !initial && !parsed && text.trim() !== "" ? parseLayup(text.trim()) : null;

  return (
    <dialog
      ref={dialog}
      className="app-dialog paste-dialog"
      aria-labelledby="paste-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <h2 id="paste-dialog-title">
          <ClipboardPaste size={16} strokeWidth={1.75} />
          {t("paste.title")}
        </h2>

        {!initial && (
          <label className="paste-source">
            {t("paste.input")}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={t("paste.input.placeholder")}
              autoFocus
              spellCheck={false}
            />
          </label>
        )}
        {notationError && !notationError.ok && (
          <p className="paste-error" role="alert">
            {t(ERROR_KEYS[notationError.error], { at: notationError.at + 1 })}
          </p>
        )}

        {parsed && preview && totals && (
          <>
            <p className="paste-summary" aria-live="polite">
              {t(`paste.source.${parsed.source}`)} ·{" "}
              {t(totals.plies === 1 ? "paste.summary.one" : "paste.summary.other", { count: totals.plies })} ·{" "}
              {t("layers.totalThickness")} <QuantityDisplay category="thickness" value={totals.thickness} />
            </p>
            {parsed.warnings.length > 0 && (
              <ul className="paste-warnings">
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{warningText(w)}</li>
                ))}
              </ul>
            )}

            {parsed.symmetric && (
              <label className="paste-option">
                <input
                  type="checkbox"
                  checked={symmetricChoice}
                  disabled={!laminateEmpty}
                  onChange={(e) => setKeepSymmetric(e.target.checked)}
                />
                <span>
                  {t("paste.keepSymmetric")}
                  {!laminateEmpty && <span className="hint"> {t("paste.keepSymmetric.onlyEmpty")}</span>}
                </span>
              </label>
            )}

            {unknown.length > 0 && (
              <fieldset className="paste-mapping">
                <legend>{t("paste.mapping.title")}</legend>
                {unknown.map((u) => (
                  <label key={u.key}>
                    <span className="paste-mapping-name">{u.name}</span>
                    <select
                      value={effectiveMapping[u.key]}
                      onChange={(e) => setMapping((m) => ({ ...m, [u.key]: e.target.value }))}
                    >
                      {u.definition && (
                        <option value={CREATE_MATERIAL}>{t("paste.mapping.create", { name: u.name })}</option>
                      )}
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </fieldset>
            )}

            <div className="paste-preview">
              <table>
                <thead>
                  <tr>
                    <th>{t("layers.column.nr")}</th>
                    <th className="num">{t("layers.column.angle")}</th>
                    <th className="num">{t("layers.column.thickness")}</th>
                    <th>{t("layers.column.material")}</th>
                    <th>{t("layers.column.criterion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.layers.map((l, i) => (
                    <tr key={l.id}>
                      <td>{i + 1}</td>
                      <td className="num">
                        <QuantityDisplay category="angle" value={l.angle} />
                      </td>
                      <td className="num">
                        <QuantityDisplay category="thickness" value={l.thickness} />
                      </td>
                      <td>{materialName(l.materialId)}</td>
                      <td>{criterionName(l.criterionId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("paste.cancel")}
          </button>
          <button type="submit" className="btn-primary" disabled={!preview || preview.layers.length === 0} autoFocus={!!initial}>
            {t("paste.apply")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
