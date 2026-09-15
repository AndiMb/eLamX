//! `.elamx` -> [`Project`].
//!
//! Deliberately stricter than the Java original in one respect: where
//! `LaminateLoadSaveImpl` silently substitutes Puck for a criterion it cannot
//! resolve, and the buckling hook silently substitutes the standard D matrix,
//! this reader reports the unknown name. A laminate quietly evaluated against
//! a different criterion than the file asked for is a wrong answer that looks
//! like a right one.

use super::naming;
use super::{
    NamedBuckling, NamedCalculation, NamedDeformation, NamedLastPlyFailure, NamedPressureVessel,
    NamedCutout, NamedSpringIn, NamedVibration, Project, ProjectLaminate, RawElement,
};
use crate::clt::{LastPlyFailureInput, Loads, PressureVesselInput, RadiusType, Strains};
use crate::micromechanics::{self, Fibre, MatrixMaterial, MicroMechanics, Model};
use crate::model::{Laminate, Layer, Material};
use crate::plate::{
    BucklingInput, DeformationInput, NamedLoad, Stiffener, StiffenerDirection, StiffenerGeometry,
    VibrationInput,
};
use crate::cutout::{CutoutGeometry, CutoutInput};
use crate::spring_in::{SpringInInput, SpringInModel};
use roxmltree::{Document, Node};

#[derive(Debug, Clone, PartialEq)]
pub enum ReadError {
    /// The bytes are not well-formed XML.
    Xml(String),
    /// Well-formed XML, but not an `.elamx` document.
    NotAnElamxFile,
    /// A required element or attribute is missing.
    Missing { context: String, what: String },
    /// An element's text is not a number.
    NotANumber { context: String, text: String },
    /// A criterion / D-matrix class name or edge-condition index the format
    /// defines but this crate does not know.
    Unknown { context: String, value: String },
    /// A layer references a material that the file does not define.
    UnknownMaterial { layer: String, material: String },
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::Xml(e) => write!(f, "kein gültiges XML: {e}"),
            ReadError::NotAnElamxFile => write!(f, "kein <elamx>-Wurzelelement"),
            ReadError::Missing { context, what } => write!(f, "{context}: <{what}> fehlt"),
            ReadError::NotANumber { context, text } => {
                write!(f, "{context}: '{text}' ist keine Zahl")
            }
            ReadError::Unknown { context, value } => {
                write!(f, "{context}: '{value}' ist unbekannt")
            }
            ReadError::UnknownMaterial { layer, material } => write!(
                f,
                "Lage '{layer}' verweist auf das nicht vorhandene Material '{material}'"
            ),
        }
    }
}

impl std::error::Error for ReadError {}

type Result<T> = std::result::Result<T, ReadError>;

