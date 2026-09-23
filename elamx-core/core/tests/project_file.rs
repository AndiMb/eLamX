//! `.elamx` reading and writing, checked against the golden reference file.
//!
//! `tests/golden/reference.elamx` is the ideal fixture: it is a real file the
//! Java program accepted and calculated (that is what produced
//! `reference.txt`), and its contents are independently known from
//! `reference.input.json`, which a different generator wrote from the same
//! definition. So the reader is not compared against itself - it has to
//! reproduce what something else produced.

use elamx_core::clt::RadiusType;
use elamx_core::plate::Stiffener;
use elamx_core::project::{
    read_elamx, write_elamx, ComparisonState, ComparisonVariant, ImportNotice, LayerCriteriaEntry,
    Project, ReadError, WebExtension, WEB_EXTENSION_TAG,
};
use elamx_core::cutout::CutoutInput;
use elamx_core::optimization::Constraint;
use elamx_core::plate::DeformationInput;
use elamx_core::spring_in::SpringInInput;
use serde_json::{json, Value};

fn golden_dir() -> String {
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden").to_string()
}

fn reference_xml() -> String {
    std::fs::read_to_string(format!("{}/reference.elamx", golden_dir()))
        .expect("reference.elamx fehlt - siehe tests/golden/README.md")
}

fn reference_json() -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(format!("{}/reference.input.json", golden_dir()))
            .expect("reference.input.json fehlt"),
    )
    .expect("reference.input.json ist kein gültiges JSON")
}

