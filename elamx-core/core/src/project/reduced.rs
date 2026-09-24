//! `.elamxb`: the reduced input file the batch mode takes.
//! Reference: eLamX2/ReducedInput/src/de/elamx/reducedinput/ReducedInputHandler.java
//!
//! Not a second file format so much as a shorthand for writing analyses by
//! hand. A `.elamx` is what the program saves; a `.elamxb` is what someone
//! types to ask it a question - materials once, load cases once by name, and
//! then analyses that refer to them.
//!
//! Three things it does that the saved format does not, and they are the whole
//! reason it exists:
//!
//! - **A load case is an object.** It is written once and referred to by name
//!   from a calculation, a buckling analysis and a last-ply-failure analysis,
//!   so the same load is not typed three times and cannot drift between them.
//! - **A material may carry a second set of elastic constants for buckling.**
//!   `<buckling>` inside `<material>` gives degraded moduli, and any laminate
//!   using such a material gets a SECOND laminate built from them, which is
//!   what the buckling analyses then run on.
//! - **Defaults come from the material.** A layer with no thickness and no
//!   criterion takes the material's.
//!
//! The original parses this with SAX rather than DOM, and its own comment says
//! why: the meaning depends on the ORDER of the blocks. That is preserved here
//! by walking the document in order rather than by looking things up.

use super::naming;
use super::read::ReadError;
use super::{NamedBuckling, NamedCalculation, NamedLastPlyFailure, Project, ProjectLaminate};
use crate::clt::{CltLaminate, LastPlyFailureInput, Loads, Strains};
use crate::model::{Laminate, Layer, Material};
use crate::plate::{BoundaryCondition, BucklingInput, DMatrixKind};
use roxmltree::Node;
use std::collections::HashMap;
use uuid::Uuid;

type Result<T> = std::result::Result<T, ReadError>;

/// A load case, which in this format is named and shared.
#[derive(Debug, Clone, Default)]
struct LoadCase {
    loads: Loads,
    /// The ultimate-load factor. Only the last-ply-failure analysis reads it,
    /// as its `j_a`; a plain calculation ignores it.
    ul_factor: Option<f64>,
}

/// What a material contributes beyond itself: the defaults its layers inherit
/// and the degraded twin its buckling analyses use.
struct MaterialEntry {
    material: Material,
    thickness: Option<f64>,
    criterion_id: Option<String>,
    buckling: Option<Material>,
}

/// Reads a `.elamxb` into the same `Project` a `.elamx` reads into.
///
/// The result is an ordinary project: there is nothing reduced about it once it
/// is open, which is the point - the shorthand is for writing, not for holding.
pub fn read_elamxb(xml: &str) -> Result<Project> {
    let doc = super::read::parse_document(xml)?;
    let root = doc.root_element();
    if root.tag_name().name() != "elamx" {
        return Err(ReadError::NotAnElamxFile);
    }

    let mut project = Project {
        version: root.attribute("version").unwrap_or("1").to_string(),
        ..Default::default()
    };

    let mut materials: HashMap<String, MaterialEntry> = HashMap::new();
    // Deliberately NOT cleared per laminate: the original keeps one map for the
    // whole document, so a later laminate may use an earlier one's load case.
    let mut load_cases: HashMap<String, LoadCase> = HashMap::new();

    for node in root.children().filter(Node::is_element) {
        match node.tag_name().name().to_lowercase().as_str() {
            "materials" => {
                for material in node.children().filter(|n| n.has_tag_name("material")) {
                    let entry = read_material(material)?;
                    project.materials.push(entry.material.clone());
                    if let Some(buckling) = &entry.buckling {
                        project.materials.push(buckling.clone());
                    }
                    materials.insert(entry.material.name.clone(), entry);
                }
            }
            "laminates" => {
                for laminate in node.children().filter(|n| n.has_tag_name("laminate")) {
                    read_laminate(laminate, &materials, &mut load_cases, &mut project)?;
                }
            }
            // A material or a laminate written at the top level, without the
            // wrapper the example file uses. The SAX handler never looks at the
            // nesting, so both spellings work there and both work here.
            "material" => {
                let entry = read_material(node)?;
                project.materials.push(entry.material.clone());
                if let Some(buckling) = &entry.buckling {
                    project.materials.push(buckling.clone());
                }
                materials.insert(entry.material.name.clone(), entry);
            }
            "laminate" => read_laminate(node, &materials, &mut load_cases, &mut project)?,
            _ => {}
        }
    }

    Ok(project)
}