/// Parses an `.elamx` document.
pub fn read_elamx(xml: &str) -> Result<Project> {
    let doc = Document::parse(xml).map_err(|e| ReadError::Xml(e.to_string()))?;
    let root = doc.root_element();
    if root.tag_name().name() != "elamx" {
        return Err(ReadError::NotAnElamxFile);
    }

    let version = root.attribute("version").unwrap_or("1").to_string();

    let mut materials = match child(root, "materials") {
        Some(node) => node
            .children()
            .filter(|n| n.has_tag_name("material"))
            .map(read_material)
            .collect::<Result<Vec<_>>>()?,
        None => Vec::new(),
    };

    let fibres = match child(root, "fibres") {
        Some(node) => node
            .children()
            .filter(|n| n.has_tag_name("fibre"))
            .map(read_fibre)
            .collect::<Result<Vec<_>>>()?,
        None => Vec::new(),
    };

    let matrices = match child(root, "matrices") {
        Some(node) => node
            .children()
            .filter(|n| n.has_tag_name("matrix"))
            .map(read_matrix)
            .collect::<Result<Vec<_>>>()?,
        None => Vec::new(),
    };

    // Before the laminates, which resolve their layers against these: a
    // micromechanic material's stored properties are a cache eLamX itself
    // recomputes on every read of them, so they are recomputed here too.
    micromechanics::resolve(&mut materials, &fibres, &matrices).map_err(|missing| {
        ReadError::Unknown {
            context: format!("Material '{}', {}", missing.material, missing.kind),
            value: missing.id,
        }
    })?;

    let laminates = match child(root, "laminates") {
        Some(node) => node
            .children()
            .filter(|n| n.has_tag_name("laminate"))
            .map(|n| read_laminate(n, &materials))
            .collect::<Result<Vec<_>>>()?,
        None => Vec::new(),
    };

    // Sections that belong to the project rather than to a laminate and that
    // this crate does not model - `<optimizations>` today. They travel as raw
    // XML: dropping them would delete real work on the next save.
    let unsupported_sections = root
        .children()
        .filter(|n| n.is_element())
        .filter(|n| {
            !["materials", "laminates", "fibres", "matrices"].contains(&n.tag_name().name())
        })
        .map(|n| RawElement {
            tag: n.tag_name().name().to_string(),
            xml: serialise(n),
        })
        .collect();

    Ok(Project {
        version,
        materials,
        fibres,
        matrices,
        laminates,
        unsupported_sections,
    })
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

fn read_fibre(node: Node) -> Result<Fibre> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("Fasermaterial '{name}'");
    Ok(Fibre {
        id: attr(node, "uuid").unwrap_or_default().to_string(),
        name,
        e_par: number(node, "Epar", &ctx)?,
        e_nor: number(node, "Enor", &ctx)?,
        nue12: number(node, "nue12", &ctx)?,
        g: number(node, "G", &ctx)?,
        // The Java reader defaults these two to zero when the tag is missing,
        // which is how a file written before they existed still opens.
        g13: optional_number(node, "G13", &ctx)?.unwrap_or(0.0),
        g23: optional_number(node, "G23", &ctx)?.unwrap_or(0.0),
        rho: number(node, "rho", &ctx)?,
        alpha_t_par: number(node, "alphaTPar", &ctx)?,
        alpha_t_nor: number(node, "alphaTNor", &ctx)?,
        beta_par: number(node, "betaPar", &ctx)?,
        beta_nor: number(node, "betaNor", &ctx)?,
    })
}

fn read_matrix(node: Node) -> Result<MatrixMaterial> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("Matrixmaterial '{name}'");
    // No <G>: the Java class derives it from E and nue and refuses to be told
    // otherwise, so the file has never carried one.
    Ok(MatrixMaterial {
        id: attr(node, "uuid").unwrap_or_default().to_string(),
        name,
        e: number(node, "E", &ctx)?,
        nue: number(node, "nue", &ctx)?,
        rho: number(node, "rho", &ctx)?,
        alpha: number(node, "alpha", &ctx)?,
        beta: number(node, "beta", &ctx)?,
    })
}

/// The micromechanic half of a `<material>`, or `None` for a plain one.
///
/// Told apart by the `class` attribute, as the original does - the two kinds
/// live in the same `<materials>` list and share most of their tags.
fn read_micro_mechanics(node: Node, ctx: &str) -> Result<Option<MicroMechanics>> {
    if attr(node, "class") != Some("de.elamx.micromechanics.MicroMechanicMaterial") {
        return Ok(None);
    }

    let id = |tag: &str| -> Result<String> {
        text(node, tag)
            .map(str::to_string)
            .ok_or_else(|| ReadError::Missing {
                context: ctx.to_string(),
                what: tag.to_string(),
            })
    };

    let model = |tag: &str| -> Result<Model> {
        match text(node, tag) {
            Some(java) => naming::micro_model_from_java(java).ok_or_else(|| ReadError::Unknown {
                context: format!("{ctx}, <{tag}>"),
                value: java.to_string(),
            }),
            // What eLamX substitutes for a missing or unresolvable model.
            None => Ok(Model::RuleOfMixture),
        }
    };

    Ok(Some(MicroMechanics {
        fibre_id: id("fibre")?,
        matrix_id: id("matrix")?,
        phi: number(node, "phi", ctx)?,
        // The density's model is not in the format: the writer stores four
        // model tags and no `rho_micromechmodel`, so a saved material comes
        // back on the rule of mixtures however it was set.
        rho_model: Model::RuleOfMixture,
        e_par_model: model("Epar_micromechmodel")?,
        e_nor_model: model("Enor_micromechmodel")?,
        nue12_model: model("Nue12_micromechmodel")?,
        g_model: model("G_micromechmodel")?,
    }))
}

