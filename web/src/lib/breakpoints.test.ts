import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS, NON_WIDTH_CONDITIONS } from "./breakpoints";

// A media query cannot read a custom property, so the widths have to appear
// literally in the CSS as well as in the TypeScript that calls matchMedia.
// This is what stops the two drifting: it reads the stylesheets and holds them
// to the list in breakpoints.ts.
// Read from disk rather than imported: vitest stubs a `.css` import to an
// empty module, `?raw` included.
const STYLESHEETS = ["../App.css", "../index.css"];

function mediaConditions(): string[] {
  return STYLESHEETS.flatMap((relative) => {
    const css = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
    return [...css.matchAll(/@media([^{]*)\{/g)].map((m) => m[1].trim());
  });
}

const documented = new Set<string>([
  ...Object.values(BREAKPOINTS).map((b) => b.condition),
  ...NON_WIDTH_CONDITIONS,
]);

describe("breakpoints", () => {
  it("finds the stylesheets", () => {
    expect(mediaConditions().length).toBeGreaterThan(5);
  });

  it("uses no width the TypeScript does not know about", () => {
    const unknown = mediaConditions().filter((c) => !documented.has(c));
    expect(unknown, `undocumented media conditions in the CSS: ${unknown.join(", ")}`).toEqual([]);
  });

  it("still uses every breakpoint it documents", () => {
    const used = new Set(mediaConditions());
    for (const [name, breakpoint] of Object.entries(BREAKPOINTS)) {
      expect(used.has(breakpoint.condition), `${name} (${breakpoint.condition}) is unused`).toBe(
        true,
      );
    }
  });

  it("spells the conditions the way matchMedia will receive them", () => {
    // `window.matchMedia("(max-width: 640px)")` and a CSS `@media (max-width:
    // 640px)` have to be the same string for this file to be able to compare
    // them at all - which is the reason the constants are conditions rather
    // than numbers.
    for (const breakpoint of Object.values(BREAKPOINTS)) {
      expect(breakpoint.condition).toMatch(/^\((max|min)-width: \d+px\)$/);
    }
  });
});
