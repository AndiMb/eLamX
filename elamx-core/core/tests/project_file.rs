//! `.elamx` reading and writing, checked against the golden reference file.
//!
//! `tests/golden/reference.elamx` is the ideal fixture: it is a real file the
//! Java program accepted and calculated (that is what produced
//! `reference.txt`), and its contents are independently known from
//! `reference.input.json`, which a different generator wrote from the same
//! definition. So the reader is not compared against itself - it has to
//! reproduce what something else produced.

use elamx_core::clt::RadiusType;
use elamx_core::project::{read_elamx, write_elamx, Project, ReadError};
use serde_json::Value;

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
            assert_eq!(value, e[field].as_f64().unwrap(), "{}.{field}", material.id);
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
            <springIn name="Spring-In">
                <temperature>-120.0</temperature>
                <angle>90.0</angle>
            </springIn>
        </laminate>
    </laminates>
    <materials>
        <material class="de.elamx.laminate.DefaultMaterial" name="M" uuid="mat">
            <Epar>141000.0</Epar>
            <Enor>9340.0</Enor>
            <nue12>0.35</nue12>
            <G>4500.0</G>
            <de.elamx.laminate.addFailureCriteriaAnsys.AnsysLaRC03.alp0>53.0</de.elamx.laminate.addFailureCriteriaAnsys.AnsysLaRC03.alp0>
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
    assert_eq!(kept[0].tag, "springIn");

    let xml = write_elamx(&project);
    assert!(xml.contains("<springIn name=\"Spring-In\">"));
    assert!(xml.contains("<temperature>-120.0</temperature>"));
    assert!(xml.contains("<angle>90.0</angle>"));
}

/// The same promise one level up. `<fibres>`, `<matrices>` and
/// `<optimizations>` hang off the root, not off a laminate, so the per-laminate
/// carry-through never saw them - and a real project opened in the web version
/// and saved again came back without its fibre materials.
#[test]
fn keeps_project_sections_it_cannot_interpret() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<elamx version="1">
    <laminates/>
    <materials/>
    <fibres>
        <fibre class="de.elamx.micromechanics.Fiber" name="Neues Fasermaterial" uuid="9fec">
            <Epar>230000.0</Epar>
            <Enor>15000.0</Enor>
            <nue12>0.23</nue12>
        </fibre>
    </fibres>
    <matrices/>
    <optimizations/>
</elamx>"#;

    let project = read_elamx(xml).unwrap();
    let tags: Vec<&str> = project
        .unsupported_sections
        .iter()
        .map(|s| s.tag.as_str())
        .collect();
    assert_eq!(tags, ["fibres", "matrices", "optimizations"]);

    let written = write_elamx(&project);
    assert!(written.contains("name=\"Neues Fasermaterial\""));
    assert!(written.contains("<Epar>230000.0</Epar>"));
    assert!(written.contains("<nue12>0.23</nue12>"));
    assert!(written.contains("<matrices/>"));
    assert!(written.contains("<optimizations/>"));

    // And once more, so that saving a file that this version wrote does not
    // lose them either.
    let again = read_elamx(&written).unwrap();
    assert_eq!(again.unsupported_sections.len(), 3);
}

/// Likewise for material parameters belonging to criteria this crate has not
/// ported: they are not ours to discard.
#[test]
fn keeps_material_parameters_of_unported_criteria() {
    let project = read_elamx(&minimal_with("de.elamx.laminate.failure.Puck")).unwrap();
    let key = "de.elamx.laminate.addFailureCriteriaAnsys.AnsysLaRC03.alp0";
    assert_eq!(project.materials[0].additional_values.get(key), Some(&53.0));
    assert!(write_elamx(&project).contains(&format!("<{key}>53.0</{key}>")));
}

/// The last-ply-failure element is the one place the format stores a boolean.
/// Java reads it with `Boolean.parseBoolean`, where anything that is not the
/// word "true" - including a missing element - means false; this reader has to
/// agree, or a project would come back with a different analysis than it was
/// saved with.
#[test]
fn reads_the_last_ply_failure_flag_the_way_java_parses_it() {
    let with_flag = |value: &str| {
        MINIMAL
            .replace("CRITERION", "de.elamx.laminate.failure.Puck")
            .replace(
                "<springIn name=\"Spring-In\">\n                <temperature>-120.0</temperature>\n                <angle>90.0</angle>\n            </springIn>",
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
                "<springIn name=\"Spring-In\">
                <temperature>-120.0</temperature>
                <angle>90.0</angle>
            </springIn>",
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
            "<springIn name=\"Spring-In\">
                <temperature>-120.0</temperature>
                <angle>90.0</angle>
            </springIn>",
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
