import { describe, expect, it } from "vitest";
import {
  defuse,
  delimitedDefaults,
  toDelimited,
  toHtmlTable,
  type SerializeOptions,
  type TableModel,
} from "./table";
import type { FormatConfig } from "../../store/formatAtoms";
import type { QuantityCategory } from "../units";

const TABLE: TableModel = {
  title: "Lagenergebnisse <Zug>",
  columns: [
    { key: "layer", label: "Lage" },
    { key: "t", label: "Dicke", category: "thickness" },
    { key: "s11", label: "σ11", category: "stress" },
    { key: "rf", label: "RF" },
  ],
  rows: [
    ["1; 0°", 0.125, 2500, 1 / 3],
    ["2", 0.25, null, Number.NaN],
  ],
};

// What the user picked: thickness in µm, stresses in GPa with 2 decimals.
const FORMATS: Partial<Record<QuantityCategory, FormatConfig>> = {
  thickness: { unitId: "um", decimals: 1, notation: "fixed" },
  stress: { unitId: "GPa", decimals: 2, notation: "fixed" },
};
const formats = (c: QuantityCategory) => FORMATS[c]!;

function options(locale: "de" | "en", extra: Partial<SerializeOptions> = {}): SerializeOptions {
  return { locale, ...delimitedDefaults(locale), precision: "full", formats, ...extra };
}

describe("TableModel als CSV/TSV", () => {
  it("trennt im Deutschen mit Semikolon und Komma, im Englischen mit Komma und Punkt", () => {
    expect(delimitedDefaults("de")).toEqual({ sep: ";", decimal: "," });
    expect(delimitedDefaults("en")).toEqual({ sep: ",", decimal: "." });

    const de = toDelimited(TABLE, options("de")).split("\r\n");
    expect(de[0]).toBe("Lage;Dicke [µm];σ11 [GPa];RF");
    // The field holding the separator is quoted; the value is in µm and GPa.
    expect(de[1]).toBe('"1; 0°";125;2,5;0,3333333333333333');

    const en = toDelimited(TABLE, options("en")).split("\r\n");
    expect(en[1]).toBe("1; 0°,125,2.5,0.3333333333333333");
  });

  /// The file is for computing with, so by default every digit goes in - a
  /// value read back is the value written. The display's rounding is an option.
  it("schreibt standardmäßig die volle Genauigkeit, auf Wunsch wie angezeigt", () => {
    const full = toDelimited(TABLE, options("en")).split("\r\n")[1].split(",");
    expect(Number(full[3])).toBe(1 / 3);

    const shown = toDelimited(TABLE, options("en", { precision: "display" })).split("\r\n");
    expect(shown[1]).toBe("1; 0°,125.0,2.50,0.3333333333333333");
    const scientific = toDelimited(
      TABLE,
      options("de", {
        precision: "display",
        formats: () => ({ unitId: "MPa", decimals: 3, notation: "scientific" }),
      }),
    ).split("\r\n");
    // The first field is quoted because it holds the separator.
    expect(scientific[1].split(";")[3]).toBe("2,500e+3");
  });

  it("lässt fehlende und nicht endliche Werte leer", () => {
    const row = toDelimited(TABLE, options("de")).split("\r\n")[2];
    expect(row).toBe("2;250;;");
  });

  it("bleibt ohne Formateinstellungen in der kanonischen Einheit und ohne Einheit im Kopf", () => {
    const lines = toDelimited(TABLE, { locale: "en", sep: "\t", decimal: ".", precision: "full" })
      .split("\r\n");
    expect(lines[0]).toBe("Lage\tDicke\tσ11\tRF");
    expect(lines[1]).toBe("1; 0°\t0.125\t2500\t0.3333333333333333");
  });

  it("maskiert Anführungszeichen und Zeilenumbrüche", () => {
    const table: TableModel = {
      title: "",
      columns: [{ key: "a", label: 'Name "kurz"' }],
      rows: [["zwei\nZeilen"]],
    };
    expect(toDelimited(table, options("en"))).toBe('"Name ""kurz"""\r\n"zwei\nZeilen"\r\n');
  });
});

describe("Text, der wie eine Formel aussieht", () => {
  // A name comes out of a project file, and a spreadsheet runs a field that
  // starts with "=" - a material called =HYPERLINK(...) must stay text.
  it("wird mit einem Apostroph zu Text", () => {
    for (const name of ['=HYPERLINK("x")', "+cmd", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(defuse(name)).toBe(`'${name}`);
    }
    const table: TableModel = { title: "T", columns: [{ key: "name", label: "Name" }], rows: [["=1+1"]] };
    expect(toDelimited(table, options("en")).split("\r\n")[1]).toBe("'=1+1");
    expect(toHtmlTable(table, options("en"))).toContain("<td>'=1+1</td>");
  });

  it("lässt gewöhnliche Namen und vorzeichenbehaftete Zahlen in Ruhe", () => {
    for (const name of ["Lage 1", "-45", "+0,5", "−45°", "UD-CFK", "[0/±45/90]s"]) {
      expect(defuse(name)).toBe(name);
    }
  });
});

describe("TableModel als HTML", () => {
  it("schreibt Titel, Kopf mit Einheit und Zahlen in der Sprache der Tabelle", () => {
    const html = toHtmlTable(TABLE, { locale: "de", decimal: ",", precision: "full", formats });
    expect(html).toContain("<caption>Lagenergebnisse &lt;Zug&gt;</caption>");
    expect(html).toContain("<th>Dicke [µm]</th>");
    expect(html).toContain('<td align="right">2,5</td>');
    expect(html).toContain("<td>1; 0°</td>");
    // Missing values are empty cells.
    expect(html).toContain('<td></td><td align="right"></td></tr>');
  });
});
