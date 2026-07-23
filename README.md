# eLamX Web

A from-scratch web reimplementation of [eLamX](https://www.tu-dresden.de/ing/maschinenwesen/ilr/lft/elamx), the classical laminate theory (CLT) calculation tool for fiber-reinforced composites. The calculation core is ported from the original Java desktop application to Rust and compiled to WebAssembly; the UI is a new React/TypeScript frontend.

## Structure

- **`elamx-core/`** — Rust workspace.
  - `core/` — the CLT calculation engine itself (materials, layers, laminates, ABD-matrix assembly, failure criteria, reserve factors).
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

Other useful commands (run from `web/`): `npm run build` (typecheck + production build), `npm run lint` (Oxlint).

### Run the Rust tests

```sh
cd elamx-core
cargo test
```

## License

GPL-3.0-only, matching the original eLamX project.
