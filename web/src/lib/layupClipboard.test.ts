import { describe, expect, it } from "vitest";
import {
  CREATE_MATERIAL,
  layupClipboardData,
  matchCriterion,
  parseClipboard,
  pasteDefaults,
  resolvePaste,
  unknownMaterials,
  type ParsedLayup,
} from "./layupClipboard";
import { defaultMaterial, type LayerRow } from "./constants";
import type { FormatConfig } from "../store/formatAtoms";
import type { MaterialDto } from "./types";

const CFK: MaterialDto = { ...defaultMaterial(), id: "m-cfk", name: "CFK T300" };
const GFK: MaterialDto = { ...defaultMaterial(), id: "m-gfk", name: "GFK E-Glas" };

const layer = (id: string, angle: number, materialId = "m-cfk", thickness = 0.125): LayerRow => ({
  id,
  name: `Lage ${id}`,
  angle,
  thickness,
  materialId,
  criterionId: "puck",
});

const LAYERS = [layer("1", 0), layer("2", 45, "m-gfk", 0.25), layer("3", -45), layer("4", 90)];

let counter = 0;
const options = (over: Partial<Parameters<typeof resolvePaste>[1]> = {}) => ({
  materials: [CFK, GFK],
  defaults: { materialId: "m-cfk", thickness: 0.2, criterionId: "max_stress" as const },
  mapping: {},
  keepSymmetric: false,
  newId: () => `new-${++counter}`,
  plyName: (i: number) => `P${i + 1}`,
  ...over,
});

describe("Kopieren", () => {
  it("schreibt eine Tabelle mit Kopfzeile und Einheiten, deutsch mit Dezimalkomma", () => {
    const { text } = layupClipboardData(LAYERS.slice(0, 2), [CFK, GFK], { locale: "de" });
    const lines = text.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Winkel\tDicke\tMaterial\tKriterium\tName");
    expect(lines[1]).toBe("0\t0,125\tCFK T300\tPuck\tLage 1");
    expect(lines[2]).toBe("45\t0,25\tGFK E-Glas\tPuck\tLage 2");
  });

  it("legt die Lagen verlustfrei ins HTML, mit den Materialdefinitionen", () => {
    const { html } = layupClipboardData(LAYERS, [CFK, GFK], { locale: "en" });
    expect(html).toMatch(/^<table data-elamx-layup="[A-Za-z0-9+/=]+"><caption>/);
    const parsed = parseClipboard({ html, text: "ignored" })!;
    expect(parsed.source).toBe("elamx");
    expect(parsed.plies.map((p) => [p.angle, p.thickness, p.material, p.criterion])).toEqual([
      [0, 0.125, "CFK T300", "puck"],
      [45, 0.25, "GFK E-Glas", "puck"],
      [-45, 0.125, "CFK T300", "puck"],
      [90, 0.125, "CFK T300", "puck"],
    ]);
    expect(parsed.materials.map((m) => m.id).sort()).toEqual(["m-cfk", "m-gfk"]);
  });

  it("nimmt die Zusatzkriterien im HTML mit, nicht aber in die Tabelle", () => {
    const listed = [{ ...layer("1", 0), extraCriteria: ["hashin" as const, "tsai_wu" as const] }, layer("2", 90)];
    const { html, text } = layupClipboardData(listed, [CFK], { locale: "en" });
    expect(text.split("\r\n")[1]).toBe("0\t0.125\tCFK T300\tPuck\tLage 1");
    const parsed = parseClipboard({ html, text })!;
    const layers = resolvePaste(parsed, options()).layers;
    expect(layers[0].extraCriteria).toEqual(["hashin", "tsai_wu"]);
    expect("extraCriteria" in layers[1]).toBe(false);
  });
});

