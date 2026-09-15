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
const METAL = "de.elamx.laminate.addFailureCriteriaMetal.";
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
  // The two isotropic yield criteria live in their own module, hence the
  // different package. They are only meaningful on an isotropic material, and
  // eLamX pops a MODAL DIALOG when they meet anything else - which in a batch
  // run would hang it. `m-alu` below is exactly isotropic by the original's
  // own test, deliberately using numbers that survive `nue12 * Enor / Epar`
  // unchanged in floating point.
  von_mises:     { java: METAL + "vonMises",   display: "von Mises" },
  tresca:        { java: METAL + "Tresca",     display: "Tresca" },
};

const ALL_CRITERIA = Object.keys(CRITERIA);
/** The isotropic ones, which need a metal ply and a laminate of their own. */
const METAL_CRITERIA = ["von_mises", "tresca"];
const COMPOSITE_CRITERIA = ALL_CRITERIA.filter((c) => !METAL_CRITERIA.includes(c));

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
  // Aluminium, for the two isotropic criteria. Every number is chosen so the
  // original's isotropy test passes EXACTLY: the four strengths are equal, the
  // two moduli are equal, and G is exactly E / (2 (1 + nu)) with nu = 0.25,
  // which is representable in binary and leaves nothing to a tolerance.
  material("m-alu", "GM-Alu", {
    e_par: 70000.0, e_nor: 70000.0, nue12: 0.25, g: 28000.0, g13: 28000.0, g23: 28000.0,
    rho: 2.7e-9,
    alpha_t_par: 2.3e-5, alpha_t_nor: 2.3e-5, beta_par: 0.0, beta_nor: 0.0,
    r_par_ten: 300.0, r_par_com: 300.0, r_nor_ten: 300.0, r_nor_com: 300.0, r_shear: 173.2,
  }, 0.0),
];

// --- Micromechanics ---------------------------------------------------------
// A micromechanic material computes rho, E_par, E_nor, nue12 and G from a
// fibre, a matrix and a fibre volume fraction, with one model choice per
// property. The batch output prints E11, E22, v12 and G12 per layer, so this
// is the one way those models can be compared against the original at all.
//
// Two things about the stored values matter for reading the cases below:
//
//  - **The values a model drives are written as 1.0 on purpose.** eLamX's
//    reader loads them and then throws them away: `getEpar()` asks the model
//    unless the model is the manual-input dummy. Writing an absurd number
//    there is what makes this suite prove the models are EVALUATED rather than
//    read - a port that trusted the file would report 1.0 MPa and fail loudly.
//  - The values a `manual` choice drives are the real ones, because there the
//    stored number IS the answer.
//
// There is no `rho_micromechmodel` tag anywhere: the original writes four
// model tags and no density one, so the density model does not survive a save.
const MICRO = {
  manual:         "de.elamx.micromechanics.models.ManualInputDummyModel",
  rule_of_mixture:"de.elamx.micromechanics.models.Mischungsregel_m",
  abolinsh:       "de.elamx.micromechanics.addmicromechanicmodels.Abolinsh",
  chamis:         "de.elamx.micromechanics.addmicromechanicmodels.Chamis",
  halpin_tsai:    "de.elamx.micromechanics.addmicromechanicmodels.HalpinTsai",
  hopkins_chamis: "de.elamx.micromechanics.addmicromechanicmodels.HopkinsChamis",
  puck:           "de.elamx.micromechanics.addmicromechanicmodels.Puck",
  hsb_37102_02:   "de.elamx.micromechanics.addmicromechanicmodels.HSB3710202",
};

/** What a model-driven property is stored as. See the note above. */
const IGNORED = 1.0;

const FIBRES = [
  {
    id: "f-carbon", name: "GM-C-Faser",
    e_par: 230000.0, e_nor: 15000.0, nue12: 0.28, g: 15000.0, g13: 0.0, g23: 0.0,
    rho: 1.78e-9, alpha_t_par: -5.0e-7, alpha_t_nor: 1.0e-5, beta_par: 0.0, beta_nor: 0.0,
  },
  {
    // Isotropic-ish, and far stiffer across the filament than the carbon one -
    // the ratio E_f / E_m is what decides where HSB 37102-02 runs into its own
    // square root, so the two fibres put that guard on both sides.
    id: "f-glass", name: "GM-Glas-Faser",
    e_par: 73000.0, e_nor: 73000.0, nue12: 0.22, g: 30000.0, g13: 0.0, g23: 0.0,
    rho: 2.55e-9, alpha_t_par: 5.0e-6, alpha_t_nor: 5.0e-6, beta_par: 0.0, beta_nor: 0.0,
  },
];

const MATRICES = [
  { id: "x-epoxy", name: "GM-Epoxid", e: 3400.0, nue: 0.35, rho: 1.2e-9, alpha: 6.5e-5, beta: 0.3 },
  { id: "x-peek", name: "GM-PEEK", e: 3600.0, nue: 0.40, rho: 1.3e-9, alpha: 4.7e-5, beta: 0.1 },
];

// One material per model, so a wrong formula shows up as its own failure
// rather than as one of nine. `mm-gemischt` uses a different model for each
// property, which is the only case that can catch the four choices being
// read in the wrong order; `mm-manuell` leaves two of them typed in.
function micro(id, name, fibre, matrix, phi, models, manual = {}) {
  return {
    id, name, fibre, matrix, phi, models,
    e_par: manual.e_par ?? IGNORED,
    e_nor: manual.e_nor ?? IGNORED,
    nue12: manual.nue12 ?? IGNORED,
    g: manual.g ?? IGNORED,
    rho: IGNORED,
    // Typed in whatever the models do - no model in eLamX predicts them.
    g13: 4000.0, g23: 3000.0,
    alpha_t_par: 2.0e-6, alpha_t_nor: 3.0e-5, beta_par: 0.01, beta_nor: 0.3,
    r_par_ten: 1800.0, r_par_com: 1100.0, r_nor_ten: 55.0, r_nor_com: 190.0, r_shear: 85.0,
  };
}