/// Everything the reader extracts has to match what the generator wrote into
/// the JSON side of the same reference definition.
#[test]
fn reads_the_reference_file_as_the_generator_wrote_it() {
    let project = read_elamx(&reference_xml()).expect("reference.elamx muss lesbar sein");
    let expected = reference_json();

    let expected_materials = expected["materials"].as_object().unwrap();
    assert_eq!(project.materials.len(), expected_materials.len());
    for material in &project.materials {
        let e = &expected_materials[&material.id];
        assert_eq!(material.name, e["name"].as_str().unwrap(), "Name von {}", material.id);
        // A micromechanic material's five basic properties are RECOMPUTED on
        // read - the file stores what the models produced last time, and the
        // reference file deliberately stores a placeholder there instead (see
        // golden/generate.mjs). What the reader has to get right for them is
        // the definition; that the numbers come out as eLamX's do is
        // `material_data_matches_elamx`.
        let derived: &[&str] = match material.micro {
            Some(_) => &["e_par", "e_nor", "nue12", "g", "rho"],
            None => &[],
        };
        for (field, value) in [
            ("e_par", material.e_par),
            ("e_nor", material.e_nor),
            ("nue12", material.nue12),
            ("g", material.g),
            ("g13", material.g13),
            ("g23", material.g23),
            ("rho", material.rho),
            ("alpha_t_par", material.alpha_t_par),
            ("alpha_t_nor", material.alpha_t_nor),
            ("beta_par", material.beta_par),
            ("beta_nor", material.beta_nor),
            ("r_par_ten", material.r_par_ten),
            ("r_par_com", material.r_par_com),
            ("r_nor_ten", material.r_nor_ten),
            ("r_nor_com", material.r_nor_com),
            ("r_shear", material.r_shear),
        ] {
            if derived.contains(&field) {
                continue;
            }
            assert_eq!(value, e[field].as_f64().unwrap(), "{}.{field}", material.id);
        }

        if let Some(micro) = &material.micro {
            let em = &e["micro"];
            assert_eq!(micro.fibre_id, em["fibre_id"].as_str().unwrap(), "{}", material.id);
            assert_eq!(micro.matrix_id, em["matrix_id"].as_str().unwrap(), "{}", material.id);
            assert_eq!(micro.phi, em["phi"].as_f64().unwrap(), "{}", material.id);
            for (field, model) in [
                ("e_par_model", micro.e_par_model),
                ("e_nor_model", micro.e_nor_model),
                ("nue12_model", micro.nue12_model),
                ("g_model", micro.g_model),
                // Not stored by the format at all, so always the fallback.
                ("rho_model", micro.rho_model),
            ] {
                assert_eq!(
                    serde_json::to_value(model).unwrap(),
                    em[field],
                    "{}.{field}",
                    material.id
                );
            }
        } else {
            assert!(e["micro"].is_null(), "{}: unerwartete Mikromechanik", material.id);
        }

        let extras = e["additional_values"].as_object().unwrap();
        for (key, value) in extras {
            assert_eq!(
                material.additional_values.get(key).copied(),
                value.as_f64(),
                "{}: Zusatzwert {key}",
                material.id
            );
        }
    }

    let expected_laminates = expected["laminates"].as_array().unwrap();
    assert_eq!(project.laminates.len(), expected_laminates.len());
    for (entry, e) in project.laminates.iter().zip(expected_laminates) {
        let el = &e["laminate"];
        let lam = &entry.laminate;
        assert_eq!(lam.name, el["name"].as_str().unwrap());
        assert_eq!(lam.symmetric, el["symmetric"].as_bool().unwrap());
        assert_eq!(lam.with_middle_layer, el["with_middle_layer"].as_bool().unwrap());
        assert_eq!(lam.invert_z, el["invert_z"].as_bool().unwrap());
        assert_eq!(lam.offset, el["offset"].as_f64().unwrap());

        let expected_layers = el["layers"].as_array().unwrap();
        assert_eq!(lam.layers.len(), expected_layers.len(), "{}: Lagenzahl", lam.name);
        for (layer, el) in lam.layers.iter().zip(expected_layers) {
            // The generator writes raw angles; both sides reduce to -90..90 on
            // load, so compare against the reduced value.
            let raw = el["angle"].as_f64().unwrap();
            let reduced = {
                let sign = if raw < 0.0 { -1.0 } else { 1.0 };
                let mut a = raw.abs() % 180.0;
                if a > 90.0 {
                    a -= 180.0;
                }
                sign * a
            };
            assert_eq!(layer.angle(), reduced, "{}/{}: Winkel", lam.name, layer.name);
            assert_eq!(layer.thickness, el["thickness"].as_f64().unwrap());
            assert_eq!(layer.material_id, el["material_id"].as_str().unwrap());
            assert_eq!(layer.criterion_id.as_deref(), el["criterion_id"].as_str());
        }

        let expected_calcs = e["calculations"].as_array().unwrap();
        assert_eq!(entry.calculations.len(), expected_calcs.len(), "{}: Lastfälle", lam.name);
        for (calc, ec) in entry.calculations.iter().zip(expected_calcs) {
            assert_eq!(calc.name, ec["name"].as_str().unwrap());
            let el = &ec["loads"];
            for (field, value) in [
                ("n_x", calc.loads.n_x),
                ("n_y", calc.loads.n_y),
                ("n_xy", calc.loads.n_xy),
                ("m_x", calc.loads.m_x),
                ("m_y", calc.loads.m_y),
                ("m_xy", calc.loads.m_xy),
                ("delta_t", calc.loads.delta_t),
                ("delta_h", calc.loads.delta_h),
            ] {
                assert_eq!(value, el[field].as_f64().unwrap(), "{}: {field}", calc.name);
            }
            let use_strain: Vec<bool> = ec["use_strain"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_bool().unwrap())
                .collect();
            assert_eq!(calc.use_strain.to_vec(), use_strain, "{}: use_strain", calc.name);
        }

        let expected_bucklings = e["bucklings"].as_array().unwrap();
        assert_eq!(entry.bucklings.len(), expected_bucklings.len(), "{}: Beulanalysen", lam.name);
        for (buck, eb) in entry.bucklings.iter().zip(expected_bucklings) {
            assert_eq!(buck.name, eb["name"].as_str().unwrap());
            let ei = &eb["input"];
            assert_eq!(buck.input.length, ei["length"].as_f64().unwrap());
            assert_eq!(buck.input.width, ei["width"].as_f64().unwrap());
            assert_eq!(buck.input.n_x, ei["n_x"].as_f64().unwrap());
            assert_eq!(buck.input.n_y, ei["n_y"].as_f64().unwrap());
            assert_eq!(buck.input.n_xy, ei["n_xy"].as_f64().unwrap());
            assert_eq!(buck.input.m, ei["m"].as_u64().unwrap() as usize);
            assert_eq!(buck.input.n, ei["n"].as_u64().unwrap() as usize);
            assert_eq!(
                serde_json::to_value(buck.input.bc_x).unwrap(),
                ei["bc_x"],
                "{}: bc_x",
                buck.name
            );
            assert_eq!(serde_json::to_value(buck.input.bc_y).unwrap(), ei["bc_y"]);
            assert_eq!(
                serde_json::to_value(buck.input.d_matrix).unwrap(),
                ei["d_matrix"],
                "{}: Biegesteifigkeit",
                buck.name
            );
            // Through serde rather than comparing Values: the generator writes
            // whole numbers as integers, which are not == to the same f64 as
            // JSON values but deserialise into the same Stiffener.
            let expected: Vec<Stiffener> =
                serde_json::from_value(ei["stiffeners"].clone()).expect("Versteifungen");
            assert_eq!(buck.input.stiffeners, expected, "{}: Versteifungen", buck.name);
        }

        // Vibration has no batch output, so the reference file is the only
        // place its element is exercised at all - and the reason it is here is
        // that the same file, written back out by this crate, still opens in
        // the Java program (see golden/README.md).
        let expected_vibrations = e["vibrations"].as_array().unwrap();
        assert_eq!(
            entry.vibrations.len(),
            expected_vibrations.len(),
            "{}: Schwingungsanalysen",
            lam.name
        );
        for (analysis, ev) in entry.vibrations.iter().zip(expected_vibrations) {
            assert_eq!(analysis.name, ev["name"].as_str().unwrap());
            let ei = &ev["input"];
            assert_eq!(analysis.input.length, ei["length"].as_f64().unwrap());
            assert_eq!(analysis.input.width, ei["width"].as_f64().unwrap());
            assert_eq!(analysis.input.m, ei["m"].as_u64().unwrap() as usize);
            assert_eq!(analysis.input.n, ei["n"].as_u64().unwrap() as usize);
            assert_eq!(serde_json::to_value(analysis.input.bc_x).unwrap(), ei["bc_x"]);
            assert_eq!(serde_json::to_value(analysis.input.bc_y).unwrap(), ei["bc_y"]);
            assert_eq!(serde_json::to_value(analysis.input.d_matrix).unwrap(), ei["d_matrix"]);
            let expected: Vec<Stiffener> =
                serde_json::from_value(ei["stiffeners"].clone()).expect("Versteifungen");
            assert_eq!(analysis.input.stiffeners, expected, "{}: Versteifungen", analysis.name);
        }

        // Spring-In has no batch output either, and unlike vibration its
        // element carries a nested one with a Java class name in it - so this
        // is the only check that the model choice and its two properties
        // survive the file at all.
        let expected_spring_ins = e["spring_ins"].as_array().unwrap();
        assert_eq!(
            entry.spring_ins.len(),
            expected_spring_ins.len(),
            "{}: Spring-In-Analysen",
            lam.name
        );
        for (analysis, es) in entry.spring_ins.iter().zip(expected_spring_ins) {
            assert_eq!(analysis.name, es["name"].as_str().unwrap());
            let expected: SpringInInput =
                serde_json::from_value(es["input"].clone()).expect("Spring-In-Eingabe");
            assert_eq!(analysis.input, expected, "{}: Eingabe", analysis.name);
        }

        // Deformation, and with it `maxDisplacement` - an allowable the
        // analysis never reads and the optimiser does, so nothing would have
        // noticed it going missing.
        let expected_deformations = e["deformations"].as_array().unwrap();
        assert_eq!(
            entry.deformations.len(),
            expected_deformations.len(),
            "{}: Verformungsanalysen",
            lam.name
        );
        for (analysis, ed) in entry.deformations.iter().zip(expected_deformations) {
            assert_eq!(analysis.name, ed["name"].as_str().unwrap());
            let expected: DeformationInput =
                serde_json::from_value(ed["input"].clone()).expect("Verformungs-Eingabe");
            assert_eq!(
                analysis.input.max_displacement_z, expected.max_displacement_z,
                "{}: zulaessige Durchbiegung",
                analysis.name
            );
            assert_eq!(analysis.input.loads.len(), expected.loads.len(), "{}: Lasten", analysis.name);
            assert_eq!(analysis.input.m, expected.m);
            assert_eq!(analysis.input.n, expected.n);
        }

        // Cutouts carry a nested element with a Java class name and property
        // names of their own - `A`, `B` and the German `Terme` - so all four
        // shapes are in the reference file and all four come back here.
        let expected_cutouts = e["cutouts"].as_array().unwrap();
        assert_eq!(
            entry.cutouts.len(),
            expected_cutouts.len(),
            "{}: Ausschnitte",
            lam.name
        );
        for (analysis, ec) in entry.cutouts.iter().zip(expected_cutouts) {
            assert_eq!(analysis.name, ec["name"].as_str().unwrap());
            let expected: CutoutInput =
                serde_json::from_value(ec["input"].clone()).expect("Ausschnitt-Eingabe");
            assert_eq!(analysis.input, expected, "{}: Eingabe", analysis.name);
        }

        let expected_lpf = e["last_ply_failures"].as_array().unwrap();
        assert_eq!(
            entry.last_ply_failures.len(),
            expected_lpf.len(),
            "{}: Last-Ply-Failure-Analysen",
            lam.name
        );
        for (analysis, el) in entry.last_ply_failures.iter().zip(expected_lpf) {
            assert_eq!(analysis.name, el["name"].as_str().unwrap());
            let ei = &el["input"];
            let loads = &ei["loads"];
            for (field, value) in [
                ("n_x", analysis.input.loads.n_x),
                ("n_y", analysis.input.loads.n_y),
                ("n_xy", analysis.input.loads.n_xy),
                ("m_x", analysis.input.loads.m_x),
                ("m_y", analysis.input.loads.m_y),
                ("m_xy", analysis.input.loads.m_xy),
            ] {
                assert_eq!(value, loads[field].as_f64().unwrap(), "{}: {field}", analysis.name);
            }
            assert_eq!(
                analysis.input.degradation_factor,
                ei["degradation_factor"].as_f64().unwrap(),
                "{}: Degradationsfaktor",
                analysis.name
            );
            assert_eq!(
                analysis.input.epsilon_crit,
                ei["epsilon_crit"].as_f64().unwrap(),
                "{}: Grenzdehnung",
                analysis.name
            );
            assert_eq!(analysis.input.j_a, ei["j_a"].as_f64().unwrap(), "{}: jA", analysis.name);
            assert_eq!(
                analysis.input.degrade_all_on_fibre_failure,
                ei["degrade_all_on_fibre_failure"].as_bool().unwrap(),
                "{}: degradeAllOnFibreFailure",
                analysis.name
            );
        }
    }
}

