// The one keydown listener: installed once at the app's root, it turns key
// presses into commands (see shortcuts.ts for the rules).
import { useEffect } from "react";
import { desktop } from "../desktop";
import { runCommand } from "./registry";
import { handleKeydown, isMacPlatform, menuCommandTarget } from "./shortcuts";

export function useGlobalShortcuts() {
  useEffect(() => {
    const isMac = isMacPlatform();
    const shell = desktop();
    const inDesktop = shell !== null;
    // Which field has been typed into since it got the focus. Tracked here
    // rather than asked of each input component, so the rule holds for every
    // field in the app without any of them opting in.
    let edited: EventTarget | null = null;
    const onFocusIn = () => {
      edited = null;
    };
    const onInput = (event: Event) => {
      edited = event.target;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // An IME composition owns the keyboard until it ends, and a handler
      // further down that already acted has said so.
      if (event.isComposing || event.defaultPrevented) return;
      const focused = document.activeElement as HTMLElement | null;
      const ran = handleKeydown(event, {
        isMac,
        inDesktop,
        focused,
        fieldEdited: edited !== null && edited === focused,
      });
      // Ctrl+S would otherwise also save the web page itself.
      if (ran) event.preventDefault();
    };
    // The desktop menu, whose accelerators are the keys in the shell: its
    // commands go through the same focus rule as a key press would.
    const stopMenu = shell?.onCommand((name) => {
      const focused = document.activeElement as HTMLElement | null;
      const target = menuCommandTarget(name, focused, edited !== null && edited === focused);
      if (!target) return;
      if (target.kind === "command") {
        runCommand(target.id);
      } else if (name === "undo" || name === "redo") {
        // A shell from before this existed has no way to reach the field's
        // own undo; the page's is the next best thing.
        if (shell.nativeEdit) shell.nativeEdit(name);
        else document.execCommand(name);
      }
    });
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("input", onInput, true);
    // Bubbling phase on the window: a component that handles a key itself and
    // stops it keeps it.
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stopMenu?.();
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
