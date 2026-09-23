import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardCopy, ClipboardPaste, Copy, Layers, ListChecks, Plus, RotateCw, Trash2 } from "lucide-react";
import { laminateConfigFamily, laminateExistsFamily } from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { Quantity } from "../components/Quantity";
import { SafeNumberInput } from "../components/SafeNumberInput";
import { BackLink } from "../components/BackLink";
import { ModuleList } from "../components/ModuleList";
import { StackViz } from "../components/StackViz";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ResponsiveTable";
import { normalizeLayerAngle, parseAngleStack } from "../lib/angleStack";
import { QuantityDisplay } from "../components/QuantityDisplay";
import { DEFAULT_CRITERION_ID, type LayerRow } from "../lib/constants";
import { layerSelectionFamily } from "../store/uiAtoms";
import {
  clickSelection,
  dropPlacement,
  duplicateBlock,
  inOrder,
  insertAt,
  moveBlock,
  pasteIndex,
  shiftBlock,
} from "../lib/layerOps";
import {
  layupClipboardData,
  parseClipboard,
  pasteDefaults,
  type ParsedLayup,
} from "../lib/layupClipboard";
import { isTextField } from "../lib/commands";
import { formatConfigFamily } from "../store/formatAtoms";
import { PasteLayupDialog, type PasteResult } from "../components/PasteLayupDialog";
import { historyStep } from "../lib/history";
import { registerCommand } from "../lib/commands";
import { t as translate, useLocale } from "../i18n";
import { DragHandle, SortableLayers, SortableRowShell } from "../components/SortableLayers";
import { LayerTableContext, type LayerTableState } from "../components/layerTableContext";
import { CRITERIA, criterionName, type CriterionId, type MaterialDto } from "../lib/types";
import { CriteriaPopover } from "../components/CriteriaPopover";
import { StackingRuleBadges } from "../components/StackingRuleBadges";
import { criteriaOf, withCriteria, withPrimary } from "../lib/criteriaList";
import { useT } from "../i18n";

export function LaminatePage() {
  const t = useT();
  const { laminateId } = useParams<{ laminateId: string }>();
  const exists = useAtomValue(laminateExistsFamily(laminateId ?? ""));

  if (!laminateId || !exists) {
    return <p className="empty-note">{t("laminate.notFound")}</p>;
  }
  return <LaminateEditor id={laminateId} />;
}

