//! WebAssembly bindings for elamx-core's CLT calculation engine.
//!
//! A single JSON request goes in, a single JSON response comes out - see
//! [`CltRequest`]/[`CltResponse`] (and [`AngleSweepRequest`]/[`AngleSweepResponse`]
//! for [`compute_angle_sweep`]) for the exact shapes. This keeps the wasm
//! boundary small and lets the frontend evolve its own request/response
//! builders without needing bindgen-generated classes for every domain type.

use elamx_core::clt::{
    calculate_last_ply_failure, calculate_pressure_vessel, determine_values, get_layer_results,
    CltLaminate, LastPlyFailureInput, LastPlyFailureResult, LayerContribution, LayerResult, Loads,
    MassMoments, PressureVesselInput, PressureVesselResult, Strains,
};
use elamx_core::failure::{
    default_criterion_registry, failure_envelope, laminate_envelope, FailureEnvelope,
    LaminateEnvelope, LaminateEnvelopeInput, DEFAULT_QUALITY,
};
use elamx_core::mathtools;
use elamx_core::micromechanics::{self, Fibre, MatrixMaterial};
use elamx_core::model::{Laminate, Material};
use elamx_core::project::{read_elamx, read_elamxb, write_elamx, Project};
use elamx_core::carpet::{carpet_plot, CarpetValue};
use elamx_core::cutout::{calculate as calculate_cutout, CutoutInput};
use elamx_core::export::{export as export_deck, ExportOptions, ExportTarget};
use elamx_core::optimization::{
    exhaustive, genetic, sequential_decision, todoroki, GeneticParameters, OptimizationInput,
};
use elamx_core::spring_in::{calculate as calculate_spring_in, SpringInInput};
use elamx_core::clt::LayerPosition;
use elamx_core::plate::{
    calculate_buckling, calculate_deformation, calculate_vibration, evaluate_plate_field,
    mode_surface, vibration_mode_surface, BucklingInput, DeformationInput, DeformationResult,
    PlateField, PlateFieldResult, PlateFieldSelection, VibrationInput,
};
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
    /// The laminate's own expansion coefficients: the strain a unit change in
    /// temperature / moisture produces, [x, y, xy]. Not derivable from the
    /// plies alone - a laminate expands as its stack lets it.
    alpha_global: [f64; 3],
    beta_global: [f64; 3],
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
        alpha_global: elamx_core::clt::alpha_global(&clt),
        beta_global: elamx_core::clt::beta_global(&clt),
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct AngleSweepRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct AngleSweepResponse {
    angle_deg: Vec<f64>,
    /// The 11, 12, 22 and 66 components of each of the three laminate
    /// matrices as the coordinate system turns. All three, and not only A,
    /// because that is what the original's polar chart offers - and B and D
    /// are where an unsymmetric or a bend-twist-coupled stack shows itself.
    a11: Vec<f64>,
    a12: Vec<f64>,
    a22: Vec<f64>,
    a66: Vec<f64>,
    b11: Vec<f64>,
    b12: Vec<f64>,
    b22: Vec<f64>,
    b66: Vec<f64>,
    d11: Vec<f64>,
    d12: Vec<f64>,
    d22: Vec<f64>,
    d66: Vec<f64>,
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

    let a = mathtools::get_matrix_components_over_angle(clt.a_matrix(), delta_angle_deg);
    let b = mathtools::get_matrix_components_over_angle(clt.b_matrix(), delta_angle_deg);
    let d = mathtools::get_matrix_components_over_angle(clt.d_matrix(), delta_angle_deg);

    let response = AngleSweepResponse {
        angle_deg: a[mathtools::ANGLE_ROW].clone(),
        a11: a[mathtools::M11_ROW].clone(),
        a12: a[mathtools::M12_ROW].clone(),
        a22: a[mathtools::M22_ROW].clone(),
        a66: a[mathtools::M66_ROW].clone(),
        b11: b[mathtools::M11_ROW].clone(),
        b12: b[mathtools::M12_ROW].clone(),
        b22: b[mathtools::M22_ROW].clone(),
        b66: b[mathtools::M66_ROW].clone(),
        d11: d[mathtools::M11_ROW].clone(),
        d12: d[mathtools::M12_ROW].clone(),
        d22: d[mathtools::M22_ROW].clone(),
        d66: d[mathtools::M66_ROW].clone(),
    };

    serde_json::to_string(&response).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct BucklingRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: BucklingInput,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct BucklingSurfaceRequest {
    input: BucklingInput,
    /// One mode's amplitudes, as returned in `BucklingModeDto::shape`.
    shape: Vec<Vec<f64>>,
    /// Grid resolution per direction.
    samples: usize,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct DeformationRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: DeformationInput,
}

/// Solves the deflection of a rectangular plate made of `laminate` under
/// transverse loads: the same Ritz series as the buckling analysis, with a
/// load vector instead of a geometric stiffness matrix.
///
/// The response is [`DeformationResult`] as JSON, including the deflection
/// already sampled on a grid - unlike the buckling modes, there is exactly one
/// field here, so there is nothing to choose between and no second call.
#[wasm_bindgen]
pub fn compute_deformation(request_json: &str) -> Result<String, JsValue> {
    compute_deformation_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_deformation_impl(request_json: &str) -> Result<String, String> {
    let request: DeformationRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials).map_err(|e| e.to_string())?;

    let result: DeformationResult =
        calculate_deformation(&clt, &request.input).map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct DeformationFieldRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: DeformationInput,
    /// The Ritz coefficients from a previous [`compute_deformation`]. Passing
    /// the solution back rather than re-solving is what makes switching the
    /// displayed quantity a redraw instead of another factorisation.
    coefficients: Vec<Vec<f64>>,
    field: PlateField,
    /// Index into the EXPANDED stack, as the CLT response numbers it.
    layer: usize,
    position: LayerPosition,
    /// Grid resolution, the same in both directions.
    samples: usize,
}

/// Evaluates ONE result field over a deflected plate: a quantity, in a ply, at
/// a position through that ply.
///
/// Deliberately one at a time. Twenty plies times three positions times seven
/// quantities is 420 grids of several thousand values, and a caller wants one
/// of them - the same reason [`compute_buckling_surface`] samples one mode
/// rather than all of them.
///
/// Shaped by [`DeformationFieldRequest`]; the response is [`PlateFieldResult`]
/// as JSON. Points the ply's failure criterion cannot evaluate come back as
/// `null` in `values` rather than as a number.
#[wasm_bindgen]
pub fn compute_deformation_field(request_json: &str) -> Result<String, JsValue> {
    compute_deformation_field_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_deformation_field_impl(request_json: &str) -> Result<String, String> {
    let request: DeformationFieldRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;

    // The coefficients are the caller's, so their shape is the caller's
    // mistake to make: silently evaluating a grid that does not match m and n
    // would return a field for a plate nobody asked about.
    if request.coefficients.len() != request.input.m
        || request
            .coefficients
            .iter()
            .any(|row| row.len() != request.input.n)
    {
        return Err(format!(
            "coefficient grid is {}x{}, but the input declares m={}, n={}",
            request.coefficients.len(),
            request.coefficients.first().map_or(0, |r| r.len()),
            request.input.m,
            request.input.n
        ));
    }

    let clt = CltLaminate::new(&request.laminate, &request.materials).map_err(|e| e.to_string())?;
    let criteria = default_criterion_registry();
    let result: PlateFieldResult = evaluate_plate_field(
        &clt,
        &request.materials,
        &criteria,
        &request.input,
        &request.coefficients,
        PlateFieldSelection {
            field: request.field,
            layer: request.layer,
            position: request.position,
            samples: request.samples,
        },
    )
    .map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct PressureVesselRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: PressureVesselInput,
}

/// Solves a thin-walled cylinder made of `laminate`: the boiler-formula load
/// on the mean radius, the moments its wall's zero curvature requires, and
/// every ply's state through the wall - where the hoop strain follows 1/r
/// rather than being constant.
///
/// Shaped by [`PressureVesselRequest`]; the response is
/// [`PressureVesselResult`] as JSON.
#[wasm_bindgen]
pub fn compute_pressure_vessel(request_json: &str) -> Result<String, JsValue> {
    compute_pressure_vessel_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_pressure_vessel_impl(request_json: &str) -> Result<String, String> {
    let request: PressureVesselRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials).map_err(|e| e.to_string())?;

    let criteria = default_criterion_registry();
    let result: PressureVesselResult =
        calculate_pressure_vessel(&clt, &request.materials, &criteria, &request.input)
            .map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
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

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct VibrationRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: VibrationInput,
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct VibrationSurfaceRequest {
    input: VibrationInput,
    /// One mode's amplitudes, as returned in the response's `shape`.
    shape: Vec<Vec<f64>>,
    /// Grid resolution per direction.
    samples: usize,
}

/// The natural frequencies of a rectangular plate cut from this laminate.
///
/// Shaped by [`VibrationRequest`]; the response is `VibrationResult` as the
/// core defines it, mode shapes and all - unlike buckling, which trims the
/// shapes out, because a vibration mode list is the same size and the
/// frontend wants the same thing from it.
#[wasm_bindgen]
pub fn compute_vibration(request_json: &str) -> Result<String, JsValue> {
    compute_vibration_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_vibration_impl(request_json: &str) -> Result<String, String> {
    let request: VibrationRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials)
        .map_err(|e| e.to_string())?;
    let result = calculate_vibration(&clt, &request.input).map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Samples one vibration mode's displacement field on a square grid,
/// normalised to a peak of 1. Rows run along y.
#[wasm_bindgen]
pub fn compute_vibration_surface(request_json: &str) -> Result<String, JsValue> {
    compute_vibration_surface_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_vibration_surface_impl(request_json: &str) -> Result<String, String> {
    let request: VibrationSurfaceRequest =
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

    let surface =
        vibration_mode_surface(&request.shape, &request.input, request.samples, request.samples);
    serde_json::to_string(&surface).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct MicroMechanicsRequest {
    /// The whole catalog, not one material: the frontend edits a fibre and
    /// wants every material built on it to follow, and doing that in one call
    /// keeps the "which materials does this fibre affect" question on this
    /// side of the boundary.
    materials: Vec<Material>,
    fibres: Vec<Fibre>,
    matrices: Vec<MatrixMaterial>,
}

/// Which of the four searches to run.
#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
enum OptimizerKind {
    Sequential,
    Exhaustive,
    Todoroki,
    Genetic,
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct OptimizationRequest {
    materials: HashMap<String, Material>,
    input: OptimizationInput,
    optimizer: OptimizerKind,
    /// Only the genetic search reads this; the others ignore it.
    #[serde(default)]
    genetic: GeneticParameters,
    /// The most candidates any search may evaluate.
    ///
    /// The exhaustive one needs it (it enumerates every order) and so does the
    /// genetic one (it runs for a fixed number of generations, which can be
    /// large). Passing it from the caller rather than fixing it here is the
    /// point: a browser tab and a batch run want different numbers.
    budget: usize,
}

/// Searches for a stacking sequence that meets every constraint.
///
/// The response is `OptimizationResult` as the core defines it. Slow by the
/// standards of everything else here - each candidate is a full analysis, and
/// there are hundreds to thousands of them - so this belongs in the worker
/// even more than the rest.
#[wasm_bindgen]
pub fn optimize(request_json: &str) -> Result<String, JsValue> {
    optimize_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn optimize_impl(request_json: &str) -> Result<String, String> {
    let request: OptimizationRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let criteria = default_criterion_registry();
    let result = match request.optimizer {
        OptimizerKind::Sequential => {
            sequential_decision(&request.input, &request.materials, &criteria)
        }
        OptimizerKind::Exhaustive => {
            exhaustive(&request.input, &request.materials, &criteria, request.budget)
        }
        OptimizerKind::Todoroki => {
            todoroki(&request.input, &request.materials, &criteria, request.budget)
        }
        OptimizerKind::Genetic => genetic(
            &request.input,
            &request.materials,
            &criteria,
            &request.genetic,
            request.budget,
        ),
    };
    serde_json::to_string(&result.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct CutoutRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: CutoutInput,
}

/// Force and moment resultants around a hole in this laminate.
///
/// The response is `CutoutResult` as the core defines it - one entry per
/// sampled angle, plus the two peaks. At the default 721 samples that is a
/// list worth passing through a worker: the unsymmetric path solves a complex
/// 4x4 system at every one of them.
#[wasm_bindgen]
pub fn compute_cutout(request_json: &str) -> Result<String, JsValue> {
    compute_cutout_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_cutout_impl(request_json: &str) -> Result<String, String> {
    let request: CutoutRequest = serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials).map_err(|e| e.to_string())?;
    let result = calculate_cutout(&clt, &request.input).map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct SpringInRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: SpringInInput,
}

/// How far a corner cured from this laminate closes when it leaves the tool.
///
/// The response is `SpringInResult` as the core defines it. Cheap enough that
/// the frontend can call it on every keystroke - it is a handful of
/// multiplications on top of the ABD matrix.
#[wasm_bindgen]
pub fn compute_spring_in(request_json: &str) -> Result<String, JsValue> {
    compute_spring_in_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_spring_in_impl(request_json: &str) -> Result<String, String> {
    let request: SpringInRequest = serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let clt = CltLaminate::new(&request.laminate, &request.materials).map_err(|e| e.to_string())?;
    let result = calculate_spring_in(&clt, &request.input).map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Recomputes the basic properties of every material that has a micromechanic
/// definition, and returns the whole catalog.
///
/// Materials without one come back untouched, so the caller can hand over its
/// list as it stands rather than filtering first.
#[wasm_bindgen]
pub fn resolve_micromechanics(request_json: &str) -> Result<String, JsValue> {
    resolve_micromechanics_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn resolve_micromechanics_impl(request_json: &str) -> Result<String, String> {
    let request: MicroMechanicsRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let mut materials = request.materials;
    micromechanics::resolve(&mut materials, &request.fibres, &request.matrices).map_err(
        |missing| {
            format!(
                "Material '{}': {} '{}' fehlt",
                missing.material, missing.kind, missing.id
            )
        },
    )?;
    serde_json::to_string(&materials).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct LaminateEnvelopeRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    input: LaminateEnvelopeInput,
}

/// The failure surface of a whole laminate, in load space.
///
/// Expensive by construction - one criterion evaluation per ply, per ply
/// surface, per direction, and for final failure per degradation step on top
/// of that. The resolution is in the request precisely so the caller can trade
/// it off; see `LaminateEnvelopeInput`.
#[wasm_bindgen]
pub fn compute_laminate_envelope(request_json: &str) -> Result<String, JsValue> {
    compute_laminate_envelope_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_laminate_envelope_impl(request_json: &str) -> Result<String, String> {
    let request: LaminateEnvelopeRequest =
        serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let registry = default_criterion_registry();
    let envelope: LaminateEnvelope =
        laminate_envelope(&request.laminate, &request.materials, &registry, &request.input)
            .map_err(|e| e.to_string())?;
    serde_json::to_string(&envelope).map_err(|e| e.to_string())
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

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct ExportRequest {
    laminate: Laminate,
    materials: HashMap<String, Material>,
    target: ExportTarget,
    options: ExportOptions,
}

/// This laminate as input for a finite-element solver.
///
/// Returns the deck as one string - material cards and the layup, and nothing
/// else. Unlike every other entry point here the answer is text rather than
/// JSON, because text is what the solver reads.
#[wasm_bindgen]
pub fn export_solver_deck(request_json: &str) -> Result<String, JsValue> {
    export_solver_deck_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn export_solver_deck_impl(request_json: &str) -> Result<String, String> {
    let request: ExportRequest = serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    export_deck(
        &request.laminate,
        &request.materials,
        request.target,
        request.options,
    )
    .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
struct CarpetRequest {
    material: Material,
    value: CarpetValue,
}

/// What this material becomes at every mix of 0, +-45 and 90 degree plies.
///
/// A material question, not a laminate one: nothing here refers to a stack,
/// which is the point - the plot is read before there is one.
#[wasm_bindgen]
pub fn compute_carpet_plot(request_json: &str) -> Result<String, JsValue> {
    compute_carpet_plot_impl(request_json).map_err(|e| JsValue::from_str(&e))
}

fn compute_carpet_plot_impl(request_json: &str) -> Result<String, String> {
    let request: CarpetRequest = serde_json::from_str(request_json).map_err(|e| e.to_string())?;
    let plot = carpet_plot(&request.material, request.value);
    serde_json::to_string(&plot).map_err(|e| e.to_string())
}

/// Reads a `.elamxb`, the reduced input file the batch mode takes.
///
/// A separate entry point rather than a sniffed format, because that is how the
/// original decides too: its batch mode takes a `--reducedinput` switch. Two
/// files with the same root element and different meanings should not be told
/// apart by guessing.
#[wasm_bindgen]
pub fn import_elamxb(xml: &str) -> Result<String, JsValue> {
    import_elamxb_impl(xml).map_err(|e| JsValue::from_str(&e))
}

fn import_elamxb_impl(xml: &str) -> Result<String, String> {
    let project = read_elamxb(xml).map_err(|e| e.to_string())?;
    serde_json::to_string(&project).map_err(|e| e.to_string())
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

    fn deformation_request(loads: &str, extra_input: &str) -> String {
        let base = sample_request(0.0, "\"max_stress\"");
        let head = base.rsplit_once("\"loads\"").map(|(h, _)| h.to_string()).unwrap();
        format!(
            r#"{head}"input": {{
                "length": 400.0, "width": 400.0,
                "bc_x": "SS", "bc_y": "SS",
                "m": 10, "n": 10,
                "d_matrix": "standard",
                "loads": [{loads}]{extra_input}
            }}}}"#
        )
    }

    /// Solves once, then asks for a field: the pair of calls the frontend
    /// makes, and the only place their two request shapes have to agree.
    fn field_request(field: &str, layer: usize, position: &str, samples: usize) -> String {
        let solved = compute_deformation_impl(&deformation_request(
            r#"{"kind":"Surface","name":"q","force":0.01}"#,
            "",
        ))
        .expect("the plate should solve");
        let coefficients = serde_json::from_str::<serde_json::Value>(&solved).unwrap()["coefficients"]
            .to_string();

        let base = deformation_request(r#"{"kind":"Surface","name":"q","force":0.01}"#, "");
        let head = base.strip_suffix('}').unwrap();
        format!(
            r#"{head}, "coefficients": {coefficients}, "field": "{field}",
               "layer": {layer}, "position": "{position}", "samples": {samples}}}"#
        )
    }

    #[test]
    fn compute_deformation_field_evaluates_one_quantity_in_one_ply() {
        let response = compute_deformation_field_impl(&field_request("StressPar", 0, "Upper", 21))
            .expect("the field should evaluate");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        let values = parsed["values"].as_array().unwrap();
        assert_eq!(values.len(), 21);
        assert_eq!(values[0].as_array().unwrap().len(), 21);
        // Simply supported and bending only: the edges carry no curvature in
        // the direction along them, so the corner is unstressed.
        assert!(values[0][0].as_f64().unwrap().abs() < 1e-9);
        assert!(parsed["max"].as_f64().unwrap() > 0.0);
        // Only the reserve factor names a failure mode.
        assert!(parsed["failure"].is_null());
    }

    #[test]
    fn compute_deformation_field_reports_the_mode_that_governs_the_reserve() {
        let response =
            compute_deformation_field_impl(&field_request("ReserveFactor", 0, "Upper", 11))
                .expect("the reserve factor should evaluate");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        let modes = parsed["failure"].as_array().unwrap();
        assert_eq!(modes.len(), 11);
        assert!(parsed["min"].as_f64().unwrap() > 0.0);
    }

    /// The deflection is the one field that does not belong to a ply, and it
    /// has to come back at the resolution asked for rather than at the 41 the
    /// solution happens to carry.
    #[test]
    fn compute_deformation_field_samples_the_deflection_at_the_requested_resolution() {
        let response = compute_deformation_field_impl(&field_request("Deflection", 0, "Middle", 9))
            .expect("the deflection should evaluate");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["values"].as_array().unwrap().len(), 9);
    }

    #[test]
    fn compute_deformation_field_rejects_coefficients_that_do_not_match_the_input() {
        // A 2x2 grid against the m=10, n=10 the input declares.
        let base = deformation_request(r#"{"kind":"Surface","name":"q","force":0.01}"#, "");
        let head = base.strip_suffix('}').unwrap();
        let request = format!(
            r#"{head}, "coefficients": [[1.0, 2.0], [3.0, 4.0]], "field": "Deflection",
               "layer": 0, "position": "Middle", "samples": 9}}"#
        );
        assert!(compute_deformation_field_impl(&request).is_err());
    }

    #[test]
    fn compute_deformation_field_rejects_a_ply_that_is_not_there() {
        assert!(compute_deformation_field_impl(&field_request("StrainPar", 99, "Upper", 9)).is_err());
    }

    #[test]
    fn compute_deformation_returns_a_deflected_surface() {
        let request = deformation_request(r#"{"kind":"Surface","name":"q","force":0.01}"#, "");
        let response =
            compute_deformation_impl(&request).expect("compute_deformation_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        assert!(parsed["max_deflection"].as_f64().unwrap() > 0.0);
        let surface = parsed["surface"].as_array().unwrap();
        assert_eq!(surface.len(), 41);
        // Simply supported: the edges do not move.
        for value in surface[0].as_array().unwrap() {
            assert!(value.as_f64().unwrap().abs() < 1e-9);
        }
        // The peak sits in the middle of the plate.
        let at = parsed["max_at"].as_array().unwrap();
        assert!((at[0].as_f64().unwrap() - 200.0).abs() < 25.0);
    }

    #[test]
    fn compute_deformation_takes_a_point_load() {
        let request =
            deformation_request(r#"{"kind":"Point","name":"F","x":0.0,"y":0.0,"force":100.0}"#, "");
        let response = compute_deformation_impl(&request).expect("point load should solve");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(parsed["max_deflection"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn compute_deformation_reports_an_unloaded_plate_as_an_error() {
        assert!(compute_deformation_impl(&deformation_request("", "")).is_err());
    }

    fn pressure_vessel_request(pressure: f64, radius: f64, radius_type: &str) -> String {
        let base = sample_request(0.0, "\"max_stress\"");
        let head = base.rsplit_once("\"loads\"").map(|(h, _)| h.to_string()).unwrap();
        format!(
            r#"{head}"input": {{
                "pressure": {pressure},
                "radius": {radius},
                "radius_type": "{radius_type}"
            }}}}"#
        )
    }

    #[test]
    fn compute_pressure_vessel_returns_the_wall_state() {
        let response = compute_pressure_vessel_impl(&pressure_vessel_request(0.5, 200.0, "Mean"))
            .expect("compute_pressure_vessel_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

        assert_eq!(parsed["mean_radius"].as_f64().unwrap(), 200.0);
        // Boiler formula: hoop is twice axial.
        let n_x = parsed["loads"]["n_x"].as_f64().unwrap();
        let n_y = parsed["loads"]["n_y"].as_f64().unwrap();
        assert!((n_y - 2.0 * n_x).abs() < 1e-9);
        // The wall is held straight.
        assert!(parsed["strains"]["kappa_x"].as_f64().unwrap().abs() < 1e-12);
        assert_eq!(parsed["layer_results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn compute_pressure_vessel_moves_an_inner_radius_to_the_mean_one() {
        let response = compute_pressure_vessel_impl(&pressure_vessel_request(0.5, 200.0, "Inner"))
            .expect("compute_pressure_vessel_impl should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        // The sample laminate is two 0.2 mm plies.
        assert!((parsed["mean_radius"].as_f64().unwrap() - 200.2).abs() < 1e-9);
    }

    #[test]
    fn compute_pressure_vessel_reports_a_degenerate_radius() {
        assert!(compute_pressure_vessel_impl(&pressure_vessel_request(1.0, 0.0, "Mean")).is_err());
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
            // The index walks a row AND a column here, so `enumerate()` over one of
            // them would not remove it.
            #[allow(clippy::needless_range_loop)]
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
            <plugindaten name="Fremdmodul"><wert>1.0</wert></plugindaten>
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
        assert!(xml.contains("<plugindaten name=\"Fremdmodul\">"));
        assert_eq!(import_elamx_impl(&xml).unwrap(), json);
    }

    /// The export's request shape, which is the part a typo breaks silently:
    /// the target is a tagged union and the options are flat beside it.
    #[test]
    fn export_solver_deck_takes_the_target_as_a_tagged_union() {
        let project = import_elamx_impl(SMALL_PROJECT).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&project).unwrap();
        let laminate = &parsed["laminates"][0]["laminate"];
        let materials: serde_json::Value = parsed["materials"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| (m["id"].as_str().unwrap().to_string(), m.clone()))
            .collect::<serde_json::Map<_, _>>()
            .into();

        let request = serde_json::json!({
            "laminate": laminate,
            "materials": materials,
            "target": { "solver": "nastran", "format": "small" },
            "options": { "hygrothermal": false, "strength": false, "offset": "mid" },
        });
        let deck = export_solver_deck_impl(&request.to_string()).expect("Nastran-Deck");
        assert!(deck.starts_with("MAT8"), "{deck}");
        assert!(deck.contains("PCOMP"), "{deck}");

        let abaqus = serde_json::json!({
            "laminate": laminate,
            "materials": materials,
            "target": { "solver": "abaqus" },
            "options": { "hygrothermal": false, "strength": true, "offset": "top" },
        });
        let deck = export_solver_deck_impl(&abaqus.to_string()).expect("Abaqus-Deck");
        assert!(deck.contains("*FAIL STRESS"), "{deck}");
        assert!(deck.contains(" OFFSET=SPOS"), "{deck}");
    }

    #[test]
    fn export_solver_deck_reports_a_missing_material_instead_of_panicking() {
        let request = serde_json::json!({
            "laminate": { "id": "l", "name": "l", "layers": [], "symmetric": false,
                          "with_middle_layer": false, "invert_z": false, "offset": 0.0 },
            "materials": {},
            "target": { "solver": "abaqus" },
            "options": { "hygrothermal": false, "strength": false, "offset": "mid" },
        });
        // An empty stack is a deck with no plies, not an error.
        assert!(export_solver_deck_impl(&request.to_string()).is_ok());
        assert!(export_solver_deck_impl("not json").is_err());
    }

    /// The carpet plot's request is a material and a choice of constant, and
    /// the answer has to carry the eleven curves the page draws.
    #[test]
    fn compute_carpet_plot_returns_the_whole_family() {
        let project = import_elamx_impl(SMALL_PROJECT).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&project).unwrap();
        let request = serde_json::json!({
            "material": parsed["materials"][0],
            "value": "ex",
        });
        let json = compute_carpet_plot_impl(&request.to_string()).expect("Carpet-Plot");
        let plot: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(plot["curves"].as_array().unwrap().len(), 11);
        assert_eq!(plot["curves"][10]["without_90"], true);
        assert!(compute_carpet_plot_impl("not json").is_err());
    }

    /// The reduced format, through the same boundary: a laminate whose layers
    /// take their thickness from the material, and a load case referred to by
    /// name from the calculation.
    #[test]
    fn import_elamxb_reads_the_reduced_format() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<elamx version="1">
  <materials>
    <material name="UD">
      <Epar>141000.0</Epar><Enor>9340.0</Enor><nue12>0.35</nue12><G>4500.0</G>
      <rho>1.7E-9</rho><thickness>0.125</thickness>
      <criterion>de.elamx.laminate.failure.Puck</criterion>
    </material>
  </materials>
  <laminates>
    <laminate name="L" offset="0.0" symmetric="false" with_middle_layer="false" invert_z="false">
      <layer name="1"><angle>0.0</angle><material>UD</material></layer>
      <layer name="2"><angle>90.0</angle><material>UD</material></layer>
      <loadcase name="LC"><n_x>100.0</n_x><ul_factor>1.5</ul_factor></loadcase>
      <calculation name="C"><loadcase>LC</loadcase></calculation>
      <lastplyfailure name="LPF" degrade_all_on_fibre_failure="true">
        <loadcase>LC</loadcase><degradationFactor>1.0E-6</degradationFactor>
        <epsilon_crit>0.003</epsilon_crit>
      </lastplyfailure>
    </laminate>
  </laminates>
</elamx>"#;
        let json = import_elamxb_impl(xml).expect("reduzierte Eingabe");
        let project: serde_json::Value = serde_json::from_str(&json).unwrap();
        let laminate = &project["laminates"][0];
        assert_eq!(laminate["laminate"]["layers"][0]["thickness"], 0.125);
        assert_eq!(laminate["laminate"]["layers"][0]["criterion_id"], "puck");
        assert_eq!(laminate["calculations"][0]["loads"]["n_x"], 100.0);
        assert_eq!(laminate["last_ply_failures"][0]["input"]["j_a"], 1.5);
        assert_eq!(
            laminate["last_ply_failures"][0]["input"]["degrade_all_on_fibre_failure"],
            true
        );
        assert!(import_elamxb_impl("<nope").is_err());
    }

    #[test]
    fn import_elamx_reports_a_bad_file_instead_of_panicking() {
        assert!(import_elamx_impl("<nope").is_err());
        assert!(import_elamx_impl("<other/>").is_err());
        assert!(export_elamx_impl("not json").is_err());
    }
}
