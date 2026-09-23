import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "jotai";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import {
  formatShortcut,
  isMacPlatform,
  listCommands,
  registerCommand,
  runCommand,
  shortcutsOf,
} from "../lib/commands";
import { rankEntries } from "../lib/commands/fuzzy";
import { laminateConfigFamily, laminateIdsAtom, loadCasesOf, selectedLoadCaseFamily } from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { modulePath, modulesOfScope } from "../lib/moduleRegistry";
import { useLocale, useT } from "../i18n";

interface Entry {
  id: string;
  label: string;
  /** What kind of thing it is, shown beside it. */
  group: string;
  shortcut?: string;
  run: () => void;
}

/** The most results listed; the search narrows, nobody scrolls 200 rows. */
const MAX_RESULTS = 50;

/**
 * Ctrl+K (F1.5): one search over everything the app can do and every object
 * it can go to - the registered commands, the laminates, materials and
 * modules, the load cases of the laminate in view - operated entirely from
 * the keyboard. Not mounted on phones, where there is no keyboard to save
 * steps with.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(
    () =>
      registerCommand({
        id: "app.palette",
        label: "palette.open",
        shortcut: "Mod+K",
        run: () => setOpen(true),
      }),
    [],
  );

  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  // Everything there is, read once when the palette opens: the project does
  // not change while one is typing into it.
  const [entries] = useState(() => {
    const isMac = isMacPlatform();
    const go = (path: string) => () => navigate(path);
    const all: Entry[] = [];
    for (const command of listCommands()) {
      if (command.id === "app.palette" || (command.when && !command.when({}))) continue;
      const shortcut = shortcutsOf(command)[0];
      all.push({
        id: `cmd:${command.id}`,
        label: t(command.label),
        group: t("palette.group.action"),
        shortcut: shortcut ? formatShortcut(shortcut, isMac, locale) : undefined,
        run: () => runCommand(command.id),
      });
    }
    const current = matchPath("/laminates/:laminateId/*", location.pathname)?.params.laminateId;
    const ids = store.get(laminateIdsAtom);
    for (const id of ids) {
      const name = store.get(laminateConfigFamily(id)).name;
      all.push({ id: `lam:${id}`, label: name, group: t("palette.group.laminate"), run: go(`/laminates/${id}`) });
    }
    if (current && ids.includes(current)) {
      const config = store.get(laminateConfigFamily(current));
      for (const mod of modulesOfScope("laminate")) {
        all.push({
          id: `mod:${mod.id}`,
          label: t(mod.labelKey),
          group: t("palette.group.module", { name: config.name }),
          run: go(modulePath(mod, current)),
        });
      }
      for (const loadCase of loadCasesOf(config)) {
        all.push({
          id: `lc:${loadCase.id}`,
          label: loadCase.name,
          group: t("palette.group.loadCase", { name: config.name }),
          run: () => store.set(selectedLoadCaseFamily(current), loadCase.id),
        });
      }
    }
    for (const mod of modulesOfScope("project")) {
      all.push({ id: `mod:${mod.id}`, label: t(mod.labelKey), group: t("nav.project"), run: go(modulePath(mod)) });
    }
    for (const material of store.get(materialsAtom)) {
      all.push({
        id: `mat:${material.id}`,
        label: material.name,
        group: t("palette.group.material"),
        run: go(`/materials/${material.id}`),
      });
    }
    all.push({ id: "nav:format", label: t("nav.formatSettings"), group: t("nav.settings"), run: go("/settings/format") });
    return all;
  });

  const results = useMemo(
    () => rankEntries(query, entries, (e) => `${e.label} ${e.group}`).slice(0, MAX_RESULTS),
    [query, entries],
  );
  const current = Math.min(active, Math.max(0, results.length - 1));

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    // After closing, so a command that opens a dialog of its own or moves
    // the focus does so from the page, not from inside this one.
    queueMicrotask(entry.run);
  };

  return (
    <dialog
      ref={dialog}
      className="app-dialog command-palette"
      aria-label={t("palette.title")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="palette-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[current] ? `palette-${current}` : undefined}
          aria-autocomplete="list"
          aria-label={t("palette.title")}
          placeholder={t("palette.placeholder")}
          value={query}
          autoFocus
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Home" && e.ctrlKey) {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End" && e.ctrlKey) {
              e.preventDefault();
              setActive(results.length - 1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[current]);
            }
          }}
        />
      </div>
      <ul id="palette-results" role="listbox" ref={list} className="palette-results">
        {results.length === 0 && <li className="palette-empty">{t("palette.empty")}</li>}
        {results.map((entry, i) => (
          <li
            key={entry.id}
            id={`palette-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === current}
            className={i === current ? "active" : undefined}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(entry)}
          >
            <span className="palette-label">{entry.label}</span>
            <span className="palette-group">{entry.group}</span>
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