const uniform = (model) => ({ e_par: model, e_nor: model, nue12: model, g: model });

const MICRO_MATERIALS = [
  micro("mm-rom", "GM-MM-Mischungsregel", "f-carbon", "x-epoxy", 0.60, uniform("rule_of_mixture")),
  micro("mm-abolinsh", "GM-MM-Abolinsh", "f-carbon", "x-epoxy", 0.55, uniform("abolinsh")),
  micro("mm-chamis", "GM-MM-Chamis", "f-carbon", "x-epoxy", 0.65, uniform("chamis")),
  micro("mm-halpin", "GM-MM-HalpinTsai", "f-carbon", "x-peek", 0.50, uniform("halpin_tsai")),
  micro("mm-hopkins", "GM-MM-HopkinsChamis", "f-carbon", "x-epoxy", 0.45, uniform("hopkins_chamis")),
  micro("mm-puck", "GM-MM-Puck", "f-carbon", "x-epoxy", 0.62, uniform("puck")),
  micro("mm-hsb", "GM-MM-HSB", "f-glass", "x-peek", 0.58, uniform("hsb_37102_02")),
  micro("mm-gemischt", "GM-MM-Gemischt", "f-glass", "x-epoxy", 0.66, {
    e_par: "rule_of_mixture", e_nor: "chamis", nue12: "rule_of_mixture", g: "halpin_tsai",
  }),
  // Two properties typed in, two predicted: the stored numbers are the answer
  // for the first pair and ignored for the second, in one material.
  micro("mm-manuell", "GM-MM-Manuell", "f-carbon", "x-epoxy", 0.60, {
    e_par: "rule_of_mixture", e_nor: "manual", nue12: "rule_of_mixture", g: "manual",
  }, { e_nor: 8200.0, g: 4100.0 }),
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

// A vibration analysis is the buckling input without the load flows. It has
// no batch output - eLamX prints nothing for it - so what these cases prove is
// the FORMAT: that the element this crate writes is one the original still
// reads, which the rewrite check at the end of the README exercises.
const vibration = (name, o) => ({
  name,
  length: 500, width: 500,
  bc_x: "SS", bc_y: "SS", m: 10, n: 10, d_matrix: "standard",
  stiffeners: [],
  ...o,
});

// Spring-In, likewise without batch output. Two things are at stake in the
// file: the <SpringInModel> child with its Java class name, and the enhanced
// model's two shrinkage properties, whose tag names are eLamX's own and whose
// MEANING is crossed against the labels the property sheet shows (see
// spring_in::SpringInModel::chemical_term).
const SPRING_IN = {
  simple_radford: {
    java: "de.elamx.clt.springin.SimpleRadfordSpringInModel",
    label: "Simple Radford Model",
  },
  enhanced_radford: {
    java: "de.elamx.clt.springin.additionalmodels.EnhancedRadfordSpringInModel",
    label: "enhanced Radford Model",
  },
};

// The optimisation is the one PROJECT-level module: a search is not about a
// laminate, it is looking for one. Its constraints nest a second service
// element inside the first, and their bodies are the same tag sets the
// matching module elements carry - so this is where the format is most likely
// to drift, and where the Java reading it back is worth the most.
const OPTIMIZERS = {
  sequential: "de.elamx.clt.optimization.sda.SequentialDecisionApproach",
  genetic: "de.elamx.clt.optimization.hauffe.HauffeOptimizer",
  exhaustive:
    "de.elamx.clt.optimization.additionaloptimizers.branchandbound.BranchAndBoundOptimizer",
  todoroki: "de.elamx.clt.optimization.additionaloptimizers.todoroki.TodorokiOptimizer",
};

const CONSTRAINT_CLASSES = {
  clt: "de.elamx.clt.optimization.MinimalReserveFactorImplementation",
  buckling: "de.elamx.clt.plate.MinimalBucklingReserveFactorImpl",
  deformation: "de.elamx.clt.plate.MinimalDeformationReserveFactorImpl",
  pressure_vessel: "de.elamx.clt.pressurevessel.optimization.MinimalReserveFactorImplementation",
};

// Cutouts, the third module with a nested service element. Like spring-in and
// vibration the batch prints nothing for them, so what these cases cover is the
// FORMAT - and for the cutout that is worth more than usual, because the shape
// carries its own Java class name and its own property names.
const CUTOUT = {
  circular: { java: "de.elamx.clt.cutout.CircularCutoutGeometry", label: "Circular cutout" },
  elliptical: {
    java: "de.elamx.clt.plate.AdditionalCutoutGeometries.EllipticalCutoutGeometry",
    label: "Elliptic cutout",
  },
  square: {
    java: "de.elamx.clt.plate.AdditionalCutoutGeometries.SquareCutoutGeometry",
    label: "Square cutout",
  },
  rectangular: {
    java: "de.elamx.clt.plate.AdditionalCutoutGeometries.RectangularCutoutGeometry",
    label: "Rectangular cutout",
  },
};

// Plate deformation. No batch output either, and until now no fixture at all -
// which left `<deformation>` as the one module element the Java had never been
// asked to read back. It carries `maxDisplacement`, an allowable the analysis
// itself never uses and the optimiser does, so a port that dropped it would
// lose a limit someone typed in without any calculation noticing.
const deformation = (name, o) => ({
  name,
  length: 500, width: 500,
  bc_x: "SS", bc_y: "SS", m: 10, n: 10, d_matrix: "standard",
  maxDisplacement: 0.0,
  loads: [{ kind: "surface", name: "q", force: 0.01 }],
  stiffeners: [],
  ...o,
});

const cutout = (name, o) => ({
  name,
  shape: "circular",
  a: 5.0, b: 5.0, terms: 11,
  n_xx: 100.0, n_yy: 0.0, n_xy: 0.0,
  m_xx: 0.0, m_yy: 0.0, m_xy: 0.0,
  val: 721,
  ...o,
});

const springIn = (name, o) => ({
  name,
  model: "simple_radford",
  angle: 90, radius: 10, alphat_thick: 3.0e-5,
  baseTemp: 25, hardeningTemp: 180,
  useAutoCalcAlphat_thick: false, zeroDegAsCircumDir: true,
  ...o,
});

const buckling = (name, o) => ({
  name,
  length: 500, width: 500, n_x: -1, n_y: 0, n_xy: 0,
  bc_x: "SS", bc_y: "SS", m: 10, n: 10, d_matrix: "standard",
  stiffeners: [],
  ...o,
});

// --- Stiffeners -------------------------------------------------------------
// Stored as a <Stiffener> child of the analysis, identified by the Java class
// name of its property service - and resolved through Lookup, so a profile
// whose module is not installed is dropped SILENTLY on load. The class names
// therefore have to be right to the letter, and the two profiles only exist at
// all because AdditionalStiffeners is deployed with the program.
//
// The property tag names below are the Java field names, because
// LoadSaveStiffeners writes them by reflection from getPropertyDefinitions();
// the order is that array's order. `direct` writes no <z>: the direct input
// does not list it among its properties, so eLamX never stores one.
const STIFFENER = {
  direct: {
    java: "de.elamx.clt.plateui.stiffenerui.DefaultStiffenerProperties",
    props: ["E", "I", "G", "J", "Rho", "A"],
  },
  i_profile: {
    java: "de.elamx.clt.plate.AdditionalStiffeners.I_StiffenerProperties",
    props: ["w1", "t1", "E", "G", "Rho"],
  },
  t_profile: {
    java: "de.elamx.clt.plate.AdditionalStiffeners.T_StiffenerProperties",
    props: ["w1", "t1", "w2", "t2", "E", "G", "Rho"],
  },
};

const DIRECTION_INDEX = { x: 1, y: 2 };

const stiffener = (name, profile, direction, position, values) => ({
  name, profile, direction, position, ...values,
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
  ...COMPOSITE_CRITERIA.map((c, i) => layer(CRITERION_ANGLES[i], 0.125, "m-cfk", c)),
  layer(-10, 0.125, "m-gfk", "max_strain"),
];

// One saved search per optimiser, so every Java class name in the section gets
// written and read back - and between them every constraint kind.
const OPTIMIZATIONS = [
  {
    name: "GM-Opt-SDA",
    angletype: 0,
    optimizer: "sequential",
    thickness: 0.125,
    material: "m-cfk",
    criterion: "puck",
    symmetric: false,
    angles: [0.0, 45.0, -45.0, 90.0],
    constraints: [{ kind: "clt", n_x: 1200.0, n_xy: 80.0 }],
  },
  {
    name: "GM-Opt-Todoroki",
    angletype: 1,
    optimizer: "todoroki",
    thickness: 0.25,
    material: "m-gfk",
    criterion: "tsai_wu",
    symmetric: true,
    angles: [0.0, 90.0],
    constraints: [
      {
        kind: "buckling",
        n_x: -1.0, length: 400.0, width: 300.0,
        bc_x: "CC", bc_y: "SS", m: 8, n: 8, d_matrix: "d_tilde",
      },
      {
        kind: "deformation",
        length: 400.0, width: 300.0,
        bc_x: "SS", bc_y: "SS", m: 8, n: 8, d_matrix: "standard",
        maxDisplacement: 3.0, force: 0.02,
      },
    ],
  },
  {
    name: "GM-Opt-Genetisch",
    angletype: 2,
    optimizer: "genetic",
    thickness: 0.2,
    material: "m-cfk",
    criterion: "max_stress",
    symmetric: false,
    angles: [0.0, 30.0, -30.0, 60.0, -60.0, 90.0],
    constraints: [{ kind: "pressure_vessel", pressure: 0.8, radius: 300.0, radiustype: 2 }],
  },
  {
    name: "GM-Opt-Vollstaendig",
    angletype: 0,
    optimizer: "exhaustive",
    thickness: 0.125,
    material: "m-cfk",
    criterion: "hashin",
    symmetric: false,
    angles: [0.0, 90.0],
    constraints: [{ kind: "clt", n_y: 400.0 }],
  },
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
      // Temperature alone, no moisture and no mechanical load, on a SYMMETRIC
      // stack: then the laminate simply expands, and the reported strains
      // divided by dT ARE the laminate's thermal expansion coefficients. That
      // is how alpha_global gets a reference value from a batch mode that
      // never prints one - and alpha_global is the one number the spring-in
      // module below does not get from the user.
      { name: "GM-Sym-AlphaT", loads: loads({ delta_t: -100 }) },
    ],
    // Spring-In on the same symmetric stack, since the module refuses an
    // unsymmetric one. Two entries because the enhanced model's two extra
    // properties are the only part of the element that is not shared.
    // All four hole shapes, so every Java class name and every property name
    // the format uses gets written and read back at least once.
    // Two deformation analyses: a plain one, and one carrying an allowable
    // deflection and a point load, so `maxDisplacement` and both load kinds
    // travel through the file.
    deformations: [
      deformation("GM-Verformung-SS", {}),
      deformation("GM-Verformung-Grenze", {
        length: 600, width: 400, bc_x: "CC", bc_y: "SS", m: 8, n: 8,
        maxDisplacement: 2.5,
        loads: [
          { kind: "surface", name: "q", force: 0.02 },
          { kind: "point", name: "F", x: 150.0, y: 200.0, force: 25.0 },
        ],
      }),
    ],
    cutouts: [
      cutout("GM-Loch-Kreis", {}),
      cutout("GM-Loch-Ellipse", { shape: "elliptical", a: 8.0, b: 3.0, n_yy: -40.0 }),
      cutout("GM-Loch-Quadrat", { shape: "square", a: 6.0, terms: 13, n_xy: 30.0 }),
      cutout("GM-Loch-Rechteck", {
        shape: "rectangular", a: 12.0, b: 4.0, terms: 9,
        n_xx: 80.0, m_xx: 15.0, m_yy: -5.0, m_xy: 3.0, val: 361,
      }),
    ],
    springIns: [
      springIn("GM-SpringIn-Einfach", {}),
      springIn("GM-SpringIn-Erweitert", {
        model: "enhanced_radford",
        angle: 120, radius: 15, alphat_thick: 2.8e-5,
        baseTemp: 20, hardeningTemp: 175,
        useAutoCalcAlphat_thick: true, zeroDegAsCircumDir: false,
        eps_cr: -0.006, eps_cu: -0.0005,
      }),
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
      // Stiffeners. One analysis per thing that can go wrong: the profile
      // formulas, the two directions, the two terms of the contribution, and
      // the summation over a list.
      //
      // The direct input is the reference case - its four numbers go into the
      // stiffness matrix untouched, so a disagreement here is in the assembly,
      // not in a section formula. Off-centre and along x, so a swapped
      // direction or a position measured from the wrong edge shows up.
      buckling("GM-Beul-VersteifFrei", {
        stiffeners: [
          stiffener("Frei-x", "direct", "x", 80.0, {
            E: 70000.0, I: 27000.0, G: 27000.0, J: 270.0, Rho: 2.7e-9, A: 90.0,
          }),
        ],
      }),
      // Torsion alone: I = 0 leaves only the G*J term, which rides on the
      // SLOPE of the shape functions across the stiffener rather than on their
      // value. Without this the two terms could compensate each other.
      buckling("GM-Beul-VersteifTorsion", {
        stiffeners: [
          stiffener("Torsion-x", "direct", "x", 0.0, {
            E: 70000.0, I: 0.0, G: 27000.0, J: 5.0e4, Rho: 2.7e-9, A: 90.0,
          }),
        ],
      }),
      // The blade profile, along y, on a rectangular plate - so a transposed
      // index in the y branch cannot hide behind a square plate, and the
      // computed I and J are checked rather than given.
      buckling("GM-Beul-VersteifI", {
        length: 600, width: 400, m: 8, n: 8,
        stiffeners: [
          stiffener("Blech-y", "i_profile", "y", -75.0, {
            w1: 35.0, t1: 2.5, E: 72000.0, G: 27500.0, Rho: 2.7e-9,
          }),
        ],
      }),
      // Two stiffeners at once, of different profiles and directions: the T
      // profile (whose I and J are the most involved of the three) along x at
      // the centre, and a direct one along y. Checks that the contributions
      // add rather than replace.
      buckling("GM-Beul-VersteifTKreuz", {
        length: 600, width: 400, n_y: -0.3, m: 8, n: 8,
        stiffeners: [
          stiffener("T-x", "t_profile", "x", 0.0, {
            w1: 24.0, t1: 2.0, w2: 30.0, t2: 3.0, E: 70000.0, G: 27000.0, Rho: 2.7e-9,
          }),
          stiffener("Frei-y", "direct", "y", 120.0, {
            E: 210000.0, I: 1.2e4, G: 81000.0, J: 900.0, Rho: 7.85e-9, A: 60.0,
          }),
        ],
      }),
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
    // Two vibration analyses: a plain one and one carrying stiffeners, which
    // is the only module whose <Stiffener> children have to survive beside a
    // module the batch mode never prints.
    vibrations: [
      vibration("GM-Schwing-SS", {}),
      vibration("GM-Schwing-CC-Versteift", {
        length: 700, width: 350, bc_x: "CC", bc_y: "SC", m: 8, n: 9, d_matrix: "d_tilde",
        stiffeners: [
          stiffener("Schwing-x", "i_profile", "x", 60.0, {
            w1: 25.0, t1: 2.0, E: 70000.0, G: 27000.0, Rho: 2.7e-9,
          }),
          stiffener("Schwing-y", "direct", "y", -100.0, {
            E: 70000.0, I: 18000.0, G: 27000.0, J: 300.0, Rho: 2.7e-9, A: 75.0,
          }),
        ],
      }),
    ],
    bucklings: [
      buckling("GM-Beul-CF-SC", { length: 800, width: 400, bc_x: "CF", bc_y: "SC", m: 6, n: 9 }),
      // The same mixed edges, now with a stiffener on them. This is the case
      // the sampled shape functions can actually get wrong: for a clamped or
      // free edge they are the hyperbolic ones, where wx and wdx are a
      // difference of large terms - unlike the sine series of a simply
      // supported edge, which is exact everywhere.
      buckling("GM-Beul-VersteifCF", {
        length: 800, width: 400, bc_x: "CF", bc_y: "SC", m: 6, n: 9,
        stiffeners: [
          stiffener("Rand-x", "i_profile", "x", 150.0, {
            w1: 40.0, t1: 3.0, E: 70000.0, G: 27000.0, Rho: 2.7e-9,
          }),
          stiffener("Rand-y", "t_profile", "y", -280.0, {
            w1: 20.0, t1: 2.0, w2: 25.0, t2: 2.5, E: 70000.0, G: 27000.0, Rho: 2.7e-9,
          }),
        ],
      }),
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
    // The two isotropic yield criteria, on an isotropic ply - which is the
    // only place they belong. Kept out of the criterion laminate above on
    // purpose: eLamX shows a modal dialog when they meet a composite material,
    // and a modal dialog in a batch run is a hang, not a warning.
    //
    // Three loads, because Tresca and von Mises agree under uniaxial tension
    // and differ most under shear: a case that only pulled would compare the
    // two criteria without ever telling them apart.
    name: "GM-Metall",
    symmetric: false, withMiddleLayer: false, invertZ: false, offset: 0.0,
    layers: [
      layer(0, 0.5, "m-alu", "von_mises"),
      layer(0, 0.5, "m-alu", "tresca"),
    ],
    calculations: [
      { name: "GM-Metall-Zug",   loads: loads({ n_x: 120 }) },
      { name: "GM-Metall-Schub", loads: loads({ n_xy: 90 }) },
      { name: "GM-Metall-Komb",  loads: loads({ n_x: 100, n_y: -60, n_xy: 70, m_x: 8 }) },
    ],
  },
  {
    // One layer per micromechanic material, so that every model's E11, E22,
    // v12 and G12 is printed once by the original. The stack is otherwise
    // deliberately dull - all plies at 0 deg and the same criterion - because
    // what is under test is the material, not the laminate: a CLT calculation
    // rides along only to give the ABD matrix something to disagree about if a
    // model were off.
    name: "GM-Mikromechanik",
    symmetric: false, withMiddleLayer: false, invertZ: false, offset: 0.0,
    layers: [
      layer(0, 0.125, "mm-rom", "max_stress"),
      layer(0, 0.125, "mm-abolinsh", "max_stress"),
      layer(0, 0.125, "mm-chamis", "max_stress"),
      layer(0, 0.125, "mm-halpin", "max_stress"),
      layer(0, 0.125, "mm-hopkins", "max_stress"),
      layer(0, 0.125, "mm-puck", "max_stress"),
      layer(0, 0.125, "mm-hsb", "max_stress"),
      layer(0, 0.125, "mm-gemischt", "max_stress"),
      layer(0, 0.125, "mm-manuell", "max_stress"),
    ],
    calculations: [
      { name: "GM-MM-Zug", loads: loads({ n_x: 300, m_y: 10 }) },
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
      (b.stiffeners ?? []).forEach((st) => {
        const def = STIFFENER[st.profile];
        out.push(`                <Stiffener name="${esc(st.name)}" classname="${def.java}">`);
        out.push(`                    <position>${num(st.position)}</position>`);
        out.push(`                    <direction>${DIRECTION_INDEX[st.direction]}</direction>`);
        for (const k of def.props) out.push(`                    <${k}>${num(st[k])}</${k}>`);
        out.push("                </Stiffener>");
      });
      out.push("            </buckling>");
    });
    (c.vibrations ?? []).forEach((v) => {
      out.push(`            <vibration name="${esc(v.name)}">`);
      out.push(`                <length>${num(v.length)}</length>`);
      out.push(`                <width>${num(v.width)}</width>`);
      out.push(`                <bcx>${BOUNDARY.indexOf(v.bc_x)}</bcx>`);
      out.push(`                <bcy>${BOUNDARY.indexOf(v.bc_y)}</bcy>`);
      out.push(`                <m>${v.m}</m>`);
      out.push(`                <n>${v.n}</n>`);
      out.push(`                <dmatrixservice>${D_MATRIX[v.d_matrix].java}</dmatrixservice>`);
      (v.stiffeners ?? []).forEach((st) => {
        const def = STIFFENER[st.profile];
        out.push(`                <Stiffener name="${esc(st.name)}" classname="${def.java}">`);
        out.push(`                    <position>${num(st.position)}</position>`);
        out.push(`                    <direction>${DIRECTION_INDEX[st.direction]}</direction>`);
        for (const k of def.props) out.push(`                    <${k}>${num(st[k])}</${k}>`);
        out.push("                </Stiffener>");
      });
      out.push("            </vibration>");
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
    (c.deformations ?? []).forEach((d) => {
      out.push(`            <deformation name="${esc(d.name)}">`);
      out.push(`                <length>${num(d.length)}</length>`);
      out.push(`                <width>${num(d.width)}</width>`);
      out.push(`                <bcx>${BOUNDARY.indexOf(d.bc_x)}</bcx>`);
      out.push(`                <bcy>${BOUNDARY.indexOf(d.bc_y)}</bcy>`);
      out.push(`                <m>${d.m}</m>`);
      out.push(`                <n>${d.n}</n>`);
      out.push(`                <dmatrixservice>${D_MATRIX[d.d_matrix].java}</dmatrixservice>`);
      out.push(`                <maxDisplacement>${num(d.maxDisplacement)}</maxDisplacement>`);
      (d.loads ?? []).forEach((l) => {
        if (l.kind === "point") {
          out.push(`                <pointload name="${esc(l.name)}">`);
          out.push(`                    <xposition>${num(l.x)}</xposition>`);
          out.push(`                    <yposition>${num(l.y)}</yposition>`);
          out.push(`                    <force>${num(l.force)}</force>`);
          out.push("                </pointload>");
        } else {
          out.push(`                <surfaceLoad_const_full name="${esc(l.name)}">`);
          out.push(`                    <force>${num(l.force)}</force>`);
          out.push("                </surfaceLoad_const_full>");
        }
      });
      (d.stiffeners ?? []).forEach((st) => {
        const def = STIFFENER[st.profile];
        out.push(`                <Stiffener name="${esc(st.name)}" classname="${def.java}">`);
        out.push(`                    <position>${num(st.position)}</position>`);
        out.push(`                    <direction>${DIRECTION_INDEX[st.direction]}</direction>`);
        for (const k of def.props) out.push(`                    <${k}>${num(st[k])}</${k}>`);
        out.push("                </Stiffener>");
      });
      out.push("            </deformation>");
    });
    (c.cutouts ?? []).forEach((co) => {
      const def = CUTOUT[co.shape];
      out.push(`            <cutout name="${esc(co.name)}">`);
      for (const k of ["n_xx", "n_yy", "n_xy", "m_xx", "m_yy", "m_xy"]) {
        out.push(`                <${k}>${num(co[k])}</${k}>`);
      }
      out.push(`                <val>${co.val}</val>`);
      out.push(`                <CutoutGeometry name="${esc(def.label)}" classname="${def.java}">`);
      out.push(`                    <A>${num(co.a)}</A>`);
      if (co.shape === "elliptical" || co.shape === "rectangular") {
        out.push(`                    <B>${num(co.b)}</B>`);
      }
      if (co.shape === "square" || co.shape === "rectangular") {
        out.push(`                    <Terme>${co.terms}</Terme>`);
      }
      out.push("                </CutoutGeometry>");
      out.push("            </cutout>");
    });
    (c.springIns ?? []).forEach((sp) => {
      const def = SPRING_IN[sp.model];
      out.push(`            <springIn name="${esc(sp.name)}">`);
      out.push(`                <alphat_thick>${num(sp.alphat_thick)}</alphat_thick>`);
      out.push(`                <angle>${num(sp.angle)}</angle>`);
      out.push(`                <baseTemp>${num(sp.baseTemp)}</baseTemp>`);
      out.push(`                <hardeningTemp>${num(sp.hardeningTemp)}</hardeningTemp>`);
      out.push(`                <radius>${num(sp.radius)}</radius>`);
      out.push(
        `                <useAutoCalcAlphat_thick>${sp.useAutoCalcAlphat_thick}</useAutoCalcAlphat_thick>`,
      );
      out.push(`                <zeroDegAsCircumDir>${sp.zeroDegAsCircumDir}</zeroDegAsCircumDir>`);
      out.push(`                <SpringInModel name="${esc(def.label)}" classname="${def.java}">`);
      if (sp.model === "enhanced_radford") {
        out.push(`                    <eps_cr>${num(sp.eps_cr)}</eps_cr>`);
        out.push(`                    <eps_cu>${num(sp.eps_cu)}</eps_cu>`);
      }
      out.push("                </SpringInModel>");
      out.push("            </springIn>");
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
  MICRO_MATERIALS.forEach((m) => {
    out.push(
      `        <material class="de.elamx.micromechanics.MicroMechanicMaterial" name="${esc(m.name)}" uuid="${m.id}">`,
    );
    out.push(`            <fibre>${m.fibre}</fibre>`);
    out.push(`            <matrix>${m.matrix}</matrix>`);
    out.push(`            <phi>${num(m.phi)}</phi>`);
    const tags = [
      ["Epar", m.e_par], ["Enor", m.e_nor], ["nue12", m.nue12], ["G", m.g],
      ["G13", m.g13], ["G23", m.g23], ["rho", m.rho],
      ["alphaTPar", m.alpha_t_par], ["alphaTNor", m.alpha_t_nor],
      ["betaPar", m.beta_par], ["betaNor", m.beta_nor],
      ["RParTen", m.r_par_ten], ["RParCom", m.r_par_com],
      ["RNorTen", m.r_nor_ten], ["RNorCom", m.r_nor_com], ["RShear", m.r_shear],
    ];
    tags.forEach(([t, v]) => out.push(`            <${t}>${num(v)}</${t}>`));
    out.push(`            <Epar_micromechmodel>${MICRO[m.models.e_par]}</Epar_micromechmodel>`);
    out.push(`            <Enor_micromechmodel>${MICRO[m.models.e_nor]}</Enor_micromechmodel>`);
    out.push(`            <Nue12_micromechmodel>${MICRO[m.models.nue12]}</Nue12_micromechmodel>`);
    out.push(`            <G_micromechmodel>${MICRO[m.models.g]}</G_micromechmodel>`);
    out.push("        </material>");
  });
  out.push("    </materials>");

  if (OPTIMIZATIONS.length > 0) {
    out.push("    <optimizations>");
    OPTIMIZATIONS.forEach((o) => {
      out.push(`        <optimization name="${esc(o.name)}">`);
      out.push(`            <angletype>${o.angletype}</angletype>`);
      out.push(`            <optimizer>${OPTIMIZERS[o.optimizer]}</optimizer>`);
      out.push(`            <thickness>${num(o.thickness)}</thickness>`);
      out.push(`            <material>${o.material}</material>`);
      out.push(`            <criterion>${CRITERIA[o.criterion].java}</criterion>`);
      out.push(`            <symmetriclaminat>${o.symmetric}</symmetriclaminat>`);
      out.push(`            <angles number="${o.angles.length}">`);
      o.angles.forEach((a, i) => out.push(`                <angle${i}>${num(a)}</angle${i}>`));
      out.push("            </angles>");
      o.constraints.forEach((c) => {
        out.push(
          `            <minimalReserverFactorCalculator classname="${CONSTRAINT_CLASSES[c.kind]}">`,
        );
        if (c.kind === "clt") {
          for (const k of ["n_x", "n_y", "n_xy", "m_x", "m_y", "m_xy"]) {
            out.push(`                <${k}>${num(c[k] ?? 0)}</${k}>`);
          }
          out.push(`                <deltat>${num(c.delta_t ?? 0)}</deltat>`);
          out.push(`                <deltah>${num(c.delta_h ?? 0)}</deltah>`);
        } else if (c.kind === "buckling") {
          for (const k of ["n_x", "n_y", "n_xy"]) {
            out.push(`                <${k}>${num(c[k] ?? 0)}</${k}>`);
          }
          out.push(`                <length>${num(c.length)}</length>`);
          out.push(`                <width>${num(c.width)}</width>`);
          out.push(`                <bcx>${BOUNDARY.indexOf(c.bc_x)}</bcx>`);
          out.push(`                <bcy>${BOUNDARY.indexOf(c.bc_y)}</bcy>`);
          out.push(`                <m>${c.m}</m>`);
          out.push(`                <n>${c.n}</n>`);
          out.push(
            `                <dmatrixservice>${D_MATRIX[c.d_matrix].java}</dmatrixservice>`,
          );
        } else if (c.kind === "deformation") {
          out.push(`                <length>${num(c.length)}</length>`);
          out.push(`                <width>${num(c.width)}</width>`);
          out.push(`                <bcx>${BOUNDARY.indexOf(c.bc_x)}</bcx>`);
          out.push(`                <bcy>${BOUNDARY.indexOf(c.bc_y)}</bcy>`);
          out.push(`                <m>${c.m}</m>`);
          out.push(`                <n>${c.n}</n>`);
          out.push(
            `                <dmatrixservice>${D_MATRIX[c.d_matrix].java}</dmatrixservice>`,
          );
          out.push(`                <maxDisplacement>${num(c.maxDisplacement)}</maxDisplacement>`);
          out.push(`                <surfaceLoad_const_full name="q">`);
          out.push(`                    <force>${num(c.force)}</force>`);
          out.push("                </surfaceLoad_const_full>");
        } else {
          out.push(`                <pressure>${num(c.pressure)}</pressure>`);
          out.push(`                <radius>${num(c.radius)}</radius>`);
          out.push(`                <radiustype>${c.radiustype}</radiustype>`);
        }
        out.push("            </minimalReserverFactorCalculator>");
      });
      out.push("        </optimization>");
    });
    out.push("    </optimizations>");
  }

  out.push("    <fibres>");
  FIBRES.forEach((f) => {
    out.push(
      `        <fibre class="de.elamx.micromechanics.Fiber" name="${esc(f.name)}" uuid="${f.id}">`,
    );
    [
      ["Epar", f.e_par], ["Enor", f.e_nor], ["nue12", f.nue12], ["G", f.g],
      ["G13", f.g13], ["G23", f.g23], ["rho", f.rho],
      ["alphaTPar", f.alpha_t_par], ["alphaTNor", f.alpha_t_nor],
      ["betaPar", f.beta_par], ["betaNor", f.beta_nor],
    ].forEach(([t, v]) => out.push(`            <${t}>${num(v)}</${t}>`));
    out.push("        </fibre>");
  });
  out.push("    </fibres>");

  out.push("    <matrices>");
  MATRICES.forEach((m) => {
    out.push(
      `        <matrix class="de.elamx.micromechanics.Matrix" name="${esc(m.name)}" uuid="${m.id}">`,
    );
    // No <G>: the Java class derives it from E and nue.
    [["E", m.e], ["nue", m.nue], ["rho", m.rho], ["alpha", m.alpha], ["beta", m.beta]].forEach(
      ([t, v]) => out.push(`            <${t}>${num(v)}</${t}>`),
    );
    out.push("        </matrix>");
  });
  out.push("    </matrices>");
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
      micro: null,
    };
  });
  MICRO_MATERIALS.forEach((m) => {
    materials[m.id] = {
      id: m.id, name: m.name,
      e_par: m.e_par, e_nor: m.e_nor, nue12: m.nue12, g: m.g, g13: m.g13, g23: m.g23,
      rho: m.rho,
      alpha_t_par: m.alpha_t_par, alpha_t_nor: m.alpha_t_nor,
      beta_par: m.beta_par, beta_nor: m.beta_nor,
      r_par_ten: m.r_par_ten, r_par_com: m.r_par_com,
      r_nor_ten: m.r_nor_ten, r_nor_com: m.r_nor_com, r_shear: m.r_shear,
      additional_values: {},
      micro: {
        fibre_id: m.fibre,
        matrix_id: m.matrix,
        phi: m.phi,
        // Never stored, so always what eLamX falls back to.
        rho_model: "rule_of_mixture",
        e_par_model: m.models.e_par,
        e_nor_model: m.models.e_nor,
        nue12_model: m.models.nue12,
        g_model: m.models.g,
      },
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
    deformations: (c.deformations ?? []).map((d) => ({
      name: d.name,
      input: {
        length: d.length,
        width: d.width,
        bc_x: d.bc_x,
        bc_y: d.bc_y,
        m: d.m,
        n: d.n,
        d_matrix: d.d_matrix,
        // NamedLoad flattens its TransverseLoad, whose tag is `kind` and
        // whose variants keep their Rust spelling.
        loads: (d.loads ?? []).map((l) =>
          l.kind === "point"
            ? { name: l.name, kind: "Point", x: l.x, y: l.y, force: l.force }
            : { name: l.name, kind: "Surface", force: l.force },
        ),
        stiffeners: (d.stiffeners ?? []).map(stiffenerJson),
        max_displacement_z: d.maxDisplacement,
      },
    })),
    cutouts: (c.cutouts ?? []).map((co) => ({
      name: co.name,
      input: {
        geometry:
          co.shape === "circular"
            ? { shape: "circular", a: co.a }
            : co.shape === "elliptical"
              ? { shape: "elliptical", a: co.a, b: co.b }
              : co.shape === "square"
                ? { shape: "square", a: co.a, terms: co.terms }
                : { shape: "rectangular", a: co.a, b: co.b, terms: co.terms },
        n_x: co.n_xx,
        n_y: co.n_yy,
        n_xy: co.n_xy,
        m_x: co.m_xx,
        m_y: co.m_yy,
        m_xy: co.m_xy,
        values: co.val,
      },
    })),
    spring_ins: (c.springIns ?? []).map((sp) => ({
      name: sp.name,
      input: {
        // The enum the Rust side reads: the model's own two properties move
        // inside it, and eps_cu is the circumferential one.
        model: sp.model === "enhanced_radford"
          ? { model: "enhanced_radford", eps_circumferential: sp.eps_cu, eps_thickness: sp.eps_cr }
          : { model: "simple_radford" },
        model_name: SPRING_IN[sp.model].label,
        angle: sp.angle,
        radius: sp.radius,
        alphat_thick: sp.alphat_thick,
        base_temp: sp.baseTemp,
        hardening_temp: sp.hardeningTemp,
        use_auto_calc_alphat_thick: sp.useAutoCalcAlphat_thick,
        zero_deg_as_circum_dir: sp.zeroDegAsCircumDir,
      },
    })),
    vibrations: (c.vibrations ?? []).map(({ name, d_matrix, stiffeners, ...input }) => ({
      name,
      input: { ...input, d_matrix, stiffeners: (stiffeners ?? []).map(stiffenerJson) },
    })),
    bucklings: (c.bucklings ?? []).map(({ name, d_matrix, stiffeners, ...input }) => ({
      name,
      input: { ...input, d_matrix, stiffeners: (stiffeners ?? []).map(stiffenerJson) },
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

  return (
    JSON.stringify(
      { materials, fibres: FIBRES, matrices: MATRICES, laminates, optimizations: optimizationsJson() },
      null,
      2,
    ) +
    "\n"
  );
}

// elamx-core tags the profile with `profile` and flattens its parameters into
// the stiffener. The parameter names above are the Java ones, because the XML
// needs them spelled exactly so; Rust spells the same quantities lower case.
const stiffenerJson = ({ profile, name, direction, position, ...params }) => ({
  name,
  direction,
  position,
  profile,
  ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k.toLowerCase(), v])),
});

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

/** The optimisations in elamx-core's serde shape. */
function optimizationsJson() {
  return OPTIMIZATIONS.map((o) => ({
    name: o.name,
    optimizer: o.optimizer,
    angle_type: o.angletype,
    input: {
      angles: o.angles,
      thickness: o.thickness,
      material_id: o.material,
      criterion_id: o.criterion,
      symmetric: o.symmetric,
      constraints: o.constraints.map((c) => {
        if (c.kind === "clt") {
          return {
            kind: "clt",
            // `?? 0` and not a plain spread: a missing component has to land
            // as a zero, because the Rust side's Deserialize wants every field.
            loads: loadsJson(
              loads({
                n_x: c.n_x ?? 0, n_y: c.n_y ?? 0, n_xy: c.n_xy ?? 0,
                m_x: c.m_x ?? 0, m_y: c.m_y ?? 0, m_xy: c.m_xy ?? 0,
              }),
            ),
          };
        }
        if (c.kind === "buckling") {
          return {
            kind: "buckling",
            input: {
              length: c.length, width: c.width,
              n_x: c.n_x ?? 0, n_y: c.n_y ?? 0, n_xy: c.n_xy ?? 0,
              bc_x: c.bc_x, bc_y: c.bc_y, m: c.m, n: c.n,
              d_matrix: c.d_matrix, stiffeners: [],
            },
          };
        }
        if (c.kind === "deformation") {
          return {
            kind: "deformation",
            input: {
              length: c.length, width: c.width,
              bc_x: c.bc_x, bc_y: c.bc_y, m: c.m, n: c.n,
              d_matrix: c.d_matrix,
              loads: [{ name: "q", kind: "Surface", force: c.force }],
              stiffeners: [],
              max_displacement_z: c.maxDisplacement,
            },
          };
        }
        return {
          kind: "pressure_vessel",
          input: {
            pressure: c.pressure,
            radius: c.radius,
            radius_type: { 1: "Inner", 2: "Mean", 4: "Outer" }[c.radiustype],
          },
        };
      }),
      // Not stored by the format; the reader leaves them at their defaults.
      max_layers: 200,
    },
  }));
}

writeFileSync(join(HERE, "reference.elamx"), elamxXml());
writeFileSync(join(HERE, "reference.input.json"), inputJson());

const layerCount = CASES.reduce((n, c) => n + c.layers.length, 0);
const calcCount = CASES.reduce((n, c) => n + c.calculations.length, 0);
const buckCount = CASES.reduce((n, c) => n + (c.bucklings ?? []).length, 0);
const vibCount = CASES.reduce((n, c) => n + (c.vibrations ?? []).length, 0);
const springCount = CASES.reduce((n, c) => n + (c.springIns ?? []).length, 0);
const cutoutCount = CASES.reduce((n, c) => n + (c.cutouts ?? []).length, 0);
const defoCount = CASES.reduce((n, c) => n + (c.deformations ?? []).length, 0);
const stiffCount = CASES.reduce(
  (n, c) => n + (c.bucklings ?? []).reduce((k, b) => k + (b.stiffeners ?? []).length, 0),
  0,
);
const lpfCount = CASES.reduce((n, c) => n + (c.lastPlyFailures ?? []).length, 0);
console.log(
  `reference.elamx + reference.input.json geschrieben: ` +
    `${CASES.length} Laminate, ${layerCount} gespeicherte Lagen, ${calcCount} Berechnungen, ` +
    `${buckCount} Beulanalysen (davon ${stiffCount} Versteifungen), ` +
    `${vibCount} Schwingungsanalysen, ${springCount} Spring-In-Analysen, ` +
    `${cutoutCount} Ausschnitte, ${defoCount} Verformungsanalysen, ` +
    `${OPTIMIZATIONS.length} Optimierungen, ` +
    `${lpfCount} Last-Ply-Failure-Analysen, ` +
    `${ALL_CRITERIA.length} Kriterien abgedeckt.`,
);
