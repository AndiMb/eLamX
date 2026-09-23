import { describe, expect, it } from "vitest";
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  checkpoint,
  initialHistory,
  record,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from "./history";

// Snapshots are numbers here: the rules do not look inside them.
const at = (now: number, path = "p", label = "L") => ({ now, path, label });

describe("die Undo-Historie", () => {
  it("legt schnelle Änderungen am selben Pfad zu einem Schritt zusammen", () => {
    let h = initialHistory(0, 0);
    h = record(h, 1, at(1000));
    h = record(h, 2, at(1000 + COALESCE_MS - 1));
    h = record(h, 3, at(1000 + 2 * COALESCE_MS - 2));
    expect(h.past.map((e) => e.snapshot)).toEqual([0]);
    expect(h.present.snapshot).toBe(3);
  });

  it("beginnt nach einer Pause einen neuen Schritt", () => {
    let h = initialHistory(0, 0);
    h = record(h, 1, at(1000));
    h = record(h, 2, at(1000 + COALESCE_MS + 1));
    expect(h.past.map((e) => e.snapshot)).toEqual([0, 1]);
  });

  it("trennt Änderungen an verschiedenen Pfaden, auch wenn sie schnell folgen", () => {
    let h = initialHistory(0, 0);
    h = record(h, 1, at(1000, "angle"));
    h = record(h, 2, at(1001, "thickness"));
    expect(h.past.map((e) => e.snapshot)).toEqual([0, 1]);
  });

  it("hält ein Textfeld bis zum Checkpoint als einen Schritt offen", () => {
    let h = initialHistory(0, 0);
    h = record(h, 1, { ...at(1000), windowMs: Infinity });
    h = record(h, 2, { ...at(60_000), windowMs: Infinity });
    expect(h.past).toHaveLength(1);
    h = checkpoint(h);
    h = record(h, 3, { ...at(60_001), windowMs: Infinity });
    expect(h.past.map((e) => e.snapshot)).toEqual([0, 2]);
  });

  it("geht vor und zurück und nennt den Schritt, den es rückgängig macht", () => {
    let h = initialHistory(0, 0);
    h = record(h, 1, at(1000, "a", "Winkel"));
    h = record(h, 2, at(5000, "b", "Dicke"));
    expect(undoLabel(h)).toBe("Dicke");
    expect(redoLabel(h)).toBeNull();

    h = undo(h);
    expect(h.present.snapshot).toBe(1);
    expect(undoLabel(h)).toBe("Winkel");
    expect(redoLabel(h)).toBe("Dicke");
    h = undo(h);
    expect(h.present.snapshot).toBe(0);
    expect(undoLabel(h)).toBeNull();
    expect(undo(h)).toBe(h);

    h = redo(h);
    h = redo(h);
    expect(h.present.snapshot).toBe(2);
    expect(redo(h)).toBe(h);
  });

  it("verwirft den Redo-Stapel bei einer neuen Änderung", () => {
    let h = initialHistory(0, 0);
    h = record(h, 1, at(1000, "a"));
    h = record(h, 2, at(5000, "b"));
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = record(h, 7, at(6000, "c"));
    expect(h.future).toEqual([]);
    expect(h.past.map((e) => e.snapshot)).toEqual([0, 1]);
  });

  /// After an undo the present is a state the user went back to; the next
  /// edit must not rewrite it, even on the same path and within the window.
  it("verschmilzt nach einem Undo nicht mit dem zurückgeholten Stand", () => {
    let h = initialHistory(0, 0);
    h = record(h, 1, at(1000, "a"));
    h = record(h, 2, at(5000, "a"));
    h = undo(h);
    h = record(h, 3, at(5001, "a"));
    expect(h.past.map((e) => e.snapshot)).toEqual([0, 1]);
    expect(h.present.snapshot).toBe(3);
  });

  it("behält höchstens HISTORY_LIMIT Schritte", () => {
    let h = initialHistory(0, 0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = record(h, i, at(i * 10_000, String(i)));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].snapshot).toBe(50);
    let steps = 0;
    while (undoLabel(h) !== null) {
      h = undo(h);
      steps++;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(100);
  });
});
