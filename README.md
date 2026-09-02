# eLamX Web

A from-scratch web reimplementation of [eLamX](https://www.tu-dresden.de/ing/maschinenwesen/ilr/lft/elamx), the classical laminate theory (CLT) calculation tool for fiber-reinforced composites. The calculation core is ported from the original Java desktop application to Rust and compiled to WebAssembly; the UI is a new React/TypeScript frontend.

## Structure

- **`elamx-core/`** — Rust workspace.
  - `core/` — the CLT calculation engine itself (materials, layers, laminates, ABD-matrix assembly, failure criteria and their 3D failure envelopes, reserve factors, last-ply-failure, pressure vessels), plus `plate/` for rectangular-plate analyses on top of a laminate (buckling and deformation, sharing the Ritz machinery in `plate/ritz.rs`; vibration, cutouts and stiffeners are not ported yet).
  - `wasm/` — thin `wasm-bindgen` bindings exposing `core` to the browser (JSON in, JSON out).
- **`web/`** — React + TypeScript + Vite frontend. State is managed with Jotai (one reactive atom family per laminate/material), all calculations run client-side via the WASM module.
- **`desktop/`** — an Electron shell that packages the built frontend as a Windows program. It adds nothing to the app: the same bundle runs in a browser tab, and the shell only supplies what a page cannot have — a real Open dialog, a Save that writes back to the file it opened, and a file association for `.elamx`.

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

## A Windows program

The frontend is a static bundle and runs in any browser, `web/dist/` on a web
server included. `desktop/` wraps that same bundle in Electron for the case
where a program is wanted rather than a page.

```sh
cd desktop
npm install
npm start          # build the frontend, then run it in the shell
npm run dist       # build the frontend, then produce installers in release/
```

`npm run dist` writes two things to `desktop/release/`: an NSIS installer
(`eLamX Setup <version>.exe`) and a portable single file
(`eLamX-<version>-portable.exe`). Both are around 110 MB, because Electron
brings its own Chromium — that is the price of not depending on what is
installed on the machine.

Two details are worth knowing before changing anything there:

- **The app is served over a custom `app://` scheme, not from `file://`.** The
  calculation core runs in a *module* worker, and Chromium refuses module
  scripts over `file://`; the WASM module also wants a real `application/wasm`
  Content-Type, which `file://` does not provide. The scheme is registered as
  standard and secure, which additionally gives the renderer a stable origin,
  so the `localStorage` the whole project state lives in survives.
- **The renderer stays a web page.** No Node integration, an isolated context,
  and a preload that exposes four named functions and nothing else. Everything
  else in the app is unchanged web code and asks the shell for nothing — see
  `web/src/lib/desktop.ts`, which returns `null` in a browser and is what every
  call site checks.

The executables are **not code-signed**, so Windows SmartScreen will warn about
them on another machine. That needs a certificate, not a change here.

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

### Regenerate the TypeScript bindings

The types that cross the wasm boundary are not written twice. `web/src/lib/generated/`
is produced from the Rust structs by [ts-rs](https://github.com/Aleph-Alpha/ts-rs)
and committed, so the frontend builds without a Rust toolchain:

```sh
cd elamx-core
cargo test --workspace --features ts
```

Run this after changing any type that a `compute_*` entry point takes or returns,
and commit what changes. `web/src/lib/types.ts` gives those types the app's own
names (`Dto` for a payload, `Id` for a string union) and holds what only the
frontend has - the criterion catalog, the unit tables, the defaults. CI
regenerates and fails on any difference.

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

The Windows installers are deliberately not built there: they are a 110 MB
artifact per run, and nothing in CI can check the one thing that would justify
the cost, which is that the program starts on a machine that is not this one.
Build them from `desktop/` when there is a release to hand out.

## License

GPL-3.0-only, matching the original eLamX project.