fn read_material(node: Node) -> Result<Material> {
    let id = attr(node, "uuid").unwrap_or_default().to_string();
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("Material '{name}'");

    let mut material = Material::new(
        id,
        name,
        number(node, "Epar", &ctx)?,
        number(node, "Enor", &ctx)?,
        number(node, "nue12", &ctx)?,
        number(node, "G", &ctx)?,
        optional_number(node, "rho", &ctx)?.unwrap_or(0.0),
    );

    material.g13 = optional_number(node, "G13", &ctx)?.unwrap_or(0.0);
    material.g23 = optional_number(node, "G23", &ctx)?.unwrap_or(0.0);
    material.alpha_t_par = optional_number(node, "alphaTPar", &ctx)?.unwrap_or(0.0);
    material.alpha_t_nor = optional_number(node, "alphaTNor", &ctx)?.unwrap_or(0.0);
    material.beta_par = optional_number(node, "betaPar", &ctx)?.unwrap_or(0.0);
    material.beta_nor = optional_number(node, "betaNor", &ctx)?.unwrap_or(0.0);
    material.r_par_ten = optional_number(node, "RParTen", &ctx)?.unwrap_or(0.0);
    material.set_r_par_com(optional_number(node, "RParCom", &ctx)?.unwrap_or(0.0));
    material.r_nor_ten = optional_number(node, "RNorTen", &ctx)?.unwrap_or(0.0);
    material.set_r_nor_com(optional_number(node, "RNorCom", &ctx)?.unwrap_or(0.0));
    material.set_r_shear(optional_number(node, "RShear", &ctx)?.unwrap_or(0.0));
    material.micro = read_micro_mechanics(node, &ctx)?;

    // Everything else is an additional value. Parameters the ported criteria
    // read are translated to this crate's keys; the rest keep their Java name
    // so that writing the file back does not drop them.
    // The micromechanic tags are listed too: they are read above, and a
    // `<fibre>` holding a UUID would otherwise be parsed as a number and fail.
    //
    // So are the five the material database uses. `MaterialDataBase
    // .getMaterialsFromFile` reads `fibreName`, `fibreType`, `matrixName`,
    // `matrixType` and `type` out of a `<material>` when a user points eLamX at
    // their own `.elamx` as a catalogue - they describe where a ply came from,
    // not how it behaves. No eLamX writer produces them (the shipped catalogue
    // is generated Java source, not a file), but a hand-written one may, and
    // three of the five are text: without this a catalogue file would not open
    // at all.
    const FIXED: [&str; 28] = [
        "Epar", "Enor", "nue12", "G", "G13", "G23", "rho", "alphaTPar", "alphaTNor", "betaPar",
        "betaNor", "RParTen", "RParCom", "RNorTen", "RNorCom", "RShear", "fibre", "matrix", "phi",
        "Epar_micromechmodel", "Enor_micromechmodel", "Nue12_micromechmodel", "G_micromechmodel",
        "fibreName", "fibreType", "matrixName", "matrixType", "type",
    ];
    for extra in node.children().filter(|n| n.is_element()) {
        let tag = extra.tag_name().name();
        if FIXED.contains(&tag) {
            continue;
        }
        let text = extra.text().unwrap_or("").trim();
        let value = text.parse::<f64>().map_err(|_| ReadError::NotANumber {
            context: format!("{ctx}, Zusatzwert <{tag}>"),
            text: text.to_string(),
        })?;
        let key = naming::additional_value_from_java(tag).unwrap_or(tag);
        material.additional_values.insert(key.to_string(), value);
    }

    Ok(material)
}

// ---------------------------------------------------------------------------
// Laminates
// ---------------------------------------------------------------------------

