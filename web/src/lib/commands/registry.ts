// Everything the user can ask the app to do by name - from a keyboard
// shortcut, the desktop menu, and later the command palette - as one list.
//
// A plain module-level map rather than an atom: commands are code, not
// state. They are registered by whoever owns the behaviour (the file actions
// by the component that holds their busy and error state) and removed again
// when it unmounts, so a command is only listed while it can actually run.

import type { MessageKey } from "../../i18n";

/** What a command may need beyond its own closure. Empty for now; the palette
 *  and undo will put things here rather than change every signature. */
export type CommandContext = Record<string, never>;

export interface Command {
  /** Stable id, e.g. `file.save`. The desktop menu refers to commands by it. */
  id: string;
  label: MessageKey;
  /** `Mod+S`, `Mod+Shift+S`, `Alt+ArrowUp` - see `matchesShortcut`. Several
   *  when a platform convention has two, like Ctrl+Y and Ctrl+Shift+Z for
   *  redo; the first is the one shown. */
  shortcut?: string | string[];
  /** Whether a text field with the focus keeps this key even when it has not
   *  been typed into - Delete and the arrow keys mean something in any field. */
  fieldOwnsKey?: boolean;
  /** Whether the shortcut belongs to the desktop shell's native menu.
   *
   *  The menu has its own accelerator for it and sends the command itself. A
   *  keydown handler acting on the same key as well would run it twice - for
   *  Save As, two dialogs - so in the shell the key is left to the menu. */
  nativeInDesktop?: boolean;
  /** Whether it can run now; a command that cannot is not offered. */
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

const commands = new Map<string, Command>();

/** Adds a command, replacing one with the same id. Returns the removal. */
export function registerCommand(command: Command): () => void {
  commands.set(command.id, command);
  return () => {
    // Only if it is still this one: a re-render may have registered the
    // successor before the cleanup of the predecessor ran.
    if (commands.get(command.id) === command) commands.delete(command.id);
  };
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

/** A command's shortcuts as a list, the one shown first. */
export function shortcutsOf(command: Pick<Command, "shortcut">): string[] {
  const { shortcut } = command;
  return shortcut === undefined ? [] : Array.isArray(shortcut) ? shortcut : [shortcut];
}

/** Every registered command, in registration order. */
export function listCommands(): Command[] {
  return [...commands.values()];
}

/** Runs a command by id. False if there is none or it cannot run now. */
export function runCommand(id: string, ctx: CommandContext = {}): boolean {
  const command = commands.get(id);
  if (!command || (command.when && !command.when(ctx))) return false;
  void command.run(ctx);
  return true;
}
