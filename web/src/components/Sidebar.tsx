import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { NavLink, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Copy, Diamond, Layers, Plus, Ruler, Trash2 } from "lucide-react";
import {
  addLaminateAtom,
  duplicateLaminateAtom,
  laminateConfigFamily,
  laminateIdsAtom,
  removeLaminateAtom,
  usedMaterialIdsAtom,
} from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { expandedLaminateIdsAtom } from "../store/uiAtoms";
import { defaultMaterial } from "../lib/constants";
import { MODULE_LIST } from "../lib/moduleRegistry";

// Inline rename on double-click (UI-Konzept §4/§6): Enter commits, Escape
// reverts, blur commits. Shared by laminate and material nodes.
function RenameableLabel({ name, onRename }: { name: string; onRename: (name: string) => void }) {
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
        title={`${name} (Doppelklick zum Umbenennen)`}
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
      aria-label="Umbenennen"
    />
  );
}

function LaminateTreeItem({ id }: { id: string }) {
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

  const ModIcon = (mod: (typeof MODULE_LIST)[number]) => mod.icon;

  return (
    <li>
      <div className="tree-node-row">
        <button
          type="button"
          className="tree-expand"
          onClick={toggleExpanded}
          aria-label={expanded ? "Zuklappen" : "Aufklappen"}
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
            aria-label="Laminat duplizieren"
            title="Laminat duplizieren"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="icon-button danger"
            onClick={handleRemove}
            aria-label="Laminat löschen"
            title="Laminat löschen"
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>
      {expanded && (
        <ul className="tree-children">
          {MODULE_LIST.map((mod) => {
            const Icon = ModIcon(mod);
            return (
              <li key={mod.id}>
                <div className="tree-node-row">
                  <NavLink
                    to={`/laminates/${id}/modules/${mod.id}`}
                    className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="tree-node-label">{mod.label}</span>
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

export function Sidebar() {
  const laminateIds = useAtomValue(laminateIdsAtom);
  const [materials, setMaterials] = useAtom(materialsAtom);
  const usedMaterialIds = useAtomValue(usedMaterialIdsAtom);
  const addLaminate = useSetAtom(addLaminateAtom);
  const navigate = useNavigate();

  const handleAddLaminate = () => {
    const id = addLaminate(materials[0]?.id ?? "");
    navigate(`/laminates/${id}`);
  };

  const handleAddMaterial = () => {
    const newMaterial = { ...defaultMaterial(), name: `Material ${materials.length + 1}` };
    setMaterials((ms) => [...ms, newMaterial]);
    navigate(`/materials/${newMaterial.id}`);
  };

  const handleDuplicateMaterial = (id: string) => {
    const source = materials.find((m) => m.id === id);
    if (!source) return;
    const copy = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} Kopie`,
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
          <h3>Laminate</h3>
          <button
            type="button"
            className="icon-button"
            onClick={handleAddLaminate}
            aria-label="Laminat hinzufügen"
            title="Laminat hinzufügen"
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
          <h3>Materialien</h3>
          <button
            type="button"
            className="icon-button"
            onClick={handleAddMaterial}
            aria-label="Material hinzufügen"
            title="Material hinzufügen"
          >
            <Plus size={16} />
          </button>
        </div>
        <ul className="tree-list">
          {materials.map((m) => {
            const inUse = usedMaterialIds.has(m.id);
            const isLast = materials.length <= 1;
            return (
              <li key={m.id}>
                <div className="tree-node-row">
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
                      aria-label="Material duplizieren"
                      title="Material duplizieren"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => handleRemoveMaterial(m.id)}
                      disabled={isLast || inUse}
                      aria-label="Material löschen"
                      title={
                        inUse
                          ? "Material wird von einem Laminat verwendet"
                          : isLast
                            ? "Das letzte Material kann nicht gelöscht werden"
                            : "Material löschen"
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

      <section className="tree-section">
        <div className="tree-section-header">
          <h3>Einstellungen</h3>
        </div>
        <ul className="tree-list">
          <li>
            <div className="tree-node-row">
              <NavLink to="/settings/format" className={({ isActive }) => `tree-node${isActive ? " active" : ""}`}>
                <Ruler size={16} strokeWidth={1.75} />
                <span className="tree-node-label">Zahlenformate &amp; Einheiten</span>
              </NavLink>
            </div>
          </li>
        </ul>
      </section>
    </nav>
  );
}
