import { describe, expect, it } from "vitest";
import { MATERIAL_CATALOG } from "./materialCatalog";

// The catalogue is generated (see web/scripts/generate-material-catalog.mjs),
// so what needs checking is not the arithmetic - there is none - but that the
// generation LANDED: a regex that matched the wrong lines, or an off-by-one in
// the indexing, would produce a file that still compiles and is quietly wrong.
//
// Two ends of the list are therefore transcribed here by hand from the Java,
// and the rest is checked for the properties a ply from the literature must
// have whatever its numbers are.

describe("the bundled material catalogue", () => {
  it("has the 33 entries the original ships", () => {
    expect(MATERIAL_CATALOG).toHaveLength(33);
  });

  it("matches the Java at the first entry", () => {
    // MaterialDataBase.getMaterials(), materials[0], line for line.
    expect(MATERIAL_CATALOG[0]).toEqual({
      name: "C-'(HM)' | EP-'-'",
      fibreType: "C",
      fibreName: "(HM)",
      matrixType: "EP",
      matrixName: "-",
      phi: 70,
      kind: "ud",
      properties: {
        e_par: 230000,
        e_nor: 6600,
        nue12: 0.25,
        g: 4800,
        rho: 1.63e-9,
        alpha_t_par: -7.0e-7,
        alpha_t_nor: 2.8e-5,
        beta_par: 0,
        beta_nor: 0,
        r_par_ten: 1100,
        r_par_com: 620,
        r_nor_ten: 21,
        r_nor_com: 170,
        r_shear: 65,
      },
    });
  });

  it("matches the Java at the last entry", () => {
    // materials[32] - the boron ply, and the only one that is not carbon,
    // glass or aramid. If the parse had stopped early this would be missing.
    expect(MATERIAL_CATALOG[32]).toEqual({
      name: "B-'B(4)' | EP-'5505'",
      fibreType: "B",
      fibreName: "B(4)",
      matrixType: "EP",
      matrixName: "5505",
      phi: 50,
      kind: "ud",
      properties: {
        e_par: 204000,
        e_nor: 18500,
        nue12: 0.23,
        g: 5590,
        rho: 2.0e-9,
        alpha_t_par: 0,
        alpha_t_nor: 0,
        beta_par: 0,
        beta_nor: 0,
        r_par_ten: 1260,
        r_par_com: 2500,
        r_nor_ten: 61,
        r_nor_com: 202,
        r_shear: 67,
      },
    });
  });

  it("keeps the exact double the original printed", () => {
    // 1.6000000000000003E-9 is what Java wrote for materials[1]'s density -
    // the noise of a sum, not a measurement. Rounding it here would be the
    // port having an opinion about someone else's data.
    expect(MATERIAL_CATALOG[1].properties.rho).toBe(1.6000000000000003e-9);
  });

  it("names every entry after its fibre and matrix", () => {
    for (const m of MATERIAL_CATALOG) {
      expect(m.name).toBe(`${m.fibreType}-'${m.fibreName}' | ${m.matrixType}-'${m.matrixName}'`);
    }
  });

  /**
   * The names are NOT unique, and that is the source's doing rather than a
   * parse that read a block twice: three entries are called
   * `C-'T300' | EP-'-'` and two `C-'AS4' | PEEK-'APC2'`. They are different
   * plies - different fibre volume fractions or simply different published
   * measurements of the same pairing - and the numbers differ accordingly.
   *
   * Which is why the picker shows the fibre volume fraction and the stiffness
   * beside the name: with the name alone, three rows would be indistinguishable
   * and a user could not tell which one they took.
   */
  it("carries the source's repeated names, and no genuine duplicates", () => {
    const names = MATERIAL_CATALOG.map((m) => m.name);
    expect(names.length - new Set(names).size).toBe(3);

    const whole = MATERIAL_CATALOG.map((m) => JSON.stringify(m));
    expect(new Set(whole).size).toBe(MATERIAL_CATALOG.length);
  });

  it("describes plies that could exist", () => {
    for (const m of MATERIAL_CATALOG) {
      const p = m.properties;
      for (const value of [p.e_par, p.e_nor, p.g, p.rho]) {
        expect(value, m.name).toBeGreaterThan(0);
      }
      for (const value of [p.r_par_ten, p.r_par_com, p.r_nor_ten, p.r_nor_com, p.r_shear]) {
        expect(value, m.name).toBeGreaterThan(0);
      }
      // Strengths are stored as magnitudes, compression included.
      expect(p.nue12, m.name).toBeGreaterThan(0);
      expect(p.nue12, m.name).toBeLessThan(0.5);
      // Densities in t/mm^3: a composite is between about 1.2 and 2.2 g/cm^3.
      expect(p.rho, m.name).toBeGreaterThan(1.0e-9);
      expect(p.rho, m.name).toBeLessThan(2.5e-9);
      // A fibre volume fraction, in percent.
      expect(m.phi, m.name).toBeGreaterThanOrEqual(0);
      expect(m.phi, m.name).toBeLessThanOrEqual(100);
    }
  });

  /**
   * The sharpest check on the parse, because it is the one an off-by-one row
   * cannot survive: a unidirectional ply is far stiffer and far stronger along
   * its fibres than across them, and a woven one is nearly the same in both.
   *
   * Nearly, not exactly - `C-'CFS003' | EP-'LTM25'` is 3% stiffer ACROSS the
   * warp than along it, and stronger across too. That is a real weave, not a
   * transcription slip: the entry is `TYPE_FABRIC`, and which of two roughly
   * equal directions comes out ahead is down to the cloth.
   */
  it("tells a unidirectional ply from a woven one by its own numbers", () => {
    for (const m of MATERIAL_CATALOG) {
      const p = m.properties;
      const stiffnessRatio = p.e_par / p.e_nor;
      if (m.kind === "ud") {
        // Two, not more: the glass plies sit around 2.4 to 4.8 where the
        // carbon ones are 15 to 30. Glass fibre is only three times stiffer
        // than its resin, so a glass ply really is the least anisotropic
        // unidirectional thing in the list.
        expect(stiffnessRatio, m.name).toBeGreaterThan(2);
        // Transverse tensile strength, by contrast, is tiny for every UD ply
        // in the catalogue - the lowest ratio here is twenty.
        expect(p.r_par_ten / p.r_nor_ten, m.name).toBeGreaterThan(10);
      } else if (m.kind === "fabric") {
        expect(stiffnessRatio, m.name).toBeGreaterThan(0.9);
        expect(stiffnessRatio, m.name).toBeLessThan(1.1);
      }
    }
  });

  it("carries the three fabrics and the one unclassified ply", () => {
    // The distribution eLamX ships. It is asserted because `kind` is the one
    // field read from a symbolic constant rather than a literal, so a typo in
    // the mapping would silently make everything "ud".
    const counted = MATERIAL_CATALOG.reduce<Record<string, number>>((acc, m) => {
      acc[m.kind] = (acc[m.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(counted).toEqual({ ud: 29, fabric: 3, unknown: 1 });
  });
});