fn read_laminate(node: Node, materials: &[Material]) -> Result<ProjectLaminate> {
    let id = attr(node, "uuid").unwrap_or_default().to_string();
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("Laminat '{name}'");

    let mut laminate = Laminate::new(id, name.clone());
    laminate.symmetric = flag(node, "symmetric");
    laminate.with_middle_layer = flag(node, "with_middle_layer");
    laminate.invert_z = flag(node, "invert_z");
    laminate.offset = match attr(node, "offset") {
        Some(text) => text.trim().parse().map_err(|_| ReadError::NotANumber {
            context: ctx.clone(),
            text: text.to_string(),
        })?,
        None => 0.0,
    };

    let mut calculations = Vec::new();
    let mut bucklings = Vec::new();
    let mut last_ply_failures = Vec::new();
    let mut pressure_vessels = Vec::new();
    let mut deformations = Vec::new();
    let mut vibrations = Vec::new();
    let mut spring_ins = Vec::new();
    let mut cutouts = Vec::new();
    let mut unsupported_modules = Vec::new();

    for element in node.children().filter(|n| n.is_element()) {
        match element.tag_name().name() {
            "layer" => laminate.layers.push(read_layer(element, materials, &ctx)?),
            "calculation" => calculations.push(read_calculation(element, &ctx)?),
            "buckling" => bucklings.push(read_buckling(element, &ctx)?),
            "lastplyfailure" => last_ply_failures.push(read_last_ply_failure(element, &ctx)?),
            "pressurevessel" => pressure_vessels.push(read_pressure_vessel(element, &ctx)?),
            "deformation" => deformations.push(read_deformation(element, &ctx)?),
            "vibration" => vibrations.push(read_vibration(element, &ctx)?),
            "springIn" => spring_ins.push(read_spring_in(element, &ctx)?),
            "cutout" => cutouts.push(read_cutout(element, &ctx)?),
            other => unsupported_modules.push(RawElement {
                tag: other.to_string(),
                xml: serialise(element),
            }),
        }
    }

    Ok(ProjectLaminate {
        laminate,
        calculations,
        bucklings,
        last_ply_failures,
        pressure_vessels,
        deformations,
        vibrations,
        spring_ins,
        cutouts,
        unsupported_modules,
    })
}

fn read_layer(node: Node, materials: &[Material], parent: &str) -> Result<Layer> {
    let id = attr(node, "uuid").unwrap_or_default().to_string();
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Lage '{name}'");

    let material_id = text(node, "material")
        .ok_or_else(|| ReadError::Missing {
            context: ctx.clone(),
            what: "material".into(),
        })?
        .to_string();
    if !materials.iter().any(|m| m.id == material_id) {
        return Err(ReadError::UnknownMaterial {
            layer: name,
            material: material_id,
        });
    }

    let mut layer = Layer::new(
        id,
        name,
        material_id,
        number(node, "angle", &ctx)?,
        number(node, "thickness", &ctx)?,
    );

    // Absent means "the original's default", which is Puck (DataLayer's
    // constructor). An unknown name is an error rather than that default.
    layer.criterion_id = match text(node, "criterion") {
        None => Some(crate::failure::PUCK_ID.to_string()),
        Some(java) => Some(
            naming::criterion_from_java(java)
                .ok_or_else(|| ReadError::Unknown {
                    context: format!("{ctx}, Versagenskriterium"),
                    value: java.to_string(),
                })?
                .to_string(),
        ),
    };

    Ok(layer)
}

fn read_calculation(node: Node, parent: &str) -> Result<NamedCalculation> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Berechnung '{name}'");

    let loads = Loads {
        n_x: number(node, "n_x", &ctx)?,
        n_y: number(node, "n_y", &ctx)?,
        n_xy: number(node, "n_xy", &ctx)?,
        m_x: number(node, "m_x", &ctx)?,
        m_y: number(node, "m_y", &ctx)?,
        m_xy: number(node, "m_xy", &ctx)?,
        delta_t: number(node, "deltat", &ctx)?,
        delta_h: number(node, "deltah", &ctx)?,
        ..Default::default()
    };

    let strains = Strains {
        epsilon_x: number(node, "epsilon_x", &ctx)?,
        epsilon_y: number(node, "epsilon_y", &ctx)?,
        gamma_xy: number(node, "gamma_xy", &ctx)?,
        kappa_x: number(node, "kappa_x", &ctx)?,
        kappa_y: number(node, "kappa_y", &ctx)?,
        kappa_xy: number(node, "kappa_xy", &ctx)?,
    };

    let mut use_strain = [false; 6];
    for (i, slot) in use_strain.iter_mut().enumerate() {
        *slot = text(node, &format!("useStrain{i}")).is_some_and(|t| t.trim() == "true");
    }

    Ok(NamedCalculation {
        name,
        loads,
        strains,
        use_strain,
    })
}