/// Writing what was read and reading it again must land in the same place -
/// otherwise a save silently degrades the project.
#[test]
fn write_then_read_is_lossless() {
    let first = read_elamx(&reference_xml()).unwrap();
    let xml = write_elamx(&first);
    let second = read_elamx(&xml).expect("selbst geschriebenes .elamx muss lesbar sein");

    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&second).unwrap(),
        "Projekt nach Schreiben und erneutem Lesen nicht identisch"
    );

    // And a second write is byte-identical, so repeated saves produce no diff.
    assert_eq!(xml, write_elamx(&second), "zweites Schreiben weicht ab");
}

/// `<optimizations>` is a PROJECT-level section, and the only module element
/// the Java batch mode does NOT read back.
///
/// That is worth knowing before trusting it: for every other module, a
/// rewritten reference file that the batch computes identically proves the
/// original parsed every tag, because a wrong one throws and truncates the
/// output. Breaking the optimizer class name or the angle count here changes
/// nothing in the batch output - the batch does not register the optimisation
/// module's load hook at all. So this section is transcribed from
/// `OptimizationLoadSaveHookImpl` and checked here, and nowhere else.
#[test]
fn reads_the_optimizations_section() {
    let project = read_elamx(&reference_xml()).expect("reference.elamx muss lesbar sein");
    let expected = reference_json();
    let expected_optimizations = expected["optimizations"].as_array().unwrap();

    assert_eq!(project.optimizations.len(), expected_optimizations.len(), "Optimierungen");
    for (found, e) in project.optimizations.iter().zip(expected_optimizations) {
        assert_eq!(found.name, e["name"].as_str().unwrap());
        assert_eq!(found.optimizer, e["optimizer"].as_str().unwrap(), "{}", found.name);
        assert_eq!(found.angle_type, e["angle_type"].as_i64().unwrap() as i32, "{}", found.name);

        let ei = &e["input"];
        assert_eq!(found.input.material_id, ei["material_id"].as_str().unwrap());
        assert_eq!(found.input.criterion_id, ei["criterion_id"].as_str().unwrap());
        assert_eq!(found.input.thickness, ei["thickness"].as_f64().unwrap());
        assert_eq!(found.input.symmetric, ei["symmetric"].as_bool().unwrap());

        let angles: Vec<f64> = ei["angles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        assert_eq!(found.input.angles, angles, "{}: Winkel", found.name);

        let expected_constraints: Vec<Constraint> =
            serde_json::from_value(ei["constraints"].clone()).expect("Anforderungen");
        assert_eq!(
            serde_json::to_value(&found.input.constraints).unwrap(),
            serde_json::to_value(&expected_constraints).unwrap(),
            "{}: Anforderungen",
            found.name
        );
    }

    // All four optimisers and all four constraint kinds are in the file, so
    // every Java class name the section uses is exercised.
    let optimizers: Vec<&str> = project.optimizations.iter().map(|o| o.optimizer.as_str()).collect();
    for expected in ["sequential", "todoroki", "genetic", "exhaustive"] {
        assert!(optimizers.contains(&expected), "{expected} fehlt");
    }
    let kinds: Vec<String> = project
        .optimizations
        .iter()
        .flat_map(|o| o.input.constraints.iter())
        .map(|c| match c {
            Constraint::Clt { .. } => "clt",
            Constraint::Buckling { .. } => "buckling",
            Constraint::Deformation { .. } => "deformation",
            Constraint::PressureVessel { .. } => "pressure_vessel",
        })
        .map(str::to_string)
        .collect();
    for expected in ["clt", "buckling", "deformation", "pressure_vessel"] {
        assert!(kinds.iter().any(|k| k == expected), "{expected} fehlt");
    }
}

/// The section written back out, character for character.
///
/// Every other element in the file is checked by its meaning: read it, write
/// it, read it again, and run the original over it. This one cannot be, so it
/// is checked against the text the generator wrote - which is the only place
/// the indentation of a constraint body is stated by something other than this
/// writer. That is not pedantry: the first version of the writer indented
/// those bodies four spaces too deep, and nothing else in the suite minded.
#[test]
fn writes_the_optimizations_section_exactly_as_the_reference_has_it() {
    let reference = reference_xml();
    let written = write_elamx(&read_elamx(&reference).unwrap());
    assert_eq!(section(&written, "optimizations"), section(&reference, "optimizations"));
}

/// The `<tag>` .. `</tag>` block, with everything between it.
fn section(xml: &str, tag: &str) -> String {
    let start = xml.find(&format!("<{tag}>")).expect("Abschnitt fehlt");
    let end = xml.find(&format!("</{tag}>")).expect("Abschnittsende fehlt");
    xml[start..end].to_string()
}

/// A project written here has to be readable by the original, so the element
/// and attribute names must be exactly the ones eLamX expects.
#[test]
fn written_file_uses_the_original_element_names() {
    let xml = write_elamx(&read_elamx(&reference_xml()).unwrap());
    for expected in [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<elamx version=",
        "<laminates>",
        "<laminate invert_z=",
        "with_middle_layer=",
        "<layer name=",
        "<thickness>",
        "<criterion>de.elamx.laminate.failure.Puck</criterion>",
        "<calculation name=",
        "<useStrain0>",
        "<deltat>",
        "<buckling name=",
        "<dmatrixservice>de.elamx.clt.plate.dmatrix.DtildeDMatrixServiceImpl</dmatrixservice>",
        "<vibration name=",
        "<deformation name=",
        "<maxDisplacement>",
        "<surfaceLoad_const_full name=",
        "<pointload name=",
        "<optimizations>",
        "<optimization name=",
        "<angletype>",
        "<symmetriclaminat>",
        "<angles number=",
        "<minimalReserverFactorCalculator classname=\"de.elamx.clt.optimization.MinimalReserveFactorImplementation\">",
        "classname=\"de.elamx.clt.plate.MinimalBucklingReserveFactorImpl\"",
        "classname=\"de.elamx.clt.plate.MinimalDeformationReserveFactorImpl\"",
        "classname=\"de.elamx.clt.pressurevessel.optimization.MinimalReserveFactorImplementation\"",
        "<optimizer>de.elamx.clt.optimization.sda.SequentialDecisionApproach</optimizer>",
        "<cutout name=",
        "<n_xx>",
        "<val>",
        "<CutoutGeometry name=\"Circular cutout\" classname=\"de.elamx.clt.cutout.CircularCutoutGeometry\">",
        "classname=\"de.elamx.clt.plate.AdditionalCutoutGeometries.EllipticalCutoutGeometry\"",
        "classname=\"de.elamx.clt.plate.AdditionalCutoutGeometries.SquareCutoutGeometry\"",
        "classname=\"de.elamx.clt.plate.AdditionalCutoutGeometries.RectangularCutoutGeometry\"",
        "<Terme>",
        "<springIn name=",
        "<alphat_thick>",
        "<zeroDegAsCircumDir>",
        "<SpringInModel name=\"Simple Radford Model\" classname=\"de.elamx.clt.springin.SimpleRadfordSpringInModel\">",
        "classname=\"de.elamx.clt.springin.additionalmodels.EnhancedRadfordSpringInModel\"",
        "<eps_cr>",
        "<eps_cu>",
        "<Stiffener name=\"Frei-x\" classname=\"de.elamx.clt.plateui.stiffenerui.DefaultStiffenerProperties\">",
        "classname=\"de.elamx.clt.plate.AdditionalStiffeners.I_StiffenerProperties\"",
        "classname=\"de.elamx.clt.plate.AdditionalStiffeners.T_StiffenerProperties\"",
        "<lastplyfailure name=",
        "<degradationFactor>",
        "<degradeAllOnFibreFailure>",
        "<epsilon_crit>",
        "<j_a>",
        "<material class=\"de.elamx.laminate.DefaultMaterial\"",
        "<Epar>",
        "<de.elamx.laminate.failure.Puck.pspd>",
    ] {
        assert!(xml.contains(expected), "geschriebene Datei enthält nicht {expected:?}");
    }
}

const MINIMAL: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<elamx version="1">
    <laminates>
        <laminate invert_z="false" name="L" offset="0.0" symmetric="false" uuid="lam" with_middle_layer="false">
            <layer name="Lage 1" uuid="l1">
                <thickness>0.125</thickness>
                <angle>0.0</angle>
                <material>mat</material>
                <criterion>CRITERION</criterion>
            </layer>
            <plugindaten name="Fremdmodul">
                <wert>-120.0</wert>
                <winkel>90.0</winkel>
            </plugindaten>
        </laminate>
    </laminates>
    <materials>
        <material class="de.elamx.laminate.DefaultMaterial" name="M" uuid="mat">
            <Epar>141000.0</Epar>
            <Enor>9340.0</Enor>
            <nue12>0.35</nue12>
            <G>4500.0</G>
            <de.fremd.plugin.EigenesKriterium.kennwert>53.0</de.fremd.plugin.EigenesKriterium.kennwert>
        </material>
    </materials>
</elamx>
"#;

fn minimal_with(criterion: &str) -> String {
    MINIMAL.replace("CRITERION", criterion)
}

/// Module data from modules this crate cannot calculate must survive a
/// read/write cycle - otherwise opening a desktop project in the web version
/// and saving it would quietly delete the rest of the user's work.
#[test]
fn keeps_module_data_it_cannot_interpret() {
    let project = read_elamx(&minimal_with("de.elamx.laminate.failure.Puck")).unwrap();
    let kept = &project.laminates[0].unsupported_modules;
    assert_eq!(kept.len(), 1);
    // Every module eLamX itself ships is read by now, so the stand-in is an
    // invented one. That is not a weaker test: what it checks is the
    // mechanism that protects a module this crate has never heard of - a
    // future eLamX version's, or a separately deployed plugin's - and an
    // invented tag is exactly that case.
    assert_eq!(kept[0].tag, "plugindaten");

    let xml = write_elamx(&project);
    assert!(xml.contains("<plugindaten name=\"Fremdmodul\">"));
    assert!(xml.contains("<wert>-120.0</wert>"));
    assert!(xml.contains("<winkel>90.0</winkel>"));
}

/// The same promise one level up. `<fibres>`, `<matrices>` and
/// `<optimizations>` hang off the root, not off a laminate, so the per-laminate
/// carry-through never saw them - and a real project opened in the web version
/// and saved again came back without its fibre materials.
#[test]
fn keeps_project_sections_it_cannot_interpret() {
    // `<optimizations>` used to be the stand-in here and is read properly
    // now, so this is a section eLamX does not have - which is the case the
    // mechanism exists for: a future version's, or a plugin's.
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<elamx version="1">
    <laminates/>
    <materials/>
    <fremdabschnitt>
        <eintrag name="Test"/>
    </fremdabschnitt>
</elamx>"#;

    let project = read_elamx(xml).unwrap();
    let tags: Vec<&str> = project
        .unsupported_sections
        .iter()
        .map(|s| s.tag.as_str())
        .collect();
    assert_eq!(tags, ["fremdabschnitt"]);

    let written = write_elamx(&project);
    assert!(written.contains("<eintrag name=\"Test\"/>"));

    // And once more, so that saving a file that this version wrote does not
    // lose them either.
    let again = read_elamx(&written).unwrap();
    assert_eq!(again.unsupported_sections.len(), 1);
}

/// Fibres and matrices used to travel as raw XML, which kept them alive but
/// left them unreadable. They are real objects now, and this is the check that
/// the promotion did not cost the round trip that the raw form guaranteed.
#[test]
fn reads_and_writes_fibres_and_matrices() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<elamx version="1">
    <laminates/>
    <materials/>
    <fibres>
        <fibre class="de.elamx.micromechanics.Fiber" name="Neues Fasermaterial" uuid="9fec">
            <Epar>230000.0</Epar>
            <Enor>15000.0</Enor>
            <nue12>0.23</nue12>
            <G>30000.0</G>
            <G13>0.0</G13>
            <G23>0.0</G23>
            <rho>1.8E-9</rho>
            <alphaTPar>-5.0E-7</alphaTPar>
            <alphaTNor>1.0E-5</alphaTNor>
            <betaPar>0.0</betaPar>
            <betaNor>0.0</betaNor>
        </fibre>
    </fibres>
    <matrices>
        <matrix class="de.elamx.micromechanics.Matrix" name="Neues Matrixmaterial" uuid="1a2b">
            <E>3400.0</E>
            <nue>0.35</nue>
            <rho>1.2E-9</rho>
            <alpha>6.5E-5</alpha>
            <beta>0.3</beta>
        </matrix>
    </matrices>
</elamx>"#;

    let project = read_elamx(xml).unwrap();
    assert_eq!(project.fibres.len(), 1);
    assert_eq!(project.matrices.len(), 1);
    assert_eq!(project.fibres[0].name, "Neues Fasermaterial");
    assert_eq!(project.fibres[0].e_par, 230000.0);
    assert_eq!(project.fibres[0].alpha_t_par, -5.0e-7);
    assert_eq!(project.matrices[0].e, 3400.0);
    assert_eq!(project.matrices[0].alpha, 6.5e-5);
    // The shear modulus is derived rather than stored.
    assert!((project.matrices[0].g() - 3400.0 / 2.7).abs() < 1e-9);

    // They are no longer raw sections, and the round trip still holds.
    assert!(project.unsupported_sections.is_empty());
    let written = write_elamx(&project);
    let matrix_block = written
        .split_once("<matrices>")
        .and_then(|(_, rest)| rest.split_once("</matrices>"))
        .expect("<matrices> im geschriebenen Projekt")
        .0;
    assert!(
        !matrix_block.contains("<G>"),
        "eLamX schreibt kein <G> in ein Matrixmaterial"
    );
    let again = read_elamx(&written).unwrap();
    assert_eq!(again.fibres, project.fibres);
    assert_eq!(again.matrices, project.matrices);
    assert_eq!(written, write_elamx(&again));
}

