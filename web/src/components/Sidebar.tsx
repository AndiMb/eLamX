import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { NavLink, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Diamond,
  Droplet,
  Layers,
  Plus,
  Ruler,
  Spline,
  Trash2,
} from "lucide-react";
import {
  addLaminateAtom,
  duplicateLaminateAtom,
  laminateConfigFamily,
  laminateIdsAtom,
  removeLaminateAtom,
  usedMaterialIdsAtom,
} from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import {
  dependentMaterialsAtom,
  fibresAtom,
  matricesAtom,
} from "../store/micromechanicsAtoms";
import { expandedLaminateIdsAtom } from "../store/uiAtoms";
import { defaultFibre, defaultMaterial, defaultMatrix } from "../lib/constants";
import { modulePath, modulesOfScope } from "../lib/moduleRegistry";
import { useT } from "../i18n";

// Inline rename on double-click (UI-Konzept §4/§6): Enter commits, Escape
// reverts, blur commits. Shared by laminate and material nodes.
function RenameableLabel({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (!editing) {
    return (
      <span
        className="tree-node-label"
        onDoubleClick={(e) => {
          e.preventDefault();
          setDraft(name);
          setEditing(true);
        }}
        title={t("tree.renameHint", { name })}
      >
        {name}
      </span>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <input
      type="text"
      className="tree-rename-input"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      onClick={(e) => e.preventDefault()}
      aria-label={t("tree.rename")}
    />
  );
}

function LaminateTreeItem({ id }: { id: string }) {
  const t = useT();
  const [config, setConfig] = useAtom(laminateConfigFamily(id));
  const [expandedIds, setExpandedIds] = useAtom(expandedLaminateIdsAtom);
  const removeLaminate = useSetAtom(removeLaminateAtom);
  const duplicateLaminate = useSetAtom(duplicateLaminateAtom);
  const navigate = useNavigate();
  const expanded = expandedIds.has(id);

  const toggleExpanded = () => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleRemove = () => {
    removeLaminate(id);
    navigate("/");
  };

  const handleDuplicate = () => {
    const newId = duplicateLaminate(id);
    navigate(`/laminates/${newId}`);
  };

  return (
    <li>
      <div className="tree-node-row">
        <button
          type="button"
          className="tree-expand"
          onClick={toggleExpanded}
          aria-label={expanded ? t("tree.collapse") : t("tree.expand")}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <NavLink to={`/laminates/${id}`} className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}>
          <Layers size={16} strokeWidth={1.75} />
          <RenameableLabel name={config.name} onRename={(name) => setConfig((c) => ({ ...c, name }))} />
        </NavLink>
        <span className="tree-node-actions">
          <button
            type="button"
            className="icon-button"
            onClick={handleDuplicate}
            aria-label={t("laminate.duplicate")}
            title={t("laminate.duplicate")}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="icon-button danger"
            onClick={handleRemove}
            aria-label={t("laminate.delete")}
            title={t("laminate.delete")}
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>
      {expanded && (
        <ul className="tree-children">
          {modulesOfScope("laminate").map((mod) => {
            const Icon = mod.icon;
            return (
              <li key={mod.id}>
                <div className="tree-node-row">
                  <NavLink
                    to={modulePath(mod, id)}
                    className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="tree-node-label">{t(mod.labelKey)}</span>
                  </NavLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * The fibres and the matrices, as two lists of the same shape.
 *
 * They sit under the materials because that is what they are for: a fibre is
 * not a ply material and appears in no laminate - it exists to be combined
 * with a matrix into one. Kept out of the materials list for the same reason,
 * and out of the laminates entirely.
 *
 * A constituent a material is built on cannot be deleted; the button says
 * which materials are in the way rather than just refusing.
 */
function ConstituentSection<T extends { id: string; name: string }>({
  title,
  addLabel,
  route,
  icon: Icon,
  items,
  setItems,
  create,
}: {
  title: string;
  addLabel: string;
  route: string;
  icon: typeof Diamond;
  items: T[];
  setItems: (update: (items: T[]) => T[]) => void;
  create: (nr: number) => T;
}) {
  const t = useT();
  const navigate = useNavigate();
  const dependentsOf = useAtomValue(dependentMaterialsAtom);

  const add = () => {
    const created = create(items.length + 1);
    setItems((list) => [...list, created]);
    navigate(`${route}/${created.id}`);
  };

  return (
    <section className="tree-section">
      <div className="tree-section-header">
        <h3>{title}</h3>
        <button
          type="button"
          className="icon-button"
          onClick={add}
          aria-label={addLabel}
          title={addLabel}
        >
          <Plus size={16} />
        </button>
      </div>
      <ul className="tree-list">
        {items.map((item) => {
          const dependents = dependentsOf(item.id);
          return (
            <li key={item.id}>
              <div className="tree-node-row">
                <NavLink
                  to={`${route}/${item.id}`}
                  className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}
                >
                  <Icon size={16} strokeWidth={1.75} />
                  <RenameableLabel
                    name={item.name}
                    onRename={(name) =>
                      setItems((list) =>
                        list.map((entry) => (entry.id === item.id ? { ...entry, name } : entry)),
                      )
                    }
                  />
                </NavLink>
                <span className="tree-node-actions">
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => setItems((list) => list.filter((entry) => entry.id !== item.id))}
                    disabled={dependents.length > 0}
                    aria-label={t("constituent.delete")}
                    title={
                      dependents.length > 0
                        ? t("constituent.usedBy", {
                            count: dependents.length,
                            names: dependents.map((m) => m.name).join(", "),
                          })
                        : t("constituent.delete")
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Sidebar() {
  const t = useT();
  const laminateIds = useAtomValue(laminateIdsAtom);
  const [materials, setMaterials] = useAtom(materialsAtom);
  const [fibres, setFibres] = useAtom(fibresAtom);
  const [matrices, setMatrices] = useAtom(matricesAtom);
  // Which materials show their modules. Session state like the laminates'
  // (see expandedLaminateIdsAtom), not part of the document.
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(new Set());

  const toggleMaterial = (id: string) =>
    setExpandedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const usedMaterialIds = useAtomValue(usedMaterialIdsAtom);
  const addLaminate = useSetAtom(addLaminateAtom);
  const navigate = useNavigate();

  const handleAddLaminate = () => {
    const id = addLaminate(materials[0]?.id ?? "");
    navigate(`/laminates/${id}`);
  };

  const handleAddMaterial = () => {
    const newMaterial = { ...defaultMaterial(), name: t("default.materialName", { nr: materials.length + 1 }) };
    setMaterials((ms) => [...ms, newMaterial]);
    navigate(`/materials/${newMaterial.id}`);
  };

  const handleDuplicateMaterial = (id: string) => {
    const source = materials.find((m) => m.id === id);
    if (!source) return;
    const copy = {
      ...source,
      id: crypto.randomUUID(),
      name: t("default.copy", { name: source.name }),
      additional_values: { ...source.additional_values },
    };
    setMaterials((ms) => {
      const at = ms.findIndex((m) => m.id === id);
      return [...ms.slice(0, at + 1), copy, ...ms.slice(at + 1)];
    });
    navigate(`/materials/${copy.id}`);
  };

  const handleRemoveMaterial = (id: string) => {
    if (materials.length <= 1 || usedMaterialIds.has(id)) return;
    setMaterials((ms) => ms.filter((m) => m.id !== id));
    navigate("/");
  };

  const renameMaterial = (id: string, name: string) => {
    setMaterials((ms) => ms.map((m) => (m.id === id ? { ...m, name } : m)));
  };

  return (
    <nav className="sidebar">
      <section className="tree-section">
        <div className="tree-section-header">
          <h3>{t("nav.laminates")}</h3>
          <button
            type="button"
            className="icon-button"
            onClick={handleAddLaminate}
            aria-label={t("laminate.add")}
            title={t("laminate.add")}
          >
            <Plus size={16} />
          </button>
        </div>
        <ul className="tree-list">
          {laminateIds.map((id) => (
            <LaminateTreeItem key={id} id={id} />
          ))}
        </ul>
      </section>

      <section className="tree-section">
        <div className="tree-section-header">
          <h3>{t("nav.materials")}</h3>
          <button
            type="button"
            className="icon-button"
            onClick={handleAddMaterial}
            aria-label={t("material.add")}
            title={t("material.add")}
          >
            <Plus size={16} />
          </button>
        </div>
        <ul className="tree-list">
          {materials.map((m) => {
            const inUse = usedMaterialIds.has(m.id);
            const isLast = materials.length <= 1;
            const expanded = expandedMaterialIds.has(m.id);
            return (
              <li key={m.id}>
                <div className="tree-node-row">
                  <button
                    type="button"
                    className="tree-expand"
                    onClick={() => toggleMaterial(m.id)}
                    aria-label={expanded ? t("tree.collapse") : t("tree.expand")}
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <NavLink
                    to={`/materials/${m.id}`}
                    className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}
                  >
                    <Diamond size={16} strokeWidth={1.75} />
                    <RenameableLabel name={m.name} onRename={(name) => renameMaterial(m.id, name)} />
                  </NavLink>
                  <span className="tree-node-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => handleDuplicateMaterial(m.id)}
                      aria-label={t("material.duplicate")}
                      title={t("material.duplicate")}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => handleRemoveMaterial(m.id)}
                      disabled={isLast || inUse}
                      aria-label={t("material.delete")}
                      title={
                        inUse
                          ? t("material.delete.inUse")
                          : isLast
                            ? t("material.delete.last")
                            : t("material.delete")
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
                {expanded && (
                  <ul className="tree-children">
                    {modulesOfScope("material").map((mod) => {
                      const Icon = mod.icon;
                      return (
                        <li key={mod.id}>
                          <div className="tree-node-row">
                            <NavLink
                              to={modulePath(mod, m.id)}
                              className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}
                            >
                              <Icon size={16} strokeWidth={1.75} />
                              <span className="tree-node-label">{t(mod.labelKey)}</span>
                            </NavLink>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <ConstituentSection
        title={t("nav.fibres")}
        addLabel={t("fibre.add")}
        route="/fibres"
        icon={Spline}
        items={fibres}
        setItems={setFibres}
        create={(nr) => defaultFibre(crypto.randomUUID(), t("default.fibreName", { nr }))}
      />

      <ConstituentSection
        title={t("nav.matrices")}
        addLabel={t("matrix.add")}
        route="/matrices"
        icon={Droplet}
        items={matrices}
        setItems={setMatrices}
        create={(nr) => defaultMatrix(crypto.randomUUID(), t("default.matrixName", { nr }))}
      />

      {/* The comparison surface belongs to the project, not to one laminate -
          it is the one place that looks at several at once. */}
      <section className="tree-section">
        <div className="tree-section-header">
          <h3>{t("nav.project")}</h3>
        </div>
        <ul className="tree-list">
          {modulesOfScope("project").map((mod) => {
            const Icon = mod.icon;
            return (
              <li key={mod.id}>
                <div className="tree-node-row">
                  <NavLink
                    to={modulePath(mod)}
                    className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="tree-node-label">{t(mod.labelKey)}</span>
                  </NavLink>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="tree-section">
        <div className="tree-section-header">
          <h3>{t("nav.settings")}</h3>
        </div>
        <ul className="tree-list">
          <li>
            <div className="tree-node-row">
              <NavLink to="/settings/format" className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}>
                <Ruler size={16} strokeWidth={1.75} />
                <span className="tree-node-label">{t("nav.formatSettings")}</span>
              </NavLink>
            </div>
          </li>
        </ul>
      </section>
    </nav>
  );
}
