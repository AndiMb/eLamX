# eLamX Web

A from-scratch web reimplementation of [eLamX](https://www.tu-dresden.de/ing/maschinenwesen/ilr/lft/elamx), the classical laminate theory (CLT) calculation tool for fiber-reinforced composites. The calculation core is ported from the original Java desktop application to Rust and compiled to WebAssembly; the UI is a new React/TypeScript frontend.

## Structure

- **`elamx-core/`** — Rust workspace.
  - `core/` — the CLT calculation engine itself (materials, layers, laminates, ABD-matrix assembly, failure criteria and their 3D failure envelopes, reserve factors, last-ply-failure, pressure vessels), plus `plate/` for rectangular-plate analyses on top of a laminate (buckling and deformation, sharing the Ritz machinery in `plate/ritz.rs`; vibration, cutouts and stiffeners are not ported yet).
  - `wasm/` — thin `wasm-bindgen` bindings exposing `core` to the browser (JSON in, JSON out).
- **`web/`** — React + TypeScript + Vite frontend. State is managed with Jotai (one reactive atom family per laminate/material), all calculations run client-side via the WASM module.
- **`desktop/`** — an Electron shell that packages the built frontend as a desktop program for Windows, Linux and macOS. It adds nothing to the app: the same bundle runs in a browser tab, and the shell only supplies what a page cannot have — a real Open dialog, a Save that writes back to the file it opened, and a file association for `.elamx`.

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

## A desktop program

The frontend is a static bundle and runs in any browser, `web/dist/` on a web
server included. `desktop/` wraps that same bundle in Electron for the case
where a program is wanted rather than a page — on Windows, Linux and macOS.

```sh
cd desktop
npm install
npm start          # build the frontend, then run it in the shell
npm run dist       # Windows: installer + portable, into release/
npm run dist:linux # AppImage + deb
npm run dist:mac   # dmg + zip, x64 and arm64
npm run smoke      # start the packaged app and check it works
```

Each platform's build goes to `desktop/release/`. They are all around 110 MB,
because Electron brings its own Chromium — that is the price of not depending
on what is installed on the machine. A platform can only be built on itself;
for all three at once, use the workflow below.

`npm run smoke` is the check that packaging cannot make for itself. Packaging
can succeed and still ship a stale bundle, a worker that will not start or a
wasm module served as the wrong type — none of which produce an error at build
time, only a window that opens and does nothing. So it starts the packaged
binary, asks it whether it is where it should be, whether the page can reach
Node (it must not), and whether a plate calculation comes back.

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

The executables are **not code-signed**, so Windows SmartScreen and macOS
Gatekeeper will warn about them on another machine. That needs a certificate,
not a change here.

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

`.github/workflows/desktop.yml` builds the desktop applications for Windows,
Linux and macOS. It runs on demand and on a version tag rather than on every
push: each run produces over 100 MB per platform. The WASM core is built once
and handed to the three packaging jobs, since `wasm32-unknown-unknown` output
does not depend on what compiled it.

The Windows and Linux artifacts are smoke-tested there (Linux under `xvfb`);
the macOS one is build-verified only, because starting a windowed application
on a hosted macOS runner needs a login session that is not reliably present,
and a failure for that reason would say nothing about the build.

Nothing is code-signed. That is a decision rather than an oversight — it costs
a certificate per platform and, on macOS, notarisation on top — so the
artifacts are fine to hand to a colleague and will be warned about by
SmartScreen and Gatekeeper on a stranger's machine.

## License

GPL-3.0-only, matching the original eLamX project.