/// Likewise for material parameters belonging to criteria this crate does not
/// know: they are not ours to discard.
///
/// Every parameter eLamX itself registers is named in `naming` by now - the FEA
/// modules were the last of them - so the stand-in is an invented one, the same
/// way `keeps_module_data_it_cannot_interpret` uses an invented module. What it
/// checks is the mechanism for a parameter this crate has never heard of: a
/// future eLamX version's, or a separately deployed plugin's.
#[test]
fn keeps_material_parameters_of_unported_criteria() {
    let project = read_elamx(&minimal_with("de.elamx.laminate.failure.Puck")).unwrap();
    let key = "de.fremd.plugin.EigenesKriterium.kennwert";
    assert_eq!(project.materials[0].additional_values.get(key), Some(&53.0));
    assert!(write_elamx(&project).contains(&format!("<{key}>53.0</{key}>")));
}

/// A material catalogue file opens even though three of the tags it may carry
/// hold text.
///
/// `MaterialDataBase.getMaterialsFromFile` reads `fibreName`, `fibreType`,
/// `matrixName`, `matrixType` and `type` when a user points eLamX at their own
/// `.elamx` as a catalogue. They say where a ply came from, not how it
/// behaves, so this reader skips them - but it has to skip them deliberately:
/// every other unknown tag is a criterion parameter and is read as a number,
/// and "AS4" is not one.
#[test]
fn reads_a_material_carrying_the_catalogue_description_tags() {
    let xml = minimal_with("de.elamx.laminate.failure.Puck").replace(
        "<G>4500.0</G>",
        "<G>4500.0</G>
            <fibreType>C</fibreType>
            <fibreName>AS4</fibreName>
            <matrixType>EP</matrixType>
            <matrixName>3501-6</matrixName>
            <type>0</type>",
    );
    let project = read_elamx(&xml).expect("Katalogdatei muss lesbar sein");
    let material = &project.materials[0];
    assert_eq!(material.e_par, 141000.0);
    // And they do not turn into criterion parameters on the way through.
    for tag in ["fibreName", "fibreType", "matrixName", "matrixType", "type"] {
        assert!(
            !material.additional_values.contains_key(tag),
            "{tag} sollte kein Zusatzwert sein"
        );
    }
}

