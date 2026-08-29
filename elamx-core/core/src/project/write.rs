//! [`Project`] -> `.elamx`.
//!
//! Hand-written rather than driven by a serialisation library: the element
//! order, the indentation and the number formatting all have to match what
//! eLamX 3.x itself writes, so that a file saved here is a small diff against
//! the same file saved there - not a reformatting of the whole document.

use super::naming;
use super::{
    NamedBuckling, NamedCalculation, NamedLastPlyFailure, Project, ProjectLaminate,
};
use crate::model::{Laminate, Material};

/// Serialises a project to `.elamx` XML.
pub fn write_elamx(project: &Project) -> String {
    let mut out = String::with_capacity(8 * 1024);
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!("<elamx version=\"{}\">\n", escape(&project.version)));

    out.push_str("    <laminates>\n");
    for entry in &project.laminates {
        write_laminate(entry, &mut out);
    }
    out.push_str("    </laminates>\n");

    out.push_str("    <materials>\n");
    for material in &project.materials {
        write_material(material, &mut out);
    }
    out.push_str("    </materials>\n");

    out.push_str("</elamx>\n");
    out
}

fn write_laminate(entry: &ProjectLaminate, out: &mut String) {
    let lam: &Laminate = &entry.laminate;
    out.push_str(&format!(
        "        <laminate invert_z=\"{}\" name=\"{}\" offset=\"{}\" symmetric=\"{}\" uuid=\"{}\" with_middle_layer=\"{}\">\n",
        lam.invert_z,
        escape(&lam.name),
        num(lam.offset),
        lam.symmetric,
        escape(&lam.id),
        lam.with_middle_layer,
    ));

    for layer in &lam.layers {
        out.push_str(&format!(
            "            <layer name=\"{}\" uuid=\"{}\">\n",
            escape(&layer.name),
            escape(&layer.id)
        ));
        tag(out, 16, "thickness", &num(layer.thickness));
        tag(out, 16, "angle", &num(layer.angle()));
        tag(out, 16, "material", &escape(&layer.material_id));
        // An unmapped criterion id cannot round-trip, so fall back to the
        // format's own default rather than writing something eLamX would
        // silently reinterpret.
        let criterion = layer
            .criterion_id
            .as_deref()
            .and_then(naming::criterion_to_java)
            .unwrap_or_else(|| naming::criterion_to_java(crate::failure::PUCK_ID).unwrap());
        tag(out, 16, "criterion", criterion);
        out.push_str("            </layer>\n");
    }

    for calculation in &entry.calculations {
        write_calculation(calculation, out);
    }
    for buckling in &entry.bucklings {
        write_buckling(buckling, out);
    }
    for analysis in &entry.last_ply_failures {
        write_last_ply_failure(analysis, out);
    }
    for raw in &entry.unsupported_modules {
        out.push_str("            ");
        out.push_str(&raw.xml);
        out.push('\n');
    }

    out.push_str("        </laminate>\n");
}

fn write_calculation(calculation: &NamedCalculation, out: &mut String) {
    let l = &calculation.loads;
    let s = &calculation.strains;
    out.push_str(&format!(
        "            <calculation name=\"{}\">\n",
        escape(&calculation.name)
    ));
    for (name, value) in [
        ("n_x", l.n_x),
        ("n_y", l.n_y),
        ("n_xy", l.n_xy),
        ("m_x", l.m_x),
        ("m_y", l.m_y),
        ("m_xy", l.m_xy),
    ] {
        tag(out, 16, name, &num(value));
    }
    tag(out, 16, "deltat", &num(l.delta_t));
    tag(out, 16, "deltah", &num(l.delta_h));
    for (i, use_strain) in calculation.use_strain.iter().enumerate() {
        tag(out, 16, &format!("useStrain{i}"), &use_strain.to_string());
    }
    for (name, value) in [
        ("epsilon_x", s.epsilon_x),
        ("epsilon_y", s.epsilon_y),
        ("gamma_xy", s.gamma_xy),
        ("kappa_x", s.kappa_x),
        ("kappa_y", s.kappa_y),
        ("kappa_xy", s.kappa_xy),
    ] {
        tag(out, 16, name, &num(value));
    }
    out.push_str("            </calculation>\n");
}

