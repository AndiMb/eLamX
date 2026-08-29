// Emits the golden-master reference cases in two synchronised forms:
//
//   reference.elamx       - fed to the Java eLamX 3.x batch mode, which writes reference.txt
//   reference.input.json  - the identical inputs in elamx-core's own serde shape
//
// Both come from the single CASES definition below, so the Rust test and the
// Java run can never drift apart on the *inputs*; reference.txt then supplies
// the expected *outputs*. See README.md for the regeneration procedure.
//
// Usage: node generate.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Failure criteria -------------------------------------------------------
// Java class name (what .elamx stores), elamx-core id (what input.json stores)
// and the display name the batch output prints per layer. The display name is
// what lets the Rust test detect eLamX's silent fallback to Puck for an
// unknown criterion class name (see LaminateLoadSaveImpl.java) instead of
// comparing against the wrong criterion without noticing.
const ADD = "de.elamx.laminate.addFailureCriteria.";
const CRITERIA = {
  max_stress:    { java: ADD + "MaxStress",    display: "maximum Stress" },
  max_strain:    { java: ADD + "MaxStrain",    display: "maximum Strain" },
  tsai_hill:     { java: ADD + "TsaiHill",     display: "Tsai-Hill" },
  tsai_wu:       { java: ADD + "TsaiWu",       display: "TsaiWu" },
  hashin:        { java: ADD + "Hashin",       display: "Hashin" },
  puck:          { java: "de.elamx.laminate.failure.Puck", display: "Puck" },
  christensen:   { java: ADD + "Christensen",  display: "Christensen" },
  edge:          { java: ADD + "Edge",         display: "Edge" },
  fibre_failure: { java: ADD + "FibreFailure", display: "Fibre Failure" },
  fmc:           { java: ADD + "FMC",          display: "FMC" },
  hoffman:       { java: ADD + "Hoffman",      display: "Hoffman" },
  mayes:         { java: ADD + "Mayes",        display: "Mayes" },
  rotem:         { java: ADD + "Rotem",        display: "Rotem" },
  sun:           { java: ADD + "Sun",          display: "Sun" },
  ztl:           { java: ADD + "ZTL",          display: "ZTL" },
};

const ALL_CRITERIA = Object.keys(CRITERIA);

// --- Materials --------------------------------------------------------------
// `extra` maps elamx-core's additional-value key -> [Java .elamx tag, value].
// The two materials deliberately differ in MaxStrain's global/local flag so
// both branches of that criterion get exercised (Java: `globalLokal > 0.5`).
function material(id, name, props, globalLokal) {
  return {
    id,
    name,
    ...props,
    extra: {
      "puck.p_spd":            ["de.elamx.laminate.failure.Puck.pspd", 0.3],
      "puck.p_spz":            ["de.elamx.laminate.failure.Puck.pspz", 0.35],
      "puck.a0":               ["de.elamx.laminate.failure.Puck.a0", 0.5],
      "puck.lambda_min":       ["de.elamx.laminate.failure.Puck.lambda_min", 0.5],
      "tsai_wu.f12_star":      [ADD + "TsaiWu.f12star", -0.5],
      "ztl.f12_star":          [ADD + "ZTL.f12star", -0.5],
      "max_strain.eps_x":      [ADD + "MaxStrain.eps_x", 0.003],
      "max_strain.eps_y":      [ADD + "MaxStrain.eps_y", 0.003],
      "max_strain.gamma_xy":   [ADD + "MaxStrain.gamma_xy", 0.006],
      "max_strain.global_local": [ADD + "MaxStrain.global_lokal", globalLokal],
      "fmc.m":                 [ADD + "FMC.m", 3.1],
      "fmc.mue_sp":            [ADD + "FMC.muesp", 0.15],
    },
  };
}

