import { describe, expect, it } from "vitest";
import { fuzzyScore, rankEntries } from "./fuzzy";

const LABELS = [
  "Speichern",
  "Speichern unter …",
  "Plattenbeulen",
  "Lagen kopieren",
  "Laminat 1",
  "Laminat 2",
  "Schichtweise Berechnung",
  "Rückgängig",
  "Material UD-CFK",
];

const rank = (query: string) => rankEntries(query, LABELS, (l) => l);

describe("die Fuzzy-Suche der Befehlspalette", () => {
  it("findet nur, was alle Zeichen in dieser Reihenfolge enthält", () => {
    expect(fuzzyScore("spei", "Speichern")).not.toBeNull();
    expect(fuzzyScore("xyz", "Speichern")).toBeNull();
    expect(fuzzyScore("nrie", "Speichern")).toBeNull();
  });

  it("stellt den Anfang vor einen Treffer mitten im Text", () => {
    expect(rank("speich")[0]).toBe("Speichern");
    expect(rank("beul")[0]).toBe("Plattenbeulen");
  });

  it("zieht Wortanfänge vor", () => {
    expect(rank("lk")[0]).toBe("Lagen kopieren");
    expect(rank("sb")[0]).toBe("Schichtweise Berechnung");
  });

  it("ignoriert Groß- und Kleinschreibung und Umlaute", () => {
    expect(rank("ruckg")[0]).toBe("Rückgängig");
    expect(rank("UD-cfk")[0]).toBe("Material UD-CFK");
  });

  it("lässt bei Gleichstand die ursprüngliche Reihenfolge", () => {
    expect(rank("laminat").slice(0, 2)).toEqual(["Laminat 1", "Laminat 2"]);
  });

  it("zeigt ohne Suchtext alles in der ursprünglichen Reihenfolge", () => {
    expect(rank("")).toEqual(LABELS);
  });
});