fn read_material(node: Node) -> Result<MaterialEntry> {
    let name = node.attribute("name").unwrap_or("").to_string();
    let mut material = Material::new(Uuid::new_v4().to_string(), &name, 0.0, 0.0, 0.0, 0.0, 0.0);
    // Every material in the original starts with the registered criterion
    // parameters at their defaults and only then reads the file (see the
    // `Material` constructor). A reduced input names very few of them - the
    // example file gives FMC's two and nothing else - so without this a Puck
    // calculation on such a material would ask for a value that the original
    // has and this crate does not.
    material.additional_values = crate::failure::default_additional_values();
    let mut thickness = None;
    let mut criterion_id = None;
    let mut buckling_node = None;

    for child in node.children().filter(Node::is_element) {
        let tag = child.tag_name().name().to_lowercase();
        if tag == "buckling" {
            buckling_node = Some(child);
            continue;
        }
        if tag == "criterion" {
            let java = text(child);
            criterion_id = Some(
                naming::criterion_from_java(&java)
                    .ok_or_else(|| ReadError::Unknown {
                        context: format!("Material '{name}'"),
                        value: java.clone(),
                    })?
                    .to_string(),
            );
            continue;
        }
        let value = number(child, &name)?;
        match tag.as_str() {
            "epar" => material.e_par = value,
            "enor" => material.e_nor = value,
            "nue12" => material.nue12 = value,
            "g" => material.g = value,
            "g13" => material.g13 = value,
            "g23" => material.g23 = value,
            "rho" => material.rho = value,
            "rparten" => material.r_par_ten = value,
            "rparcom" => material.set_r_par_com(value),
            "rnorten" => material.r_nor_ten = value,
            "rnorcom" => material.set_r_nor_com(value),
            "rshear" => material.set_r_shear(value),
            "thickness" => thickness = Some(value),
            // The criterion parameters, under the short names this format uses
            // rather than the fully qualified ones a saved file writes.
            "fmc.muesp" => add(&mut material, crate::failure::FMC_MUE_SP, value),
            "fmc.m" => add(&mut material, crate::failure::FMC_M, value),
            "puck.a0" => add(&mut material, crate::failure::A0, value),
            "puck.pspz" => add(&mut material, crate::failure::PSPZ, value),
            "puck.pspd" => add(&mut material, crate::failure::PSPD, value),
            "puck.lambda_min" => add(&mut material, crate::failure::LAMBDA_MIN, value),
            "tsai_wu.f12star" => add(&mut material, crate::failure::F12_STAR, value),
            _ => {}
        }
    }

    // The degraded twin: a copy of everything, with only the elastic constants
    // that are given replaced. It is a material of its own in the project, so
    // that what the buckling analysis ran on can be read back.
    let buckling = buckling_node
        .map(|child| -> Result<Material> {
            let mut degraded = material.clone();
            degraded.id = Uuid::new_v4().to_string();
            degraded.name = format!("{name} Buckling");
            for value_node in child.children().filter(Node::is_element) {
                let value = number(value_node, &degraded.name)?;
                match value_node.tag_name().name().to_lowercase().as_str() {
                    "epar" => degraded.e_par = value,
                    "enor" => degraded.e_nor = value,
                    "nue12" => degraded.nue12 = value,
                    "g" => degraded.g = value,
                    "g13" => degraded.g13 = value,
                    "g23" => degraded.g23 = value,
                    _ => {}
                }
            }
            Ok(degraded)
        })
        .transpose()?;

    Ok(MaterialEntry {
        material,
        thickness,
        criterion_id,
        buckling,
    })
}

