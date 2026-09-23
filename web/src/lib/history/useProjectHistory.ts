// Installs the undo history for the app, once, at its root.
import { useEffect } from "react";
import { isTextField } from "../commands/shortcuts";
import { checkpointHistory, installHistory } from "./controller";

/**
 * Starts recording, and ends a step wherever typing ends.
 *
 * Typing into a field is one step until the field is left or confirmed with
 * Enter. That is decided here for every text field of the app at once rather
 * than by each input component, the same way the shortcut listener tracks
 * which field was typed into: a field someone adds later behaves the same
 * without having to remember to.
 */
export function useProjectHistory() {
  useEffect(() => {
    const stop = installHistory();
    const onFocusOut = (event: FocusEvent) => {
      if (isTextField(event.target as HTMLElement | null)) checkpointHistory();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && isTextField(event.target as HTMLElement | null)) {
        checkpointHistory();
      }
    };
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      stop();
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
