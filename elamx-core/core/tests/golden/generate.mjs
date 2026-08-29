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
      loads: { ...calc.loads, nt_x: 0, nt_y: 0, nt_xy: 0, mt_x: 0, mt_y: 0, mt_xy: 0 },
      strains: calc.strains ?? strains(),
      use_strain: calc.useStrain ?? NO_STRAIN,
    })),
  }));

  return JSON.stringify({ materials, laminates }, null, 2) + "\n";
}

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
console.log(
  `reference.elamx + reference.input.json geschrieben: ` +
    `${CASES.length} Laminate, ${layerCount} gespeicherte Lagen, ${calcCount} Berechnungen, ` +
    `${ALL_CRITERIA.length} Kriterien abgedeckt.`,
);