fn read_buckling(node: Node, parent: &str) -> Result<NamedBuckling> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Beulanalyse '{name}'");

    let input = BucklingInput {
        length: number(node, "length", &ctx)?,
        width: number(node, "width", &ctx)?,
        n_x: number(node, "n_x", &ctx)?,
        n_y: number(node, "n_y", &ctx)?,
        n_xy: number(node, "n_xy", &ctx)?,
        bc_x: boundary(node, "bcx", &ctx)?,
        bc_y: boundary(node, "bcy", &ctx)?,
        m: number(node, "m", &ctx)? as usize,
        n: number(node, "n", &ctx)? as usize,
        d_matrix: d_matrix(node, &ctx)?,
        stiffeners: read_stiffeners(node, &ctx)?,
    };

    Ok(NamedBuckling { name, input })
}

fn read_last_ply_failure(node: Node, parent: &str) -> Result<NamedLastPlyFailure> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Last-Ply-Failure-Analyse '{name}'");

    let input = LastPlyFailureInput {
        loads: Loads {
            n_x: number(node, "n_x", &ctx)?,
            n_y: number(node, "n_y", &ctx)?,
            n_xy: number(node, "n_xy", &ctx)?,
            m_x: number(node, "m_x", &ctx)?,
            m_y: number(node, "m_y", &ctx)?,
            m_xy: number(node, "m_xy", &ctx)?,
            // No dT/dc: the format stores none, and the analysis could not use
            // them (see clt::last_ply_failure).
            ..Default::default()
        },
        degradation_factor: number(node, "degradationFactor", &ctx)?,
        epsilon_crit: number(node, "epsilon_crit", &ctx)?,
        j_a: number(node, "j_a", &ctx)?,
        // The Java reader passes this through Boolean.parseBoolean, where
        // anything but "true" means false - including a missing element.
        degrade_all_on_fibre_failure: text(node, "degradeAllOnFibreFailure")
            .is_some_and(|t| t.eq_ignore_ascii_case("true")),
    };

    Ok(NamedLastPlyFailure { name, input })
}

fn read_deformation(node: Node, parent: &str) -> Result<NamedDeformation> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Plattenverformung '{name}'");

    let mut loads = Vec::new();
    for element in node.children().filter(|n| n.is_element()) {
        match element.tag_name().name() {
            "pointload" => {
                let load_name = attr(element, "name").unwrap_or_default().to_string();
                let lctx = format!("{ctx}, Einzellast '{load_name}'");
                loads.push(NamedLoad::point(
                    load_name,
                    number(element, "xposition", &lctx)?,
                    number(element, "yposition", &lctx)?,
                    number(element, "force", &lctx)?,
                ));
            }
            "surfaceLoad_const_full" => {
                let load_name = attr(element, "name").unwrap_or_default().to_string();
                let lctx = format!("{ctx}, Flächenlast '{load_name}'");
                loads.push(NamedLoad::surface(load_name, number(element, "force", &lctx)?));
            }
            _ => {}
        }
    }

    Ok(NamedDeformation {
        name,
        input: DeformationInput {
            length: number(node, "length", &ctx)?,
            width: number(node, "width", &ctx)?,
            bc_x: boundary(node, "bcx", &ctx)?,
            bc_y: boundary(node, "bcy", &ctx)?,
            m: number(node, "m", &ctx)? as usize,
            n: number(node, "n", &ctx)? as usize,
            d_matrix: d_matrix(node, &ctx)?,
            loads,
            stiffeners: read_stiffeners(node, &ctx)?,
            // Absent in a file written before the field existed, and eLamX
            // itself defaults it to zero rather than refusing.
            max_displacement_z: optional_number(node, "maxDisplacement", &ctx)?.unwrap_or(0.0),
        },
    })
}

