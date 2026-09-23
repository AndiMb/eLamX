// The one keydown listener: installed once at the app's root, it turns key
// presses into commands (see shortcuts.ts for the rules).
import { useEffect } from "react";
import { desktop } from "../desktop";
import { handleKeydown, isMacPlatform } from "./shortcuts";

export function useGlobalShortcuts() {
  useEffect(() => {
    const isMac = isMacPlatform();
    const inDesktop = desktop() !== null;
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
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("input", onInput, true);
    // Bubbling phase on the window: a component that handles a key itself and
    // stops it keeps it.
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