// Split from LaminatePage so its hooks only run for a laminate that is in the
// list: laminateConfigFamily answers any id, and editing that answer would
// store a laminate no list shows.
function LaminateEditor({ id }: { id: string }) {
  const t = useT();
  const [config, setConfig] = useAtom(laminateConfigFamily(id));
  const [materials, setMaterials] = useAtom(materialsAtom);
  const locale = useLocale();
  const store = useStore();
  // The paste dialog: closed (null), or open with what the clipboard held -
  // `parsed: null` when it was opened to type or paste into.
  const [pasteDraft, setPasteDraft] = useState<{ parsed: ParsedLayup | null } | null>(null);
  const [angleStackText, setAngleStackText] = useState("");
  const [rotateDelta, setRotateDelta] = useState(0);
  const [selectedIds, setSelectedIds] = useAtom(layerSelectionFamily(id));
  // The row a Shift+click extends from: the last one clicked without Shift.
  const anchor = useRef<string | null>(null);
  // The rows moving with a drag, while one is under way.
  const [dragging, setDragging] = useState<ReadonlySet<string> | null>(null);
  const [bulkMaterialChoice, setBulkMaterialChoice] = useState("");
  const [bulkCriterionChoice, setBulkCriterionChoice] = useState("");
  const [bulkAngle, setBulkAngle] = useState(0);
  const [bulkThickness, setBulkThickness] = useState(0);
  // The criteria list being edited: for one ply or for the selection.
  const [criteriaEdit, setCriteriaEdit] = useState<{ layerIds: string[]; title: string } | null>(null);

  const updateLayerField = <K extends keyof LayerRow>(layerId: string, key: K, value: LayerRow[K]) => {
    // Ply angles are conventionally reduced to [-90, 90] (see normalizeLayerAngle).
    const normalized = key === "angle" ? (normalizeLayerAngle(value as number) as LayerRow[K]) : value;
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => (l.id === layerId ? { ...l, [key]: normalized } : l)),
    }));
  };

  // Multi-angle add (Java LaminateStringParser counterpart): "0/45/-45/90"
  // appends 4 layers; name/thickness/material/criterion come from the last
  // existing layer (template), matching the existing thickness/material
  // inheritance behavior.
  const addLayers = () => {
    const angles = parseAngleStack(angleStackText || "0");
    if (!angles) return;
    historyStep(t("history.label.added"), () => setConfig((c) => {
      const template = c.layers.at(-1);
      const thickness = template?.thickness ?? 0.2;
      const materialId = template?.materialId ?? materials[0]?.id ?? "";
      const criterionId = template?.criterionId ?? DEFAULT_CRITERION_ID;
      const extra = template?.extraCriteria ? { extraCriteria: template.extraCriteria } : {};
      const startNr = c.layers.length + 1;
      return {
        ...c,
        layers: [
          ...c.layers,
          ...angles.map((angle, i) => ({
            id: crypto.randomUUID(),
            name: t("default.layerName", { nr: startNr + i }),
            angle: normalizeLayerAngle(angle),
            thickness,
            materialId,
            criterionId,
            ...extra,
          })),
        ],
      };
    }));
    setAngleStackText("");
  };

  const removeLayer = (layerId: string) => {
    setConfig((c) => ({ ...c, layers: c.layers.filter((l) => l.id !== layerId) }));
    setSelectedIds((prev) => {
      if (!prev.has(layerId)) return prev;
      const next = new Set(prev);
      next.delete(layerId);
      return next;
    });
  };

  const duplicateLayer = (layerId: string) => {
    setConfig((c) => {
      const at = c.layers.findIndex((l) => l.id === layerId);
      if (at < 0) return c;
      const copy = {
        ...c.layers[at],
        id: crypto.randomUUID(),
        name: t("default.copy", { name: c.layers[at].name }),
      };
      return { ...c, layers: [...c.layers.slice(0, at + 1), copy, ...c.layers.slice(at + 1)] };
    });
  };

  const moveLayer = (layerId: string, direction: -1 | 1) => {
    historyStep(t("history.label.moved"), () =>
      setConfig((c) => ({ ...c, layers: shiftBlock(c.layers, new Set([layerId]), direction) })),
    );
  };

  // Alt+Up/Down: the selected rows, or - with nothing selected - the row the
  // focus is in, so the keys work straight from a ply's angle field.
  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      let ids: ReadonlySet<string> = selectedIds;
      if (ids.size === 0) {
        const row = (document.activeElement as HTMLElement | null)?.closest("[data-layer-id]");
        const focusedId = row?.getAttribute("data-layer-id");
        if (!focusedId) return;
        ids = new Set([focusedId]);
      }
      historyStep(translate("history.label.moved"), () =>
        setConfig((c) => ({ ...c, layers: shiftBlock(c.layers, ids, direction) })),
      );
    },
    [selectedIds, setConfig],
  );

  useEffect(() => {
    const stops = [
      registerCommand({
        id: "layers.moveUp",
        label: "command.layers.moveUp",
        shortcut: "Alt+ArrowUp",
        run: () => moveSelection(-1),
      }),
      registerCommand({
        id: "layers.moveDown",
        label: "command.layers.moveDown",
        shortcut: "Alt+ArrowDown",
        run: () => moveSelection(1),
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [moveSelection]);

  // A drag moves the dragged row - and, when it is one of several selected
  // rows, all of them, closed up into one block where it is dropped.
  const blockFor = (activeId: string): ReadonlySet<string> =>
    selectedIds.has(activeId) && selectedIds.size > 1 ? selectedIds : new Set([activeId]);

  const dropLayers = (activeId: string, overId: string) => {
    const block = blockFor(activeId);
    setDragging(null);
    historyStep(t("history.label.moved"), () =>
      setConfig((c) => ({
        ...c,
        layers: moveBlock(c.layers, block, overId, dropPlacement(c.layers, activeId, overId)),
      })),
    );
  };

  const onRowClick = (layerId: string, event: MouseEvent) => {
    const next = clickSelection(
      config.layers.map((l) => l.id),
      selectedIds,
      anchor.current,
      layerId,
      { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey },
    );
    anchor.current = next.anchor;
    setSelectedIds(next.selection);
  };

  // Stack ops from the Java original's "Aufbau bearbeiten" panel.
  const invertStack = () => {
    historyStep(t("history.label.inverted"), () =>
      setConfig((c) => ({ ...c, layers: [...c.layers].reverse() })),
    );
  };

  const rotateStack = () => {
    if (rotateDelta === 0) return;
    historyStep(t("history.label.rotated"), () =>
      setConfig((c) => ({
        ...c,
        layers: c.layers.map((l) => ({ ...l, angle: normalizeLayerAngle(l.angle + rotateDelta) })),
      })),
    );
  };

  // Bulk edit of selected layers: change material or failure criterion for
  // every currently-checked row at once. Selection is intersected with the
  // CURRENT layer list everywhere (rather than trusted as-is) so a layer
  // removed via its own row action can't leave a stale, inflated
  // "N selected" count behind.
  const selectedLayerIds = config.layers.filter((l) => selectedIds.has(l.id)).map((l) => l.id);
  const selectedCount = selectedLayerIds.length;
  const allSelected = config.layers.length > 0 && selectedCount === config.layers.length;

  // The bulk-angle/-thickness fields otherwise would keep showing whatever
  // value was last typed for a PREVIOUS selection - resetting the display to
  // 0 on every selection change makes clear it's a fresh "set to..." action,
  // not a reflection of the newly-selected layers' current values.
  const selectionKey = selectedLayerIds.join(",");
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey);
  if (selectionKey !== lastSelectionKey) {
    // During render, not in an effect: the fields would otherwise show the
    // previous selection's numbers for one commit before being cleared.
    setLastSelectionKey(selectionKey);
    setBulkAngle(0);
    setBulkThickness(0);
  }

  const toggleSelected = (layerId: string) => {
    anchor.current = layerId;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(config.layers.map((l) => l.id)));
  };

  const bulkSetMaterial = (materialId: string) => {
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => (selectedIds.has(l.id) ? { ...l, materialId } : l)),
    }));
  };

  const bulkSetCriterion = (criterionId: CriterionId) => {
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => (selectedIds.has(l.id) ? withPrimary(l, criterionId) : l)),
    }));
  };

  // The whole list, for one ply or for every selected one: one undo step.
  const applyCriteria = (layerIds: readonly string[], list: CriterionId[]) => {
    const targets = new Set(layerIds);
    historyStep(t("history.label.criteria"), () =>
      setConfig((c) => ({
        ...c,
        layers: c.layers.map((l) => (targets.has(l.id) ? withCriteria(l, list) : l)),
      })),
    );
    setCriteriaEdit(null);
  };
  const plyCriteriaEdit = (l: LayerRow & { index: number }) =>
    setCriteriaEdit({ layerIds: [l.id], title: t("criteria.titlePly", { nr: l.index + 1, name: l.name }) });

  // Angle/thickness apply directly on every keystroke, same as a single
  // layer's own field - no separate "Anwenden" step. There's no stale-value
  // footgun here: unlike a button that could be clicked without editing the
  // field first, applying only ever happens as a direct consequence of the
  // user typing a new value.
  const bulkSetAngle = (value: number) => {
    const angle = normalizeLayerAngle(value);
    setBulkAngle(angle);
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => (selectedIds.has(l.id) ? { ...l, angle } : l)),
    }));
  };

  const bulkSetThickness = (thickness: number) => {
    setBulkThickness(thickness);
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => (selectedIds.has(l.id) ? { ...l, thickness } : l)),
    }));
  };

  // --- clipboard, duplicate, delete on the selection (F1.3, F1.4) ---

  const selectedLayers = inOrder(config.layers, selectedIds);

  const clipboardData = () =>
    layupClipboardData(selectedLayers, materials, {
      locale,
      formats: (category) => store.get(formatConfigFamily(category)),
    });

  const deleteSelected = (label: string) => {
    if (selectedLayers.length === 0) return;
    const doomed = new Set(selectedLayers.map((l) => l.id));
    historyStep(label, () => setConfig((c) => ({ ...c, layers: c.layers.filter((l) => !doomed.has(l.id)) })));
    setSelectedIds(new Set());
  };

  const duplicateSelected = () => {
    if (selectedLayers.length === 0) return;
    let copies: LayerRow[] = [];
    historyStep(t("history.label.duplicated"), () =>
      setConfig((c) => {
        const result = duplicateBlock(c.layers, selectedIds, (l) => ({
          ...l,
          id: crypto.randomUUID(),
          name: t("default.copy", { name: l.name }),
        }));
        copies = result.copies;
        return { ...c, layers: result.items };
      }),
    );
    setSelectedIds(new Set(copies.map((l) => l.id)));
  };

  const applyPaste = (result: PasteResult) => {
    historyStep(t("history.label.pasted"), () => {
      if (result.newMaterials.length > 0) setMaterials((m) => [...m, ...result.newMaterials]);
      setConfig((c) => ({
        ...c,
        layers: insertAt(c.layers, result.layers, pasteIndex(c.layers, selectedIds)),
        ...(result.symmetry ?? {}),
      }));
    });
    setSelectedIds(new Set(result.layers.map((l) => l.id)));
    setPasteDraft(null);
  };

  // The clipboard keys arrive as the page's own copy, cut and paste events -
  // in the browser from Ctrl+C/X/V, in the desktop shell from its menu - and
  // those carry the data, where the async clipboard API would ask for a
  // permission first. They are the table's only while no text field has the
  // focus and no text on the page is selected: then they are the text's.
  const clipboardIsOurs = () => {
    if (pasteDraft) return false;
    if (isTextField(document.activeElement as HTMLElement | null)) return false;
    const selection = window.getSelection();
    return !selection || selection.isCollapsed;
  };
  const clipboardHandlers = useRef({ copy: (_e: ClipboardEvent) => {}, cut: (_e: ClipboardEvent) => {}, paste: (_e: ClipboardEvent) => {} });
  useEffect(() => {
    clipboardHandlers.current = {
      copy: (e) => {
        if (!clipboardIsOurs() || selectedLayers.length === 0 || !e.clipboardData) return;
        const { text, html } = clipboardData();
        e.clipboardData.setData("text/plain", text);
        e.clipboardData.setData("text/html", html);
        e.preventDefault();
      },
      cut: (e) => {
        if (!clipboardIsOurs() || selectedLayers.length === 0 || !e.clipboardData) return;
        const { text, html } = clipboardData();
        e.clipboardData.setData("text/plain", text);
        e.clipboardData.setData("text/html", html);
        e.preventDefault();
        deleteSelected(t("history.label.cut"));
      },
      paste: (e) => {
        if (!clipboardIsOurs() || !e.clipboardData) return;
        const parsed = parseClipboard({
          html: e.clipboardData.getData("text/html"),
          text: e.clipboardData.getData("text/plain"),
        });
        if (!parsed) return;
        e.preventDefault();
        setPasteDraft({ parsed });
      },
    };
  });
  useEffect(() => {
    const on = (kind: "copy" | "cut" | "paste") => (e: ClipboardEvent) => clipboardHandlers.current[kind](e);
    const handlers = { copy: on("copy"), cut: on("cut"), paste: on("paste") };
    for (const kind of ["copy", "cut", "paste"] as const) document.addEventListener(kind, handlers[kind]);
    return () => {
      for (const kind of ["copy", "cut", "paste"] as const) document.removeEventListener(kind, handlers[kind]);
    };
  }, []);

  // The same actions by name, for the palette and the keys the browser does
  // not turn into events. The palette's copy and paste go through the async
  // clipboard API; where that is refused, paste falls back to the dialog's
  // own text field.
  const actions = useRef({
    hasSelection: false,
    copy: () => {},
    cut: () => {},
    paste: () => {},
    duplicate: () => {},
    remove: () => {},
    selectAll: () => {},
  });
  useEffect(() => {
    const writeClipboard = async () => {
      const { text, html } = clipboardData();
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
    };
    actions.current = {
      hasSelection: selectedLayers.length > 0,
      copy: () => void writeClipboard().catch(() => {}),
      cut: () =>
        void writeClipboard()
          .then(() => deleteSelected(t("history.label.cut")))
          .catch(() => {}),
      paste: () => {
        const read = async (): Promise<ParsedLayup | null> => {
          const items = await navigator.clipboard.read();
          let html = "";
          let text = "";
          for (const item of items) {
            if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
            if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
          }
          return parseClipboard({ html, text });
        };
        read()
          .then((parsed) => setPasteDraft({ parsed }))
          .catch(() => setPasteDraft({ parsed: null }));
      },
      duplicate: duplicateSelected,
      remove: () => deleteSelected(t("history.label.deleted")),
      selectAll: () => setSelectedIds(new Set(config.layers.map((l) => l.id))),
    };
  });
  useEffect(() => {
    const hasSelection = () => actions.current.hasSelection;
    const stops = [
      registerCommand({ id: "layers.copy", label: "command.layers.copy", when: hasSelection, run: () => actions.current.copy() }),
      registerCommand({ id: "layers.cut", label: "command.layers.cut", when: hasSelection, run: () => actions.current.cut() }),
      registerCommand({ id: "layers.paste", label: "command.layers.paste", run: () => actions.current.paste() }),
      registerCommand({
        id: "layers.duplicate",
        label: "command.layers.duplicate",
        // Ctrl+D would otherwise bookmark the page.
        shortcut: "Mod+D",
        when: hasSelection,
        run: () => actions.current.duplicate(),
      }),
      registerCommand({
        id: "layers.delete",
        label: "command.layers.delete",
        shortcut: "Delete",
        // Delete in a text field deletes text, typed into or not.
        fieldOwnsKey: true,
        when: hasSelection,
        run: () => actions.current.remove(),
      }),
      registerCommand({
        id: "layers.selectAll",
        label: "command.layers.selectAll",
        shortcut: "Mod+A",
        fieldOwnsKey: true,
        run: () => actions.current.selectAll(),
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  const bulkDelete = () => {
    historyStep(t("history.label.deleted"), () =>
      setConfig((c) => ({ ...c, layers: c.layers.filter((l) => !selectedIds.has(l.id)) })),
    );
    setSelectedIds(new Set());
  };

  const tableState: LayerTableState = { selected: selectedIds, dragging, onRowClick };
  const withExtraCount = config.layers.filter((l) => (l.extraCriteria ?? []).length > 0).length;

  // Editor info line (Java "Informationen" panel): totals across the
  // EXPANDED stack, mirroring the core's symmetric/middle-layer expansion.
  const baseThickness = config.layers.reduce((s, l) => s + l.thickness, 0);
  const lastThickness = config.layers.at(-1)?.thickness ?? 0;
  const totalThickness = config.symmetric
    ? 2 * baseThickness - (config.withMiddleLayer ? lastThickness : 0)
    : baseThickness;
  const totalLayers = config.symmetric
    ? 2 * config.layers.length - (config.withMiddleLayer ? 1 : 0)
    : config.layers.length;

  // A cell in a table is named by its column header for anyone who can see the
  // header, and by nothing at all for a screen reader. Sixteen plies were 82
  // fields announced as "edit text".
  const fieldLabel = (field: string, index: number) =>
    `${field}, ${t("layers.aria.ply", { nr: index + 1 })}`;

  const columns: ResponsiveTableColumn<LayerRow & { index: number }>[] = [
    {
      key: "handle",
      label: "",
      // A card has its handle in its summary, where it can be reached closed.
      hideInCards: true,
      render: (l) => <DragHandle label={t("layers.dnd.handle", { nr: l.index + 1 })} />,
    },
    {
      key: "select",
      label: "",
      render: (l) => (
        <input
          type="checkbox"
          checked={selectedIds.has(l.id)}
          onChange={() => toggleSelected(l.id)}
          aria-label={t("layers.select", { name: l.name })}
        />
      ),
    },
    { key: "nr", label: t("layers.column.nr"), render: (l) => l.index + 1 },
    {
      key: "name",
      label: t("common.name"),
      render: (l) => (
        <input
          type="text"
          value={l.name}
          aria-label={fieldLabel(t("common.name"), l.index)}
          onChange={(e) => updateLayerField(l.id, "name", e.target.value)}
        />
      ),
    },
    {
      key: "angle",
      label: t("layers.column.angle"),
      render: (l) => (
        <Quantity
          category="angle"
          value={l.angle}
          aria-label={fieldLabel(t("layers.column.angle"), l.index)}
          onChange={(v) => updateLayerField(l.id, "angle", v)}
        />
      ),
    },
    {
      key: "thickness",
      label: t("layers.column.thickness"),
      render: (l) => (
        <Quantity
          category="thickness"
          value={l.thickness}
          aria-label={fieldLabel(t("layers.column.thickness"), l.index)}
          onChange={(v) => updateLayerField(l.id, "thickness", v)}
        />
      ),
    },
    {
      key: "material",
      label: t("layers.column.material"),
      render: (l) => (
        <select
          value={l.materialId}
          aria-label={fieldLabel(t("layers.column.material"), l.index)}
          onChange={(e) => updateLayerField(l.id, "materialId", e.target.value)}
        >
          {materials.map((m: MaterialDto) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "criterion",
      label: t("layers.column.criterion"),
      render: (l) => {
        const extra = l.extraCriteria ?? [];
        const names = criteriaOf(l).map((id) => criterionName(id, t)).join(", ");
        return (
          <span className="criterion-cell">
            <select
              value={l.criterionId}
              aria-label={fieldLabel(t("layers.column.criterion"), l.index)}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  layers: c.layers.map((row) =>
                    row.id === l.id ? withPrimary(row, e.target.value as CriterionId) : row,
                  ),
                }))
              }
            >
              {CRITERIA.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(c.labelKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={extra.length > 0 ? "criteria-count has-extra" : "criteria-count"}
              onClick={() => plyCriteriaEdit(l)}
              aria-label={t("criteria.open", { nr: l.index + 1, list: names })}
              title={extra.length > 0 ? names : t("criteria.addTitle")}
            >
              {extra.length > 0 ? `+${extra.length}` : <ListChecks size={14} aria-hidden="true" />}
            </button>
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "",
      render: (l) => (
        <span className="row-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => moveLayer(l.id, -1)}
            disabled={l.index === 0}
            aria-label={t("layers.moveUp")}
            title={t("layers.moveUp")}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => moveLayer(l.id, 1)}
            disabled={l.index === config.layers.length - 1}
            aria-label={t("layers.moveDown")}
            title={t("layers.moveDown")}
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => duplicateLayer(l.id)}
            aria-label={t("layers.duplicate")}
            title={t("layers.duplicate")}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="icon-button danger"
            onClick={() => removeLayer(l.id)}
            aria-label={t("layers.delete")}
            title={t("layers.delete")}
          >
            <Trash2 size={14} />
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <BackLink to="/" label={t("nav.laminates")} />
      {/* The visible hierarchy starts at the editor panel's h2; this is the
          page's level-one heading for anyone navigating by them. */}
      <h1 className="visually-hidden">{config.name}</h1>
      <div className="editor-layout">
        {/* Both cards stacked in one column, sized to their own content - the
            module list sits directly under the table (rather than as a
            separate full-width section) so this column's total height keeps
            pace with the sidebar's, instead of leaving a tall dead zone
            beneath a short table. */}
        <div className="editor-main-column">
          <section className="editor-main">
            <h2>
              <Layers size={16} strokeWidth={1.75} />
              {t("layers.title")}
            </h2>
            <label className="material-name compact">
              {t("common.name")}
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
              />
            </label>

            {config.layers.length === 0 ? (
              <div className="empty-state">
                <Layers size={32} strokeWidth={1.25} />
                <p>{t("layers.empty")}</p>
              </div>
            ) : (
              <>
                <div className="bulk-toolbar">
                  <label className="bulk-select-all">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    {t("layers.selectAll")}
                  </label>
                  {selectedCount > 0 && (
                    <>
                      <span className="hint" style={{ margin: 0 }}>
                        {/* Both catalog languages have exactly two plural
                            forms, so an explicit one/other key pair beats
                            pulling in Intl.PluralRules machinery here. */}
                        {t(selectedCount === 1 ? "layers.selected.one" : "layers.selected.other", {
                          count: selectedCount,
                        })}
                      </span>
                      <span className="bulk-angle">
                        <Quantity
                          category="angle"
                          value={bulkAngle}
                          onChange={bulkSetAngle}
                          aria-label={t("layers.bulk.setAngle")}
                        />
                      </span>
                      <span className="bulk-thickness">
                        <Quantity
                          category="thickness"
                          value={bulkThickness}
                          onChange={bulkSetThickness}
                          aria-label={t("layers.bulk.setThickness")}
                        />
                      </span>
                      <select
                        value={bulkMaterialChoice}
                        onChange={(e) => {
                          const value = e.target.value;
                          setBulkMaterialChoice("");
                          if (value) bulkSetMaterial(value);
                        }}
                        aria-label={t("layers.bulk.setMaterial")}
                      >
                        <option value="" disabled>
                          {t("layers.bulk.materialPlaceholder")}
                        </option>
                        {materials.map((m: MaterialDto) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={bulkCriterionChoice}
                        onChange={(e) => {
                          const value = e.target.value;
                          setBulkCriterionChoice("");
                          if (value) bulkSetCriterion(value as CriterionId);
                        }}
                        aria-label={t("layers.bulk.setCriterion")}
                      >
                        <option value="" disabled>
                          {t("layers.bulk.criterionPlaceholder")}
                        </option>
                        {CRITERIA.map((c) => (
                          <option key={c.id} value={c.id}>
                            {t(c.labelKey)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="icon-button"
                        // Starts from the first selected ply's list; applying
                        // gives every selected ply that same list.
                        onClick={() =>
                          setCriteriaEdit({
                            layerIds: selectedLayerIds,
                            title: t("criteria.titleSelection", { count: selectedCount }),
                          })
                        }
                        aria-label={t("layers.bulk.criteria")}
                        title={t("layers.bulk.criteria")}
                      >
                        <ListChecks size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => actions.current.copy()}
                        aria-label={t("layers.copy")}
                        title={t("layers.copy")}
                      >
                        <ClipboardCopy size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={bulkDelete}
                        aria-label={t("layers.bulk.delete")}
                        title={t("layers.bulk.delete")}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
                {/* The whole stack in one picture, above the list rather than
                    below it. The right rail holds the same drawing on a wide
                    screen; on a narrow one the rail sits after 16 ply cards,
                    which is where it helps least. */}
                <div className="layer-strip">
                  <StackViz
                    layers={config.layers}
                    symmetric={config.symmetric}
                    withMiddleLayer={config.withMiddleLayer}
                    compact
                  />
                </div>
                <StackingRuleBadges laminateId={id} />
                <LayerTableContext.Provider value={tableState}>
                  <SortableLayers
                    ids={config.layers.map((l) => l.id)}
                    onDragStart={(activeId) => setDragging(blockFor(activeId))}
                    onMove={dropLayers}
                    onDragCancel={() => setDragging(null)}
                  >
                    <ResponsiveTable
                      variant="records"
                      className="layer-table"
                      columns={columns}
                      rows={config.layers.map((l, index) => ({ ...l, index }))}
                      rowKey={(l) => l.id}
                      RowShell={SortableRowShell}
                      cardSummary={(l) => (
                        <>
                          <DragHandle label={t("layers.dnd.handle", { nr: l.index + 1 })} />
                          <span className="ply-nr">{l.index + 1}</span>
                          <span className="ply-angle">
                            <QuantityDisplay category="angle" value={l.angle} />
                          </span>
                          <span className="ply-thickness">
                            <QuantityDisplay category="thickness" value={l.thickness} />
                          </span>
                          <span className="ply-name">{l.name}</span>
                        </>
                      )}
                    />
                  </SortableLayers>
                </LayerTableContext.Provider>
                {config.symmetric && <p className="hint layer-symmetric-hint">{t("layers.symmetricHint")}</p>}
                {withExtraCount > 0 && (
                  <p className="hint criteria-java-hint">
                    <ListChecks size={14} aria-hidden="true" />
                    {t(withExtraCount === 1 ? "criteria.javaHint.one" : "criteria.javaHint.other", {
                      count: withExtraCount,
                    })}
                  </p>
                )}
              </>
            )}
          </section>

          <ModuleList scope="laminate" ownerId={id} />
        </div>

        {/* Sticky (desktop only, see App.css breakpoint): with many layers the
            table can grow far taller than the viewport, so the tools -
            above all "add layer", the most-used action - must stay
            reachable without scrolling back up to them every time. */}
        <aside className="editor-side">
          <div className="tool-group">
            <div className="tool-group-title">{t("layers.add.title")}</div>
            <div className="add-layer-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder={t("layers.add.placeholder")}
                value={angleStackText}
                onChange={(e) => setAngleStackText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addLayers();
                }}
                aria-label={t("layers.add.aria")}
              />
            </div>
            <button
              type="button"
              onClick={addLayers}
              disabled={angleStackText !== "" && !parseAngleStack(angleStackText)}
            >
              <Plus size={16} /> {t("layers.add.button")}
            </button>
            <button type="button" onClick={() => setPasteDraft({ parsed: null })}>
              <ClipboardPaste size={16} /> {t("paste.open")}
            </button>
            <p className="hint">{t("layers.add.hint")}</p>
          </div>

          <div className="tool-group">
            <div className="tool-group-title">{t("layers.preview")}</div>
            <StackViz
              layers={config.layers}
              symmetric={config.symmetric}
              withMiddleLayer={config.withMiddleLayer}
              controls
            />
            <p className="stack-info">
              {t("layers.totalThickness")}: <QuantityDisplay category="thickness" value={totalThickness} /> ·{" "}
              {totalLayers} {t(totalLayers === 1 ? "layers.count.one" : "layers.count.other")}
              {config.symmetric ? t("layers.mirrorNote") : ""}
            </p>
          </div>

          <div className="tool-group">
            <div className="tool-group-title">{t("layers.editStack")}</div>
            <button type="button" onClick={invertStack} disabled={config.layers.length < 2}>
              <ArrowUpDown size={16} /> {t("layers.invert")}
            </button>
            <div className="stack-ops">
              <button type="button" onClick={rotateStack} disabled={config.layers.length === 0 || rotateDelta === 0}>
                <RotateCw size={16} /> {t("layers.rotateBy")}
              </button>
              <span className="rotate-field">
                <SafeNumberInput
                  value={rotateDelta}
                  aria-label={t("layers.rotateBy")}
                  onChange={setRotateDelta}
                />
              </span>
              <span className="hint" style={{ margin: 0 }}>
                °
              </span>
            </div>
          </div>

          <div className="tool-group">
            <div className="tool-group-title">{t("layers.symmetryGroup")}</div>
            <div className="flags vertical">
              <label>
                <input
                  type="checkbox"
                  checked={config.symmetric}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      symmetric: e.target.checked,
                      withMiddleLayer: e.target.checked ? c.withMiddleLayer : false,
                    }))
                  }
                />
                {t("layers.symmetric")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.withMiddleLayer}
                  disabled={!config.symmetric}
                  onChange={(e) => setConfig((c) => ({ ...c, withMiddleLayer: e.target.checked }))}
                />
                {t("layers.withMiddleLayer")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.invertZ}
                  onChange={(e) => setConfig((c) => ({ ...c, invertZ: e.target.checked }))}
                />
                {t("layers.invertZ")}
              </label>
            </div>
          </div>
        </aside>
      </div>
      {criteriaEdit && (
        <CriteriaPopover
          title={criteriaEdit.title}
          initial={criteriaOf(
            config.layers.find((l) => l.id === criteriaEdit.layerIds[0]) ?? {
              criterionId: DEFAULT_CRITERION_ID,
            },
          )}
          onApply={(list) => applyCriteria(criteriaEdit.layerIds, list)}
          onClose={() => setCriteriaEdit(null)}
        />
      )}
      {pasteDraft && (
        <PasteLayupDialog
          initial={pasteDraft.parsed}
          materials={materials}
          defaults={pasteDefaults(config.layers, selectedIds, materials)}
          laminateEmpty={config.layers.length === 0}
          onApply={applyPaste}
          onClose={() => setPasteDraft(null)}
        />
      )}
    </>
  );
}
