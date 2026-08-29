//! WebAssembly bindings for elamx-core's CLT calculation engine.
//!
//! A single JSON request goes in, a single JSON response comes out - see
//! [`CltRequest`]/[`CltResponse`] (and [`AngleSweepRequest`]/[`AngleSweepResponse`]
//! for [`compute_angle_sweep`]) for the exact shapes. This keeps the wasm
//! boundary small and lets the frontend evolve its own request/response
//! builders without needing bindgen-generated classes for every domain type.

use elamx_core::clt::{
    calculate_last_ply_failure, determine_values, get_layer_results, CltLaminate,
    LastPlyFailureInput, LastPlyFailureResult, LayerContribution, LayerResult, Loads, MassMoments,
    Strains,
};
use elamx_core::failure::{
    default_criterion_registry, failure_envelope, FailureEnvelope, DEFAULT_QUALITY,
};
use elamx_core::mathtools;
use elamx_core::model::{Laminate, Material};
use elamx_core::project::{read_elamx, write_elamx, Project};
use elamx_core::plate::{calculate_buckling, mode_surface, BucklingInput};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Routes Rust panics to `console.error` instead of an opaque
/// "unreachable executed" trap, since wasm32 has no default panic output.
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[derive(Deserialize)]
struct CltRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    loads: Loads,
    strains: Strains,
    /// Per-degree-of-freedom flag (order: eps_x, eps_y, gamma_xy, kappa_x,
    /// kappa_y, kappa_xy): `true` prescribes the strain, `false` the load.
    use_strain: [bool; 6],
}

/// All of `CltLaminate`'s engineering-constant getters, bundled for the JSON
/// boundary. "Simple"/"fixed" = without/with Poisson restraint; "bend" =
/// derived from bending rather than extensional stiffness.
#[derive(Serialize)]
struct EngineeringConstantsDto {
    ex_simple: f64,
    ey_simple: f64,
    g_simple: f64,
    nuxy_simple: f64,
    nuyx_simple: f64,
    ex_fixed: f64,
    ey_fixed: f64,
    g_fixed: f64,
    nuxy_fixed: f64,
    nuyx_fixed: f64,
    ex_bend_simple: f64,
    ey_bend_simple: f64,
    g_bend_simple: f64,
    nuxy_bend_simple: f64,
    nuyx_bend_simple: f64,
    ex_bend_fixed: f64,
    ey_bend_fixed: f64,
    g_bend_fixed: f64,
    nuxy_bend_fixed: f64,
    nuyx_bend_fixed: f64,
    /// Seydel's orthotropy parameter.
    beta_d: f64,
    /// Transverse contraction parameter.
    nu_d: f64,
    /// Anisotropy parameters (bend-twist coupling).
    gamma_d: f64,
    delta_d: f64,
}

impl From<&CltLaminate> for EngineeringConstantsDto {
    fn from(clt: &CltLaminate) -> Self {
        EngineeringConstantsDto {
            ex_simple: clt.ex_simple(),
            ey_simple: clt.ey_simple(),
            g_simple: clt.g_simple(),
            nuxy_simple: clt.nuxy_simple(),
            nuyx_simple: clt.nuyx_simple(),
            ex_fixed: clt.ex_fixed(),
            ey_fixed: clt.ey_fixed(),
            g_fixed: clt.g_fixed(),
            nuxy_fixed: clt.nuxy_fixed(),
            nuyx_fixed: clt.nuyx_fixed(),
            ex_bend_simple: clt.ex_bend_simple(),
            ey_bend_simple: clt.ey_bend_simple(),
            g_bend_simple: clt.g_bend_simple(),
            nuxy_bend_simple: clt.nuxy_bend_simple(),
            nuyx_bend_simple: clt.nuyx_bend_simple(),
            ex_bend_fixed: clt.ex_bend_fixed(),
            ey_bend_fixed: clt.ey_bend_fixed(),
            g_bend_fixed: clt.g_bend_fixed(),
            nuxy_bend_fixed: clt.nuxy_bend_fixed(),
            nuyx_bend_fixed: clt.nuyx_bend_fixed(),
            beta_d: clt.beta_d(),
            nu_d: clt.nu_d(),
            gamma_d: clt.gamma_d(),
            delta_d: clt.delta_d(),
        }
    }
}

#[derive(Serialize)]
struct MassMomentsDto {
    i0: f64,
    i1: f64,
    i2: f64,
}

impl From<MassMoments> for MassMomentsDto {
    fn from(m: MassMoments) -> Self {
        MassMomentsDto {
            i0: m.i0,
            i1: m.i1,
            i2: m.i2,
        }
    }
}