describe("Einfügen", () => {
  /// Excel drops the attribute when the table goes through a sheet; the
  /// text it pastes back must read the same.
  it("liest die eigene Tabelle zurück, auch in µm und über Excel", () => {
    const formats = (category: string): FormatConfig => ({
      unitId: category === "thickness" ? "um" : "deg",
      decimals: 1,
      notation: "fixed",
    });
    const { text } = layupClipboardData(LAYERS, [CFK, GFK], { locale: "de", formats });
    expect(text.split("\r\n")[0]).toBe("Winkel [°]\tDicke [µm]\tMaterial\tKriterium\tName");
    const parsed = parseClipboard({ text })!;
    expect(parsed.source).toBe("table");
    expect(parsed.plies.map((p) => p.thickness)).toEqual([0.125, 0.25, 0.125, 0.125]);
    expect(parsed.plies[1]).toEqual({
      angle: 45,
      thickness: 0.25,
      material: "GFK E-Glas",
      criterion: "puck",
      name: "Lage 2",
    });
  });

  it("erkennt Spalten über englische Köpfe in beliebiger Reihenfolge", () => {
    const text = "Ply\tMaterial\tThickness [mm]\tAngle\n1\tCFK T300\t0.2\t30\n2\tCFK T300\t0.2\t-30\n";
    const parsed = parseClipboard({ text })!;
    expect(parsed.plies).toEqual([
      { angle: 30, thickness: 0.2, material: "CFK T300" },
      { angle: -30, thickness: 0.2, material: "CFK T300" },
    ]);
  });

  it("nimmt ohne Kopfzeile die Reihenfolge Winkel, Dicke, Material", () => {
    const parsed = parseClipboard({ text: "0\t0,15\tCFK T300\r\n90\t0,15\tCFK T300\r\n" })!;
    expect(parsed.plies.map((p) => [p.angle, p.thickness, p.material])).toEqual([
      [0, 0.15, "CFK T300"],
      [90, 0.15, "CFK T300"],
    ]);
  });

  it("liest eine Spalte Winkel aus Excel", () => {
    const parsed = parseClipboard({ text: "0\r\n45\r\n-45\r\n90\r\n" })!;
    expect(parsed.source).toBe("table");
    expect(parsed.plies.map((p) => p.angle)).toEqual([0, 45, -45, 90]);
  });

  it("überspringt Zeilen ohne Winkel und sagt es", () => {
    const parsed = parseClipboard({ text: "Winkel\tDicke\n0\t0,1\n\t\nSumme\t0,2\n90\t0,1" })!;
    expect(parsed.plies.map((p) => p.angle)).toEqual([0, 90]);
    expect(parsed.warnings).toEqual([{ kind: "skippedRows", count: 1 }]);
  });

  it("meldet ein unbekanntes Kriterium einmal", () => {
    const parsed = parseClipboard({ text: "Winkel\tKriterium\n0\tFoo\n90\tFoo\n45\tTsai-Wu" })!;
    expect(parsed.warnings).toEqual([{ kind: "unknownCriterion", value: "Foo" }]);
    expect(parsed.plies[2].criterion).toBe("tsai_wu");
  });

  it("liest eine Zeile als Kurzschreibweise", () => {
    const parsed = parseClipboard({ text: "[0/±45/90]s" })!;
    expect(parsed.source).toBe("notation");
    expect(parsed.plies.map((p) => p.angle)).toEqual([0, 45, -45, 90]);
    expect(parsed.symmetric).toBe(true);
  });

  it("lehnt ab, was kein Aufbau ist", () => {
    expect(parseClipboard({ text: "Hallo Welt" })).toBeNull();
    expect(parseClipboard({ text: "" })).toBeNull();
    expect(parseClipboard({ html: "<p>x</p>", text: "a\tb\nc\td" })).toBeNull();
  });

  it("findet Kriterien über Id und Namen in beiden Sprachen", () => {
    expect(matchCriterion("max_stress")).toBe("max_stress");
    expect(matchCriterion("Max. Spannung")).toBe("max_stress");
    expect(matchCriterion("max. stress")).toBe("max_stress");
    expect(matchCriterion("")).toBeNull();
  });
});

describe("Von Lagen der Zwischenablage zu Lagen des Laminats", () => {
  const notation: ParsedLayup = parseClipboard({ text: "[0/45/90]s" })!;

  it("füllt fehlende Spalten mit den Werten der Nachbarlage (O7)", () => {
    const defaults = pasteDefaults(LAYERS, new Set(["2"]), [CFK, GFK]);
    expect(defaults).toEqual({ materialId: "m-gfk", thickness: 0.25, criterionId: "puck" });
    expect(pasteDefaults(LAYERS, new Set(), [CFK, GFK]).materialId).toBe("m-cfk");
    expect(pasteDefaults([], new Set(), [GFK]).materialId).toBe("m-gfk");
    const { layers } = resolvePaste(notation, options({ defaults }));
    expect(layers.map((l) => [l.angle, l.thickness, l.materialId, l.criterionId])).toEqual([
      [0, 0.25, "m-gfk", "puck"],
      [45, 0.25, "m-gfk", "puck"],
      [90, 0.25, "m-gfk", "puck"],
      [90, 0.25, "m-gfk", "puck"],
      [45, 0.25, "m-gfk", "puck"],
      [0, 0.25, "m-gfk", "puck"],
    ]);
  });

  it("schreibt die gespiegelte Hälfte aus, oder behält nur die definierte", () => {
    expect(resolvePaste(notation, options()).layers).toHaveLength(6);
    expect(resolvePaste(notation, options({ keepSymmetric: true })).layers).toHaveLength(3);
  });

  it("fragt nach Materialien, die es nicht gibt, und legt nur auf Wunsch an", () => {
    const { html } = layupClipboardData([layer("1", 0, "m-x")], [{ ...CFK, id: "m-x", name: "Aramid" }], {
      locale: "de",
    });
    const parsed = parseClipboard({ html })!;
    const unknown = unknownMaterials(parsed, [CFK, GFK]);
    expect(unknown.map((u) => [u.key, u.definition?.name])).toEqual([["aramid", "Aramid"]]);

    // Mapped onto an existing material: nothing new.
    const mapped = resolvePaste(parsed, options({ mapping: { aramid: "m-gfk" } }));
    expect(mapped.newMaterials).toEqual([]);
    expect(mapped.layers[0].materialId).toBe("m-gfk");

    // Created from the clipboard: once, with a fresh id.
    const created = resolvePaste(parsed, options({ mapping: { aramid: CREATE_MATERIAL } }));
    expect(created.newMaterials).toHaveLength(1);
    expect(created.newMaterials[0].name).toBe("Aramid");
    expect(created.layers[0].materialId).toBe(created.newMaterials[0].id);
  });

  it("erkennt ein Material desselben Projekts an Id und Namen, ein fremdes am Namen", () => {
    const parsed = parseClipboard({ html: layupClipboardData(LAYERS, [CFK, GFK], { locale: "de" }).html })!;
    expect(unknownMaterials(parsed, [CFK, GFK])).toEqual([]);
    // Another project: same name, different id.
    const other = [{ ...CFK, id: "material-1" }];
    expect(unknownMaterials(parsed, other).map((u) => u.name)).toEqual(["GFK E-Glas"]);
    expect(resolvePaste(parsed, options({ materials: other })).layers[0].materialId).toBe("material-1");
  });

  it("bringt Winkel in den Bereich (-90, 90]", () => {
    const parsed = parseClipboard({ text: "135\n-100" })!;
    expect(resolvePaste(parsed, options()).layers.map((l) => l.angle)).toEqual([-45, 80]);
  });
});
