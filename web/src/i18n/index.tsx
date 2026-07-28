// A small, typed i18n layer rather than i18next/react-intl: this app needs
// exactly two languages, `{name}` interpolation and a two-form plural, which
// is roughly what the ~90 lines below do - while a full framework would add
// ~40 kB to a bundle that ships to phones, and would give WEAKER guarantees
// here, since its string keys are untyped by default. Deriving `MessageKey`
// from the English catalog instead turns every typo, every forgotten German
// translation and every leftover key after a rename into a compile error.
//
// Adding a language: create `src/i18n/xx.ts` typed as `Messages` (TypeScript
// then lists any key still missing), add it to CATALOGS and LOCALES below.
// Nothing else in the app needs to change.
// (A .tsx file, not .ts, only because useTx() below builds React elements.)
import { Fragment, useCallback } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ReactNode } from "react";
import { en } from "./en";
import { de } from "./de";

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export type Locale = "en" | "de";

/** Display names are intentionally endonyms - each language names itself. */
export const LOCALES: { id: Locale; label: string; short: string }[] = [
  { id: "de", label: "Deutsch", short: "DE" },
  { id: "en", label: "English", short: "EN" },
];

const CATALOGS: Record<Locale, Messages> = { en, de };

const STORAGE_KEY = "elamx.locale";

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "de";
}

// Resolved eagerly at module load (not in a React effect), because the store
// modules create the initial laminate/material - with their default names -
// while the module graph is still evaluating, long before React mounts.
function detectInitialLocale(): Locale {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (isLocale(stored)) return stored;
  } catch {
    // Malformed or unavailable storage (private mode, quota) - fall through
    // to the browser's own preference rather than failing to start.
  }
  const preferred = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const tag of preferred) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

const initialLocale = detectInitialLocale();

// Mirrors localeAtom for the handful of call sites that cannot be React
// hooks - the default-name factories in lib/constants.ts and
// store/laminateAtoms.ts, which run inside jotai write functions and at
// module scope. Kept in sync SYNCHRONOUSLY by setLocaleAtom below (not by an
// effect), so it is never one render stale.
let currentLocale: Locale = initialLocale;

export const localeAtom = atomWithStorage<Locale>(STORAGE_KEY, initialLocale);

/** The only supported way to change the language - see `currentLocale`. */
export const setLocaleAtom = atom(null, (_get, set, locale: Locale) => {
  currentLocale = locale;
  set(localeAtom, locale);
});

export type MessageParams = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  // `?? en[key]` is the runtime safety net behind the compile-time guarantee:
  // it also covers a catalog loaded from somewhere less typed later on.
  const template = CATALOGS[locale][key] ?? en[key];
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Non-reactive translate, for code that is not a React component. Prefer
 * useT() anywhere a re-render on language change is wanted - this one is for
 * strings that are captured once (default names of newly created objects).
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(currentLocale, key, params);
}

/** The active locale outside React - e.g. for Intl in non-component code. */
export function getLocale(): Locale {
  return currentLocale;
}

export function useLocale(): Locale {
  return useAtomValue(localeAtom);
}

export function useSetLocale(): (locale: Locale) => void {
  return useSetAtom(setLocaleAtom);
}

/**
 * The translate function for components. Subscribing to localeAtom here is
 * what makes a language switch re-render every translated component.
 */
export function useT(): (key: MessageKey, params?: MessageParams) => string {
  const locale = useAtomValue(localeAtom);
  return useCallback((key: MessageKey, params?: MessageParams) => translate(locale, key, params), [locale]);
}

/**
 * Like useT(), but the parameters may be React nodes - for the few messages
 * where markup sits INSIDE the sentence (a link, a bold "+"). Splitting such
 * a sentence into "before" and "after" keys instead would force every
 * translation to keep the fragments in English word order.
 */
export function useTx(): (key: MessageKey, params: Record<string, ReactNode>) => ReactNode[] {
  const locale = useAtomValue(localeAtom);
  return useCallback(
    (key: MessageKey, params: Record<string, ReactNode>) => {
      const template = CATALOGS[locale][key] ?? en[key];
      // split() with a capturing group yields [text, name, text, name, ...],
      // so odd indices are the placeholder names. Index keys are safe here:
      // the array's length and order are fixed by the template, and it is
      // rebuilt wholesale whenever the template (i.e. the language) changes.
      return template
        .split(/\{(\w+)\}/g)
        .map((part, i) =>
          i % 2 === 1 ? (
            <Fragment key={i}>{params[part] ?? `{${part}}`}</Fragment>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        );
    },
    [locale],
  );
}

/**
 * Failure mode names come out of the Rust core as stable, language-neutral
 * identifiers ("MatrixFailureModusA"), so they are translated here rather
 * than in elamx-core - the core stays free of presentation concerns, and a
 * criterion added there needs no i18n awareness. An unrecognized name is
 * shown verbatim, which is more useful than an empty cell.
 */
export function failureModeLabel(locale: Locale, failureName: string): string {
  if (!failureName) return "";
  const key = `failureMode.${failureName}` as MessageKey;
  return key in en ? translate(locale, key) : failureName;
}
