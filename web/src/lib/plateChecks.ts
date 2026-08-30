// The guard rails eLamX 3.x puts around a Ritz plate analysis, ported.
//
// Both plate modules compute reactively, so there is no "Berechnen" button to
// refuse the way `ControlPanel.checkInput` does in the original - the checks
// have to run on every keystroke and show up beside the result instead of in a
// modal. What they say is the same, and it is worth saying: a Ritz series is
// an UPPER bound on the buckling load, so an under-resolved one does not look
// wrong. It looks like a plate that is stronger than it is.
//
// Reference: Classical_Laminated_Plate_Theory_Plate_UI/.../buckling/
// ControlPanel.java#checkInput and its deformation counterpart.
import type { BoundaryConditionId } from "./types";
import type { MessageKey } from "../i18n";

export interface PlateCheck {
  /** `error`: the original refuses to compute at all. `warning`: it computes
   *  and says the numbers are questionable. */
  severity: "error" | "warning";
  message: MessageKey;
}

export interface PlateGeometry {
  length: number;
  width: number;
  bc_x: BoundaryConditionId;
  bc_y: BoundaryConditionId;
  /** Term count in x. The original checks the aspect ratio against this one
   *  only, and so does this. */
  m: number;
}

export function plateChecks(input: PlateGeometry): PlateCheck[] {
  const checks: PlateCheck[] = [];

  // A plate free on all four edges is not held anywhere: there is nothing to
  // buckle or bend against. The core notices too, but only as far downstream
  // as "stiffness matrix is not positive definite" - true, and useless to
  // someone who picked two dropdown entries.
  if (input.bc_x === "FF" && input.bc_y === "FF") {
    checks.push({ severity: "error", message: "plate.check.freeEdges" });
  }

  // The shape functions are sines and cosines over the plate; a long plate
  // buckles into many half-waves along its length, and m of them is all the
  // series has to spend. Java's rule verbatim: ratio < 1/m or m < ratio.
  const ratio = input.length / input.width;
  if (Number.isFinite(ratio) && ratio > 0 && input.m > 0) {
    if (ratio < 1 / input.m || input.m < ratio) {
      checks.push({ severity: "warning", message: "plate.check.terms" });
    }
  }

  return checks;
}

/** Whether any check stops the analysis from being meaningful at all. */
export function hasBlockingCheck(checks: PlateCheck[]): boolean {
  return checks.some((c) => c.severity === "error");
}
