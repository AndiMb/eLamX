// Lazily initializes the elamx-wasm module once and caches the promise, since
// `init()` must only run a single time per page load.

let initPromise: Promise<typeof import("../wasm-pkg/elamx_wasm.js")> | null = null;

export function loadElamxWasm() {
  if (!initPromise) {
    initPromise = import("../wasm-pkg/elamx_wasm.js").then(async (mod) => {
      await mod.default();
      return mod;
    });
  }
  return initPromise;
}
