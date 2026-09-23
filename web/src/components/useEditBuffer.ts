import { useState } from "react";

interface Edit {
  text: string;
  /** The value the text was last in step with. */
  value: number;
  /** Whether the field itself has sent a value since - the next change of
   *  the value is then its own echo, not someone else's edit. */
  sent: boolean;
}

/**
 * The text of a number field while it has the focus.
 *
 * The field keeps its own text while it is being typed into - "1," is not a
 * number yet, and forcing the value's formatting onto it mid-keystroke would
 * fight the typing. But the value can also change from outside while the
 * field has the focus - an undo, a bulk edit - and then the text has to
 * follow, or the field shows a number the project no longer has and the
 * next keystroke writes it back. A change the field did not send itself is
 * such an outside change.
 */
export function useEditBuffer(value: number, format: (value: number) => string) {
  const [edit, setEdit] = useState<Edit | null>(null);

  let current = edit;
  if (edit && !Object.is(edit.value, value)) {
    // During render rather than in an effect, so the stale text is never
    // shown for a frame.
    current = { text: edit.sent ? edit.text : format(value), value, sent: false };
    setEdit(current);
  }

  return {
    text: current?.text ?? format(value),
    onFocus: () => setEdit({ text: format(value), value, sent: false }),
    /** `sent`: the value this text was passed on as, if it was one. */
    onText: (text: string, sent: number | null) =>
      setEdit((prev) => {
        const inStep = prev?.value ?? value;
        return {
          text,
          value: inStep,
          // Sending the value the project already has changes nothing, so no
          // echo will come back.
          sent: (sent !== null && !Object.is(sent, inStep)) || (prev?.sent ?? false),
        };
      }),
    onBlur: () => setEdit(null),
  };
}