const MATERIALS = [
  material("m-cfk", "GM-CFK-UD", {
    e_par: 141000.0, e_nor: 9340.0, nue12: 0.35, g: 4500.0, g13: 4500.0, g23: 3000.0,
    rho: 1.7e-9,
    alpha_t_par: 1.0e-6, alpha_t_nor: 3.5e-5, beta_par: 0.01, beta_nor: 0.38,
    r_par_ten: 2000.0, r_par_com: 1200.0, r_nor_ten: 60.0, r_nor_com: 200.0, r_shear: 90.0,
  }, 0.3),
  material("m-gfk", "GM-GFK-UD", {
    e_par: 45000.0, e_nor: 12000.0, nue12: 0.30, g: 5500.0, g13: 5500.0, g23: 4000.0,
    rho: 2.0e-9,
    alpha_t_par: 6.0e-6, alpha_t_nor: 2.8e-5, beta_par: 0.005, beta_nor: 0.30,
    r_par_ten: 1100.0, r_par_com: 700.0, r_nor_ten: 40.0, r_nor_com: 130.0, r_shear: 60.0,
  }, 1.0),
];

// --- Plate buckling ---------------------------------------------------------
// Boundary conditions are stored in .elamx as the INDEX into eLamX's own
// array (InputPanel.boundary_cond); elamx-core names them instead. The
// D-matrix choice is stored as a Java class name and, like the failure
// criterion, falls back silently to "Standard" when unrecognised
// (see plateui/buckling/LoadSaveLaminateHookImpl) - hence the display label,
// which the batch output prints and the Rust test checks.
const BOUNDARY = ["SS", "CC", "CF", "FF", "SC", "SF"];
const DM = "de.elamx.clt.plate.dmatrix.";
const D_MATRIX = {
  standard:            { java: DM + "StandardDMatrixServiceImpl",           label: "Original D matrix" },
  special_orthotropic: { java: DM + "SpecialOrthotropicDMatrixServiceImpl", label: "D matrix with D_{16} = D_{26} = 0" },
  d_tilde:             { java: DM + "DtildeDMatrixServiceImpl",             label: "D-tilde matrix" },
};

const buckling = (name, o) => ({
  name,
  length: 500, width: 500, n_x: -1, n_y: 0, n_xy: 0,
  bc_x: "SS", bc_y: "SS", m: 10, n: 10, d_matrix: "standard",
  ...o,
});

// --- Last ply failure -------------------------------------------------------
// The defaults here are LastPlyFailureInput's own field initialisers. Note
// what is absent: the analysis is load-controlled only (its `useStrains` array
// is all-false and never exposed) and has no dT/dc - the ply copies it builds
// carry no expansion coefficients, so a hygrothermal load could not act
// anyway. See core/src/clt/last_ply_failure.rs for that and two more
// faithfully reproduced quirks.
const lastPlyFailure = (name, o) => ({
  name,
  n_x: 0, n_y: 0, n_xy: 0, m_x: 0, m_y: 0, m_xy: 0,
  degradationFactor: 0.000001, epsilon_crit: 0.003, j_a: 1.0,
  degradeAllOnFibreFailure: true,
  ...o,
});

// --- Helpers for the case definitions ---------------------------------------
const layer = (angle, thickness, materialId, criterionId) =>
  ({ angle, thickness, materialId, criterionId });

const loads = (o = {}) => ({
  n_x: 0, n_y: 0, n_xy: 0, m_x: 0, m_y: 0, m_xy: 0, delta_t: 0, delta_h: 0, ...o,
});
const strains = (o = {}) => ({
  epsilon_x: 0, epsilon_y: 0, gamma_xy: 0, kappa_x: 0, kappa_y: 0, kappa_xy: 0, ...o,
});
const NO_STRAIN = [false, false, false, false, false, false];

// One layer per criterion, at a spread of angles so each criterion sees a
// different local stress state. The last layer repeats MaxStrain on the second
// material to reach its `global` branch.
const CRITERION_ANGLES = [0, 15, 30, 45, 60, 75, 90, -15, -30, -45, -60, -75, 20, -20, 10];
const criterionLayers = [
  ...ALL_CRITERIA.map((c, i) => layer(CRITERION_ANGLES[i], 0.125, "m-cfk", c)),
  layer(-10, 0.125, "m-gfk", "max_strain"),
];

