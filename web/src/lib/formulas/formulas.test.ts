// The formula registry has to give the explanations exactly what they showed
// before it existed, and every formula has to set in MathJax as well as in
// KaTeX - the report's derivation is MathJax.
import { describe, expect, test } from "vitest";
import { translate } from "../../i18n";
import type { EngineeringConstantsDto, LayerResultDto, MaterialDto } from "../types";
import { texToSvg } from "../report/pdf/math";
import {
  aMatrixFormula,
  bucklingFormula,
  criterionMatrixFormula,
  cutoutFormula,
  deformationFormula,
  envelopeRayFormula,
  exFormula,
  lastPlyFailureFormula,
  localQFormula,
  nuxyFormula,
  pressureVesselFormula,
  qBarFormula,
  sheetFormula,
  springInFormula,
  texExp,
  texNumber,
  vibrationFormula,
  type Formula,
} from ".";

const de = { t: (k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate("de", k, p), locale: "de" as const };

const material = {
  id: "m",
  name: "CFK",
  e_par: 140000,
  e_nor: 10000,
  nue12: 0.3,
  g: 5000,
} as MaterialDto;

const ec = { ex_simple: 57381.234, nuxy_simple: 0.31234 } as EngineeringConstantsDto;
const abdInv = [
  [5.36e-6, -1.674e-6],
  [0, 0],
];

function layer(nr: number, criteria: [string, number][]): LayerResultDto {
  const rf = (v: number) => ({ minimal_reserve_factor: v, failure_name: "", failure_type: "Undamaged" as const });
  const min = Math.min(...criteria.map((c) => c[1]));
  return {
    layer_number: nr,
    rr_lower: rf(min),
    rr_upper: rf(min + 1),
    by_criterion: criteria.map(([id, v]) => ({ id, rr_lower: rf(v), rr_upper: rf(v + 1) })),
  } as unknown as LayerResultDto;
}

describe("the numbers in a formula", () => {
  test("are written in the language's notation", () => {
    expect(texNumber("de")(141000.5, 1)).toBe("141.000{,}5");
    expect(texNumber("en")(141000.5, 1)).toBe("141{,}000.5");
    expect(texNumber("de")(Number.NaN)).toBe("\\text{–}");
    expect(texExp(-1.674e-6, "de")).toBe("-1{,}674\\times 10^{-6}");
  });
});

describe("the explanations show what they showed before the registry, the comma braced", () => {
  test("local stiffness", () => {
    const f = localQFormula(material, de);
    expect(f.tex).toBe(
      "\\nu_{21} = \\nu_{12}\\dfrac{E_\\perp}{E_\\parallel},\\quad Q_{11} = \\dfrac{E_\\parallel}{1-\\nu_{12}\\nu_{21}},\\quad Q_{12} = \\nu_{21}Q_{11},\\quad Q_{22} = \\dfrac{E_\\perp}{1-\\nu_{12}\\nu_{21}},\\quad Q_{66} = G",
    );
    expect(f.substituted?.split("\n")[1]).toBe(
      "\\nu_{21} &= 0{,}300 \\cdot \\dfrac{10.000}{140.000} = 0{,}0214 \\\\",
    );
    expect(f.substituted).toContain("Q_{11} &= \\dfrac{140.000}{1 - 0{,}300 \\cdot 0{,}0214} = 140.905{,}8\\ \\text{MPa}");
  });

  test("the rotated stiffness names the core's value", () => {
    const f = qBarFormula({ angle_deg: 0, q_global: [[140904.4]] }, material, de);
    expect(f.substituted).toContain("\\theta &= 0{,}0^\\circ, \\quad c = 1{,}000, \\quad s = 0{,}000");
    expect(f.substituted).toContain("&= 140.904{,}4\\ \\text{MPa} \\quad (\\text{");
  });

  test("A11 as a sum", () => {
    const f = aMatrixFormula([{ a_contribution: [[10]] }, { a_contribution: [[20.25]] }], [[30.25]], de);
    expect(f.substituted).toBe("A_{11} = 10{,}0 + 20{,}3 = 30{,}3\\ \\text{N/mm}");
  });

  test("Ex and nuxy from the inverse", () => {
    expect(exFormula(abdInv, 3.25, ec, de).substituted).toBe(
      "E_x = \\dfrac{1}{5{,}360\\times 10^{-6} \\cdot 3{,}25} = 57.381{,}2\\ \\text{MPa}",
    );
    expect(nuxyFormula(abdInv, ec, de).substituted).toBe(
      "\\nu_{xy} = -\\dfrac{-1{,}674\\times 10^{-6}}{5{,}360\\times 10^{-6}} = 0{,}3123",
    );
  });

  test("the criterion matrix works the ply with the most criteria", () => {
    const f = criterionMatrixFormula([layer(1, [["puck", 2]]), layer(2, [["puck", 1.5], ["max_stress", 3]])], de)!;
    expect(f.substituted).toBe("RF_{2} = \\min\\left(1{,}500,\\; 3{,}000\\right) = 1{,}500");
    expect(criterionMatrixFormula([{ ...layer(1, []), by_criterion: [] } as unknown as LayerResultDto], de)).toBeNull();
  });

  test("the modules' one-liners", () => {
    expect(bucklingFormula(1.234567891, { m: 5, n: 5 }, de).substituted).toBe("\\lambda_{crit} = 1{,}23457");
    expect(vibrationFormula(123.4567891, { m: 5, n: 5 }, de).substituted).toBe("f_1 = 123{,}457\\ \\mathrm{Hz}");
    expect(lastPlyFailureFormula(1e-6, 3, de).substituted).toBe("\\eta = 0{,}000001");
  });
});

describe("every formula sets in MathJax", () => {
  const all: Formula[] = [
    localQFormula(material, de),
    qBarFormula({ angle_deg: 45, q_global: [[42187.5]] }, material, de),
    aMatrixFormula([{ a_contribution: [[10]] }], [[10]], de),
    exFormula(abdInv, 3.25, ec, de),
    nuxyFormula(abdInv, ec, de),
    criterionMatrixFormula([layer(1, [["puck", 1.5], ["max_stress", Number.POSITIVE_INFINITY]])], de)!,
    sheetFormula({ number: 3, zExample: -0.5, epsilonX0: 1e-3, kappaX: 2e-4, epsilonX: 9e-4 }, de),
    envelopeRayFormula({ rf: 2, failure_load: [200, 0, 0] }, [100, 0, 0], de),
    bucklingFormula(1.2, { m: 5, n: 5 }, de),
    vibrationFormula(120, { m: 5, n: 5 }, de),
    deformationFormula(0.012, { m: 5, n: 5 }, de),
    lastPlyFailureFormula(1e-6, 5, de),
    cutoutFormula(123, de),
    pressureVesselFormula(200, de),
    springInFormula({ delta_angle: -0.5, alpha_circumferential: 2e-6, delta_t: -150 }, de),
  ];
  test.each(all.map((f) => [f.title, f] as const))("%s", async (_, f) => {
    await expect(texToSvg(f.tex)).resolves.toMatchObject({ svg: expect.stringContaining("<path") });
    if (f.substituted) {
      await expect(texToSvg(f.substituted)).resolves.toMatchObject({ svg: expect.stringContaining("<svg") });
    }
  });
});