/// One layer's contribution to the assembled A/B/D matrices - see
/// [`LayerContribution`] in the core crate for the underlying formula.
#[derive(Serialize)]
struct LayerContributionDto {
    layer_number: usize,
    angle_deg: f64,
    thickness: f64,
    zm: f64,
    /// Which material and criterion this expanded ply carries - the mirrored
    /// half of a symmetric laminate exists only here, so a UI that wants a
    /// ply's material must not re-derive the expansion itself.
    material_id: String,
    criterion_id: Option<String>,
    q_global: Vec<Vec<f64>>,
    a_contribution: Vec<Vec<f64>>,
    b_contribution: Vec<Vec<f64>>,
    d_contribution: Vec<Vec<f64>>,
}

impl From<LayerContribution> for LayerContributionDto {
    fn from(c: LayerContribution) -> Self {
        LayerContributionDto {
            layer_number: c.layer_number,
            angle_deg: c.angle_deg,
            thickness: c.thickness,
            zm: c.zm,
            material_id: c.material_id,
            criterion_id: c.criterion_id,
            q_global: c.q_global,
            a_contribution: c.a_contribution,
            b_contribution: c.b_contribution,
            d_contribution: c.d_contribution,
        }
    }
}

#[derive(Serialize)]
struct CltResponse {
    abd: Vec<Vec<f64>>,
    /// Inverse of `abd` - exposed so a UI can show the "simple" (Poisson-free)
    /// engineering constants' derivation with real numbers instead of
    /// re-deriving a 6x6 matrix inverse in TypeScript.
    abd_inv: Vec<Vec<f64>>,
    tges: f64,
    is_symmetric: bool,
    area_weight: f64,
    /// `None` unless the laminate is symmetric (matches the Java original).
    mass_moments: Option<MassMomentsDto>,
    loads: Loads,
    strains: Strains,
    engineering_constants: EngineeringConstantsDto,
    /// Per-layer A/B/D build-up, in stacking order - lets a UI show how each
    /// ply adds up to the assembled laminate stiffness.
    layer_contributions: Vec<LayerContributionDto>,
    /// Per-layer stresses/strains and reserve factors, evaluated with each
    /// layer's `criterion_id` (falling back to Puck if unset - see
    /// `elamx_core::clt::get_layer_results`).
    layer_results: Vec<LayerResult>,
}

/// Assembles the ABD matrix for a laminate and solves for whichever loads or
/// strains aren't prescribed. Both `request_json` and the returned string are
/// JSON, shaped by [`CltRequest`]/[`CltResponse`].
///
/// This is a thin wrapper around [`compute_clt_impl`] that only exists to
/// convert its plain `Result<String, String>` into the `JsValue` error type
/// wasm-bindgen requires - `JsValue` can't be constructed outside a wasm32
/// target, so keeping it out of the actual logic lets that logic run under
/// plain `cargo test` on the host.
#[wasm_bindgen]
pub fn compute_clt(request_json: &str) -> Result<String, JsValue> {
    compute_clt_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_clt_impl(request_json: &str) -> Result<String, String> {
    let request: CltRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials)
        .map_err(|e| e.to_string())?;

    let mut loads = request.loads;
    let mut strains = request.strains;
    determine_values(&clt, &mut loads, &mut strains, &request.use_strain);

    let criteria = default_criterion_registry();
    let layer_results = get_layer_results(&clt, &loads, &strains, &request.materials, &criteria)
        .map_err(|e| e.to_string())?;

    let response = CltResponse {
        abd: clt.abd_matrix().clone(),
        abd_inv: clt.abd_inv_matrix().clone(),
        tges: clt.tges(),
        is_symmetric: clt.is_symmetric(),
        area_weight: clt.area_weight(),
        mass_moments: clt.mass_moments().map(MassMomentsDto::from),
        loads,
        strains,
        engineering_constants: EngineeringConstantsDto::from(&clt),
        layer_contributions: clt
            .layer_contributions()
            .into_iter()
            .map(LayerContributionDto::from)
            .collect(),
        layer_results,
    };

    serde_json::to_string(&response).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct AngleSweepRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
}

#[derive(Serialize)]
struct AngleSweepResponse {
    angle_deg: Vec<f64>,
    a11: Vec<f64>,
    a12: Vec<f64>,
    a22: Vec<f64>,
    a66: Vec<f64>,
}

/// Sweeps the in-plane A-matrix components (A11, A12, A22, A66) as the
/// coordinate system rotates from 0 to 360 degrees in `delta_angle_deg`
/// steps - visualizes in-plane stiffness anisotropy. `request_json` only
/// needs a `laminate` and its `materials` (no loads/strains/criteria).
#[wasm_bindgen]
pub fn compute_angle_sweep(request_json: &str, delta_angle_deg: f64) -> Result<String, JsValue> {
    compute_angle_sweep_impl(request_json, delta_angle_deg).map_err(|e| JsValue::from_str(&e))
}