/// An edge condition, stored as the index into eLamX's own array.
fn boundary(node: Node, tag: &str, ctx: &str) -> Result<crate::plate::BoundaryCondition> {
    let index = number(node, tag, ctx)? as usize;
    naming::boundary_from_index(index).ok_or_else(|| ReadError::Unknown {
        context: format!("{ctx}, <{tag}>"),
        value: index.to_string(),
    })
}

/// The bending-stiffness idealisation, by Java class name.
///
/// A missing `<dmatrixservice>` means a file written before the choice
/// existed; those carry `<wholed>` instead, which the original maps to the
/// standard or the special-orthotropic matrix. All three plate analyses store
/// it the same way, so they read it the same way.
fn d_matrix(node: Node, ctx: &str) -> Result<crate::plate::DMatrixKind> {
    match text(node, "dmatrixservice") {
        Some(java) => naming::d_matrix_from_java(java).ok_or_else(|| ReadError::Unknown {
            context: format!("{ctx}, Biegesteifigkeit"),
            value: java.to_string(),
        }),
        None => Ok(match text(node, "wholed") {
            Some("false") => crate::plate::DMatrixKind::SpecialOrthotropic,
            _ => crate::plate::DMatrixKind::Standard,
        }),
    }
}

fn read_vibration(node: Node, parent: &str) -> Result<NamedVibration> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Schwingungsanalyse '{name}'");

    Ok(NamedVibration {
        name,
        input: VibrationInput {
            length: number(node, "length", &ctx)?,
            width: number(node, "width", &ctx)?,
            bc_x: boundary(node, "bcx", &ctx)?,
            bc_y: boundary(node, "bcy", &ctx)?,
            m: number(node, "m", &ctx)? as usize,
            n: number(node, "n", &ctx)? as usize,
            d_matrix: d_matrix(node, &ctx)?,
            stiffeners: read_stiffeners(node, &ctx)?,
        },
    })
}

fn read_spring_in(node: Node, parent: &str) -> Result<NamedSpringIn> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Spring-In '{name}'");

    // The model sits in a child element that names its Java class, with its
    // own numeric properties under it - the same reflected shape the stiffener
    // profiles use, and written by the same kind of code.
    let model_node = child(node, "SpringInModel").ok_or_else(|| ReadError::Missing {
        context: ctx.clone(),
        what: "SpringInModel".to_string(),
    })?;
    let class = attr(model_node, "classname").ok_or_else(|| ReadError::Missing {
        context: ctx.clone(),
        what: "classname".to_string(),
    })?;
    let code = naming::spring_in_model_from_java(class).ok_or_else(|| ReadError::Unknown {
        context: format!("{ctx}, Modell"),
        value: class.to_string(),
    })?;
    let model = match code {
        "simple_radford" => SpringInModel::SimpleRadford,
        // On the crossed names see spring_in::SpringInModel::chemical_term:
        // `eps_cu` is the one around the bend, whatever the property sheet
        // says.
        _ => SpringInModel::EnhancedRadford {
            eps_circumferential: number(model_node, "eps_cu", &ctx)?,
            eps_thickness: number(model_node, "eps_cr", &ctx)?,
        },
    };

    Ok(NamedSpringIn {
        name,
        input: SpringInInput {
            model,
            model_name: attr(model_node, "name")
                .unwrap_or(model.default_name())
                .to_string(),
            angle: number(node, "angle", &ctx)?,
            radius: number(node, "radius", &ctx)?,
            alphat_thick: number(node, "alphat_thick", &ctx)?,
            base_temp: number(node, "baseTemp", &ctx)?,
            hardening_temp: number(node, "hardeningTemp", &ctx)?,
            // Boolean.parseBoolean again: anything but "true" is false.
            use_auto_calc_alphat_thick: text(node, "useAutoCalcAlphat_thick")
                .is_some_and(|t| t.eq_ignore_ascii_case("true")),
            zero_deg_as_circum_dir: text(node, "zeroDegAsCircumDir")
                .is_some_and(|t| t.eq_ignore_ascii_case("true")),
        },
    })
}

