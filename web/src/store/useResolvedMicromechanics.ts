import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { materialsAtom } from "./materialsAtoms";
import { fibresAtom, matricesAtom, recomputeMicromechanicsAtom } from "./micromechanicsAtoms";

/**
 * Keeps every micromechanic material in step with the fibre and the matrix it
 * is built from.
 *
 * Mounted once, in the shell. The alternative - a derived atom every consumer
 * reads instead of `materialsAtom` - would mean rewriting every call site for
 * a case most projects never use, and would make a synchronous read
 * asynchronous throughout. Here the stored values stay the source of truth,
 * exactly as in the file, and this is what refreshes them.
 *
 * The write inside the action is guarded by an equality check, which is what
 * stops the loop this otherwise obviously is: a run that changes nothing
 * writes nothing, so the effect settles after one pass.
 */
export function useResolvedMicromechanics() {
  const materials = useAtomValue(materialsAtom);
  const fibres = useAtomValue(fibresAtom);
  const matrices = useAtomValue(matricesAtom);
  const recompute = useSetAtom(recomputeMicromechanicsAtom);

  useEffect(() => {
    void recompute();
  }, [materials, fibres, matrices, recompute]);
}