fn compute_angle_sweep_impl(request_json: &str, delta_angle_deg: f64) -> Result<String, String> {
    let request: AngleSweepRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials)
        .map_err(|e| e.to_string())?;

    let sweep = mathtools::get_matrix_components_over_angle(clt.a_matrix(), delta_angle_deg);

    let response = AngleSweepResponse {
        angle_deg: sweep[mathtools::ANGLE_ROW].clone(),
        a11: sweep[mathtools::A11_ROW].clone(),
        a12: sweep[mathtools::A12_ROW].clone(),
        a22: sweep[mathtools::A22_ROW].clone(),
        a66: sweep[mathtools::A66_ROW].clone(),
    };

    serde_json::to_string(&response).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct BucklingRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: BucklingInput,
}

#[derive(Serialize)]
struct BucklingModeDto {
    eigenvalue: f64,
    /// Modal amplitudes a_ij (m rows of n). Feed these back into
    /// [`compute_buckling_surface`] to get a plottable displacement field.
    shape: Vec<Vec<f64>>,
}

/// Sampling a mode surface needs only the modal amplitudes and the plate
/// input - not the laminate - so it is its own entry point. That keeps the
/// eigenvalue solve (which the UI runs on every input change) from carrying
/// grid data for modes nobody is looking at, and lets the user switch the
/// displayed mode without re-solving.
#[derive(Deserialize)]
struct BucklingSurfaceRequest {
    input: BucklingInput,
    /// One mode's amplitudes, as returned in `BucklingModeDto::shape`.
    shape: Vec<Vec<f64>>,
    /// Grid resolution per direction.
    samples: usize,
}

#[derive(Serialize)]
struct BucklingResponse {
    critical_factor: Option<f64>,
    n_crit: Option<[f64; 3]>,
    modes: Vec<BucklingModeDto>,
    /// True when the selected D-matrix idealisation assumes a symmetric
    /// laminate but this laminate is not one.
    symmetry_warning: bool,
}

/// Solves the buckling eigenvalue problem for a rectangular plate made of
/// `laminate`, under the in-plane load flows and edge conditions in `input`.
///
/// Both `request_json` and the returned string are JSON, shaped by
/// [`BucklingRequest`]/[`BucklingResponse`].
#[wasm_bindgen]
pub fn compute_buckling(request_json: &str) -> Result<String, JsValue> {
    compute_buckling_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_buckling_impl(request_json: &str) -> Result<String, String> {
    let request: BucklingRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials)
        .map_err(|e| e.to_string())?;

    let result = calculate_buckling(&clt, &request.input).map_err(|e| e.to_string())?;

    let modes = result
        .modes
        .iter()
        .map(|m| BucklingModeDto {
            eigenvalue: m.eigenvalue,
            shape: m.shape.clone(),
        })
        .collect();

    let response = BucklingResponse {
        critical_factor: result.critical_factor,
        n_crit: result.n_crit,
        modes,
        symmetry_warning: result.symmetry_warning,
    };

    serde_json::to_string(&response).map_err(|e| e.to_string())
}

