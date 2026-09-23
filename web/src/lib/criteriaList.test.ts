import { describe, expect, it } from "vitest";
import {
  addCriterion,
  criteriaOf,
  moveCriterion,
  removeCriterion,
  withCriteria,
  withPrimary,
} from "./criteriaList";
import type { LayerRow } from "./constants";

const row: LayerRow = {
  id: "a",
  name: "Lage 1",
  angle: 0,
  thickness: 0.125,
  materialId: "m",
  criterionId: "puck",
};

describe("Kriterienliste einer Lage", () => {
  it("liest das primäre Kriterium zuerst, jedes nur einmal", () => {
    expect(criteriaOf(row)).toEqual(["puck"]);
    expect(criteriaOf({ ...row, extraCriteria: ["hashin", "puck", "tsai_wu"] })).toEqual([
      "puck",
      "hashin",
      "tsai_wu",
    ]);
  });

  it("schreibt die Liste in primär und Zusatz zurück", () => {
    expect(withCriteria(row, ["tsai_wu", "hashin"])).toEqual({
      ...row,
      criterionId: "tsai_wu",
      extraCriteria: ["hashin"],
    });
    // One criterion: no extraCriteria key at all, as before the feature.
    const single = withCriteria({ ...row, extraCriteria: ["hashin"] }, ["hashin"]);
    expect(single).toEqual({ ...row, criterionId: "hashin" });
    expect("extraCriteria" in single).toBe(false);
    // A ply always keeps a criterion.
    expect(withCriteria(row, [])).toBe(row);
  });

  it("setzt ein neues primäres Kriterium an die erste Stelle", () => {
    const listed = { ...row, extraCriteria: ["hashin", "tsai_wu"] as LayerRow["extraCriteria"] };
    expect(criteriaOf(withPrimary(listed, "tsai_wu"))).toEqual(["tsai_wu", "hashin"]);
    expect(criteriaOf(withPrimary(listed, "max_stress"))).toEqual(["max_stress", "hashin", "tsai_wu"]);
  });

  it("verschiebt, ergänzt und entfernt", () => {
    expect(moveCriterion(["puck", "hashin", "tsai_wu"], 2, -1)).toEqual(["puck", "tsai_wu", "hashin"]);
    expect(moveCriterion(["puck", "hashin"], 0, -1)).toEqual(["puck", "hashin"]);
    expect(moveCriterion(["puck", "hashin"], 1, 1)).toEqual(["puck", "hashin"]);
    expect(addCriterion(["puck"], "hashin")).toEqual(["puck", "hashin"]);
    expect(addCriterion(["puck"], "puck")).toEqual(["puck"]);
    expect(removeCriterion(["puck", "hashin"], 0)).toEqual(["hashin"]);
    expect(removeCriterion(["puck"], 0)).toEqual(["puck"]);
  });
});
