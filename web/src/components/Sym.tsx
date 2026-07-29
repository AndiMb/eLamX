import type { SymbolSpec } from "../lib/symbols";

// Renders an indexed symbol as real <sub> markup - rule (1) in lib/symbols.ts.
// Use this in every slot that can hold markup; reach for symText() only where
// the platform accepts plain text and nothing else.
export function Sym({ base, sub }: SymbolSpec) {
  if (!sub) return <>{base}</>;
  return (
    <>
      {base}
      <sub>{sub}</sub>
    </>
  );
}