fn read_cutout(node: Node, parent: &str) -> Result<NamedCutout> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Ausschnitt '{name}'");

    // The shape sits in a child element naming its Java class, with its own
    // properties under it - the third module to use that reflected shape,
    // after the stiffeners and the spring-in model.
    let shape_node = child(node, "CutoutGeometry").ok_or_else(|| ReadError::Missing {
        context: ctx.clone(),
        what: "CutoutGeometry".to_string(),
    })?;
    let class = attr(shape_node, "classname").ok_or_else(|| ReadError::Missing {
        context: ctx.clone(),
        what: "classname".to_string(),
    })?;
    let code = naming::cutout_shape_from_java(class).ok_or_else(|| ReadError::Unknown {
        context: format!("{ctx}, Form"),
        value: class.to_string(),
    })?;

    let a = number(shape_node, "A", &ctx)?;
    // `Terme` is the German property name, capital and all - it is what the
    // reflection wrote, so it is what the file says.
    let terms = |ctx: &str| -> Result<usize> { Ok(number(shape_node, "Terme", ctx)? as usize) };
    let geometry = match code {
        "circular" => CutoutGeometry::Circular { a },
        "elliptical" => CutoutGeometry::Elliptical { a, b: number(shape_node, "B", &ctx)? },
        "square" => CutoutGeometry::Square { a, terms: terms(&ctx)? },
        _ => CutoutGeometry::Rectangular {
            a,
            b: number(shape_node, "B", &ctx)?,
            terms: terms(&ctx)?,
        },
    };

    Ok(NamedCutout {
        name,
        input: CutoutInput {
            geometry,
            n_x: number(node, "n_xx", &ctx)?,
            n_y: number(node, "n_yy", &ctx)?,
            n_xy: number(node, "n_xy", &ctx)?,
            m_x: number(node, "m_xx", &ctx)?,
            m_y: number(node, "m_yy", &ctx)?,
            m_xy: number(node, "m_xy", &ctx)?,
            values: number(node, "val", &ctx)? as usize,
        },
    })
}

/// The `<Stiffener>` children of a buckling, deformation or vibration element.
///
/// The profile is identified by Java class name, and its geometry parameters
/// are written under their own property names - `LoadSaveStiffeners` derives
/// both from the service's `getPropertyDefinitions()` by reflection, so the tag
/// names ARE the Java field names, capital letters and all.
fn read_stiffeners(node: Node, parent: &str) -> Result<Vec<Stiffener>> {
    let mut stiffeners = Vec::new();
    for element in node.children().filter(|n| n.is_element()) {
        if element.tag_name().name() != "Stiffener" {
            continue;
        }
        let name = attr(element, "name").unwrap_or_default().to_string();
        let ctx = format!("{parent}, Versteifung '{name}'");

        let class = attr(element, "classname").ok_or_else(|| ReadError::Missing {
            context: ctx.clone(),
            what: "classname".to_string(),
        })?;
        let profile =
            naming::stiffener_profile_from_java(class).ok_or_else(|| ReadError::Unknown {
                context: format!("{ctx}, Profil"),
                value: class.to_string(),
            })?;

        let index = number(element, "direction", &ctx)? as i32;
        let direction =
            StiffenerDirection::from_java_index(index).ok_or_else(|| ReadError::Unknown {
                context: format!("{ctx}, <direction>"),
                value: index.to_string(),
            })?;

        let v = |tag: &str| number(element, tag, &ctx);
        let geometry = match profile {
            // No <z>: the direct input does not list it among its properties,
            // so eLamX never writes one - see plate::stiffener on why nothing
            // misses it.
            "direct" => StiffenerGeometry::Direct {
                e: v("E")?,
                i: v("I")?,
                g: v("G")?,
                j: v("J")?,
                a: v("A")?,
                rho: v("Rho")?,
            },
            "i_profile" => StiffenerGeometry::IProfile {
                w1: v("w1")?,
                t1: v("t1")?,
                e: v("E")?,
                g: v("G")?,
                rho: v("Rho")?,
            },
            "t_profile" => StiffenerGeometry::TProfile {
                w1: v("w1")?,
                t1: v("t1")?,
                w2: v("w2")?,
                t2: v("t2")?,
                e: v("E")?,
                g: v("G")?,
                rho: v("Rho")?,
            },
            other => unreachable!("unmapped stiffener profile '{other}'"),
        };

        stiffeners.push(Stiffener {
            name,
            direction,
            position: number(element, "position", &ctx)?,
            geometry,
        });
    }
    Ok(stiffeners)
}

