import { describe, expect, it } from "vitest";
import { en } from "./en";
import { de } from "./de";

// TypeScript already guarantees that every catalog has every key: `Messages`
// is derived from `en`, so a missing or misspelled key is a compile error.
// What it cannot check is the CONTENT of a translation, and the one part of
// the content that is machine-readable is the placeholders: a German string
// that writes {anzahl} where the English one writes {count} renders the
// literal braces at runtime, in the one language nobody testing in English
// would see.
const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the message catalogs", () => {
  it("use the same placeholders in every language", () => {
    const mismatched: string[] = [];
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const source = placeholders(en[key]);
      const target = placeholders(de[key]);
      if (source.join(",") !== target.join(",")) {
        mismatched.push(`${key}: en={${source}} de={${target}}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("translate every key rather than leaving the English text in place", () => {
    // Not every string HAS to differ - "Puck" is "Puck" - so this only flags
    // the long ones, where an identical string is a forgotten translation
    // rather than a word that is the same in both languages.
    const untranslated = (Object.keys(en) as (keyof typeof en)[]).filter(
      (key) => en[key].length > 60 && en[key] === de[key],
    );
    expect(untranslated).toEqual([]);
  });

  it("has no empty message", () => {
    const empty = (Object.keys(en) as (keyof typeof en)[]).filter(
      (key) => en[key].trim() === "" || de[key].trim() === "",
    );
    expect(empty).toEqual([]);
  });
});
