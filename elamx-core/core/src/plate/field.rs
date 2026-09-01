//! One result field over a deformed plate: which quantity, in which ply, at
//! which position through that ply.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/view3d/DeformationPlate.java
//!
//! Separate from [`super::deformation`] on purpose. The deflection is one grid
//! and comes back with the solution; everything else is a grid PER quantity,
//! per ply and per position, which at twenty plies, three positions and seven
//! quantities is 420 grids of 6561 values. So the solution is computed once
//! and a field is asked for one at a time, the way `buckling::mode_surface`
//! already samples one mode out of many.
//!
//! # The curvature sign
//!
//! The Java original (`DeformationPlate.init_dZ_Kappa`) sets
//! `kappa = [w_xx, w_yy, 2 * w_xy]` - the raw second derivatives, with no sign
//! change - where plate theory writes `kappa = -w_xx`. It decides which half
//! of a ply is in tension, and the golden-master suite cannot settle it
//! because eLamX's batch mode prints no deformation results.
//!
//! **This port uses `kappa = -w''`, verified rather than assumed.** Kirchhoff
//! puts a point at height z above the mid-plane at `u = -z dw/dx`, so
//! `eps_x = -z w_xx`; `CltLayer::stress_state` forms `eps + z * kappa`, which
//! makes `kappa_x = -w_xx` the only choice that agrees. The test
//! `tension_lies_on_the_face_away_from_the_load` checks that consequence
//! against the Navier case the deflection itself was checked against: a simply
//! supported plate under constant pressure carries tension on the face the
//! load is NOT pushing on. With the Java sign that test fails, which is the
//! whole reason it is written as a load case rather than as an assertion about
//! a minus sign.
//!
//! This is therefore a deliberate divergence from the original, of the same
//! kind as the three in the last-ply-failure port: the picture the original
//! draws puts the tension on the wrong face.

use std::collections::HashMap;

use super::boundary::Boundary;
use super::deformation::DeformationInput;
use super::ritz::{self, Derivative, SurfaceScale};
use crate::clt::{CltLaminate, LayerPosition};
use crate::failure::{CriterionRegistry, FailureType, LayerContext};
use crate::model::Material;
use serde::{Deserialize, Serialize};

/// The eight quantities eLamX 3.x offers for a deformed plate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub enum PlateField {
    /// Out-of-plane displacement. The only one that does not depend on a ply.
    Deflection,
    /// Local strain along the fibres.
    StrainPar,
    /// Local strain across the fibres.
    StrainNor,
    /// Local shear strain.
    StrainShear,
    /// Local stress along the fibres.
    StressPar,
    /// Local stress across the fibres.
    StressNor,
    /// Local shear stress.
    StressShear,
    /// Smallest reserve factor of the ply's own failure criterion.
    ReserveFactor,
}

impl PlateField {
    /// Whether the field is the same everywhere through the thickness, so the
    /// caller can grey out the ply and position controls rather than offering
    /// choices that change nothing.
    pub fn depends_on_ply(&self) -> bool {
        *self != PlateField::Deflection
    }

    /// Whether zero is a meaningful middle for this quantity - which decides
    /// between a diverging and a sequential colour scale.
    pub fn is_signed(&self) -> bool {
        *self != PlateField::ReserveFactor
    }
}

/// Everything a field needs beyond the plate input and its solution.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct PlateFieldSelection {
    pub field: PlateField,
    /// Index into the EXPANDED stack, 0-based from the bottom ply.
    pub layer: usize,
    pub position: LayerPosition,
    /// Grid resolution; the same number in both directions (CR-04).
    pub samples: usize,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct PlateFieldResult {
    /// Rows along y, columns along x. A point the criterion could not evaluate
    /// is NaN, not a number - see the note on the reserve factor below.
    pub values: Vec<Vec<f64>>,
    pub min: f64,
    pub max: f64,
    /// Plate coordinates of the extremes, measured from the corner at (0, 0).
    pub min_at: [f64; 2],
    pub max_at: [f64; 2],
    /// Which mode of failure governs at each point - only for the reserve
    /// factor, and `None` where it could not be evaluated.
    pub failure: Option<Vec<Vec<Option<FailureType>>>>,
    /// How many grid points the criterion refused. Zero for every other field.
    pub gaps: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlateFieldError {
    LayerOutOfRange { layer: usize, layers: usize },
    SampleCountOutOfRange { samples: usize },
    MissingMaterial(String),
    MissingCriterion(String),
}

impl std::fmt::Display for PlateFieldError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlateFieldError::LayerOutOfRange { layer, layers } => {
                write!(f, "ply {layer} is outside a stack of {layers}")
            }
            PlateFieldError::SampleCountOutOfRange { samples } => write!(
                f,
                "grid resolution {samples} must be within {MIN_SAMPLES}..={MAX_SAMPLES}"
            ),
            PlateFieldError::MissingMaterial(id) => write!(f, "material '{id}' not found"),
            PlateFieldError::MissingCriterion(id) => {
                write!(f, "failure criterion '{id}' not found in the registry")
            }
        }
    }
}

