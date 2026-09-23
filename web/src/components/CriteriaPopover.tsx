import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListChecks, Plus, X } from "lucide-react";
import { addCriterion, moveCriterion, removeCriterion } from "../lib/criteriaList";
import { CRITERIA, criterionName, type CriterionId } from "../lib/types";
import { useT } from "../i18n";

// The ply's criteria as an ordered list (F2.1): the first is the one eLamX
// 3.x stores and reads, the rest are checked here too and the smallest
// reserve factor governs.
//
// A small modal <dialog> rather than a floating popover: the browser traps
// the focus in it and closes it on Escape, the page behind is inert, and on a
// phone it is a sheet rather than something hanging off a table cell that is
// itself inside a card. Every action is a button or a select, so the whole
// list is operable from the keyboard; reordering is Up/Down per entry.

export function CriteriaPopover({
  title,
  initial,
  onApply,
  onClose,
}: {
  /** What the list is for: one ply, or a selection. */
  title: string;
  /** Primary first. */
  initial: CriterionId[];
  onApply: (criteria: CriterionId[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<CriterionId[]>(initial);
  const [adding, setAdding] = useState("");
  // After a move or removal the focus would fall to <body> with the button
  // that had it; it follows the entry instead.
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    if (!focusAfter.current) return;
    dialog.current?.querySelector<HTMLElement>(`[data-focus-key="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  });

  const move = (index: number, direction: -1 | 1) => {
    const id = list[index];
    const target = index + direction;
    setList(moveCriterion(list, index, direction));
    // Keep the pressed arrow under the focus while it still can move.
    const edge = target === 0 || target === list.length - 1;
    focusAfter.current = `${id}:${edge ? (direction < 0 ? "down" : "up") : direction < 0 ? "up" : "down"}`;
  };

  const remove = (index: number) => {
    const next = removeCriterion(list, index);
    setList(next);
    focusAfter.current = next.length > 0 ? `${next[Math.min(index, next.length - 1)]}:remove` : null;
  };

  const available = CRITERIA.filter((c) => !list.includes(c.id));

  return (
    <dialog
      ref={dialog}
      className="app-dialog criteria-dialog"
      aria-labelledby="criteria-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(list);
        }}
      >
        <h2 id="criteria-dialog-title">
          <ListChecks size={16} strokeWidth={1.75} />
          {title}
        </h2>
        <p className="hint">{t("criteria.explain")}</p>

        <ol className="criteria-list" aria-label={t("criteria.listLabel")}>
          {list.map((id, index) => {
            const name = criterionName(id, t);
            return (
              <li key={id} className="criteria-item">
                <span className="criteria-rank" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="criteria-name">
                  {name}
                  {index === 0 && (
                    <span className="criteria-badge" title={t("criteria.primaryTitle")}>
                      {t("criteria.primary")}
                    </span>
                  )}
                </span>
                <span className="criteria-actions">
                  <button
                    type="button"
                    className="icon-button"
                    data-focus-key={`${id}:up`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={t("criteria.moveUp", { name })}
                    title={t("criteria.moveUp", { name })}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-focus-key={`${id}:down`}
                    onClick={() => move(index, 1)}
                    disabled={index === list.length - 1}
                    aria-label={t("criteria.moveDown", { name })}
                    title={t("criteria.moveDown", { name })}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    data-focus-key={`${id}:remove`}
                    onClick={() => remove(index)}
                    disabled={list.length === 1}
                    aria-label={t("criteria.remove", { name })}
                    title={t("criteria.remove", { name })}
                  >
                    <X size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>

        <label className="criteria-add">
          <Plus size={14} aria-hidden="true" />
          <select
            value={adding}
            onChange={(e) => {
              const value = e.target.value as CriterionId;
              setAdding("");
              if (value) setList((l) => addCriterion(l, value));
            }}
            aria-label={t("criteria.add")}
          >
            <option value="">{t("criteria.add")}</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {t(c.labelKey)}
              </option>
            ))}
          </select>
        </label>
        {list.length > 1 && <p className="hint">{t("criteria.javaNote")}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("criteria.cancel")}
          </button>
          <button type="submit" className="primary">
            {t("criteria.apply")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
