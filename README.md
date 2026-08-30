# eLamX Web

A from-scratch web reimplementation of [eLamX](https://www.tu-dresden.de/ing/maschinenwesen/ilr/lft/elamx), the classical laminate theory (CLT) calculation tool for fiber-reinforced composites. The calculation core is ported from the original Java desktop application to Rust and compiled to WebAssembly; the UI is a new React/TypeScript frontend.

## Structure

- **`elamx-core/`** — Rust workspace.
  - `core/` — the CLT calculation engine itself (materials, layers, laminates, ABD-matrix assembly, failure criteria, reserve factors, last-ply-failure), plus `plate/` for rectangular-plate analyses on top of a laminate (buckling; vibration, deformation, cutouts and stiffeners are not ported yet).
  - `wasm/` — thin `wasm-bindgen` bindings exposing `core` to the browser (JSON in, JSON out).
- **`web/`** — React + TypeScript + Vite frontend. State is managed with Jotai (one reactive atom family per laminate/material), all calculations run client-side via the WASM module.

## Getting started

### Prerequisites

- [Rust](https://rustup.rs/) (stable) + [`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/)
- [Node.js](https://nodejs.org/) 20+

### Build the WASM core

```sh
cd elamx-core/wasm
wasm-pack build --target web --out-dir ../../web/src/wasm-pkg
```

This regenerates `web/src/wasm-pkg/`, which is gitignored and must be rebuilt after any change under `elamx-core/`.

### Run the frontend

```sh
cd web
npm install
npm run dev
```

Other useful commands (run from `web/`): `npm run build` (typecheck + production build), `npm run lint` (Oxlint), `npm test` (Vitest).

The frontend suite covers the parts that are arithmetic or state rather than
pixels: stacking notation, number formatting, unit round-trips, the store's
migrations and the comparison's bookkeeping. It runs in Node with a small
`localStorage` stand-in (`src/test/setup.ts`) rather than a DOM - what needs a
real browser is checked in one, where a jsdom stub would prove nothing.

## Languages

The UI ships in English and German, switchable at runtime via the picker in the
top bar (the choice is remembered in `localStorage`; on first visit the browser's
`navigator.languages` decides, falling back to English).

Translations live in `web/src/i18n/`:

- `en.ts` — the English catalog. It is the **source of truth**: `MessageKey` is
  derived from its keys, so every other catalog is typed as
  `Record<MessageKey, string>` and a missing or misspelled key is a compile
  error, not a runtime hole. (English holds this role because the original Java
  eLamX did the same — NetBeans `Bundle.properties` is English, with
  `Bundle_de.properties` as the German overlay.)
- `de.ts` — the German catalog.
- `index.tsx` — the runtime: `useT()` in components, `t()` for non-React call
  sites, `useTx()` when a placeholder is a React node, plus
  `failureModeLabel()` for the failure-mode identifiers coming out of the Rust
  core (which stay language-neutral on that side).

To add a language, create `xx.ts` typed as `Messages`, register it in
`CATALOGS`, and add an entry to `LOCALES`. TypeScript then lists every key you
still have to translate.

Note that numbers are formatted per locale (`1,234.5` vs `1.234,5`); parsing
accepts both decimal separators regardless of language.

### Run the Rust tests

```sh
cd elamx-core
cargo test
```

This includes the golden-master suite in `core/tests/golden/`, which compares
the port against numbers the original Java eLamX 3.x produced. Those numbers are
checked in, so the suite needs no Java installation - see
`core/tests/golden/README.md` for how to regenerate them when the cases change.

## Continuous integration

`.github/workflows/ci.yml` runs the Rust suite, the `wasm-pack` build and the
frontend's lint, tests and typecheck/build on every push to `main` and on every
pull request - the same commands documented above.

## License

GPL-3.0-only, matching the original eLamX project.
