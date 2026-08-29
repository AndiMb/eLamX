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
    NamedBuckling, NamedCalculation, NamedLastPlyFailure, Project, ProjectLaminate, RawModule,
};
use crate::clt::{LastPlyFailureInput, Loads, Strains};
use crate::model::{Laminate, Layer, Material};
use crate::plate::BucklingInput;
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

    let materials = match child(root, "materials") {
        Some(node) => node
            .children()
            .filter(|n| n.has_tag_name("material"))
            .map(read_material)
            .collect::<Result<Vec<_>>>()?,
        None => Vec::new(),
    };

    let laminates = match child(root, "laminates") {
        Some(node) => node
            .children()
            .filter(|n| n.has_tag_name("laminate"))
            .map(|n| read_laminate(n, &materials))
            .collect::<Result<Vec<_>>>()?,
        None => Vec::new(),
    };

    Ok(Project {
        version,
        materials,
        laminates,
    })
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

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

    // Everything else is an additional value. Parameters the ported criteria
    // read are translated to this crate's keys; the rest keep their Java name
    // so that writing the file back does not drop them.
    const FIXED: [&str; 16] = [
        "Epar", "Enor", "nue12", "G", "G13", "G23", "rho", "alphaTPar", "alphaTNor", "betaPar",
        "betaNor", "RParTen", "RParCom", "RNorTen", "RNorCom", "RShear",
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
    let mut unsupported_modules = Vec::new();

    for element in node.children().filter(|n| n.is_element()) {
        match element.tag_name().name() {
            "layer" => laminate.layers.push(read_layer(element, materials, &ctx)?),
            "calculation" => calculations.push(read_calculation(element, &ctx)?),
            "buckling" => bucklings.push(read_buckling(element, &ctx)?),
            "lastplyfailure" => last_ply_failures.push(read_last_ply_failure(element, &ctx)?),
            other => unsupported_modules.push(RawModule {
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

    let bc = |tag: &str| -> Result<crate::plate::BoundaryCondition> {
        let index = number(node, tag, &ctx)? as usize;
        naming::boundary_from_index(index).ok_or_else(|| ReadError::Unknown {
            context: format!("{ctx}, <{tag}>"),
            value: index.to_string(),
        })
    };

    // A missing <dmatrixservice> means an old file written before the choice
    // existed; those carry <wholed> instead, which the original maps to the
    // standard or special-orthotropic matrix.
    let d_matrix = match text(node, "dmatrixservice") {
        Some(java) => naming::d_matrix_from_java(java).ok_or_else(|| ReadError::Unknown {
            context: format!("{ctx}, Biegesteifigkeit"),
            value: java.to_string(),
        })?,
        None => match text(node, "wholed") {
            Some("false") => crate::plate::DMatrixKind::SpecialOrthotropic,
            _ => crate::plate::DMatrixKind::Standard,
        },
    };

    let input = BucklingInput {
        length: number(node, "length", &ctx)?,
        width: number(node, "width", &ctx)?,
        n_x: number(node, "n_x", &ctx)?,
        n_y: number(node, "n_y", &ctx)?,
        n_xy: number(node, "n_xy", &ctx)?,
        bc_x: bc("bcx")?,
        bc_y: bc("bcy")?,
        m: number(node, "m", &ctx)? as usize,
        n: number(node, "n", &ctx)? as usize,
        d_matrix,
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