fn write_buckling(buckling: &NamedBuckling, out: &mut String) {
    let b = &buckling.input;
    out.push_str(&format!(
        "            <buckling name=\"{}\">\n",
        escape(&buckling.name)
    ));
    tag(out, 16, "n_x", &num(b.n_x));
    tag(out, 16, "n_y", &num(b.n_y));
    tag(out, 16, "n_xy", &num(b.n_xy));
    tag(out, 16, "length", &num(b.length));
    tag(out, 16, "width", &num(b.width));
    tag(out, 16, "bcx", &naming::boundary_to_index(b.bc_x).to_string());
    tag(out, 16, "bcy", &naming::boundary_to_index(b.bc_y).to_string());
    tag(out, 16, "m", &b.m.to_string());
    tag(out, 16, "n", &b.n.to_string());
    tag(out, 16, "dmatrixservice", naming::d_matrix_to_java(b.d_matrix));
    out.push_str("            </buckling>\n");
}

fn write_last_ply_failure(analysis: &NamedLastPlyFailure, out: &mut String) {
    let input = &analysis.input;
    out.push_str(&format!(
        "            <lastplyfailure name=\"{}\">\n",
        escape(&analysis.name)
    ));
    for (name, value) in [
        ("n_x", input.loads.n_x),
        ("n_y", input.loads.n_y),
        ("n_xy", input.loads.n_xy),
        ("m_x", input.loads.m_x),
        ("m_y", input.loads.m_y),
        ("m_xy", input.loads.m_xy),
    ] {
        tag(out, 16, name, &num(value));
    }
    tag(out, 16, "degradationFactor", &num(input.degradation_factor));
    tag(
        out,
        16,
        "degradeAllOnFibreFailure",
        &input.degrade_all_on_fibre_failure.to_string(),
    );
    tag(out, 16, "epsilon_crit", &num(input.epsilon_crit));
    tag(out, 16, "j_a", &num(input.j_a));
    out.push_str("            </lastplyfailure>\n");
}

fn write_material(material: &Material, out: &mut String) {
    out.push_str(&format!(
        "        <material class=\"de.elamx.laminate.DefaultMaterial\" name=\"{}\" uuid=\"{}\">\n",
        escape(&material.name),
        escape(&material.id)
    ));
    for (name, value) in [
        ("Epar", material.e_par),
        ("Enor", material.e_nor),
        ("nue12", material.nue12),
        ("G", material.g),
        ("G13", material.g13),
        ("G23", material.g23),
        ("rho", material.rho),
        ("alphaTPar", material.alpha_t_par),
        ("alphaTNor", material.alpha_t_nor),
        ("betaPar", material.beta_par),
        ("betaNor", material.beta_nor),
        ("RParTen", material.r_par_ten),
        ("RParCom", material.r_par_com),
        ("RNorTen", material.r_nor_ten),
        ("RNorCom", material.r_nor_com),
        ("RShear", material.r_shear),
    ] {
        tag(out, 12, name, &num(value));
    }

    // Sorted, because `additional_values` is a HashMap and an arbitrary order
    // would make two saves of the same project differ.
    let mut extras: Vec<(&String, &f64)> = material.additional_values.iter().collect();
    extras.sort_by(|a, b| a.0.cmp(b.0));
    for (key, value) in extras {
        // Keys this crate does not know were read from the file under their
        // Java name and go back out unchanged.
        let java = naming::additional_value_to_java(key).unwrap_or(key.as_str());
        tag(out, 12, java, &num(*value));
    }

    out.push_str("        </material>\n");
}

// ---------------------------------------------------------------------------

fn tag(out: &mut String, indent: usize, name: &str, value: &str) {
    out.push_str(&" ".repeat(indent));
    out.push('<');
    out.push_str(name);
    out.push('>');
    out.push_str(value);
    out.push_str("</");
    out.push_str(name);
    out.push_str(">\n");
}

/// Java's `Double.toString` for the values eLamX writes: whole numbers keep a
/// trailing `.0`, everything else prints as short as round-trips exactly.
/// Rust's own `{}` already produces the shortest round-tripping form, so only
/// the integral case needs help.
fn num(value: f64) -> String {
    if value == 0.0 {
        // Keeps -0.0 from printing as "-0.0", which is noise in a diff.
        return "0.0".to_string();
    }
    if value.fract() == 0.0 && value.abs() < 1e16 {
        return format!("{value:.1}");
    }
    format!("{value}")
}

pub(super) fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}