// --- Reference cases --------------------------------------------------------
// Calculation names must be unique across the whole file: the batch output
// identifies a calculation only by its own name, not by its laminate.
const CASES = [
  {
    name: "GM-Kriterien",
    symmetric: false, withMiddleLayer: false, invertZ: false, offset: 0.0,
    layers: criterionLayers,
    calculations: [
      { name: "GM-Krit-Zug",        loads: loads({ n_x: 400 }) },
      { name: "GM-Krit-Druck",      loads: loads({ n_x: -400 }) },
      { name: "GM-Krit-Schub",      loads: loads({ n_xy: 250 }) },
      { name: "GM-Krit-Biegung",    loads: loads({ m_x: 40 }) },
      { name: "GM-Krit-Kombiniert", loads: loads({ n_x: 200, n_y: -150, n_xy: 120, m_y: 25 }) },
    ],
    // Unsymmetric stack: D-tilde is the idealisation that actually applies
    // here, and the plain D matrix is included precisely because it does not -
    // eLamX computes it anyway, and so must the port.
    bucklings: [
      buckling("GM-Beul-DTilde", { length: 450, width: 450, d_matrix: "d_tilde" }),
      buckling("GM-Beul-UnsymStandard", { length: 450, width: 450, d_matrix: "standard" }),
    ],
    // One degradation path over all 15 criteria: each iteration's failure
    // type and name comes from whichever criterion governs that ply, so this
    // checks that every criterion feeds the loop the same verdict on both
    // sides - not just the same reserve factor.
    lastPlyFailures: [
      lastPlyFailure("GM-LPF-Krit", { n_x: 400 }),
    ],
  },
  {
    // Symmetric stack with a shared middle layer: exercises the mirroring and
    // the "middle layer counted once" rule in Laminate::all_layers.
    name: "GM-SymMittellage",
    symmetric: true, withMiddleLayer: true, invertZ: false, offset: 0.0,
    layers: [
      layer(0, 0.125, "m-cfk", "puck"),
      layer(45, 0.2, "m-gfk", "tsai_wu"),
      layer(-45, 0.2, "m-cfk", "hashin"),
      layer(90, 0.15, "m-gfk", "max_stress"),
      layer(0, 0.3, "m-cfk", "christensen"),
    ],
    calculations: [
      { name: "GM-Sym-Zug",    loads: loads({ n_x: 500, n_y: 100 }) },
      { name: "GM-Sym-Thermo", loads: loads({ delta_t: -120, delta_h: 0.6 }) },
    ],
    // Two loads on the same stack: the first is carried (so the strain-based
    // RF_epsilon exists), the second is far beyond the laminate's strength, so
    // no iteration ever reaches a reserve factor of 1 and eLamX prints "-".
    // The first also carries jA != 1, and it has to be a case that reaches an
    // inter-fibre failure - jA scales nothing else, so on a case without one
    // (GM-LPF-Offset, say) it would go untested.
    lastPlyFailures: [
      lastPlyFailure("GM-LPF-Sym", { n_x: 300, n_xy: 60, j_a: 0.75 }),
      lastPlyFailure("GM-LPF-SymUeberlast", { n_x: 4000, epsilon_crit: 0.005 }),
    ],
    bucklings: [
      buckling("GM-Beul-SS-Druck", {}),
      buckling("GM-Beul-CC-Biax", { length: 600, width: 400, n_y: -0.5, bc_x: "CC", bc_y: "CC", m: 8, n: 8 }),
      buckling("GM-Beul-Schub", { length: 500, width: 300, n_x: 0, n_xy: 1, m: 12, n: 12 }),
      buckling("GM-Beul-SpecOrtho", { d_matrix: "special_orthotropic" }),
    ],
  },
  {
    // Symmetric without a middle layer, plus a non-zero reference-plane offset
    // (z0 = tges/2 + offset), which shifts the whole B/D build-up.
    name: "GM-SymOffset",
    symmetric: true, withMiddleLayer: false, invertZ: false, offset: 0.35,
    layers: [
      layer(0, 0.125, "m-cfk", "puck"),
      layer(90, 0.25, "m-cfk", "tsai_hill"),
      layer(30, 0.125, "m-gfk", "hoffman"),
    ],
    calculations: [
      { name: "GM-Offset-Zug", loads: loads({ n_x: 300, m_x: 15 }) },
    ],
    // The laminate carries offset = 0.35, which the analysis drops (it rebuilds
    // the stack on a fresh, offset-free laminate). A bending load makes that
    // visible: with the offset it would give different ply stresses.
    lastPlyFailures: [
      lastPlyFailure("GM-LPF-Offset", { n_x: 250, m_x: 12, j_a: 0.8 }),
    ],
    bucklings: [
      buckling("GM-Beul-CF-SC", { length: 800, width: 400, bc_x: "CF", bc_y: "SC", m: 6, n: 9 }),
    ],
  },
  {
    // Reversed stacking order (invert_z), so the first stored layer ends up at
    // the largest z instead of the smallest.
    name: "GM-InvertZ",
    symmetric: false, withMiddleLayer: false, invertZ: true, offset: 0.0,
    layers: [
      layer(0, 0.125, "m-cfk", "puck"),
      layer(30, 0.15, "m-cfk", "mayes"),
      layer(60, 0.175, "m-gfk", "sun"),
      layer(90, 0.2, "m-cfk", "edge"),
    ],
    calculations: [
      { name: "GM-Invert-Biegung", loads: loads({ m_x: 30, m_xy: 12 }) },
    ],
    // invert_z, so the reported "layer of failure" numbers follow the reversed
    // stack; degradeAllOnFibreFailure = false leaves a broken ply its matrix
    // stiffness, which changes the path from the iteration of the first fibre
    // failure onwards.
    lastPlyFailures: [
      lastPlyFailure("GM-LPF-Invert", { m_x: 30, m_xy: 12, degradeAllOnFibreFailure: false }),
    ],
    bucklings: [
      buckling("GM-Beul-FF-CC", { length: 700, width: 350, bc_x: "FF", bc_y: "CC", m: 7, n: 7, d_matrix: "d_tilde" }),
    ],
  },
  {
    // Combined mechanical + thermal + moisture load: exercises the
    // hygrothermal force/moment path and its feedback into the solved strains.
    name: "GM-Hygrothermisch",
    symmetric: false, withMiddleLayer: false, invertZ: false, offset: 0.0,
    layers: [
      layer(0, 0.125, "m-cfk", "puck"),
      layer(90, 0.125, "m-gfk", "fmc"),
      layer(45, 0.125, "m-cfk", "rotem"),
      layer(-45, 0.125, "m-gfk", "ztl"),
    ],
    calculations: [
      { name: "GM-Hygro-Rein",     loads: loads({ delta_t: -150, delta_h: 1.2 }) },
      { name: "GM-Hygro-Mechanisch", loads: loads({ n_x: 150, delta_t: -150, delta_h: 1.2 }) },
    ],
    // Pure shear, and a degradation factor three orders of magnitude milder
    // than the default: a degraded ply keeps 1% of its stiffness instead of
    // 0.0001%, which changes how the load redistributes after every step.
    lastPlyFailures: [
      lastPlyFailure("GM-LPF-Schub", { n_xy: 200, degradationFactor: 0.01 }),
    ],
    bucklings: [
      buckling("GM-Beul-SF-SS", { length: 600, width: 300, bc_x: "SF", n_xy: -0.4, d_matrix: "d_tilde" }),
    ],
  },
  {
    // Ply angles outside -90..90 as stored in the file. Both sides reduce them
    // on load (Java DataLayer.reduceAngle, Rust Layer::new / its deserializer),
    // so this checks that the two reductions agree rather than only that one
    // exists: 100 -> -80, -100 -> 80, 200 -> 20, 91 -> -89, -91 -> 89, 270 -> 90.
    name: "GM-Winkelnormierung",
    symmetric: false, withMiddleLayer: false, invertZ: false, offset: 0.0,
    layers: [
      layer(100, 0.125, "m-cfk", "puck"),
      layer(-100, 0.125, "m-cfk", "max_stress"),
      layer(200, 0.125, "m-cfk", "tsai_wu"),
      layer(91, 0.125, "m-gfk", "hashin"),
      layer(-91, 0.125, "m-cfk", "tsai_hill"),
      layer(270, 0.125, "m-cfk", "hoffman"),
    ],
    calculations: [
      { name: "GM-Winkel-Kombiniert", loads: loads({ n_x: 250, n_xy: 90, m_y: 18 }) },
    ],
  },
  {
    // Mixed boundary conditions: eps_x and gamma_xy prescribed (their loads are
    // solved for), the remaining four degrees of freedom load-prescribed.
    name: "GM-DehnungVorgegeben",
    symmetric: false, withMiddleLayer: false, invertZ: false, offset: 0.0,
    layers: [
      layer(0, 0.15, "m-cfk", "puck"),
      layer(45, 0.15, "m-cfk", "fibre_failure"),
      layer(90, 0.15, "m-gfk", "max_strain"),
      layer(-45, 0.15, "m-cfk", "tsai_wu"),
      layer(0, 0.15, "m-cfk", "hashin"),
    ],
    calculations: [
      {
        name: "GM-Dehnung-Gemischt",
        loads: loads({ n_y: 80, m_x: 10, m_y: 5, m_xy: 3 }),
        strains: strains({ epsilon_x: 0.002, gamma_xy: 0.001 }),
        useStrain: [true, false, true, false, false, false],
      },
    ],
  },
];