/// Samples one buckling mode's displacement field w(x, y) on a square grid,
/// normalised to a peak of 1. Rows run along y.
///
/// Shaped by [`BucklingSurfaceRequest`]; the `shape` comes straight from a
/// mode in [`compute_buckling`]'s response.
#[wasm_bindgen]
pub fn compute_buckling_surface(request_json: &str) -> Result<String, JsValue> {
    compute_buckling_surface_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_buckling_surface_impl(request_json: &str) -> Result<String, String> {
    let request: BucklingSurfaceRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;

    if request.samples < 2 {
        return Err("samples must be at least 2".to_string());
    }
    if request.shape.len() != request.input.m
        || request.shape.iter().any(|row| row.len() != request.input.n)
    {
        return Err(format!(
            "mode shape is {}x{}, but the input declares m={}, n={}",
            request.shape.len(),
            request.shape.first().map_or(0, |r| r.len()),
            request.input.m,
            request.input.n
        ));
    }

    let surface = mode_surface(&request.shape, &request.input, request.samples, request.samples);
    serde_json::to_string(&surface).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct LastPlyFailureRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: LastPlyFailureInput,
}

/// Runs the last-ply-failure analysis: the laminate's weakest ply is degraded,
/// everything recomputed, and so on until no ply is left to take stiffness
/// from. The response is [`LastPlyFailureResult`] as JSON - the load factors of
/// the first fibre/inter-fibre failure and of final failure, plus the full
/// degradation path with every ply's state at every step.
///
/// Note that the analysis deliberately ignores parts of its own input, exactly
/// as eLamX 3.x does: the criterion parameters stored on the materials, their
/// expansion coefficients, and the laminate's reference-plane offset. See
/// `elamx_core::clt::last_ply_failure` - a UI showing these results should say
/// so rather than let a user wonder why a changed p_spd changes nothing.
#[wasm_bindgen]
pub fn compute_last_ply_failure(request_json: &str) -> Result<String, JsValue> {
    compute_last_ply_failure_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_last_ply_failure_impl(request_json: &str) -> Result<String, String> {
    let request: LastPlyFailureRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;

    let criteria = default_criterion_registry();
    let result: LastPlyFailureResult = calculate_last_ply_failure(
        &request.laminate,
        &request.materials,
        &criteria,
        &request.input,
    )
    .map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct FailureEnvelopeRequest {
    material: Material,
    /// Criterion id, as on a layer (`puck`, `max_stress`, ...).
    criterion_id: String,
    /// Sample density; 1.0 matches the Java view's default slider position.
    #[serde(default = "default_envelope_quality")]
    quality: f64,
}

fn default_envelope_quality() -> f64 {
    DEFAULT_QUALITY
}

/// Samples a failure criterion's failure surface in the ply's own stress space
/// (sigma_par, sigma_nor, tau), as a grid of points that all have a reserve
/// factor of exactly 1.
///
/// The response is [`FailureEnvelope`] as JSON. A `null` point marks a
/// direction the criterion cannot evaluate; the surface has a hole there
/// rather than the whole body being refused.
#[wasm_bindgen]
pub fn compute_failure_envelope(request_json: &str) -> Result<String, JsValue> {
    compute_failure_envelope_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_failure_envelope_impl(request_json: &str) -> Result<String, String> {
    let request: FailureEnvelopeRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;

    let criteria = default_criterion_registry();
    let criterion = criteria
        .get(&request.criterion_id)
        .ok_or_else(|| format!("failure criterion '{}' not found in the registry", request.criterion_id))?;

    let envelope: FailureEnvelope =
        failure_envelope(criterion.as_ref(), &request.material, request.quality)
            .map_err(|e| e.to_string())?;

    serde_json::to_string(&envelope).map_err(|e| e.to_string())
}

/// Parses an `.elamx` project file into the JSON shape of
/// [`elamx_core::project::Project`].
///
/// Stricter than the Java original on purpose: an unresolvable failure
/// criterion or bending-stiffness idealisation is reported instead of being
/// silently replaced by a default (see the `project::read` module). Module
/// data this crate cannot calculate is preserved in the returned project and
/// written back unchanged by [`export_elamx`], so an open/save cycle in the
/// browser does not discard what the desktop application put there.
#[wasm_bindgen]
pub fn import_elamx(xml: &str) -> Result<String, JsValue> {
    import_elamx_impl(xml).map_err(|e| JsValue::from_str(&e))
}

fn import_elamx_impl(xml: &str) -> Result<String, String> {
    let project = read_elamx(xml).map_err(|e| e.to_string())?;
    serde_json::to_string(&project).map_err(|e| e.to_string())
}

/// Serialises a project back to `.elamx` XML, in the element order and number
/// formatting eLamX 3.x itself uses, so the file opens there unchanged.
#[wasm_bindgen]
pub fn export_elamx(project_json: &str) -> Result<String, JsValue> {
    export_elamx_impl(project_json).map_err(|e| JsValue::from_str(&e))
}

fn export_elamx_impl(project_json: &str) -> Result<String, String> {
    let project: Project = serde_json::from_str(project_json).map_err(|e| e.to_string())?;
    Ok(write_elamx(&project))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request(n_x: f64, criterion_id: &str) -> String {
        format!(
            r#"{{
                "laminate": {{
                    "id": "lam", "name": "test",
                    "layers": [
                        {{"id":"l0","name":"0","angle":0.0,"thickness":0.2,"material_id":"mat","criterion_id":{criterion_id}}},
                        {{"id":"l1","name":"90","angle":90.0,"thickness":0.2,"material_id":"mat","criterion_id":{criterion_id}}}
                    ],
                    "symmetric": false, "with_middle_layer": false, "invert_z": false, "offset": 0.0
                }},
                "materials": {{
                    "mat": {{
                        "id":"mat","name":"UD","e_par":140000.0,"e_nor":10000.0,"nue12":0.3,"g":5000.0,
                        "g13":0.0,"g23":0.0,"rho":1.6e-9,
                        "alpha_t_par":0.0,"alpha_t_nor":0.0,"beta_par":0.0,"beta_nor":0.0,
                        "r_par_ten":2000.0,"r_par_com":1200.0,"r_nor_ten":50.0,"r_nor_com":150.0,"r_shear":70.0,
                        "additional_values":{{}}
                    }}
                }},
                "loads": {{"n_x":{n_x},"n_y":0.0,"n_xy":0.0,"m_x":0.0,"m_y":0.0,"m_xy":0.0,"delta_t":0.0,"delta_h":0.0,"nt_x":0.0,"nt_y":0.0,"nt_xy":0.0,"mt_x":0.0,"mt_y":0.0,"mt_xy":0.0}},
                "strains": {{"epsilon_x":0.0,"epsilon_y":0.0,"gamma_xy":0.0,"kappa_x":0.0,"kappa_y":0.0,"kappa_xy":0.0}},
                "use_strain": [false,false,false,false,false,false]
            }}"#
        )
    }

    #[test]
    fn compute_clt_solves_strain_from_prescribed_load() {
        let response = compute_clt_impl(&sample_request(1000.0, "\"max_stress\""))
            .expect("compute_clt_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        assert!(parsed["strains"]["epsilon_x"].as_f64().unwrap() > 0.0);
        // Balanced [0/90] cross-ply: A11 == A22.
        assert_eq!(parsed["abd"][0][0], parsed["abd"][1][1]);
        assert_eq!(parsed["tges"].as_f64().unwrap(), 0.4);
        assert!(!parsed["is_symmetric"].as_bool().unwrap());
    }

    #[test]
    fn compute_clt_includes_layer_results_with_reserve_factors() {
        let response = compute_clt_impl(&sample_request(1000.0, "\"max_stress\""))
            .expect("compute_clt_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let layer_results = parsed["layer_results"].as_array().unwrap();
        assert_eq!(layer_results.len(), 2);
        assert_eq!(layer_results[0]["layer_number"], 1);
        assert!(layer_results[0]["rr_lower"]["minimal_reserve_factor"]
            .as_f64()
            .unwrap()
            .is_finite());
        assert!(layer_results.iter().any(|r| r["failed"] == true));
    }

    #[test]
    fn compute_clt_includes_engineering_constants_and_layer_contributions() {
        let response = compute_clt_impl(&sample_request(1000.0, "\"max_stress\""))
            .expect("compute_clt_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let ec = &parsed["engineering_constants"];
        assert!(ec["ex_simple"].as_f64().unwrap() > 0.0);
        assert!(ec["ex_bend_fixed"].as_f64().unwrap() > 0.0);

        let contributions = parsed["layer_contributions"].as_array().unwrap();
        assert_eq!(contributions.len(), 2);
        assert_eq!(contributions[0]["layer_number"], 1);
        assert!(contributions[0]["q_global"].is_array());

        assert!(parsed["area_weight"].as_f64().unwrap() > 0.0);
        // Not symmetric, so no mass moments.
        assert!(parsed["mass_moments"].is_null());
    }

    #[test]
    fn compute_clt_reports_mass_moments_for_symmetric_laminate() {
        let mut request: serde_json::Value =
            serde_json::from_str(&sample_request(0.0, "\"max_stress\"")).unwrap();
        request["laminate"]["symmetric"] = serde_json::json!(true);

        let response =
            compute_clt_impl(&request.to_string()).expect("compute_clt_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(parsed["mass_moments"]["i0"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn compute_clt_defaults_to_puck_when_no_criterion_is_assigned() {
        let mut request: serde_json::Value =
            serde_json::from_str(&sample_request(10.0, "null")).unwrap();
        request["materials"]["mat"]["additional_values"] = serde_json::json!({
            "puck.p_spd": 0.3, "puck.p_spz": 0.35, "puck.a0": 0.5, "puck.lambda_min": 0.5
        });

        let response = compute_clt_impl(&request.to_string())
            .expect("compute_clt_impl should succeed with Puck's defaults");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["layer_results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn compute_clt_reports_missing_criterion_as_an_error() {
        let result = compute_clt_impl(&sample_request(1000.0, "\"not-a-real-criterion\""));
        assert!(result.is_err());
    }

    #[test]
    fn compute_clt_rejects_malformed_json() {
        let result = compute_clt_impl("not json");
        assert!(result.is_err());
    }

    #[test]
    fn compute_clt_reports_missing_material_as_error_not_panic() {
        // Only rename the material catalog's key, not the layers' `material_id`
        // references - that's what creates the mismatch under test.
        let request =
            sample_request(1000.0, "\"max_stress\"").replacen("\"mat\": {", "\"renamed\": {", 1);
        let result = compute_clt_impl(&request);
        assert!(result.is_err());
    }

    fn sample_angle_sweep_request() -> String {
        r#"{
            "laminate": {
                "id": "lam", "name": "test",
                "layers": [
                    {"id":"l0","name":"0","angle":0.0,"thickness":0.2,"material_id":"mat","criterion_id":null},
                    {"id":"l1","name":"90","angle":90.0,"thickness":0.2,"material_id":"mat","criterion_id":null}
                ],
                "symmetric": false, "with_middle_layer": false, "invert_z": false, "offset": 0.0
            },
            "materials": {
                "mat": {
                    "id":"mat","name":"UD","e_par":140000.0,"e_nor":10000.0,"nue12":0.3,"g":5000.0,
                    "g13":0.0,"g23":0.0,"rho":1.6e-9,
                    "alpha_t_par":0.0,"alpha_t_nor":0.0,"beta_par":0.0,"beta_nor":0.0,
                    "r_par_ten":2000.0,"r_par_com":1200.0,"r_nor_ten":50.0,"r_nor_com":150.0,"r_shear":70.0,
                    "additional_values":{}
                }
            }
        }"#
        .to_string()
    }

    #[test]
    fn compute_angle_sweep_returns_a_full_revolution() {
        let response = compute_angle_sweep_impl(&sample_angle_sweep_request(), 90.0)
            .expect("compute_angle_sweep_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let angles = parsed["angle_deg"].as_array().unwrap();
        assert_eq!(angles.len(), 4);
        assert_eq!(angles[0].as_f64().unwrap(), 0.0);
        assert_eq!(angles[1].as_f64().unwrap(), 90.0);

        // The sample laminate is a balanced [0/90] cross-ply, so A11 == A22 at
        // 0 degrees, and rotating the whole laminate 90 degrees swaps them
        // back onto themselves (A11(90) == A22(0), A22(90) == A11(0)).
        let a11_0 = parsed["a11"][0].as_f64().unwrap();
        let a22_0 = parsed["a22"][0].as_f64().unwrap();
        let a11_90 = parsed["a11"][1].as_f64().unwrap();
        let a22_90 = parsed["a22"][1].as_f64().unwrap();
        assert!(a11_0 > 0.0 && a22_0 > 0.0);
        assert!((a11_0 - a22_0).abs() < 1e-6);
        assert!((a11_90 - a22_0).abs() < 1e-6);
        assert!((a22_90 - a11_0).abs() < 1e-6);
    }

    #[test]
    fn compute_angle_sweep_rejects_malformed_json() {
        let result = compute_angle_sweep_impl("not json", 90.0);
        assert!(result.is_err());
    }

    fn envelope_request(criterion_id: &str, quality: f64) -> String {
        format!(
            r#"{{
                "material": {{
                    "id":"mat","name":"UD","e_par":140000.0,"e_nor":10000.0,"nue12":0.3,"g":5000.0,
                    "g13":0.0,"g23":0.0,"rho":1.6e-9,
                    "alpha_t_par":0.0,"alpha_t_nor":0.0,"beta_par":0.0,"beta_nor":0.0,
                    "r_par_ten":2000.0,"r_par_com":1200.0,"r_nor_ten":50.0,"r_nor_com":150.0,"r_shear":70.0,
                    "additional_values":{{}}
                }},
                "criterion_id": "{criterion_id}",
                "quality": {quality}
            }}"#
        )
    }

    #[test]
    fn compute_failure_envelope_returns_a_grid_of_surface_points() {
        let response = compute_failure_envelope_impl(&envelope_request("max_stress", 0.4))
            .expect("compute_failure_envelope_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let polar = parsed["polar_samples"].as_u64().unwrap() as usize;
        let azimuth = parsed["azimuth_samples"].as_u64().unwrap() as usize;
        assert_eq!(polar, 2 * azimuth);

        let points = parsed["points"].as_array().unwrap();
        assert_eq!(points.len(), polar);
        assert_eq!(points[0].as_array().unwrap().len(), azimuth);

        // The tension pole is the fibre tensile strength.
        let pole = points[0].as_array().unwrap()[0].as_array().unwrap();
        assert!((pole[0].as_f64().unwrap() - 2000.0).abs() < 1e-6);
    }

    #[test]
    fn compute_failure_envelope_reports_an_unknown_criterion() {
        assert!(compute_failure_envelope_impl(&envelope_request("nope", 0.4)).is_err());
    }

    /// Puck needs its parameters; a material without them must produce an
    /// error rather than a body computed from whatever happened to be there.
    #[test]
    fn compute_failure_envelope_reports_a_material_missing_criterion_parameters() {
        let request = envelope_request("puck", 0.4);
        assert!(compute_failure_envelope_impl(&request).is_err());
    }

    /// Same splice as `buckling_request`, with the last-ply-failure input.
    /// The material carries no additional values, which is exactly what the
    /// analysis needs: it supplies the criteria's defaults itself.
    fn last_ply_failure_request(n_x: f64, extra_input: &str) -> String {
        let base = sample_request(0.0, "\"max_stress\"");
        let head = base.rsplit_once("\"loads\"").map(|(h, _)| h.to_string()).unwrap();
        format!(
            r#"{head}"input": {{
                "loads": {{"n_x":{n_x},"n_y":0.0,"n_xy":0.0,"m_x":0.0,"m_y":0.0,"m_xy":0.0,
                           "delta_t":0.0,"delta_h":0.0,
                           "nt_x":0.0,"nt_y":0.0,"nt_xy":0.0,"mt_x":0.0,"mt_y":0.0,"mt_xy":0.0}},
                "degradation_factor": 0.000001,
                "epsilon_crit": 0.003,
                "j_a": 1.0,
                "degrade_all_on_fibre_failure": true{extra_input}
            }}}}"#
        )
    }

    #[test]
    fn compute_last_ply_failure_returns_the_whole_degradation_path() {
        let response = compute_last_ply_failure_impl(&last_ply_failure_request(1000.0, ""))
            .expect("compute_last_ply_failure_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let iterations = parsed["iterations"].as_array().unwrap();
        assert!(!iterations.is_empty());
        // Two plies, so at most two degradation steps each.
        assert!(iterations.len() <= 4);

        let first = &iterations[0];
        assert!(first["layer_number"].as_u64().unwrap() >= 1);
        assert_eq!(first["layer_results"].as_array().unwrap().len(), 2);
        assert_eq!(first["matrix_failed"].as_array().unwrap().len(), 2);
        assert!(first["failure_type"].is_string());
        assert!(first["reserve_factor"].as_f64().unwrap() > 0.0);

        // The laminate survives past its first failed ply.
        let ef = parsed["exceedance_factor"]["reserve_factor"].as_f64().unwrap();
        assert!(ef >= first["reserve_factor"].as_f64().unwrap());
    }

    #[test]
    fn compute_last_ply_failure_reports_events_that_never_happened_as_null() {
        let response = compute_last_ply_failure_impl(&last_ply_failure_request(1000.0, ""))
            .expect("compute_last_ply_failure_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        // Each of these is either an object with a reserve factor and an
        // iteration, or null - the frontend has to handle both.
        for key in ["first_fibre_failure", "first_matrix_failure", "first_epsilon"] {
            let value = &parsed[key];
            assert!(
                value.is_null() || value["iteration"].is_number(),
                "{key}: {value}"
            );
        }
    }

    #[test]
    fn compute_last_ply_failure_reports_a_missing_material_as_an_error() {
        let request = last_ply_failure_request(1000.0, "").replace("\"mat\":", "\"other\":");
        assert!(compute_last_ply_failure_impl(&request).is_err());
    }

    /// The buckling request reuses the laminate/materials shape above and adds
    /// an `input` block; `surface_samples`/`surface_modes` are optional.
    fn buckling_request(extra_input: &str, tail: &str) -> String {
        let base = sample_request(0.0, "null");
        // Splice the plate input in beside the existing laminate/materials.
        let without_clt_fields = base
            .rsplit_once("\"loads\"")
            .map(|(head, _)| head.to_string())
            .unwrap();
        format!(
            r#"{without_clt_fields}"input": {{
                "length": 400.0, "width": 400.0,
                "n_x": -1.0, "n_y": 0.0, "n_xy": 0.0,
                "bc_x": "SS", "bc_y": "SS",
                "m": 6, "n": 6, "d_matrix": "d_tilde"{extra_input}
            }}{tail}}}"#
        )
    }

    #[test]
    fn compute_buckling_returns_a_positive_critical_factor_under_compression() {
        let response = compute_buckling_impl(&buckling_request("", ""))
            .expect("compute_buckling_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let factor = parsed["critical_factor"].as_f64().unwrap();
        assert!(factor > 0.0, "critical factor {factor}");
        // n_crit is the applied load scaled by the factor; n_x was -1.
        assert!((parsed["n_crit"][0].as_f64().unwrap() + factor).abs() < 1e-9);
        assert_eq!(parsed["n_crit"][1].as_f64().unwrap(), 0.0);
        // 6x6 Ritz terms => 36 modes, each shape 6 rows of 6.
        let modes = parsed["modes"].as_array().unwrap();
        assert_eq!(modes.len(), 36);
        assert_eq!(modes[0]["shape"].as_array().unwrap().len(), 6);
        assert_eq!(modes[0]["shape"][0].as_array().unwrap().len(), 6);
    }

    /// The surface entry point takes a mode's amplitudes straight back, so a
    /// round trip through both calls is what a caller actually does.
    #[test]
    fn compute_buckling_surface_samples_any_mode_from_its_amplitudes() {
        let solved: serde_json::Value =
            serde_json::from_str(&compute_buckling_impl(&buckling_request("", "")).unwrap()).unwrap();

        for mode_index in [0usize, 3, 11] {
            let shape = &solved["modes"][mode_index]["shape"];
            let request = format!(
                r#"{{"input": {{"length":400.0,"width":400.0,"n_x":-1.0,"n_y":0.0,"n_xy":0.0,
                    "bc_x":"SS","bc_y":"SS","m":6,"n":6,"d_matrix":"d_tilde"}},
                    "shape": {shape}, "samples": 11}}"#
            );
            let surface: Vec<Vec<f64>> =
                serde_json::from_str(&compute_buckling_surface_impl(&request).unwrap()).unwrap();

            assert_eq!(surface.len(), 11);
            assert_eq!(surface[0].len(), 11);
            // Normalised to a peak of exactly 1.
            let peak = surface
                .iter()
                .flat_map(|r| r.iter())
                .fold(0.0f64, |a, v| a.max(v.abs()));
            assert!((peak - 1.0).abs() < 1e-9, "mode {mode_index} peak {peak}");
            // Simply supported all round: every edge stays put.
            for s in 0..11 {
                assert!(surface[0][s].abs() < 1e-6);
                assert!(surface[10][s].abs() < 1e-6);
                assert!(surface[s][0].abs() < 1e-6);
                assert!(surface[s][10].abs() < 1e-6);
            }
        }
    }

    #[test]
    fn compute_buckling_surface_rejects_a_shape_that_does_not_match_the_input() {
        // 2x2 amplitudes against an m=n=6 input.
        let request = r#"{"input": {"length":400.0,"width":400.0,"n_x":-1.0,"n_y":0.0,"n_xy":0.0,
            "bc_x":"SS","bc_y":"SS","m":6,"n":6,"d_matrix":"standard"},
            "shape": [[1.0,0.0],[0.0,0.0]], "samples": 11}"#;
        assert!(compute_buckling_surface_impl(request).is_err());

        let too_coarse = r#"{"input": {"length":400.0,"width":400.0,"n_x":-1.0,"n_y":0.0,"n_xy":0.0,
            "bc_x":"SS","bc_y":"SS","m":1,"n":1,"d_matrix":"standard"},
            "shape": [[1.0]], "samples": 1}"#;
        assert!(compute_buckling_surface_impl(too_coarse).is_err());
    }

    #[test]
    fn compute_buckling_flags_an_unsymmetric_laminate_for_a_symmetric_only_idealisation() {
        // The [0/90] sample laminate is not symmetric.
        let d_tilde = compute_buckling_impl(&buckling_request("", "")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&d_tilde).unwrap();
        assert!(!parsed["symmetry_warning"].as_bool().unwrap());

        let standard = buckling_request("", "").replace("\"d_tilde\"", "\"standard\"");
        let parsed: serde_json::Value =
            serde_json::from_str(&compute_buckling_impl(&standard).unwrap()).unwrap();
        assert!(parsed["symmetry_warning"].as_bool().unwrap());
    }

    #[test]
    fn compute_buckling_reports_degenerate_input_as_an_error() {
        let no_load = buckling_request("", "").replace("\"n_x\": -1.0", "\"n_x\": 0.0");
        assert!(compute_buckling_impl(&no_load).is_err());

        let too_many_terms = buckling_request("", "").replace("\"m\": 6", "\"m\": 25");
        assert!(compute_buckling_impl(&too_many_terms).is_err());

        assert!(compute_buckling_impl("not json").is_err());
    }

    const SMALL_PROJECT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<elamx version="1">
    <laminates>
        <laminate invert_z="false" name="L" offset="0.0" symmetric="false" uuid="lam" with_middle_layer="false">
            <layer name="Lage 1" uuid="l1">
                <thickness>0.125</thickness>
                <angle>0.0</angle>
                <material>mat</material>
                <criterion>de.elamx.laminate.failure.Puck</criterion>
            </layer>
            <lastplyfailure name="LPF">
                <n_x>1.0</n_x><n_y>0.0</n_y><n_xy>0.0</n_xy>
                <m_x>0.0</m_x><m_y>0.0</m_y><m_xy>0.0</m_xy>
                <degradationFactor>1.0E-6</degradationFactor>
                <degradeAllOnFibreFailure>true</degradeAllOnFibreFailure>
                <epsilon_crit>0.003</epsilon_crit>
                <j_a>1.0</j_a>
            </lastplyfailure>
            <pressurevessel name="Kessel"><pressure>0.5</pressure></pressurevessel>
        </laminate>
    </laminates>
    <materials>
        <material class="de.elamx.laminate.DefaultMaterial" name="M" uuid="mat">
            <Epar>141000.0</Epar><Enor>9340.0</Enor><nue12>0.35</nue12><G>4500.0</G>
        </material>
    </materials>
