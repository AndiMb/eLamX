import { beforeEach, describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import { Provider, createStore } from "jotai";
import { createQuantityFormatter, useQuantityFormat } from "./quantityFormat";
import { CATEGORY_DEFINITIONS, type QuantityCategory } from "./units";
import { formatConfigFamily, type FormatConfig } from "../store/formatAtoms";
import { localeAtom, type Locale } from "../i18n";

// The formatter without the hook exists for exports and reports, which run
// outside any component. What they write has to be what the screen shows, so
// the check is the hook itself, rendered, against the plain function - for
// every category, every unit it offers and both languages. (A .ts file with
// createElement rather than JSX: the test runner only picks up *.test.ts.)

const categories = Object.keys(CATEGORY_DEFINITIONS) as QuantityCategory[];
const locales: Locale[] = ["de", "en"];
// Inside, above and below the compact band, a negative and a zero.
const VALUES = [0, 0.125, -3.5, 1234.5678, 2.5e-5, 3.2e7];

function Probe({ category }: { category: QuantityCategory }) {
  const format = useQuantityFormat(category);
  return createElement(
    Fragment,
    null,
    JSON.stringify({
      unit: format.unit,
      text: VALUES.map(format.text),
      compact: VALUES.map(format.compact),
    }),
  );
}

function viaHook(category: QuantityCategory, config: FormatConfig, locale: Locale) {
  const store = createStore();
  store.set(localeAtom, locale);
  store.set(formatConfigFamily(category), config);
  const html = renderToString(
    createElement(Provider, { store }, createElement(Probe, { category })),
  );
  // React escapes the quotes of the JSON text node.
  return JSON.parse(html.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
}

describe("der Formatierer ohne Hook", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("schreibt für jede Kategorie, Einheit und Sprache dasselbe wie der Hook", () => {
    let compared = 0;
    for (const category of categories) {
      const definition = CATEGORY_DEFINITIONS[category];
      const unitIds = definition.units?.map((u) => u.id) ?? [null];
      for (const unitId of unitIds) {
        for (const notation of ["fixed", "scientific"] as const) {
          const config: FormatConfig = { unitId, decimals: 3, notation };
          for (const locale of locales) {
            const plain = createQuantityFormatter(category, config, locale);
            expect(viaHook(category, config, locale), `${category}/${unitId}/${locale}`).toEqual({
              unit: plain.unit,
              text: VALUES.map(plain.text),
              compact: VALUES.map(plain.compact),
            });
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(categories.length * 4 - 1);
  });

  /// Pinned values, so that the comparison above cannot pass by both sides
  /// being wrong the same way.
  it("rechnet in die gewählte Einheit um und formatiert nach der Sprache", () => {
    const thickness: FormatConfig = { unitId: "mm", decimals: 2, notation: "fixed" };
    expect(createQuantityFormatter("thickness", thickness, "de").text(1234.5)).toBe("1.234,50");
    expect(createQuantityFormatter("thickness", thickness, "en").text(1234.5)).toBe("1,234.50");
    expect(createQuantityFormatter("thickness", thickness, "en").compact(2.5e-5)).toBe("2.50E-5");

    const angle = CATEGORY_DEFINITIONS.angle.units?.find((u) => u.id !== "deg");
    if (angle) {
      const radians = createQuantityFormatter(
        "angle",
        { unitId: angle.id, decimals: 4, notation: "fixed" },
        "en",
      );
      expect(radians.convert(180)).toBeCloseTo(angle.fromCanonical(180), 12);
    }
  });
});