// --- Deterministic ids ------------------------------------------------------
// Fixed, readable ids rather than random UUIDs: the generated files are
// checked in, so regenerating them must not produce a spurious diff.
const uuidFor = (kind, index) =>
  `00000000-0000-4000-8000-${String(index).padStart(11, "0")}${kind}`;

// --- .elamx (Java input) ----------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Java's Double.parseDouble accepts this; keeping a decimal point on whole
// numbers matches what eLamX itself writes.
const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

function elamxXml() {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<elamx version="1">');
  out.push("    <laminates>");
  CASES.forEach((c, ci) => {
    out.push(
      `        <laminate invert_z="${c.invertZ}" name="${esc(c.name)}" offset="${num(c.offset)}"` +
        ` symmetric="${c.symmetric}" uuid="${uuidFor("a", ci)}" with_middle_layer="${c.withMiddleLayer}">`,
    );
    c.layers.forEach((l, li) => {
      out.push(`            <layer name="Lage ${li + 1}" uuid="${uuidFor("b", ci * 100 + li)}">`);
      out.push(`                <thickness>${num(l.thickness)}</thickness>`);
      out.push(`                <angle>${num(l.angle)}</angle>`);
      out.push(`                <material>${l.materialId}</material>`);
      out.push(`                <criterion>${CRITERIA[l.criterionId].java}</criterion>`);
      out.push("            </layer>");
    });
    c.calculations.forEach((calc) => {
      const ld = calc.loads;
      const st = calc.strains ?? strains();
      const us = calc.useStrain ?? NO_STRAIN;
      out.push(`            <calculation name="${esc(calc.name)}">`);
      for (const k of ["n_x", "n_y", "n_xy", "m_x", "m_y", "m_xy"]) {
        out.push(`                <${k}>${num(ld[k])}</${k}>`);
      }
      out.push(`                <deltat>${num(ld.delta_t)}</deltat>`);
      out.push(`                <deltah>${num(ld.delta_h)}</deltah>`);
      us.forEach((v, i) => out.push(`                <useStrain${i}>${v}</useStrain${i}>`));
      for (const k of ["epsilon_x", "epsilon_y", "gamma_xy", "kappa_x", "kappa_y", "kappa_xy"]) {
        out.push(`                <${k}>${num(st[k])}</${k}>`);
      }
      out.push("            </calculation>");
    });
    (c.bucklings ?? []).forEach((b) => {
      out.push(`            <buckling name="${esc(b.name)}">`);
      for (const k of ["n_x", "n_y", "n_xy"]) out.push(`                <${k}>${num(b[k])}</${k}>`);
      out.push(`                <length>${num(b.length)}</length>`);
      out.push(`                <width>${num(b.width)}</width>`);
      out.push(`                <bcx>${BOUNDARY.indexOf(b.bc_x)}</bcx>`);
      out.push(`                <bcy>${BOUNDARY.indexOf(b.bc_y)}</bcy>`);
      out.push(`                <m>${b.m}</m>`);
      out.push(`                <n>${b.n}</n>`);
      out.push(`                <dmatrixservice>${D_MATRIX[b.d_matrix].java}</dmatrixservice>`);
      out.push("            </buckling>");
    });
    (c.lastPlyFailures ?? []).forEach((l) => {
      out.push(`            <lastplyfailure name="${esc(l.name)}">`);
      for (const k of ["n_x", "n_y", "n_xy", "m_x", "m_y", "m_xy"]) {
        out.push(`                <${k}>${num(l[k])}</${k}>`);
      }
      out.push(`                <degradationFactor>${num(l.degradationFactor)}</degradationFactor>`);
      out.push(
        `                <degradeAllOnFibreFailure>${l.degradeAllOnFibreFailure}</degradeAllOnFibreFailure>`,
      );
      out.push(`                <epsilon_crit>${num(l.epsilon_crit)}</epsilon_crit>`);
      out.push(`                <j_a>${num(l.j_a)}</j_a>`);
      out.push("            </lastplyfailure>");
    });
    out.push("        </laminate>");
  });
  out.push("    </laminates>");
  out.push("    <materials>");
  MATERIALS.forEach((m) => {
    out.push(
      `        <material class="de.elamx.laminate.DefaultMaterial" name="${esc(m.name)}" uuid="${m.id}">`,
    );
    const tags = [
      ["Epar", m.e_par], ["Enor", m.e_nor], ["nue12", m.nue12], ["G", m.g],
      ["G13", m.g13], ["G23", m.g23], ["rho", m.rho],
      ["alphaTPar", m.alpha_t_par], ["alphaTNor", m.alpha_t_nor],
      ["betaPar", m.beta_par], ["betaNor", m.beta_nor],
      ["RParTen", m.r_par_ten], ["RParCom", m.r_par_com],
      ["RNorTen", m.r_nor_ten], ["RNorCom", m.r_nor_com], ["RShear", m.r_shear],
    ];
    tags.forEach(([t, v]) => out.push(`            <${t}>${num(v)}</${t}>`));
    Object.values(m.extra).forEach(([tag, v]) =>
      out.push(`            <${tag}>${num(v)}</${tag}>`),
    );
    out.push("        </material>");
  });
  out.push("    </materials>");
  out.push("</elamx>");
  return out.join("\n") + "\n";
}