/// Java reads every boolean in the format with `Boolean.parseBoolean`, where
/// anything that is not the word "true" - including a missing element - means
/// false; this reader has to agree, or a project would come back with a
/// different analysis than it was saved with. Checked on last-ply-failure's
/// flag, which was the first one the format had; spring-in's two follow the
/// same path.
#[test]
fn reads_the_last_ply_failure_flag_the_way_java_parses_it() {
    let with_flag = |value: &str| {
        MINIMAL
            .replace("CRITERION", "de.elamx.laminate.failure.Puck")
            .replace(
                "<plugindaten name=\"Fremdmodul\">\n                <wert>-120.0</wert>\n                <winkel>90.0</winkel>\n            </plugindaten>",
                &format!(
                    "<lastplyfailure name=\"LPF\">\n                <n_x>1.0</n_x>\n                <n_y>0.0</n_y>\n                <n_xy>0.0</n_xy>\n                <m_x>0.0</m_x>\n                <m_y>0.0</m_y>\n                <m_xy>0.0</m_xy>\n                <degradationFactor>1.0E-6</degradationFactor>\n                {value}\n                <epsilon_crit>0.003</epsilon_crit>\n                <j_a>1.0</j_a>\n            </lastplyfailure>"
                ),
            )
    };

    for (element, expected) in [
        ("<degradeAllOnFibreFailure>true</degradeAllOnFibreFailure>", true),
        ("<degradeAllOnFibreFailure>false</degradeAllOnFibreFailure>", false),
        ("<degradeAllOnFibreFailure>ja</degradeAllOnFibreFailure>", false),
        ("", false),
    ] {
        let project = read_elamx(&with_flag(element)).unwrap_or_else(|e| panic!("{element:?}: {e}"));
        let analysis = &project.laminates[0].last_ply_failures[0];
        assert_eq!(
            analysis.input.degrade_all_on_fibre_failure, expected,
            "{element:?}"
        );
        assert_eq!(analysis.input.loads.n_x, 1.0);
        assert_eq!(analysis.input.loads.delta_t, 0.0, "die Analyse kennt keine Temperaturlast");
    }
}