impl std::error::Error for PlateFieldError {}

/// Below this a grid is not a picture; above it the reserve factor evaluates a
/// failure criterion more than 25000 times for one frame.
pub const MIN_SAMPLES: usize = 5;
pub const MAX_SAMPLES: usize = 161;
/// What the frontend asks for unless the device says otherwise (CR-04).
pub const DEFAULT_SAMPLES: usize = 81;

/// Evaluates one field over the plate from a solution that already exists.
///
/// `coefficients` is `DeformationResult::coefficients`; nothing here re-solves
/// the plate, which is what keeps switching the displayed quantity a matter of
/// milliseconds rather than of another factorisation.
pub fn evaluate(
    laminate: &CltLaminate,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    input: &DeformationInput,
    coefficients: &[Vec<f64>],
    selection: PlateFieldSelection,
) -> Result<PlateFieldResult, PlateFieldError> {
    let samples = selection.samples;
    if !(MIN_SAMPLES..=MAX_SAMPLES).contains(&samples) {
        return Err(PlateFieldError::SampleCountOutOfRange { samples });
    }

    let bx = Boundary::new(input.bc_x, input.length);
    let by = Boundary::new(input.bc_y, input.width);

    if selection.field == PlateField::Deflection {
        let field = ritz::surface(
            coefficients,
            input.length,
            input.width,
            &bx,
            &by,
            samples,
            samples,
            SurfaceScale::Absolute,
        );
        return Ok(summarise(field, None, 0, input, samples));
    }

    let layers = laminate.layers();
    let layer = layers
        .get(selection.layer)
        .ok_or(PlateFieldError::LayerOutOfRange {
            layer: selection.layer,
            layers: layers.len(),
        })?;

    let curvature = curvatures(coefficients, input, &bx, &by, samples);

    // The reserve factor is the only field that needs a material and a
    // criterion, and looking them up per grid point would repeat 6561 hash
    // lookups for one answer.
    let wants_failure = selection.field == PlateField::ReserveFactor;
    let material = materials
        .get(layer.material_id())
        .ok_or_else(|| PlateFieldError::MissingMaterial(layer.material_id().to_string()))?;
    let criterion = if wants_failure {
        let id = layer.criterion_id().unwrap_or(crate::failure::PUCK_ID);
        Some(
            criteria
                .get(id)
                .ok_or_else(|| PlateFieldError::MissingCriterion(id.to_string()))?,
        )
    } else {
        None
    };
    let context = LayerContext {
        angle_deg: layer.angle_deg,
        embedded: layer.embedded,
    };

    let mut values = vec![vec![0.0f64; samples]; samples];
    let mut failure: Option<Vec<Vec<Option<FailureType>>>> =
        wants_failure.then(|| vec![vec![None; samples]; samples]);
    let mut gaps = 0usize;

    for row in 0..samples {
        for col in 0..samples {
            // Bending only: the Ritz formulation carries no membrane strain,
            // so the mid-plane strain of every point is zero and the whole
            // state comes from the curvatures.
            let epskappa = [
                0.0,
                0.0,
                0.0,
                curvature.xx[row][col],
                curvature.yy[row][col],
                curvature.xy[row][col],
            ];
            let (local, _) = layer.stress_state(&epskappa, 0.0, 0.0, selection.position, false);

            values[row][col] = match selection.field {
                PlateField::Deflection => unreachable!("handled above"),
                PlateField::StrainPar => local.strain[0],
                PlateField::StrainNor => local.strain[1],
                PlateField::StrainShear => local.strain[2],
                PlateField::StressPar => local.stress[0],
                PlateField::StressNor => local.stress[1],
                PlateField::StressShear => local.stress[2],
                PlateField::ReserveFactor => {
                    match criterion.expect("looked up above").reserve_factor(
                        material,
                        Some(&context),
                        &local,
                    ) {
                        Ok(rf) => {
                            if let Some(modes) = failure.as_mut() {
                                modes[row][col] = Some(rf.failure_type);
                            }
                            rf.minimal_reserve_factor
                        }
                        // A criterion that cannot answer here leaves a hole
                        // (CR-06). The original turns the whole field into
                        // "1 = safe, 2 = failed" and folds NaN into safe - its
                        // own comment calls that out as a risk.
                        Err(_) => {
                            gaps += 1;
                            f64::NAN
                        }
                    }
                }
            };
        }
    }

    Ok(summarise(values, failure, gaps, input, samples))
}