// --- input.json (elamx-core input) ------------------------------------------
function inputJson() {
  const materials = {};
  MATERIALS.forEach((m) => {
    const additional = {};
    for (const [coreKey, [, value]] of Object.entries(m.extra)) additional[coreKey] = value;
    materials[m.id] = {
      id: m.id, name: m.name,
      e_par: m.e_par, e_nor: m.e_nor, nue12: m.nue12, g: m.g, g13: m.g13, g23: m.g23,
      rho: m.rho,
      alpha_t_par: m.alpha_t_par, alpha_t_nor: m.alpha_t_nor,
      beta_par: m.beta_par, beta_nor: m.beta_nor,
      r_par_ten: m.r_par_ten, r_par_com: m.r_par_com,
      r_nor_ten: m.r_nor_ten, r_nor_com: m.r_nor_com, r_shear: m.r_shear,
      additional_values: additional,
    };
  });

  const laminates = CASES.map((c, ci) => ({
    laminate: {
      id: uuidFor("a", ci),
      name: c.name,
      layers: c.layers.map((l, li) => ({
        id: uuidFor("b", ci * 100 + li),
        name: `Lage ${li + 1}`,
        angle: l.angle,
        thickness: l.thickness,
        material_id: l.materialId,
        criterion_id: l.criterionId,
      })),
      symmetric: c.symmetric,
      with_middle_layer: c.withMiddleLayer,
      invert_z: c.invertZ,
      offset: c.offset,
    },
    // Display names in stacking order, so the Rust test can check that eLamX
    // really used the criteria we asked for.
    criterion_display_names: storedCriterionDisplayNames(c),
    calculations: c.calculations.map((calc) => ({
      name: calc.name,
      loads: loadsJson(calc.loads),
      strains: calc.strains ?? strains(),
      use_strain: calc.useStrain ?? NO_STRAIN,
    })),
    bucklings: (c.bucklings ?? []).map(({ name, d_matrix, ...input }) => ({
      name,
      input: { ...input, d_matrix },
      // Printed by the batch output as "D-matrix option:", so the Rust test can
      // catch eLamX's silent fallback to the standard D matrix.
      d_matrix_label: D_MATRIX[d_matrix].label,
    })),
    last_ply_failures: (c.lastPlyFailures ?? []).map((l) => ({
      name: l.name,
      input: {
        loads: loadsJson(loads({
          n_x: l.n_x, n_y: l.n_y, n_xy: l.n_xy, m_x: l.m_x, m_y: l.m_y, m_xy: l.m_xy,
        })),
        degradation_factor: l.degradationFactor,
        epsilon_crit: l.epsilon_crit,
        j_a: l.j_a,
        degrade_all_on_fibre_failure: l.degradeAllOnFibreFailure,
      },
    })),
  }));

  return JSON.stringify({ materials, laminates }, null, 2) + "\n";
}

