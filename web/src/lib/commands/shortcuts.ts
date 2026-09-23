// Matching key events to commands, and the one rule that decides whether a
// key belongs to the app or to the field that has the focus.
//
// Kept free of the DOM's classes (it reads the few properties it needs), so
// the rule can be tested without a browser.

import { listCommands, runCommand, shortcutsOf, type Command, type CommandContext } from "./registry";

/** The parts of a KeyboardEvent the matching reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Whether `event` is `shortcut`. `Mod` is Cmd on a Mac and Ctrl elsewhere,
 * so one definition serves both; the key compares case-insensitively, since
 * Shift turns `s` into `S`.
 */
export function matchesShortcut(event: KeyLike, shortcut: string, isMac: boolean): boolean {
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  const wanted = new Set(parts.map((p) => p.toLowerCase()));
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const other = isMac ? event.ctrlKey : event.metaKey;
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    mod === wanted.has("mod") &&
    // Ctrl on a Mac and the Windows key elsewhere are never part of a
    // shortcut here; with one held, the key is someone else's.
    !other &&
    event.shiftKey === wanted.has("shift") &&
    event.altKey === wanted.has("alt")
  );
}

/** The parts of the focused element the focus rule reads. */
export interface FocusLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
}

const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "email", "url", "tel", "password", ""]);

/** Whether the element takes typed text, which is what gives it its own undo
 *  and its own clipboard. A checkbox or a select has neither. */
export function isTextField(el: FocusLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.readOnly) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && TEXT_INPUT_TYPES.has((el.type ?? "").toLowerCase());
}

/** The commands whose keys are also a text field's own editing keys. */
const FIELD_EDITING_COMMANDS = new Set([
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.selectAll",
]);

/**
 * The focus rule: a key the field itself understands stays with the field
 * while the field has something to apply it to.
 *
 * Ctrl+Z in a field one has just typed into means "undo my typing", not "undo
 * the last change to the project" - so while a text field has the focus and
 * has been edited since it got it, the editing keys go to the field. In an
 * untouched field there is nothing of its own to undo, and the key acts on
 * the project. Keys that are not editing keys - Save, Open - always act on
 * the app, from wherever they are pressed.
 */
export function keyStaysWithField(
  commandId: string,
  focused: FocusLike | null | undefined,
  fieldEdited: boolean,
): boolean {
  return FIELD_EDITING_COMMANDS.has(commandId) && isTextField(focused) && fieldEdited;
}

export interface KeydownEnvironment {
  isMac: boolean;
  /** Whether this is the desktop shell, whose menu owns some keys. */
  inDesktop: boolean;
  focused: FocusLike | null;
  /** Whether the focused field was edited since it got the focus. */
  fieldEdited: boolean;
  ctx?: CommandContext;
}

/**
 * The command a key press asks for, if any - after the focus rule and the
 * desktop menu have had their say.
 */
export function commandForKey(
  event: KeyLike,
  env: KeydownEnvironment,
  commands: Command[] = listCommands(),
): Command | null {
  for (const command of commands) {
    if (!shortcutsOf(command).some((s) => matchesShortcut(event, s, env.isMac))) continue;
    if (env.inDesktop && command.nativeInDesktop) return null;
    if (keyStaysWithField(command.id, env.focused, env.fieldEdited)) return null;
    if (command.fieldOwnsKey && isTextField(env.focused)) return null;
    return command;
  }
  return null;
}

/**
 * Runs what a key press asks for. True if the key is the app's - the caller
 * then keeps the browser from acting on it as well.
 *
 * True also when the command cannot run right now (its `when` says no, say a
 * save already in progress): the key still means that command, and letting
 * it fall through would hand Ctrl+S to the browser's own "save page".
 */
export function handleKeydown(event: KeyLike, env: KeydownEnvironment): boolean {
  const command = commandForKey(event, env);
  if (!command) return false;
  runCommand(command.id, env.ctx);
  return true;
}

const KEY_NAMES: Record<string, { de: string; en: string; mac?: string }> = {
  mod: { de: "Strg", en: "Ctrl", mac: "⌘" },
  shift: { de: "Umschalt", en: "Shift", mac: "⇧" },
  alt: { de: "Alt", en: "Alt", mac: "⌥" },
  arrowup: { de: "↑", en: "↑" },
  arrowdown: { de: "↓", en: "↓" },
  delete: { de: "Entf", en: "Del" },
  escape: { de: "Esc", en: "Esc" },
  enter: { de: "Eingabe", en: "Enter" },
};

/** A shortcut as the keyboard labels it: `Strg+Umschalt+Z`, or `⇧⌘Z` on a
 *  Mac, where the symbols are the convention and go without separators. */
export function formatShortcut(shortcut: string, isMac: boolean, locale: "de" | "en"): string {
  const parts = shortcut.split("+").map((part) => {
    const name = KEY_NAMES[part.toLowerCase()];
    if (!name) return part.length === 1 ? part.toUpperCase() : part;
    return isMac && name.mac ? name.mac : name[locale];
  });
  return isMac ? parts.join("") : parts.join("+");
}

/** Whether this is a Mac, where Mod is Cmd. */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}