fn add(material: &mut Material, key: &str, value: f64) {
    material.additional_values.insert(key.to_string(), value);
}

fn read_laminate(
    node: Node,
    materials: &HashMap<String, MaterialEntry>,
    load_cases: &mut HashMap<String, LoadCase>,
    project: &mut Project,
) -> Result<()> {
    let name = node.attribute("name").unwrap_or("").to_string();
    let mut laminate = Laminate::new(Uuid::new_v4().to_string(), &name);
    laminate.offset = flag_number(node.attribute("offset"));
    laminate.symmetric = flag(node.attribute("symmetric"));
    laminate.with_middle_layer = flag(node.attribute("with_middle_layer"));
    laminate.invert_z = flag(node.attribute("invert_z"));

    let mut entry = ProjectLaminate {
        laminate,
        calculations: Vec::new(),
        bucklings: Vec::new(),
        last_ply_failures: Vec::new(),
        pressure_vessels: Vec::new(),
        deformations: Vec::new(),
        vibrations: Vec::new(),
        spring_ins: Vec::new(),
        cutouts: Vec::new(),
        unsupported_modules: Vec::new(),
    };
    // Built at the first buckling analysis, not here: the original copies the
    // laminate at that moment, so it contains the layers read SO FAR.
    let mut buckling_entry: Option<ProjectLaminate> = None;
    let mut needs_buckling_laminate = false;

    for child in node.children().filter(Node::is_element) {
        match child.tag_name().name().to_lowercase().as_str() {
            "layer" => {
                let layer_name = child.attribute("name").unwrap_or("").to_string();
                let mut angle = 0.0;
                let mut thickness = None;
                let mut material_name = String::new();
                let mut criterion = None;
                for value_node in child.children().filter(Node::is_element) {
                    let tag = value_node.tag_name().name().to_lowercase();
                    match tag.as_str() {
                        "material" => material_name = text(value_node),
                        "criterion" => {
                            let java = text(value_node);
                            criterion = Some(
                                naming::criterion_from_java(&java)
                                    .ok_or_else(|| ReadError::Unknown {
                                        context: format!("Lage '{layer_name}'"),
                                        value: java.clone(),
                                    })?
                                    .to_string(),
                            );
                        }
                        "angle" => angle = number(value_node, &layer_name)?,
                        "thickness" => thickness = Some(number(value_node, &layer_name)?),
                        _ => {}
                    }
                }

                let material = materials.get(&material_name).ok_or_else(|| {
                    ReadError::UnknownMaterial {
                        layer: layer_name.clone(),
                        material: material_name.clone(),
                    }
                })?;
                if material.buckling.is_some() {
                    needs_buckling_laminate = true;
                }

                let mut layer = Layer::new(
                    Uuid::new_v4().to_string(),
                    &layer_name,
                    material.material.id.clone(),
                    angle,
                    // The material's own thickness is the default, which is
                    // what makes a stack of one repeated ply short to write.
                    thickness.or(material.thickness).unwrap_or(0.0),
                );
                layer.criterion_id = criterion.or_else(|| material.criterion_id.clone());
                entry.laminate.layers.push(layer);
            }
            "loadcase" => {
                let case_name = child.attribute("name").unwrap_or("").to_string();
                let mut case = LoadCase::default();
                for value_node in child.children().filter(Node::is_element) {
                    let value = number(value_node, &case_name)?;
                    match value_node.tag_name().name().to_lowercase().as_str() {
                        "n_x" => case.loads.n_x = value,
                        "n_y" => case.loads.n_y = value,
                        "n_xy" => case.loads.n_xy = value,
                        "m_x" => case.loads.m_x = value,
                        "m_y" => case.loads.m_y = value,
                        "m_xy" => case.loads.m_xy = value,
                        "deltat" => case.loads.delta_t = value,
                        "deltah" => case.loads.delta_h = value,
                        "ul_factor" => case.ul_factor = Some(value),
                        _ => {}
                    }
                }
                load_cases.insert(case_name, case);
            }
            "calculation" => {
                let analysis_name = child.attribute("name").unwrap_or("").to_string();
                let case = referenced_case(child, load_cases, &analysis_name)?;
                entry.calculations.push(NamedCalculation {
                    name: analysis_name,
                    loads: case.loads,
                    strains: Strains::default(),
                    // This format cannot prescribe a strain, so every degree of
                    // freedom is load-controlled.
                    use_strain: [false; 6],
                });
            }
            "buckling" => {
                if needs_buckling_laminate && buckling_entry.is_none() {
                    buckling_entry = Some(degraded_copy(&entry, materials));
                }
                let analysis_name = child.attribute("name").unwrap_or("").to_string();
                let case = referenced_case(child, load_cases, &analysis_name)?;
                let input = read_buckling(child, &case, &analysis_name)?;

                let target = buckling_entry.as_mut().unwrap_or(&mut entry);
                target.bucklings.push(NamedBuckling {
                    name: analysis_name.clone(),
                    input: input.clone(),
                });

                // An unsymmetric laminate has no D matrix of its own, so the
                // original runs the analysis a SECOND time with the reduced
                // bending stiffness and lets the reader compare the two.
                if !is_symmetric(target, project) {
                    target.bucklings.push(NamedBuckling {
                        name: format!("{analysis_name} Dtilde-option"),
                        input: BucklingInput {
                            d_matrix: DMatrixKind::DTilde,
                            ..input
                        },
                    });
                }
            }
            "lastplyfailure" => {
                let analysis_name = child.attribute("name").unwrap_or("").to_string();
                let case = referenced_case(child, load_cases, &analysis_name)?;
                let mut input = LastPlyFailureInput {
                    loads: case.loads,
                    // The ultimate-load factor is the only place it is read.
                    j_a: case.ul_factor.unwrap_or(1.0),
                    degrade_all_on_fibre_failure: flag(
                        child.attribute("degrade_all_on_fibre_failure"),
                    ),
                    ..Default::default()
                };
                // Hygrothermal fields are not part of a last-ply-failure load
                // in either program - the original copies the six mechanical
                // components and nothing else.
                input.loads.delta_t = 0.0;
                input.loads.delta_h = 0.0;
                for value_node in child.children().filter(Node::is_element) {
                    let tag = value_node.tag_name().name().to_lowercase();
                    match tag.as_str() {
                        "degradationfactor" => {
                            input.degradation_factor = number(value_node, &analysis_name)?
                        }
                        "epsilon_crit" => {
                            input.epsilon_crit = number(value_node, &analysis_name)?
                        }
                        _ => {}
                    }
                }
                entry.last_ply_failures.push(NamedLastPlyFailure {
                    name: analysis_name,
                    input,
                });
            }
            _ => {}
        }
    }

    project.laminates.push(entry);
    if let Some(buckling) = buckling_entry {
        project.laminates.push(buckling);
    }
    Ok(())
}

