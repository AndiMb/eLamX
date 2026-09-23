import { describe, expect, it } from "vitest";
import {
  clickSelection,
  dropPlacement,
  duplicateBlock,
  insertAt,
  moveBlock,
  pasteIndex,
  shiftBlock,
} from "./layerOps";

const list = (ids: string) => ids.split("").map((id) => ({ id }));
const ids = (items: { id: string }[]) => items.map((i) => i.id).join("");
const sel = (s: string) => new Set(s.split(""));

describe("Blöcke in der Lagenliste", () => {
  it("verschiebt eine Lage vor oder hinter das Ziel", () => {
    expect(ids(moveBlock(list("abcde"), sel("a"), "c", "after"))).toBe("bcade");
    expect(ids(moveBlock(list("abcde"), sel("e"), "b", "before"))).toBe("aebcd");
  });

  it("schließt eine verstreute Auswahl zu einem Block zusammen", () => {
    expect(ids(moveBlock(list("abcdef"), sel("bd"), "f", "after"))).toBe("acefbd");
    expect(ids(moveBlock(list("abcdef"), sel("be"), "a", "before"))).toBe("beacdf");
  });

  it("bewegt nichts, wenn das Ziel im Block liegt", () => {
    const items = list("abcd");
    expect(moveBlock(items, sel("bc"), "c", "after")).toBe(items);
  });

  it("legt ab, wo die Lücke beim Ziehen gezeigt wurde", () => {
    const items = list("abcde");
    expect(dropPlacement(items, "a", "c")).toBe("after");
    expect(dropPlacement(items, "d", "b")).toBe("before");
    expect(ids(moveBlock(items, sel("a"), "c", dropPlacement(items, "a", "c")))).toBe("bcade");
  });

  it("schiebt die Auswahl mit Alt+Pfeil um eine Stelle und behält die Abstände", () => {
    expect(ids(shiftBlock(list("abcde"), sel("bd"), -1))).toBe("badce");
    expect(ids(shiftBlock(list("abcde"), sel("bc"), 1))).toBe("adbce");
    // At the edge the whole block stays, rather than tearing apart.
    const items = list("abcde");
    expect(shiftBlock(items, sel("ac"), -1)).toBe(items);
    expect(shiftBlock(items, sel("e"), 1)).toBe(items);
  });

  it("fügt Kopien als Block hinter der letzten gewählten Lage ein", () => {
    const { items, copies } = duplicateBlock(list("abcd"), sel("ac"), (i) => ({ id: i.id.toUpperCase() }));
    expect(ids(items)).toBe("abcACd");
    expect(ids(copies)).toBe("AC");
  });

  it("fügt oberhalb der Auswahl ein, ohne Auswahl am Ende", () => {
    expect(pasteIndex(list("abcd"), sel("dc"))).toBe(2);
    expect(pasteIndex(list("abcd"), new Set())).toBe(4);
    expect(ids(insertAt(list("abcd"), list("XY"), 2))).toBe("abXYcd");
  });
});

describe("Auswahl per Klick", () => {
  const order = "abcdef".split("");

  it("wählt mit einfachem Klick nur die Zeile", () => {
    expect(clickSelection(order, sel("bc"), "b", "e", { toggle: false, range: false })).toEqual({
      selection: sel("e"),
      anchor: "e",
    });
  });

  it("schaltet mit Strg eine Zeile hinzu oder weg", () => {
    expect(clickSelection(order, sel("b"), "b", "d", { toggle: true, range: false }).selection).toEqual(sel("bd"));
    expect(clickSelection(order, sel("bd"), "b", "b", { toggle: true, range: false }).selection).toEqual(sel("d"));
  });

  it("wählt mit Umschalt den Bereich ab dem Anker, in beide Richtungen", () => {
    expect(clickSelection(order, sel("b"), "b", "e", { toggle: false, range: true })).toEqual({
      selection: sel("bcde"),
      anchor: "b",
    });
    expect(clickSelection(order, sel("e"), "e", "c", { toggle: false, range: true }).selection).toEqual(sel("cde"));
    expect(clickSelection(order, sel("a"), "a", "c", { toggle: true, range: true }).selection).toEqual(sel("abc"));
  });
});