/// The pressure vessel stores its radius type as the Java constant's own value
/// (1 inner / 2 mean / 4 outer), not as an index into a list - a distinction
/// that only shows up when a file written elsewhere is read back.
#[test]
fn reads_and_writes_the_pressure_vessel_radius_types() {
    for (stored, expected) in [
        ("1", RadiusType::Inner),
        ("2", RadiusType::Mean),
        ("4", RadiusType::Outer),
    ] {
        let xml = MINIMAL
            .replace("CRITERION", "de.elamx.laminate.failure.Puck")
            .replace(
                "<plugindaten name=\"Fremdmodul\">
                <wert>-120.0</wert>
                <winkel>90.0</winkel>
            </plugindaten>",
                &format!(
                    "<pressurevessel name=\"Kessel\">
                <pressure>0.5</pressure>
                <radius>250.0</radius>
                <radiustype>{stored}</radiustype>
            </pressurevessel>"
                ),
            );

        let project = read_elamx(&xml).unwrap_or_else(|e| panic!("radiustype {stored}: {e}"));
        let vessel = &project.laminates[0].pressure_vessels[0];
        assert_eq!(vessel.name, "Kessel");
        assert_eq!(vessel.input.radius_type, expected);
        assert_eq!(vessel.input.pressure, 0.5);
        assert_eq!(vessel.input.radius, 250.0);

        // And back out under the same numbering, so the desktop reads what it
        // wrote.
        let written = write_elamx(&project);
        assert!(written.contains(&format!("<radiustype>{stored}</radiustype>")));
        assert!(written.contains("<pressurevessel name=\"Kessel\">"));
    }
}

