import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commandForKey,
  handleKeydown,
  isTextField,
  keyStaysWithField,
  listCommands,
  matchesShortcut,
  registerCommand,
  runCommand,
  type KeyLike,
} from "./index";

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

const INPUT = { tagName: "INPUT", type: "number" };
const TEXT = { tagName: "input", type: "text" };
const CHECKBOX = { tagName: "INPUT", type: "checkbox" };
const BUTTON = { tagName: "BUTTON" };

const env = (over: Partial<Parameters<typeof commandForKey>[1]> = {}) => ({
  isMac: false,
  inDesktop: false,
  focused: null,
  fieldEdited: false,
  ...over,
});

let cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.forEach((stop) => stop());
  cleanup = [];
});

function register(...args: Parameters<typeof registerCommand>) {
  const stop = registerCommand(...args);
  cleanup.push(stop);
  return stop;
}

describe("Tastenkürzel", () => {
  it("liest Mod als Strg und auf dem Mac als Cmd", () => {
    expect(matchesShortcut(key("s", { ctrlKey: true }), "Mod+S", false)).toBe(true);
    expect(matchesShortcut(key("s", { metaKey: true }), "Mod+S", false)).toBe(false);
    expect(matchesShortcut(key("s", { metaKey: true }), "Mod+S", true)).toBe(true);
    expect(matchesShortcut(key("s", { ctrlKey: true }), "Mod+S", true)).toBe(false);
  });

  it("verlangt genau die genannten Zusatztasten", () => {
    expect(matchesShortcut(key("S", { ctrlKey: true, shiftKey: true }), "Mod+Shift+S", false)).toBe(
      true,
    );
    expect(matchesShortcut(key("S", { ctrlKey: true, shiftKey: true }), "Mod+S", false)).toBe(false);
    expect(matchesShortcut(key("s", { ctrlKey: true, altKey: true }), "Mod+S", false)).toBe(false);
    expect(matchesShortcut(key("ArrowUp", { altKey: true }), "Alt+ArrowUp", false)).toBe(true);
  });
});

describe("die Fokusregel", () => {
  it("erkennt Textfelder, aber keine Checkboxen und Knöpfe", () => {
    expect(isTextField(INPUT)).toBe(true);
    expect(isTextField(TEXT)).toBe(true);
    expect(isTextField({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextField({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextField(CHECKBOX)).toBe(false);
    expect(isTextField(BUTTON)).toBe(false);
    expect(isTextField({ ...TEXT, readOnly: true })).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  /// Ctrl+Z after typing into a field means "undo my typing"; in a field one
  /// has only tabbed into, there is nothing of its own to undo.
  it("lässt Bearbeitungstasten beim Feld, solange darin getippt wurde", () => {
    expect(keyStaysWithField("edit.undo", INPUT, true)).toBe(true);
    expect(keyStaysWithField("edit.redo", TEXT, true)).toBe(true);
    expect(keyStaysWithField("edit.paste", TEXT, true)).toBe(true);
    expect(keyStaysWithField("edit.undo", INPUT, false)).toBe(false);
    expect(keyStaysWithField("edit.undo", CHECKBOX, true)).toBe(false);
    expect(keyStaysWithField("edit.undo", BUTTON, true)).toBe(false);
  });

  it("gibt Speichern und Öffnen immer der App, auch aus einem bearbeiteten Feld", () => {
    expect(keyStaysWithField("file.save", INPUT, true)).toBe(false);
    expect(keyStaysWithField("file.open", TEXT, true)).toBe(false);
  });
});

describe("die Registry", () => {
  it("führt ein Kommando über seine Taste aus", () => {
    const save = vi.fn();
    register({ id: "file.save", label: "topbar.save", shortcut: "Mod+S", run: save });

    expect(handleKeydown(key("s", { ctrlKey: true }), env())).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    // Save from inside a field one has typed into: still the app's.
    expect(handleKeydown(key("s", { ctrlKey: true }), env({ focused: INPUT, fieldEdited: true }))).toBe(
      true,
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(handleKeydown(key("x", { ctrlKey: true }), env())).toBe(false);
  });

  it("überlässt im Bearbeitungsfall die Taste dem Feld", () => {
    const undo = vi.fn();
    register({ id: "edit.undo", label: "topbar.save", shortcut: "Mod+Z", run: undo });

    expect(handleKeydown(key("z", { ctrlKey: true }), env({ focused: TEXT, fieldEdited: true }))).toBe(
      false,
    );
    expect(undo).not.toHaveBeenCalled();
    expect(handleKeydown(key("z", { ctrlKey: true }), env({ focused: TEXT }))).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
  });

  /// The shell's menu has its own accelerator for these keys and sends the
  /// command itself; acting on the key as well would run it twice.
  it("überlässt im Desktop die Tasten des nativen Menüs dem Menü", () => {
    const open = vi.fn();
    register({
      id: "file.open",
      label: "topbar.open",
      shortcut: "Mod+O",
      nativeInDesktop: true,
      run: open,
    });
    expect(handleKeydown(key("o", { ctrlKey: true }), env({ inDesktop: true }))).toBe(false);
    expect(open).not.toHaveBeenCalled();
    // The menu's route: by id.
    expect(runCommand("file.open")).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it("behält die Taste, auch wenn das Kommando gerade nicht laufen kann", () => {
    const save = vi.fn();
    register({ id: "file.save", label: "topbar.save", shortcut: "Mod+S", when: () => false, run: save });
    // Consumed, so the browser does not open its own "save page" instead.
    expect(handleKeydown(key("s", { ctrlKey: true }), env())).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(runCommand("file.save")).toBe(false);
  });

  it("entfernt nur das eigene Kommando, nicht seinen Nachfolger", () => {
    const first = register({ id: "x", label: "topbar.save", run: () => {} });
    register({ id: "x", label: "topbar.open", run: () => {} });
    first();
    expect(listCommands().map((c) => c.label)).toEqual(["topbar.open"]);
  });
});