/// The three curvature fields, sign as decided at the top of this module.
struct Curvatures {
    xx: Vec<Vec<f64>>,
    yy: Vec<Vec<f64>>,
    xy: Vec<Vec<f64>>,
}

fn curvatures(
    coefficients: &[Vec<f64>],
    input: &DeformationInput,
    bx: &Boundary,
    by: &Boundary,
    samples: usize,
) -> Curvatures {
    let evaluate = |dx, dy| {
        ritz::derivative_field(
            coefficients,
            input.length,
            input.width,
            bx,
            by,
            samples,
            samples,
            dx,
            dy,
        )
    };

    let negate = |mut grid: Vec<Vec<f64>>, factor: f64| {
        for row in grid.iter_mut() {
            for v in row.iter_mut() {
                *v *= factor;
            }
        }
        grid
    };

    Curvatures {
        xx: negate(evaluate(Derivative::Second, Derivative::Value), -1.0),
        yy: negate(evaluate(Derivative::Value, Derivative::Second), -1.0),
        // The engineering shear curvature carries the factor two, and the same
        // minus sign as the other two.
        xy: negate(evaluate(Derivative::First, Derivative::First), -2.0),
    }
}

/// Extremes and their positions.
///
/// A plain search, deliberately: `DeformationPlate.getShapes` writes
/// `if (v > max) {...} else if (v < min) {...}`, so a value that raises the
/// maximum never gets to lower the minimum, and the legend can end up with a
/// range narrower than the data.
fn summarise(
    values: Vec<Vec<f64>>,
    failure: Option<Vec<Vec<Option<FailureType>>>>,
    gaps: usize,
    input: &DeformationInput,
    samples: usize,
) -> PlateFieldResult {
    let step = (samples - 1).max(1) as f64;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut min_at = [0.0, 0.0];
    let mut max_at = [0.0, 0.0];

    for (row, line) in values.iter().enumerate() {
        for (col, value) in line.iter().enumerate() {
            if !value.is_finite() {
                continue;
            }
            let at = [
                input.length * col as f64 / step,
                input.width * row as f64 / step,
            ];
            if *value > max {
                max = *value;
                max_at = at;
            }
            if *value < min {
                min = *value;
                min_at = at;
            }
        }
    }

    // A field with nothing evaluable anywhere: report a range rather than
    // infinities the frontend would have to special-case a second time.
    if !min.is_finite() {
        min = 0.0;
        max = 0.0;
    }

    PlateFieldResult {
        values,
        min,
        max,
        min_at,
        max_at,
        failure,
        gaps,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clt::LayerPosition;
    use crate::model::{Laminate, Layer, Material};
    use crate::plate::deformation::{self, NamedLoad};
    use crate::plate::{BoundaryCondition, DMatrixKind};

    /// A single unidirectional ply: no bending-extension coupling, no
    /// bend-twist coupling, so the Navier case is clean and the sign of the
    /// answer is not an artefact of the stacking.
    fn ud_plate() -> (CltLaminate, HashMap<String, Material>) {
        let mut materials = HashMap::new();
        let mut ud = Material::new("ud", "UD", 140000.0, 9000.0, 0.3, 4600.0, 1.5e-9);
        // The reserve factor needs strengths; maximum stress needs nothing
        // beyond them, which keeps this fixture about the plate rather than
        // about one criterion's parameter set.
        ud.r_par_ten = 2000.0;
        ud.r_par_com = 1500.0;
        ud.r_nor_ten = 50.0;
        ud.r_nor_com = 170.0;
        ud.r_shear = 70.0;
        materials.insert("ud".to_string(), ud);
        let mut laminate = Laminate::new("lam", "plate");
        let mut layer = Layer::new("l0", "", "ud", 0.0, 2.0);
        layer.criterion_id = Some(crate::failure::MAX_STRESS_ID.to_string());
        laminate.layers.push(layer);
        (CltLaminate::new(&laminate, &materials).unwrap(), materials)
    }

    fn navier_input(force: f64) -> DeformationInput {
        DeformationInput {
            length: 400.0,
            width: 400.0,
            bc_x: BoundaryCondition::SimplySimply,
            bc_y: BoundaryCondition::SimplySimply,
            m: 12,
            n: 12,
            d_matrix: DMatrixKind::Standard,
            loads: vec![NamedLoad::surface("q", force)],
        }
    }

    fn field_of(
        selection: PlateFieldSelection,
        force: f64,
    ) -> PlateFieldResult {
        let (laminate, materials) = ud_plate();
        let input = navier_input(force);
        let solution = deformation::calculate(&laminate, &input).unwrap();
        let criteria = crate::failure::default_criterion_registry();
        evaluate(
            &laminate,
            &materials,
            &criteria,
            &input,
            &solution.coefficients,
            selection,
        )
        .unwrap()
    }

    fn at_centre(result: &PlateFieldResult) -> f64 {
        let mid = result.values.len() / 2;
        result.values[mid][mid]
    }

    fn selection(field: PlateField, position: LayerPosition) -> PlateFieldSelection {
        PlateFieldSelection {
            field,
            layer: 0,
            position,
            samples: 21,
        }
    }

    /// THE sign test. A simply supported plate under a constant pressure bows
    /// away from the load, and at its centre the face the load is NOT pushing
    /// on is in tension - that is textbook, and it is what fixes
    /// `kappa = -w''` rather than the raw second derivatives the Java original
    /// feeds in. With the other sign both assertions below invert.
    #[test]
    fn tension_lies_on_the_face_away_from_the_load() {
        // A positive surface load pushes along +z (see TransverseLoad::add),
        // so it acts on the underside and the upper face must be in tension.
        let up = field_of(selection(PlateField::StrainPar, LayerPosition::Upper), 0.01);
        let down = field_of(selection(PlateField::StrainPar, LayerPosition::Lower), 0.01);
        assert!(at_centre(&up) > 0.0, "upper face under a +z load must be in tension");
        assert!(at_centre(&down) < 0.0, "lower face under a +z load must be in compression");

        // Turning the load over turns the whole state over with it.
        let flipped = field_of(selection(PlateField::StrainPar, LayerPosition::Upper), -0.01);
        assert!(at_centre(&flipped) < 0.0);
        assert!((at_centre(&flipped) + at_centre(&up)).abs() < 1e-12 * at_centre(&up).abs().max(1e-12));
    }

    /// The stress must follow the strain through the ply's own stiffness -
    /// checked against a hand calculation on the Q matrix rather than against
    /// the code that produced it. For a 0 degree ply the local axes are the
    /// plate axes, so sigma_par = Q11 eps_par + Q12 eps_nor.
    #[test]
    fn stress_follows_strain_through_the_q_matrix() {
        let (_, materials) = ud_plate();
        let m = &materials["ud"];
        let nu21 = m.nue21();
        let temp = 1.0 / (1.0 - m.nue12 * nu21);
        let q11 = temp * m.e_par;
        let q12 = temp * m.e_par * nu21;

        let position = LayerPosition::Upper;
        let eps_par = at_centre(&field_of(selection(PlateField::StrainPar, position), 0.01));
        let eps_nor = at_centre(&field_of(selection(PlateField::StrainNor, position), 0.01));
        let sigma = at_centre(&field_of(selection(PlateField::StressPar, position), 0.01));

        let expected = q11 * eps_par + q12 * eps_nor;
        assert!(
            (sigma - expected).abs() < 1e-9 * expected.abs(),
            "sigma_par {sigma} should be {expected}"
        );
    }

    /// The strain is linear through the thickness and zero at the mid-plane of
    /// a single symmetric ply - the Kirchhoff assumption the whole module
    /// rests on, stated where it can fail.
    #[test]
    fn strain_is_linear_through_the_thickness() {
        let upper = at_centre(&field_of(selection(PlateField::StrainPar, LayerPosition::Upper), 0.01));
        let middle = at_centre(&field_of(selection(PlateField::StrainPar, LayerPosition::Middle), 0.01));
        let lower = at_centre(&field_of(selection(PlateField::StrainPar, LayerPosition::Lower), 0.01));
        assert!(middle.abs() < 1e-12 * upper.abs());
        assert!((upper + lower).abs() < 1e-12 * upper.abs());
    }

    /// The deflection field must be the same one the solution already carries,
    /// only sampled at the resolution the caller asked for.
    #[test]
    fn the_deflection_field_matches_the_solution() {
        let (laminate, _) = ud_plate();
        let input = navier_input(0.01);
        let solution = deformation::calculate(&laminate, &input).unwrap();
        let field = field_of(selection(PlateField::Deflection, LayerPosition::Middle), 0.01);
        // Both grids include the plate centre, at different indices.
        let mine = at_centre(&field);
        let theirs = solution.surface[solution.surface.len() / 2][solution.surface[0].len() / 2];
        assert!((mine - theirs).abs() < 1e-9 * theirs.abs());
        assert!((field.max - solution.max_deflection).abs() < 1e-6 * solution.max_deflection.abs());
    }

    /// A simply supported plate is at its most highly stressed in the middle,
    /// and the extremes have to be reported where they actually are.
    #[test]
    fn the_extreme_is_found_where_it_belongs() {
        let field = field_of(selection(PlateField::StressPar, LayerPosition::Upper), 0.01);
        assert!((field.max_at[0] - 200.0).abs() < 1e-9);
        assert!((field.max_at[1] - 200.0).abs() < 1e-9);
        // And the minimum is looked for even though the maximum was raised
        // first - the bug the Java original has here.
        assert!(field.min < field.max);
    }

    #[test]
    fn the_reserve_factor_comes_with_the_mode_that_governs() {
        let field = field_of(selection(PlateField::ReserveFactor, LayerPosition::Upper), 0.01);
        let modes = field.failure.as_ref().expect("the reserve factor names its mode");
        assert_eq!(modes.len(), field.values.len());
        // The centre is the most highly bent point, so it must have an answer
        // rather than a hole.
        let mid = field.values.len() / 2;
        assert!(modes[mid][mid].is_some());
        assert!(field.values[mid][mid].is_finite());
        assert!(field.values[mid][mid] > 0.0);

        // And the reported extremes really are the extremes of the grid. Not a
        // tautology: the original searches with `if (v > max) ... else if
        // (v < min)`, which cannot lower the minimum on a point that raised
        // the maximum. The smallest reserve is NOT at the plate centre here -
        // the twisting curvature puts the governing shear near the corners -
        // so a search that stops early lands somewhere plausible and wrong.
        let flat: Vec<f64> = field.values.iter().flatten().copied().filter(|v| v.is_finite()).collect();
        let smallest = flat.iter().copied().fold(f64::INFINITY, f64::min);
        let largest = flat.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        assert_eq!(field.min, smallest);
        assert_eq!(field.max, largest);
    }

    #[test]
    fn every_other_field_leaves_the_failure_modes_out() {
        let field = field_of(selection(PlateField::StressNor, LayerPosition::Upper), 0.01);
        assert!(field.failure.is_none());
        assert_eq!(field.gaps, 0);
    }

    #[test]
    fn a_ply_outside_the_stack_is_an_error_rather_than_a_panic() {
        let (laminate, materials) = ud_plate();
        let input = navier_input(0.01);
        let solution = deformation::calculate(&laminate, &input).unwrap();
        let criteria = crate::failure::default_criterion_registry();
        let out_of_range = PlateFieldSelection {
            field: PlateField::StrainPar,
            layer: 7,
            position: LayerPosition::Upper,
            samples: 21,
        };
        let error = evaluate(
            &laminate,
            &materials,
            &criteria,
            &input,
            &solution.coefficients,
            out_of_range,
        )
        .unwrap_err();
        assert_eq!(error, PlateFieldError::LayerOutOfRange { layer: 7, layers: 1 });
    }

    #[test]
    fn the_grid_resolution_is_bounded_at_both_ends() {
        let (laminate, materials) = ud_plate();
        let input = navier_input(0.01);
        let solution = deformation::calculate(&laminate, &input).unwrap();
        let criteria = crate::failure::default_criterion_registry();
        for samples in [0, 1, MAX_SAMPLES + 1] {
            let selection = PlateFieldSelection {
                field: PlateField::Deflection,
                layer: 0,
                position: LayerPosition::Middle,
                samples,
            };
            assert!(evaluate(
                &laminate,
                &materials,
                &criteria,
                &input,
                &solution.coefficients,
                selection
            )
            .is_err());
        }
    }
}