// elamx-core's Loads carries the resulting hygrothermal force vector in the
// same struct as the applied load, and its Deserialize wants every field.
const loadsJson = (l) => ({ ...l, nt_x: 0, nt_y: 0, nt_xy: 0, mt_x: 0, mt_y: 0, mt_xy: 0 });

// Mirrors Laminate::layers_in_stacking_order (Java: Laminat.getLayers()): the
// STORED layers only - for a symmetric stack the batch output lists just the
// one stored half - reversed if invert_z is set.
function storedCriterionDisplayNames(c) {
  const names = c.layers.map((l) => CRITERIA[l.criterionId].display);
  if (c.invertZ) names.reverse();
  return names;
}

writeFileSync(join(HERE, "reference.elamx"), elamxXml());
writeFileSync(join(HERE, "reference.input.json"), inputJson());

const layerCount = CASES.reduce((n, c) => n + c.layers.length, 0);
const calcCount = CASES.reduce((n, c) => n + c.calculations.length, 0);
const buckCount = CASES.reduce((n, c) => n + (c.bucklings ?? []).length, 0);
const lpfCount = CASES.reduce((n, c) => n + (c.lastPlyFailures ?? []).length, 0);
console.log(
  `reference.elamx + reference.input.json geschrieben: ` +
    `${CASES.length} Laminate, ${layerCount} gespeicherte Lagen, ${calcCount} Berechnungen, ` +
    `${buckCount} Beulanalysen, ${lpfCount} Last-Ply-Failure-Analysen, ` +
    `${ALL_CRITERIA.length} Kriterien abgedeckt.`,
);