</elamx>"#;

    #[test]
    fn import_elamx_returns_the_project_as_json() {
        let json = import_elamx_impl(SMALL_PROJECT).expect("import_elamx_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["materials"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["laminates"][0]["laminate"]["layers"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["laminates"][0]["laminate"]["layers"][0]["criterion_id"], "puck");
        assert_eq!(parsed["laminates"][0]["last_ply_failures"][0]["name"], "LPF");
        assert_eq!(
            parsed["laminates"][0]["last_ply_failures"][0]["input"]["loads"]["n_x"],
            1.0
        );
    }

    #[test]
    fn export_elamx_round_trips_through_the_json_boundary() {
        let json = import_elamx_impl(SMALL_PROJECT).unwrap();
        let xml = export_elamx_impl(&json).expect("export_elamx_impl should succeed");
        assert!(xml.contains("<criterion>de.elamx.laminate.failure.Puck</criterion>"));
        assert!(xml.contains("<lastplyfailure name=\"LPF\">"));
        // Module data the core cannot calculate survives the browser round trip.
        assert!(xml.contains("<pressurevessel name=\"Kessel\">"));
        assert_eq!(import_elamx_impl(&xml).unwrap(), json);
    }

    #[test]
    fn import_elamx_reports_a_bad_file_instead_of_panicking() {
        assert!(import_elamx_impl("<nope").is_err());
        assert!(import_elamx_impl("<other/>").is_err());
        assert!(export_elamx_impl("not json").is_err());
    }
}
