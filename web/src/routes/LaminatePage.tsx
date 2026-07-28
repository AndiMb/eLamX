import { useEffect, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Layers, Plus, RotateCw, Trash2 } from "lucide-react";
import { laminateConfigFamily } from "../store/laminateAtoms";
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
import { CRITERIA, type CriterionId, type MaterialDto } from "../lib/types";
import { useT } from "../i18n";

export function LaminatePage() {
  const t = useT();
  const { laminateId } = useParams<{ laminateId: string }>();
  const id = laminateId!;
  const [config, setConfig] = useAtom(laminateConfigFamily(id));
  const materials = useAtomValue(materialsAtom);
  const [angleStackText, setAngleStackText] = useState("");
  const [rotateDelta, setRotateDelta] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMaterialChoice, setBulkMaterialChoice] = useState("");
  const [bulkCriterionChoice, setBulkCriterionChoice] = useState("");
  const [bulkAngle, setBulkAngle] = useState(0);
  const [bulkThickness, setBulkThickness] = useState(0);

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
    setConfig((c) => {
      const template = c.layers.at(-1);
      const thickness = template?.thickness ?? 0.2;
      const materialId = template?.materialId ?? materials[0]?.id ?? "";
      const criterionId = template?.criterionId ?? DEFAULT_CRITERION_ID;
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
          })),
        ],
      };
    });
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
    setConfig((c) => {
      const at = c.layers.findIndex((l) => l.id === layerId);
      const to = at + direction;
      if (at < 0 || to < 0 || to >= c.layers.length) return c;
      const layers = [...c.layers];
      [layers[at], layers[to]] = [layers[to], layers[at]];
      return { ...c, layers };
    });
  };

  // Stack ops from the Java original's "Aufbau bearbeiten" panel.
  const invertStack = () => {
    setConfig((c) => ({ ...c, layers: [...c.layers].reverse() }));
  };

  const rotateStack = () => {
    if (rotateDelta === 0) return;
    setConfig((c) => ({
      ...c,
      layers: c.layers.map((l) => ({ ...l, angle: normalizeLayerAngle(l.angle + rotateDelta) })),
    }));
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
  useEffect(() => {
    setBulkAngle(0);
    setBulkThickness(0);
  }, [selectionKey]);

  const toggleSelected = (layerId: string) => {
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
      layers: c.layers.map((l) => (selectedIds.has(l.id) ? { ...l, criterionId } : l)),
    }));
  };

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

  const bulkDelete = () => {
    setConfig((c) => ({ ...c, layers: c.layers.filter((l) => !selectedIds.has(l.id)) }));
    setSelectedIds(new Set());
  };

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

  const columns: ResponsiveTableColumn<LayerRow & { index: number }>[] = [
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
        <input type="text" value={l.name} onChange={(e) => updateLayerField(l.id, "name", e.target.value)} />
      ),
    },
    {
      key: "angle",
      label: t("layers.column.angle"),
      render: (l) => (
        <Quantity category="angle" value={l.angle} onChange={(v) => updateLayerField(l.id, "angle", v)} />
      ),
    },
    {
      key: "thickness",
      label: t("layers.column.thickness"),
      render: (l) => (
        <Quantity category="thickness" value={l.thickness} onChange={(v) => updateLayerField(l.id, "thickness", v)} />
      ),
    },
    {
      key: "material",
      label: t("layers.column.material"),
      render: (l) => (
        <select value={l.materialId} onChange={(e) => updateLayerField(l.id, "materialId", e.target.value)}>
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
      render: (l) => (
        <select
          value={l.criterionId}
          onChange={(e) => updateLayerField(l.id, "criterionId", e.target.value as CriterionId)}
        >
          {CRITERIA.map((c) => (
            <option key={c.id} value={c.id}>
              {t(c.labelKey)}
            </option>
          ))}
        </select>
      ),
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
                <ResponsiveTable
                  variant="records"
                  className="layer-table"
                  columns={columns}
                  rows={config.layers.map((l, index) => ({ ...l, index }))}
                  rowKey={(l) => l.id}
                />
              </>
            )}
          </section>

          <section className="panel">
            <ModuleList laminateId={id} />
          </section>
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
            <p className="hint">{t("layers.add.hint")}</p>
          </div>

          <div className="tool-group">
            <div className="tool-group-title">{t("layers.preview")}</div>
            <StackViz layers={config.layers} symmetric={config.symmetric} withMiddleLayer={config.withMiddleLayer} />
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
                <SafeNumberInput value={rotateDelta} onChange={setRotateDelta} />
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
    </>
  );
}
