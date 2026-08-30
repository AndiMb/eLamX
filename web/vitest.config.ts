import { defineConfig } from "vitest/config";

// Node environment, not jsdom: what is worth testing here is arithmetic and
// state - stacking notation, number formatting, unit conversion, the store's
// migrations and the comparison's bookkeeping. None of it needs a DOM, and the
// pieces that do (canvas projection, pointer handling) are checked in a real
// browser instead, where a jsdom stub would prove nothing.
//
// `setup.ts` supplies the one browser API the store does need: localStorage,
// which every persisted atom reads at module load.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