/// The laminate a buckling analysis runs on when its materials have degraded
/// twins: the same stack, the same angles, the degraded materials.
fn degraded_copy(entry: &ProjectLaminate, materials: &HashMap<String, MaterialEntry>) -> ProjectLaminate {
    let mut laminate = entry.laminate.clone();
    laminate.id = Uuid::new_v4().to_string();
    laminate.name = format!("{} Buckling", entry.laminate.name);
    for layer in &mut laminate.layers {
        let degraded = materials
            .values()
            .find(|m| m.material.id == layer.material_id)
            .and_then(|m| m.buckling.as_ref());
        if let Some(degraded) = degraded {
            layer.material_id = degraded.id.clone();
        }
    }
    // A copy of the STACK only: the analyses stay with the laminate they were
    // written under, and the buckling ones are added to this one as they come.
    ProjectLaminate {
        laminate,
        calculations: Vec::new(),
        bucklings: Vec::new(),
        last_ply_failures: Vec::new(),
        pressure_vessels: Vec::new(),
        deformations: Vec::new(),
        vibrations: Vec::new(),
        spring_ins: Vec::new(),
        cutouts: Vec::new(),
        unsupported_modules: Vec::new(),
    }
}

/// Whether the stack has no bending-extension coupling worth speaking of - the
/// B-matrix test, the same one the rest of the crate uses.
fn is_symmetric(entry: &ProjectLaminate, project: &Project) -> bool {
    let materials: HashMap<String, Material> = project
        .materials
        .iter()
        .map(|m| (m.id.clone(), m.clone()))
        .collect();
    match CltLaminate::new(&entry.laminate, &materials) {
        Ok(clt) => clt.is_symmetric(),
        // A laminate whose materials cannot be resolved is a broken file, and
        // the layer reader has already refused it; treating it as symmetric
        // here only avoids a second analysis nobody would see.
        Err(_) => true,
    }
}