fn read_pressure_vessel(node: Node, parent: &str) -> Result<NamedPressureVessel> {
    let name = attr(node, "name").unwrap_or_default().to_string();
    let ctx = format!("{parent}, Drucktank '{name}'");

    // The format stores the radius type as the Java constant's own value
    // (1/2/4), not as an index - see PressureVesselInput.
    let radius_type = match number(node, "radiustype", &ctx)? as i64 {
        1 => RadiusType::Inner,
        2 => RadiusType::Mean,
        4 => RadiusType::Outer,
        other => {
            return Err(ReadError::Unknown {
                context: format!("{ctx}, <radiustype>"),
                value: other.to_string(),
            })
        }
    };

    Ok(NamedPressureVessel {
        name,
        input: PressureVesselInput {
            pressure: number(node, "pressure", &ctx)?,
            radius: number(node, "radius", &ctx)?,
            radius_type,
        },
    })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn child<'a>(node: Node<'a, 'a>, tag: &str) -> Option<Node<'a, 'a>> {
    node.children().find(|n| n.has_tag_name(tag))
}

fn attr<'a>(node: Node<'a, 'a>, name: &str) -> Option<&'a str> {
    node.attribute(name)
}

fn flag(node: Node, name: &str) -> bool {
    node.attribute(name).is_some_and(|v| v.trim() == "true")
}

fn text<'a>(node: Node<'a, 'a>, tag: &str) -> Option<&'a str> {
    child(node, tag).and_then(|n| n.text()).map(str::trim)
}

fn number(node: Node, tag: &str, context: &str) -> Result<f64> {
    let raw = text(node, tag).ok_or_else(|| ReadError::Missing {
        context: context.to_string(),
        what: tag.to_string(),
    })?;
    raw.parse().map_err(|_| ReadError::NotANumber {
        context: format!("{context}, <{tag}>"),
        text: raw.to_string(),
    })
}

fn optional_number(node: Node, tag: &str, context: &str) -> Result<Option<f64>> {
    match text(node, tag) {
        None => Ok(None),
        Some(raw) => raw
            .parse()
            .map(Some)
            .map_err(|_| ReadError::NotANumber {
                context: format!("{context}, <{tag}>"),
                text: raw.to_string(),
            }),
    }
}

/// Serialises an element back to XML, for module data this crate keeps but
/// does not interpret. Only what the `.elamx` schema actually uses is handled:
/// elements, attributes and text - no comments, CDATA or namespaces.
fn serialise(node: Node) -> String {
    let mut out = String::new();
    serialise_into(node, &mut out);
    out
}

fn serialise_into(node: Node, out: &mut String) {
    let name = node.tag_name().name();
    out.push('<');
    out.push_str(name);
    for a in node.attributes() {
        out.push(' ');
        out.push_str(a.name());
        out.push_str("=\"");
        out.push_str(&super::write::escape(a.value()));
        out.push('"');
    }
    let children: Vec<Node> = node.children().filter(|n| n.is_element()).collect();
    let own_text = node.text().map(str::trim).unwrap_or("");
    if children.is_empty() && own_text.is_empty() {
        out.push_str("/>");
        return;
    }
    out.push('>');
    if children.is_empty() {
        out.push_str(&super::write::escape(own_text));
    } else {
        for c in children {
            serialise_into(c, out);
        }
    }
    out.push_str("</");
    out.push_str(name);
    out.push('>');
}
