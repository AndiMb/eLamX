# eLamX Web - frontend

The React + TypeScript + Vite frontend of eLamX Web. Everything about building,
running and testing it - including the WASM core it needs first - is in the
[README at the repository root](../README.md).

In short, from this directory, once `src/wasm-pkg/` has been built:

```sh
npm install
npm run dev     # development server
npm run build   # typecheck + production build into dist/
npm run lint    # Oxlint
npm test        # Vitest
```