fn read_buckling(node: Node, case: &LoadCase, name: &str) -> Result<BucklingInput> {
    let mut input = BucklingInput {
        n_x: case.loads.n_x,
        n_y: case.loads.n_y,
        n_xy: case.loads.n_xy,
        ..Default::default()
    };
    let mut m = None;
    let mut n = None;
    for value_node in node.children().filter(Node::is_element) {
        let tag = value_node.tag_name().name().to_lowercase();
        match tag.as_str() {
            "length" => input.length = number(value_node, name)?,
            "width" => input.width = number(value_node, name)?,
            "bcx" => input.bc_x = boundary(whole(value_node, name)?, name)?,
            "bcy" => input.bc_y = boundary(whole(value_node, name)?, name)?,
            "m" => m = Some(term_count(value_node, name)?),
            "n" => n = Some(term_count(value_node, name)?),
            _ => {}
        }
    }
    // A file written before the term count was split in two gives only `n`.
    input.n = n.unwrap_or(0);
    input.m = m.unwrap_or(input.n);
    Ok(input)
}

/// A code or a count: a number, and a whole one - see `read::whole_number`.
fn whole(node: Node, context: &str) -> Result<i64> {
    let value = number(node, context)?;
    let context = format!("{context}/<{}>", node.tag_name().name());
    super::read::whole_number(value, &context, &text(node))
}

fn term_count(node: Node, context: &str) -> Result<usize> {
    let value = whole(node, context)?;
    usize::try_from(value).map_err(|_| ReadError::NotAWholeNumber {
        context: format!("{context}/<{}>", node.tag_name().name()),
        text: text(node),
    })
}

fn boundary(code: i64, context: &str) -> Result<BoundaryCondition> {
    let index = usize::try_from(code).unwrap_or(usize::MAX);
    naming::boundary_from_index(index).ok_or_else(|| ReadError::Unknown {
        context: context.to_string(),
        value: format!("Randbedingung {code}"),
    })
}

fn referenced_case(node: Node, cases: &HashMap<String, LoadCase>, name: &str) -> Result<LoadCase> {
    let referenced = node
        .children()
        .filter(Node::is_element)
        .find(|n| n.tag_name().name().eq_ignore_ascii_case("loadcase"))
        .map(text)
        .unwrap_or_default();
    cases.get(&referenced).cloned().ok_or(ReadError::Unknown {
        context: name.to_string(),
        value: format!("Lastfall '{referenced}'"),
    })
}

fn text(node: Node) -> String {
    node.text().unwrap_or("").trim().to_string()
}

fn number(node: Node, context: &str) -> Result<f64> {
    let raw = text(node);
    raw.parse::<f64>().map_err(|_| ReadError::NotANumber {
        context: format!("{context}/<{}>", node.tag_name().name()),
        text: raw,
    })
}

fn flag(value: Option<&str>) -> bool {
    // `Boolean.parseBoolean`: anything that is not "true" is false, and a
    // missing attribute is false rather than an error.
    matches!(value, Some(v) if v.eq_ignore_ascii_case("true"))
}

fn flag_number(value: Option<&str>) -> f64 {
    value.and_then(|v| v.trim().parse().ok()).unwrap_or(0.0)
}
