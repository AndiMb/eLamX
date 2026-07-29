// ONE notation rule for indexed symbols across the whole UI, because the app
// had grown four of them: real <sub> markup (MaterialPage), ASCII underscores
// (N_x, t_ges, E_x), Unicode subscript characters (σ₁, τ₁₂) and no marking at
// all (A11, σx, Q̄12) - sometimes two of them side by side in one panel.
//
// The rule:
//
//   1. Wherever markup can be rendered, an index IS real <sub> markup. Use
//      the <Sym> component (components/Sym.tsx) when the symbol comes from
//      data; literal <sub> in JSX is equally fine and is what MaterialPage's
//      static field captions already do.
//   2. In slots that accept plain text ONLY, the index is written adjacent,
//      with no separator: "Nx", "A11", "τ12". Use symText().
//
// Slots meant by (2) are <option> content (its content model is text - any
// markup inside is dropped), aria-label/title attributes, and SVG <text>.
//
// Why adjacency and not "N_x" for case (2): an underscore in rendered UI text
// reads as leaked markup to the user, whereas "τxy" and "A11" are how the
// composites literature writes these anyway. Why not Unicode subscripts
// (σ₁, τ₁₂): the block has no subscript "y" at all, so ν_xy, σ_y, κ_xy and
// E_y could never be expressed - it can't be the general rule, and a rule
// that covers only some symbols is what got us here.
export interface SymbolSpec {
  /** Base glyph(s), e.g. "N", "ε", "Q̄". */
  base: string;
  /** Index, e.g. "x", "xy", "11", "ges". Omit for an unindexed symbol. */
  sub?: string;
}

/** Plain-text rendering for markup-free slots - see rule (2) above. */
export function symText(sym: SymbolSpec): string {
  return sym.sub ? `${sym.base}${sym.sub}` : sym.base;
}
