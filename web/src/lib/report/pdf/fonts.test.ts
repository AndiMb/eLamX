// jsPDF has no fallback font: a character the embedded font lacks vanishes
// from the PDF without an error. So the font is checked against everything a
// report can write - the two catalogs, and the text the report's charts and
// builders put down themselves.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cmapCodePoints } from "../../../test/ttfCmap";
import { reportFonts } from "../../../test/reportFonts";

const SRC = new URL("../../../", import.meta.url);

function read(relative: string): string {
  return readFileSync(new URL(relative, SRC), "utf8");
}

/** The characters of the source's string literals and JSX text - the file
 *  without its comments. Rough, but it only has to over-approximate. */
function codeCharacters(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function filesUnder(relative: string): string[] {
  const dir = new URL(relative, SRC);
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir.pathname.replace(/^\/([A-Za-z]:)/, "$1"), name);
    if (statSync(path).isDirectory()) return filesUnder(`${relative}${name}/`);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [`${relative}${name}`] : [];
  });
}

function missing(text: string, glyphs: Set<number>): string[] {
  const absent = new Set<string>();
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    if (!glyphs.has(code)) absent.add(`${char} U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return [...absent].sort();
}

const fonts = reportFonts();

describe.each([
  ["regular", fonts.regular],
  ["bold", fonts.bold],
])("the %s report font", (_, font) => {
  const glyphs = cmapCodePoints(font);

  test("holds every character of both catalogs", () => {
    expect(missing(read("i18n/de.ts") + read("i18n/en.ts"), glyphs)).toEqual([]);
  });

  test("holds every character the report's builders and charts write", () => {
    const sources = [
      ...filesUnder("lib/report/"),
      ...filesUnder("lib/formulas/"),
      ...filesUnder("components/charts/"),
      "components/StackViz.tsx",
      "components/ThroughThicknessSheet.tsx",
      "lib/angleStack.ts",
      "lib/numberFormat.ts",
      "lib/units.ts",
      "lib/symbols.ts",
    ];
    const text = sources.map((file) => codeCharacters(read(file))).join("");
    expect(missing(text, glyphs)).toEqual([]);
  });
});
