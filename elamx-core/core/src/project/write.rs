//! [`Project`] -> `.elamx`.
//!
//! Hand-written rather than driven by a serialisation library: the element
//! order, the indentation and the number formatting all have to match what
//! eLamX 3.x itself writes, so that a file saved here is a small diff against
//! the same file saved there - not a reformatting of the whole document.

use super::naming;
use super::web_extension::{to_cdata, WebExtension, WEB_EXTENSION_SCHEMA, WEB_EXTENSION_TAG};
use super::{
    NamedBuckling, NamedCalculation, NamedDeformation, NamedLastPlyFailure, NamedPressureVessel,
    NamedCutout, NamedOptimization, NamedSpringIn, NamedVibration, Project, ProjectLaminate,
};
use crate::clt::{Loads, PressureVesselInput, RadiusType};
use crate::plate::{BucklingInput, DeformationInput, Stiffener, StiffenerGeometry, TransverseLoad};
use crate::micromechanics::{Fibre, MatrixMaterial};
use crate::model::{Laminate, Material};
use crate::cutout::CutoutGeometry;
use crate::optimization::Constraint;
use crate::spring_in::SpringInModel;

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

    // After `<materials>`, which is the order eLamX 3.x writes them in, and
    // only when there is something to write: an empty `<fibres/>` in a project
    // that never had one would be a diff against the desktop for nothing.
    if !project.fibres.is_empty() {
        out.push_str("    <fibres>
");
        for fibre in &project.fibres {
            write_fibre(fibre, &mut out);
        }
        out.push_str("    </fibres>
");
    }
    if !project.matrices.is_empty() {
        out.push_str("    <matrices>
");
        for matrix in &project.matrices {
            write_matrix(matrix, &mut out);
        }
        out.push_str("    </matrices>
");
    }

    // Sections the reader kept verbatim, in the order the file had them -
    // after `<materials>`, which is where eLamX 3.x writes them.
    if !project.optimizations.is_empty() {
        out.push_str("    <optimizations>\n");
        for optimization in &project.optimizations {
            write_optimization(optimization, &mut out);
        }
        out.push_str("    </optimizations>\n");
    }

    // Only when there is something in it, so a project that uses no web-only
    // feature is written exactly as eLamX 3.x would write it. And not at all
    // when the file already carried one this build could not read: that is a
    // newer version's data, it travels below as it came, and a second element
    // beside it would leave the next reader to guess which one counts.
    let foreign_extension = project
        .unsupported_sections
        .iter()
        .any(|s| s.tag == WEB_EXTENSION_TAG);
    if let Some(extension) = project.web_extension.as_ref() {
        if !extension.is_empty() && !foreign_extension {
            let extension = WebExtension {
                schema: WEB_EXTENSION_SCHEMA,
                ..extension.clone()
            };
            // Serialising plain data with string keys cannot fail.
            let json = serde_json::to_string(&extension).expect("WebExtension ist serialisierbar");
            out.push_str(&format!(
                "    <{WEB_EXTENSION_TAG} schema=\"{WEB_EXTENSION_SCHEMA}\">{}</{WEB_EXTENSION_TAG}>
",
                to_cdata(&json)
            ));
        }
    }

    for section in &project.unsupported_sections {
        out.push_str("    ");
        out.push_str(&section.xml);
        out.push('\n');
    }

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
    for analysis in &entry.pressure_vessels {
        write_pressure_vessel(analysis, out);
    }
    for analysis in &entry.deformations {
        write_deformation(analysis, out);
    }
    for analysis in &entry.vibrations {
        write_vibration(analysis, out);
    }
    for analysis in &entry.spring_ins {
        write_spring_in(analysis, out);
    }
    for analysis in &entry.cutouts {
        write_cutout(analysis, out);
    }
    for raw in &entry.unsupported_modules {
        out.push_str("            ");
        out.push_str(&raw.xml);
        out.push('\n');
    }

    out.push_str("        </laminate>\n");
}

/// The load tags a `<calculation>` carries.
///
/// Its own function because the optimisation's CLT constraint carries exactly
/// the same set - the Java writes both with one `storeInput`.
fn write_loads(l: &Loads, indent: usize, out: &mut String) {
    for (name, value) in [
        ("n_x", l.n_x),
        ("n_y", l.n_y),
        ("n_xy", l.n_xy),
        ("m_x", l.m_x),
        ("m_y", l.m_y),
        ("m_xy", l.m_xy),
    ] {
        tag(out, indent, name, &num(value));
    }
    tag(out, indent, "deltat", &num(l.delta_t));
    tag(out, indent, "deltah", &num(l.delta_h));
}

fn write_calculation(calculation: &NamedCalculation, out: &mut String) {
    let l = &calculation.loads;
    let s = &calculation.strains;
    out.push_str(&format!(
        "            <calculation name=\"{}\">\n",
        escape(&calculation.name)
    ));
    write_loads(l, 16, out);
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

/// The tags a `<buckling>` carries, shared with the optimisation constraint.
fn write_buckling_input(b: &BucklingInput, out: &mut String) {
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
    write_stiffeners(&b.stiffeners, out);
}

fn write_buckling(buckling: &NamedBuckling, out: &mut String) {
    out.push_str(&format!(
        "            <buckling name=\"{}\">\n",
        escape(&buckling.name)
    ));
    write_buckling_input(&buckling.input, out);
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

fn write_vibration(analysis: &NamedVibration, out: &mut String) {
    let input = &analysis.input;
    out.push_str(&format!(
        "            <vibration name=\"{}\">\n",
        escape(&analysis.name)
    ));
    tag(out, 16, "length", &num(input.length));
    tag(out, 16, "width", &num(input.width));
    tag(out, 16, "bcx", &naming::boundary_to_index(input.bc_x).to_string());
    tag(out, 16, "bcy", &naming::boundary_to_index(input.bc_y).to_string());
    tag(out, 16, "m", &input.m.to_string());
    tag(out, 16, "n", &input.n.to_string());
    tag(out, 16, "dmatrixservice", naming::d_matrix_to_java(input.d_matrix));
    write_stiffeners(&input.stiffeners, out);
    out.push_str("            </vibration>\n");
}

/// `<optimization>`, in eLamX's own tag order.
///
/// A constraint carries the whole input of the analysis it constrains, so its
/// body is written by the very same functions the laminate modules use - which
/// is the whole reason those were split out. Both sit four levels deep, so the
/// bodies are taken as they are.
fn write_optimization(optimization: &NamedOptimization, out: &mut String) {
    let input = &optimization.input;
    out.push_str(&format!(
        "        <optimization name=\"{}\">\n",
        escape(&optimization.name)
    ));
    tag(out, 12, "angletype", &optimization.angle_type.to_string());
    tag(
        out,
        12,
        "optimizer",
        naming::optimizer_to_java(&optimization.optimizer)
            .expect("every optimizer has a Java class name"),
    );
    tag(out, 12, "thickness", &num(input.thickness));
    tag(out, 12, "material", &escape(&input.material_id));
    tag(
        out,
        12,
        "criterion",
        naming::criterion_to_java(&input.criterion_id)
            .expect("every ported criterion has a Java class name"),
    );
    tag(out, 12, "symmetriclaminat", &input.symmetric.to_string());

    out.push_str(&format!(
        "            <angles number=\"{}\">\n",
        input.angles.len()
    ));
    for (i, angle) in input.angles.iter().enumerate() {
        tag(out, 16, &format!("angle{i}"), &num(*angle));
    }
    out.push_str("            </angles>\n");

    for constraint in &input.constraints {
        let kind = constraint_code(constraint);
        out.push_str(&format!(
            "            <minimalReserverFactorCalculator classname=\"{}\">\n",
            naming::constraint_to_java(kind).expect("every constraint has a Java class name")
        ));
        // The misspelling above is the original's. The format is what it is.
        //
        // A constraint body is written at the same indentation as the module
        // it comes from: a laminate's module sits two levels deep and its body
        // four, and so does an optimisation's constraint body. So the bodies
        // are reused as they are.
        let mut body = String::new();
        match constraint {
            Constraint::Clt { loads } => write_loads(loads, 16, &mut body),
            Constraint::Buckling { input } => write_buckling_input(input, &mut body),
            Constraint::Deformation { input } => write_deformation_input(input, &mut body),
            Constraint::PressureVessel { input } => write_pressure_vessel_input(input, &mut body),
        }
        out.push_str(&body);
        out.push_str("            </minimalReserverFactorCalculator>\n");
    }

    out.push_str("        </optimization>\n");
}

fn constraint_code(constraint: &Constraint) -> &'static str {
    match constraint {
        Constraint::Clt { .. } => "clt",
        Constraint::Buckling { .. } => "buckling",
        Constraint::Deformation { .. } => "deformation",
        Constraint::PressureVessel { .. } => "pressure_vessel",
    }
}

/// `<cutout>`, in eLamX's own tag order - the loads first, then the sample
/// count, then the shape as a nested element with its Java class name.
fn write_cutout(analysis: &NamedCutout, out: &mut String) {
    let input = &analysis.input;
    out.push_str(&format!(
        "            <cutout name=\"{}\">
",
        escape(&analysis.name)
    ));
    for (name, value) in [
        ("n_xx", input.n_x),
        ("n_yy", input.n_y),
        ("n_xy", input.n_xy),
        ("m_xx", input.m_x),
        ("m_yy", input.m_y),
        ("m_xy", input.m_xy),
    ] {
        tag(out, 16, name, &num(value));
    }
    tag(out, 16, "val", &input.values.to_string());
    out.push_str(&format!(
        "                <CutoutGeometry name=\"{}\" classname=\"{}\">
",
        escape(shape_name(input.geometry)),
        naming::cutout_shape_to_java(input.geometry.code())
            .expect("every cutout shape has a Java class name")
    ));
    // Only the numeric properties travel as elements, in the order the shape
    // declares them: A, then B where there is one, then the term count.
    tag(out, 20, "A", &num(input.geometry.a()));
    if matches!(
        input.geometry,
        CutoutGeometry::Elliptical { .. } | CutoutGeometry::Rectangular { .. }
    ) {
        tag(out, 20, "B", &num(input.geometry.b()));
    }
    if let CutoutGeometry::Square { terms, .. } | CutoutGeometry::Rectangular { terms, .. } =
        input.geometry
    {
        tag(out, 20, "Terme", &terms.to_string());
    }
    out.push_str("                </CutoutGeometry>
");
    out.push_str("            </cutout>
");
}

/// The name eLamX gives a freshly created shape, from its resource bundle.
/// English, as for the spring-in models, and decoration either way.
fn shape_name(geometry: CutoutGeometry) -> &'static str {
    match geometry {
        CutoutGeometry::Circular { .. } => "Circular cutout",
        CutoutGeometry::Elliptical { .. } => "Elliptic cutout",
        CutoutGeometry::Square { .. } => "Square cutout",
        CutoutGeometry::Rectangular { .. } => "Rectangular cutout",
    }
}

/// `<springIn>`, in eLamX's own tag order - alphabetical, because
/// `LoadSaveLaminateHookImpl` writes them that way and a diff against a file
/// the desktop saved should be empty.
fn write_spring_in(analysis: &NamedSpringIn, out: &mut String) {
    let input = &analysis.input;
    out.push_str(&format!(
        "            <springIn name=\"{}\">
",
        escape(&analysis.name)
    ));
    tag(out, 16, "alphat_thick", &num(input.alphat_thick));
    tag(out, 16, "angle", &num(input.angle));
    tag(out, 16, "baseTemp", &num(input.base_temp));
    tag(out, 16, "hardeningTemp", &num(input.hardening_temp));
    tag(out, 16, "radius", &num(input.radius));
    tag(
        out,
        16,
        "useAutoCalcAlphat_thick",
        &input.use_auto_calc_alphat_thick.to_string(),
    );
    tag(
        out,
        16,
        "zeroDegAsCircumDir",
        &input.zero_deg_as_circum_dir.to_string(),
    );
    out.push_str(&format!(
        "                <SpringInModel name=\"{}\" classname=\"{}\">
",
        escape(&input.model_name),
        naming::spring_in_model_to_java(input.model.code())
            .expect("every spring-in model has a Java class name")
    ));
    // Only the numeric properties are written, and in the order the model
    // declares them - eps_cr first. The model's name is a String property and
    // travels as an attribute instead, which is why it is not repeated here.
    if let SpringInModel::EnhancedRadford { eps_circumferential, eps_thickness } = input.model {
        tag(out, 20, "eps_cr", &num(eps_thickness));
        tag(out, 20, "eps_cu", &num(eps_circumferential));
    }
    out.push_str("                </SpringInModel>
");
    out.push_str("            </springIn>
");
}

/// The tags a `<deformation>` carries, shared with the optimisation
/// constraint.
fn write_deformation_input(input: &DeformationInput, out: &mut String) {
    tag(out, 16, "length", &num(input.length));
    tag(out, 16, "width", &num(input.width));
    tag(out, 16, "bcx", &naming::boundary_to_index(input.bc_x).to_string());
    tag(out, 16, "bcy", &naming::boundary_to_index(input.bc_y).to_string());
    tag(out, 16, "m", &input.m.to_string());
    tag(out, 16, "n", &input.n.to_string());
    tag(out, 16, "dmatrixservice", naming::d_matrix_to_java(input.d_matrix));
    // eLamX writes this on every deformation element, used or not.
    tag(out, 16, "maxDisplacement", &num(input.max_displacement_z));

    for load in &input.loads {
        match load.load {
            TransverseLoad::Point { x, y, force } => {
                out.push_str(&format!(
                    "                <pointload name=\"{}\">\n",
                    escape(&load.name)
                ));
                tag(out, 20, "xposition", &num(x));
                tag(out, 20, "yposition", &num(y));
                tag(out, 20, "force", &num(force));
                out.push_str("                </pointload>\n");
            }
            TransverseLoad::Surface { force } => {
                out.push_str(&format!(
                    "                <surfaceLoad_const_full name=\"{}\">\n",
                    escape(&load.name)
                ));
                tag(out, 20, "force", &num(force));
                out.push_str("                </surfaceLoad_const_full>\n");
            }
        }
    }

    write_stiffeners(&input.stiffeners, out);
}

fn write_deformation(analysis: &NamedDeformation, out: &mut String) {
    out.push_str(&format!(
        "            <deformation name=\"{}\">\n",
        escape(&analysis.name)
    ));
    write_deformation_input(&analysis.input, out);
    out.push_str("            </deformation>\n");
}

/// The tags a `<pressurevessel>` carries, shared with the optimisation
/// constraint.
fn write_pressure_vessel_input(input: &PressureVesselInput, out: &mut String) {
    tag(out, 16, "pressure", &num(input.pressure));
    tag(out, 16, "radius", &num(input.radius));
    tag(
        out,
        16,
        "radiustype",
        match input.radius_type {
            RadiusType::Inner => "1",
            RadiusType::Mean => "2",
            RadiusType::Outer => "4",
        },
    );
}

fn write_pressure_vessel(analysis: &NamedPressureVessel, out: &mut String) {
    out.push_str(&format!(
        "            <pressurevessel name=\"{}\">\n",
        escape(&analysis.name)
    ));
    write_pressure_vessel_input(&analysis.input, out);
    out.push_str("            </pressurevessel>\n");
}

fn write_fibre(fibre: &Fibre, out: &mut String) {
    out.push_str(&format!(
        "        <fibre class=\"de.elamx.micromechanics.Fiber\" name=\"{}\" uuid=\"{}\">\n",
        escape(&fibre.name),
        escape(&fibre.id)
    ));
    for (name, value) in [
        ("Epar", fibre.e_par),
        ("Enor", fibre.e_nor),
        ("nue12", fibre.nue12),
        ("G", fibre.g),
        ("G13", fibre.g13),
        ("G23", fibre.g23),
        ("rho", fibre.rho),
        ("alphaTPar", fibre.alpha_t_par),
        ("alphaTNor", fibre.alpha_t_nor),
        ("betaPar", fibre.beta_par),
        ("betaNor", fibre.beta_nor),
    ] {
        tag(out, 12, name, &num(value));
    }
    out.push_str("        </fibre>\n");
}

fn write_matrix(matrix: &MatrixMaterial, out: &mut String) {
    out.push_str(&format!(
        "        <matrix class=\"de.elamx.micromechanics.Matrix\" name=\"{}\" uuid=\"{}\">\n",
        escape(&matrix.name),
        escape(&matrix.id)
    ));
    // No <G>: it follows from E and nue, and eLamX has never written one.
    for (name, value) in [
        ("E", matrix.e),
        ("nue", matrix.nue),
        ("rho", matrix.rho),
        ("alpha", matrix.alpha),
        ("beta", matrix.beta),
    ] {
        tag(out, 12, name, &num(value));
    }
    out.push_str("        </matrix>\n");
}

fn write_material(material: &Material, out: &mut String) {
    let class = match material.micro {
        Some(_) => "de.elamx.micromechanics.MicroMechanicMaterial",
        None => "de.elamx.laminate.DefaultMaterial",
    };
    out.push_str(&format!(
        "        <material class=\"{class}\" name=\"{}\" uuid=\"{}\">\n",
        escape(&material.name),
        escape(&material.id)
    ));

    // First, in the original's order: which fibre, which matrix, how much of
    // each. The properties below are then the numbers those produced - eLamX
    // writes the COMPUTED values, not whatever was typed in before a model
    // was chosen, and that is what lets a program without the micromechanics
    // module still open the file and get the same laminate.
    if let Some(micro) = &material.micro {
        tag(out, 12, "fibre", &escape(&micro.fibre_id));
        tag(out, 12, "matrix", &escape(&micro.matrix_id));
        tag(out, 12, "phi", &num(micro.phi));
    }
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

    // The model choice, after the values it produced. No `rho_micromechmodel`:
    // the original writes none, so one written here would be a tag eLamX
    // ignores and this crate would then read back as something the desktop
    // never stored.
    if let Some(micro) = &material.micro {
        for (name, model) in [
            ("Epar_micromechmodel", micro.e_par_model),
            ("Enor_micromechmodel", micro.e_nor_model),
            ("Nue12_micromechmodel", micro.nue12_model),
            ("G_micromechmodel", micro.g_model),
        ] {
            tag(out, 12, name, naming::micro_model_to_java(model));
        }
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

/// The `<Stiffener>` children, after the analysis input and after the loads -
/// the position `LoadSaveLaminateHookImpl.store` puts them in.
///
/// The property tag names are the Java field names, because `LoadSaveStiffeners`
/// derives them by reflection from `getPropertyDefinitions()`; their ORDER is
/// that array's order, so a file written here is a small diff against one
/// written by eLamX rather than a reshuffle.
fn write_stiffeners(stiffeners: &[Stiffener], out: &mut String) {
    for stiffener in stiffeners {
        let class = naming::stiffener_profile_to_java(stiffener.geometry.code())
            .expect("every stiffener profile has a Java class name");
        out.push_str(&format!(
            "                <Stiffener name=\"{}\" classname=\"{}\">
",
            escape(&stiffener.name),
            class
        ));
        tag(out, 20, "position", &num(stiffener.position));
        tag(out, 20, "direction", &stiffener.direction.java_index().to_string());
        match stiffener.geometry {
            StiffenerGeometry::Direct { e, i, g, j, a, rho } => {
                for (name, value) in [("E", e), ("I", i), ("G", g), ("J", j), ("Rho", rho), ("A", a)]
                {
                    tag(out, 20, name, &num(value));
                }
            }
            StiffenerGeometry::IProfile { w1, t1, e, g, rho } => {
                for (name, value) in [("w1", w1), ("t1", t1), ("E", e), ("G", g), ("Rho", rho)] {
                    tag(out, 20, name, &num(value));
                }
            }
            StiffenerGeometry::TProfile { w1, t1, w2, t2, e, g, rho } => {
                for (name, value) in [
                    ("w1", w1),
                    ("t1", t1),
                    ("w2", w2),
                    ("t2", t2),
                    ("E", e),
                    ("G", g),
                    ("Rho", rho),
                ] {
                    tag(out, 20, name, &num(value));
                }
            }
        }
        out.push_str("                </Stiffener>
");
    }
}

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