/// An unknown radius type is refused rather than quietly analysed about some
/// other radius - the same rule the criterion names follow.
#[test]
fn rejects_an_unknown_pressure_vessel_radius_type() {
    let xml = MINIMAL
        .replace("CRITERION", "de.elamx.laminate.failure.Puck")
        .replace(
            "<plugindaten name=\"Fremdmodul\">
                <wert>-120.0</wert>
                <winkel>90.0</winkel>
            </plugindaten>",
            "<pressurevessel name=\"Kessel\">
                <pressure>0.5</pressure>
                <radius>250.0</radius>
                <radiustype>3</radiustype>
            </pressurevessel>",
        );
    assert!(matches!(read_elamx(&xml), Err(ReadError::Unknown { .. })));
}

/// The Java loader substitutes Puck for a criterion it cannot resolve, without
/// telling anyone. Doing the same here would mean silently calculating against
/// a different criterion than the file asked for.
#[test]
fn rejects_an_unknown_criterion_instead_of_defaulting_to_puck() {
    let error = read_elamx(&minimal_with("de.example.NotACriterion")).unwrap_err();
    match error {
        ReadError::Unknown { value, .. } => assert_eq!(value, "de.example.NotACriterion"),
        other => panic!("falscher Fehler: {other:?}"),
    }
}

#[test]
fn reports_a_layer_pointing_at_a_missing_material() {
    let xml = minimal_with("de.elamx.laminate.failure.Puck").replace("<material>mat</material>", "<material>weg</material>");
    match read_elamx(&xml).unwrap_err() {
        ReadError::UnknownMaterial { material, .. } => assert_eq!(material, "weg"),
        other => panic!("falscher Fehler: {other:?}"),
    }
}

#[test]
fn reports_malformed_and_foreign_documents() {
    assert!(matches!(read_elamx("<nope"), Err(ReadError::Xml(_))));
    assert!(matches!(
        read_elamx("<other></other>"),
        Err(ReadError::NotAnElamxFile)
    ));
    let missing = minimal_with("de.elamx.laminate.failure.Puck").replace("<Epar>141000.0</Epar>", "");
    assert!(matches!(read_elamx(&missing), Err(ReadError::Missing { .. })));
    let nan = minimal_with("de.elamx.laminate.failure.Puck").replace("141000.0", "viel");
    assert!(matches!(read_elamx(&nan), Err(ReadError::NotANumber { .. })));
}

/// An empty project is a valid document, and the round trip has to hold for it
/// too - that is the state a new session starts from.
#[test]
fn handles_an_empty_project() {
    let empty = Project {
        version: "1".into(),
        ..Default::default()
    };
    let xml = write_elamx(&empty);
    let back = read_elamx(&xml).expect("leeres Projekt muss lesbar sein");
    assert!(back.materials.is_empty());
    assert!(back.laminates.is_empty());
    assert_eq!(back.version, "1");
}

// ---------------------------------------------------------------------------
// <webExtension>
// ---------------------------------------------------------------------------

fn full_extension() -> WebExtension {
    WebExtension {
        layer_criteria: vec![LayerCriteriaEntry {
            laminate_uuid: "lam-1".into(),
            layer_uuid: "layer-1".into(),
            primary: "puck".into(),
            extra: vec!["tsai_wu".into(), "max_stress".into()],
        }],
        // Opaque today, so any JSON has to come back as it went in - including
        // strings that would end a CDATA section or look like eLamX's tags.
        studies: vec![json!({"id": "s1", "name": "Studie ]]> <laminate>", "kind": "matrix"})],
        snapshots: vec![json!({"id": "snap", "keyFigures": {"minRf": 1.25}})],
        report_templates: vec![json!({"name": "Standard", "sections": ["abd", "layerResults"]})],
        comparison: Some(ComparisonState {
            variants: vec![ComparisonVariant {
                laminate_uuid: "lam-1".into(),
                load_case_index: 1,
                load_case_name: "Zug & Druck".into(),
            }],
        }),
        stacking_rule_settings: Some(json!({"maxSameAngle": 4})),
        ..WebExtension::new()
    }
}

fn project_with(extension: Option<WebExtension>) -> Project {
    Project {
        web_extension: extension,
        ..read_elamx(&reference_xml()).unwrap()
    }
}

#[test]
fn web_extension_round_trips_every_field() {
    let xml = write_elamx(&project_with(Some(full_extension())));
    let back = read_elamx(&xml).expect("Datei mit Erweiterung muss lesbar sein");
    assert_eq!(back.web_extension, Some(full_extension()));
    assert!(back.import_notices.is_empty(), "{:?}", back.import_notices);
    assert!(
        back.unsupported_sections.iter().all(|s| s.tag != WEB_EXTENSION_TAG),
        "eine lesbare Erweiterung ist kein Fremdabschnitt"
    );
    // And stable: saving what was read gives the same file.
    assert_eq!(write_elamx(&back), xml);
}

/// eLamX 3.x finds its sections with `getElementsByTagName`, which searches
/// every descendant. Nothing of the extension may therefore look like an
/// element - not even a user-typed name that happens to contain one.
#[test]
fn web_extension_contains_no_element_elamx_could_mistake_for_its_own() {
    let xml = write_elamx(&project_with(Some(full_extension())));
    let doc = roxmltree::Document::parse(&xml).unwrap();
    let extension = doc
        .root_element()
        .children()
        .find(|n| n.has_tag_name(WEB_EXTENSION_TAG))
        .expect("Erweiterung geschrieben");
    assert_eq!(extension.attribute("schema"), Some("1"));
    assert_eq!(extension.descendants().filter(|n| n.is_element()).count(), 1);
}

/// A project that uses no web-only feature has to be written exactly as it was
/// before the extension existed - otherwise every desktop file opened and saved
/// in the web version would come back with a diff.
#[test]
fn an_empty_web_extension_is_not_written() {
    let without = write_elamx(&project_with(None));
    let empty = write_elamx(&project_with(Some(WebExtension::new())));
    assert_eq!(without, empty);
    assert!(!without.contains(WEB_EXTENSION_TAG));
    assert_eq!(read_elamx(&without).unwrap().web_extension, None);
}

/// Java's writer is free to turn the CDATA section into escaped text; both are
/// the same XML and both have to read.
#[test]
fn reads_a_web_extension_stored_as_escaped_text() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<elamx version="1">
    <laminates/>
    <materials/>
    <webExtension schema="1">{&quot;schema&quot;:1,&quot;comparison&quot;:{&quot;variants&quot;:[]}}</webExtension>
</elamx>"#;
    let project = read_elamx(xml).unwrap();
    assert_eq!(
        project.web_extension,
        Some(WebExtension {
            comparison: Some(ComparisonState::default()),
            ..WebExtension::new()
        })
    );
}

fn with_raw_extension(element: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<elamx version=\"1\">\n    <laminates/>\n    <materials/>\n    {element}\n</elamx>\n"
    )
}

/// A newer version's extension is neither interpreted nor lost: it travels as
/// it came, the user is told, and this build's own extension gives way to it
/// rather than standing beside it as a second, competing one.
#[test]
fn keeps_a_web_extension_of_an_unknown_schema() {
    let xml = with_raw_extension(r#"<webExtension schema="7"><![CDATA[{"schema":7,"neu":true}]]></webExtension>"#);
    let project = read_elamx(&xml).unwrap();
    assert_eq!(project.web_extension, None);
    assert_eq!(
        project.import_notices,
        [ImportNotice::UnknownWebExtensionSchema { schema: "7".into() }]
    );
    let kept: Vec<&str> = project.unsupported_sections.iter().map(|s| s.tag.as_str()).collect();
    assert_eq!(kept, [WEB_EXTENSION_TAG]);

    let written = write_elamx(&Project {
        web_extension: Some(full_extension()),
        ..project
    });
    assert_eq!(written.matches(WEB_EXTENSION_TAG).count(), 2, "genau ein Element: {written}");
    let again = read_elamx(&written).unwrap();
    assert_eq!(
        again.import_notices,
        [ImportNotice::UnknownWebExtensionSchema { schema: "7".into() }]
    );
    let doc = roxmltree::Document::parse(&written).unwrap();
    let text: String = doc
        .descendants()
        .find(|n| n.has_tag_name(WEB_EXTENSION_TAG))
        .unwrap()
        .text()
        .unwrap()
        .to_string();
    assert_eq!(text, r#"{"schema":7,"neu":true}"#);
}

/// Content that is not valid JSON of the schema is somebody's data all the
/// same, and must not stop the project from opening.
#[test]
fn keeps_a_web_extension_it_cannot_parse() {
    let xml = with_raw_extension(r#"<webExtension schema="1"><![CDATA[{"layer_criteria": 3}]]></webExtension>"#);
    let project = read_elamx(&xml).expect("das Projekt selbst ist lesbar");
    assert_eq!(project.web_extension, None);
    assert!(matches!(
        project.import_notices.as_slice(),
        [ImportNotice::InvalidWebExtension { .. }]
    ));
    assert!(write_elamx(&project).contains(r#"<webExtension schema="1">"#));
}

/// `with_extension.elamx` is what the Java batch was run on to show that
/// eLamX 3.x ignores the extension (see tests/golden/README.md). That proof
/// only holds while the fixture IS the reference file plus the extension, so
/// this pins it - and checks that the extension in it, the one Java saw, is
/// the one this crate reads.
#[test]
fn the_java_checked_fixture_is_the_reference_file_plus_an_extension() {
    let fixture = std::fs::read_to_string(format!("{}/with_extension.elamx", golden_dir()))
        .expect("with_extension.elamx fehlt")
        .replace("\r\n", "\n");
    let without: String = fixture
        .lines()
        .filter(|line| !line.trim_start().starts_with("<webExtension"))
        .map(|line| format!("{line}\n"))
        .collect();
    assert_eq!(without, reference_xml().replace("\r\n", "\n"));

    let with = read_elamx(&fixture).unwrap();
    let plain = read_elamx(&reference_xml()).unwrap();
    assert!(with.import_notices.is_empty(), "{:?}", with.import_notices);
    let extension = with.web_extension.clone().expect("Erweiterung gelesen");
    assert_eq!(extension.layer_criteria[0].extra, ["tsai_wu", "max_stress"]);
    // The name that would end a CDATA section and looks like eLamX's tags.
    assert_eq!(extension.studies[0]["name"], "<laminate><layer><material> ]]> & Co");
    assert_eq!(
        serde_json::to_value(Project { web_extension: None, ..with }).unwrap(),
        serde_json::to_value(plain).unwrap()
    );
}
