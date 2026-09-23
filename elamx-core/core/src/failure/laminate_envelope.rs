//! The failure surface of a whole LAMINATE, in load space.
//!
//! Reference: eLamX2/LaminateFailureBody/src/de/elamx/laminatfailurebody/PlyFailureCriterion.java
//!
//! The material failure body in `envelope` answers "which stress states does
//! this criterion call failure, for one ply". This answers the question a
//! designer actually has: **which load flows can this stacking sequence
//! carry?** The surface lives in (n_x, n_y, n_xy), and every point on it is a
//! load the laminate fails at.
//!
//! Two failure definitions, as in the original:
//!
//! - `FirstPly` stops at the first ply to fail, in any mode. Conservative, and
//!   the surface a certification case is usually argued against.
//! - `Final` keeps going: a ply that fails between the fibres has its
//!   transverse and shear stiffness set to zero, the laminate is reassembled
//!   without it, and the load is pushed further. It stops at the first FIBRE
//!   failure, or when every ply has failed between the fibres. The reported
//!   load is the largest the laminate carried anywhere along that path.
//!
//! The degradation is a hard zero here, not the small factor
//! `clt::last_ply_failure` uses - two modules of the original, two conventions,
//! and this one follows its own.
//!
//! One thing this module does NOT reproduce: the last-ply-failure module's
//! quirk of evaluating criteria with their registered defaults instead of the
//! material's own parameters (see `clt::last_ply_failure`). That is a bug in
//! *that* Java file, `CLT_Calculator.getAsDefaultMaterial`; the copy here
//! reads the source material, so a material's own Puck parameters do reach the
//! criterion.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::clt::{CltLaminate, LayerPosition};
use crate::failure::{Criterion, FailureType, LayerContext};
use crate::mathtools::Matrix;
use crate::model::{Laminate, Layer, Material};

/// Which failure the surface is drawn for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum LaminateFailureKind {
    /// The first ply to fail, in any mode.
    FirstPly,
    /// The last one: inter-fibre failures degrade and the load goes on.
    Final,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LaminateEnvelopeInput {
    pub kind: LaminateFailureKind,
    /// Steps around the two sweep angles. The Java uses 200 each, which is
    /// 40 401 directions and, for a sixteen-ply stack, over a million
    /// criterion evaluations - fine for a desktop thread, not for a browser
    /// that recomputes on a keystroke. The caller picks.
    pub alpha_steps: usize,
    pub beta_steps: usize,
}

impl Default for LaminateEnvelopeInput {
    fn default() -> Self {
        LaminateEnvelopeInput {
            kind: LaminateFailureKind::FirstPly,
            alpha_steps: 60,
            beta_steps: 120,
        }
    }
}

/// One direction's result.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LaminateEnvelopePoint {
    /// The load flows the laminate fails at: [n_x, n_y, n_xy] in N/mm.
    pub load: [f64; 3],
    /// Stacking-order index of the ply that governed, or `None` where the
    /// direction could not be evaluated at all.
    pub layer: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LaminateEnvelope {
    /// Rows over alpha (-pi/2 .. pi/2), columns over beta (0 .. 2 pi), so the
    /// grid closes on itself in the column direction and is a cap at each end
    /// of the row direction.
    pub points: Vec<Vec<LaminateEnvelopePoint>>,
    /// Largest absolute load component anywhere on the surface, in N/mm.
    pub peak: f64,
    /// Where the surface crosses each axis: n_x max/min, n_y max/min,
    /// n_xy max/min. The six numbers a reader wants without rotating anything.
    pub axis_intersections: [f64; 6],
}

#[derive(Debug, Clone, PartialEq)]
pub enum LaminateEnvelopeError {
    NoLayers,
    MissingMaterial(String),
    MissingCriterion(String),
    /// Fewer than two steps in a direction leaves no surface to draw.
    ResolutionTooLow { alpha_steps: usize, beta_steps: usize },
    /// A ray was asked for through the origin, which has no direction.
    ZeroLoad,
}

impl std::fmt::Display for LaminateEnvelopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LaminateEnvelopeError::NoLayers => write!(f, "the laminate has no layers"),
            LaminateEnvelopeError::MissingMaterial(id) => write!(f, "unknown material '{id}'"),
            LaminateEnvelopeError::MissingCriterion(id) => write!(f, "unknown criterion '{id}'"),
            LaminateEnvelopeError::ResolutionTooLow { alpha_steps, beta_steps } => write!(
                f,
                "alpha_steps={alpha_steps}, beta_steps={beta_steps}: both must be at least 2"
            ),
            LaminateEnvelopeError::ZeroLoad => write!(f, "the load is zero and has no direction"),
        }
    }
}

impl std::error::Error for LaminateEnvelopeError {}

/// How close to the governing reserve factor a ply has to be to count as
/// failing in the same step. The Java's own tolerance.
const EPS: f64 = 1.0e-8;
/// Below this on the ABD diagonal the laminate has stopped being one.
const EPS_ZERO: f64 = 1.0e-14;

pub fn laminate_envelope(
    laminate: &Laminate,
    materials: &HashMap<String, Material>,
    criteria: &HashMap<String, Box<dyn Criterion>>,
    input: &LaminateEnvelopeInput,
) -> Result<LaminateEnvelope, LaminateEnvelopeError> {
    if input.alpha_steps < 2 || input.beta_steps < 2 {
        return Err(LaminateEnvelopeError::ResolutionTooLow {
            alpha_steps: input.alpha_steps,
            beta_steps: input.beta_steps,
        });
    }

    let (working, working_materials) = expand(laminate, materials)?;
    let ply_count = working.layers.len();

    let alpha_start = -std::f64::consts::FRAC_PI_2;
    let d_alpha = std::f64::consts::PI / input.alpha_steps as f64;
    let d_beta = 2.0 * std::f64::consts::PI / input.beta_steps as f64;

    let mut points = Vec::with_capacity(input.alpha_steps + 1);
    let mut peak = 0.0f64;

    // Reused across directions: for `Final` the stack is degraded and restored
    // per direction, so the materials are cloned once and reset each time.
    let mut degraded = working_materials.clone();

    for i in 0..=input.alpha_steps {
        let alpha = alpha_start + d_alpha * i as f64;
        let (sin_alpha, cos_alpha) = alpha.sin_cos();
        let mut row = Vec::with_capacity(input.beta_steps + 1);

        for j in 0..=input.beta_steps {
            let beta = d_beta * j as f64;
            let direction = [sin_alpha, beta.sin() * cos_alpha, beta.cos() * cos_alpha];

            let point = along(
                &working,
                &working_materials,
                &mut degraded,
                criteria,
                direction,
                input.kind,
                ply_count,
            )?
            .point();

            for value in point.load {
                peak = peak.max(value.abs());
            }
            row.push(point);
        }
        points.push(row);
    }

    // The six axis crossings, at the grid positions the original reads them
    // from: alpha = +/- pi/2 point along n_x, and the beta quarters at
    // alpha = 0 along n_y and n_xy.
    let (a, b) = (input.alpha_steps, input.beta_steps);
    let axis_intersections = [
        points[a][0].load[0],
        points[0][0].load[0],
        points[a / 2][b / 4].load[1],
        points[a / 2][3 * b / 4].load[1],
        points[a / 2][0].load[2],
        points[a / 2][b / 2].load[2],
    ];

    Ok(LaminateEnvelope { points, peak, axis_intersections })
}

/// One load case on the failure surface (F2.4): how far its in-plane load
/// can be scaled before the laminate fails, and where the ray from the origin
/// through the load meets the surface.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LaminateEnvelopeRay {
    /// The load factor: `failure_load = rf * load`. For `FirstPly` it is the
    /// laminate's smallest ply reserve factor under that load; for `Final`
    /// the largest load factor reached along the degradation path.
    pub rf: f64,
    /// The point on the surface, [n_x, n_y, n_xy] in N/mm.
    pub failure_load: [f64; 3],
    /// Stacking-order index of the ply that governed, as in
    /// [`LaminateEnvelopePoint::layer`].
    pub layer: Option<usize>,
    /// How that ply failed at the reported point.
    pub failure_type: FailureType,
}

/// The ray through one in-plane load: the same search a grid point of
/// [`laminate_envelope`] runs, in the load's own direction instead of a grid
/// direction, so the marker and the surface drawn around it agree.
///
/// `load` is [n_x, n_y, n_xy]. A zero load has no direction and is reported
/// as `ZeroLoad`; the surface lives in the membrane space only, so moments or
/// prescribed strains are the caller's to refuse (see the module
/// documentation).
pub fn laminate_rf_along(
    laminate: &Laminate,
    materials: &HashMap<String, Material>,
    criteria: &HashMap<String, Box<dyn Criterion>>,
    kind: LaminateFailureKind,
    load: [f64; 3],
) -> Result<LaminateEnvelopeRay, LaminateEnvelopeError> {
    if load.iter().all(|v| *v == 0.0) {
        return Err(LaminateEnvelopeError::ZeroLoad);
    }
    let (working, working_materials) = expand(laminate, materials)?;
    let ply_count = working.layers.len();
    let mut degraded = working_materials.clone();
    let reach = along(&working, &working_materials, &mut degraded, criteria, load, kind, ply_count)?;
    Ok(LaminateEnvelopeRay {
        rf: reach.factor,
        failure_load: reach.load,
        layer: reach.layer,
        failure_type: reach.failure_type,
    })
}

/// How far one direction reaches: the factor on the direction vector, the
/// load it gives, and which ply governed how.
struct Reach {
    factor: f64,
    load: [f64; 3],
    layer: Option<usize>,
    failure_type: FailureType,
}

impl Reach {
    fn point(self) -> LaminateEnvelopePoint {
        LaminateEnvelopePoint { load: self.load, layer: self.layer }
    }
}

/// Pushes the load along one direction until the laminate fails.
///
/// A note for whoever next finds the numbers suspiciously round: they are.
/// Once every ply but one has been degraded, the survivor carries the whole
/// load flow, so its MEAN stress is exactly `n / t` - and with a round
/// thickness that makes the failure load round too. It is equilibrium, not a
/// clamp. The surface also stops responding to the fibre modulus for the same
/// reason: a max-stress fibre failure happens at `eps = R / E`, and the load
/// is `A eps = (E t)(R / E) = R t`, with E cancelling out.
#[allow(clippy::too_many_arguments)]
fn along(
    working: &Laminate,
    pristine: &HashMap<String, Material>,
    degraded: &mut HashMap<String, Material>,
    criteria: &HashMap<String, Box<dyn Criterion>>,
    direction: [f64; 3],
    kind: LaminateFailureKind,
    ply_count: usize,
) -> Result<Reach, LaminateEnvelopeError> {
    // Everything starts from the undamaged stack.
    for (id, material) in pristine {
        degraded.insert(id.clone(), material.clone());
    }

    let mut broken = vec![false; ply_count];
    let mut broken_count = 0usize;
    let mut best = 0.0f64;
    let mut best_layer: Option<usize> = None;
    let mut best_type = FailureType::Undamaged;
    let mut load = [0.0; 3];

    loop {
        let clt = CltLaminate::new(working, degraded)
            .map_err(|e| LaminateEnvelopeError::MissingMaterial(e.to_string()))?;
        if !abd_is_usable(clt.abd_matrix()) {
            break;
        }
        let abd_inv = clt.abd_inv_matrix();

        // Strains from a purely in-plane load: only the first three columns of
        // the inverse are touched, because the moment half of the load is zero.
        let mut strains = [0.0f64; 6];
        for (m, strain) in strains.iter_mut().enumerate() {
            for (n, component) in direction.iter().enumerate() {
                *strain += abd_inv[m][n] * component;
            }
        }

        let mut governing = f64::MAX;
        let mut governing_layer = 0usize;
        let mut governing_type = FailureType::Undamaged;
        let mut per_ply = vec![(f64::MAX, FailureType::Undamaged); ply_count];

        for (index, layer) in clt.layers().iter().enumerate() {
            let criterion_id = layer
                .criterion_id()
                .ok_or_else(|| LaminateEnvelopeError::MissingCriterion(String::new()))?;
            // The ply's whole list, primary first: the minimum over it is the
            // ply's reserve factor, a tie going to the earlier criterion.
            let ply_criteria = layer
                .criterion_ids(criterion_id)
                .into_iter()
                .map(|id| {
                    criteria
                        .get(id)
                        .ok_or_else(|| LaminateEnvelopeError::MissingCriterion(id.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let material = degraded
                .get(layer.material_id())
                .ok_or_else(|| LaminateEnvelopeError::MissingMaterial(layer.material_id().into()))?;

            let context = LayerContext { angle_deg: layer.angle_deg, embedded: layer.embedded };
            let mut worst = f64::MAX;
            let mut worst_type = FailureType::Undamaged;
            for position in [LayerPosition::Lower, LayerPosition::Upper] {
                let (state, _) = layer.stress_state(&strains, 0.0, 0.0, position, false);
                for criterion in &ply_criteria {
                    let rf = criterion
                        .reserve_factor(material, Some(&context), &state)
                        .map_err(|e| LaminateEnvelopeError::MissingCriterion(e.to_string()))?;
                    if rf.minimal_reserve_factor < worst {
                        worst = rf.minimal_reserve_factor;
                        worst_type = rf.failure_type;
                    }
                }
            }
            per_ply[index] = (worst, worst_type);
            if worst < governing {
                governing = worst;
                governing_layer = index;
                governing_type = worst_type;
            }
        }

        if governing > best {
            best = governing;
            best_layer = Some(governing_layer);
            best_type = governing_type;
            load = [
                governing * direction[0],
                governing * direction[1],
                governing * direction[2],
            ];
        }

        if kind == LaminateFailureKind::FirstPly {
            break;
        }

        // Every ply at (or within EPS of) the governing factor fails in this
        // step - several can go at once, which is why this is a loop and not
        // a single index.
        let mut fibre_failure = false;
        for (index, (rf, failure)) in per_ply.iter().enumerate() {
            if governing * (1.0 + EPS) <= *rf {
                continue;
            }
            match failure {
                FailureType::FiberFailure => {
                    fibre_failure = true;
                    break;
                }
                FailureType::MatrixFailure if !broken[index] => {
                    broken[index] = true;
                    broken_count += 1;
                    if let Some(material) = degraded.get_mut(&material_id(index)) {
                        // The original's degradation: the transverse and shear
                        // stiffness simply go, and only the fibre direction is
                        // left carrying load.
                        material.e_nor = 0.0;
                        material.nue12 = 0.0;
                        material.g = 0.0;
                    }
                }
                _ => {}
            }
        }

        if fibre_failure || broken_count == ply_count {
            break;
        }
    }

    Ok(Reach { factor: best, load, layer: best_layer, failure_type: best_type })
}

/// Whether the ABD matrix still describes a laminate. A stack whose plies have
/// all lost their transverse stiffness has near-zero entries on the diagonal,
/// and inverting it would produce numbers rather than an answer.
fn abd_is_usable(abd: &Matrix) -> bool {
    (0..6).all(|i| abd[i][i].abs() >= EPS_ZERO)
}

fn material_id(index: usize) -> String {
    format!("lfb-{index}")
}

/// The fully expanded stack as plain layers, each with a material of its own so
/// that degrading one ply does not degrade every ply sharing its material.
///
/// The copies carry the stiffnesses, the strengths and - unlike the
/// last-ply-failure module's - the material's OWN criterion parameters, which
/// is what the Java does here.
fn expand(
    laminate: &Laminate,
    materials: &HashMap<String, Material>,
) -> Result<(Laminate, HashMap<String, Material>), LaminateEnvelopeError> {
    let resolved = laminate.all_layers();
    if resolved.is_empty() {
        return Err(LaminateEnvelopeError::NoLayers);
    }

    let mut working = Laminate::new("lfb", "");
    let mut working_materials = HashMap::with_capacity(resolved.len());

    for (index, ply) in resolved.iter().enumerate() {
        let source = materials
            .get(ply.material_id)
            .ok_or_else(|| LaminateEnvelopeError::MissingMaterial(ply.material_id.to_string()))?;

        let id = material_id(index);
        let mut material = Material::new(
            id.clone(),
            "",
            source.e_par,
            source.e_nor,
            source.nue12,
            source.g,
            0.0,
        );
        material.r_par_ten = source.r_par_ten;
        material.set_r_par_com(source.r_par_com);
        material.r_nor_ten = source.r_nor_ten;
        material.set_r_nor_com(source.r_nor_com);
        material.set_r_shear(source.r_shear);
        material.additional_values = source.additional_values.clone();
        working_materials.insert(id.clone(), material);

        let mut layer = Layer::new("", "", id, ply.angle, ply.thickness);
        layer.criterion_id = ply.criterion_id.map(str::to_string);
        layer.extra_criteria = ply.extra_criteria.to_vec();
        working.layers.push(layer);
    }

    Ok((working, working_materials))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::{default_criterion_registry, MAX_STRESS_ID};

    fn material() -> Material {
        let mut m = Material::new("m", "m", 141000.0, 9340.0, 0.35, 4500.0, 1.7e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 60.0;
        m.set_r_nor_com(200.0);
        m.set_r_shear(90.0);
        m
    }

    fn stack(angles: &[f64]) -> (Laminate, HashMap<String, Material>) {
        let mut materials = HashMap::new();
        materials.insert("m".to_string(), material());
        let mut laminate = Laminate::new("l", "l");
        for (index, angle) in angles.iter().enumerate() {
            let mut layer = Layer::new(format!("l{index}"), "", "m", *angle, 0.125);
            layer.criterion_id = Some(MAX_STRESS_ID.to_string());
            laminate.layers.push(layer);
        }
        (laminate, materials)
    }

    fn run(angles: &[f64], kind: LaminateFailureKind) -> LaminateEnvelope {
        let (laminate, materials) = stack(angles);
        laminate_envelope(
            &laminate,
            &materials,
            &default_criterion_registry(),
            &LaminateEnvelopeInput { kind, alpha_steps: 24, beta_steps: 48 },
        )
        .unwrap()
    }

    #[test]
    fn the_grid_has_the_shape_the_sweep_describes() {
        let envelope = run(&[0.0, 90.0, 90.0, 0.0], LaminateFailureKind::FirstPly);
        assert_eq!(envelope.points.len(), 25);
        assert_eq!(envelope.points[0].len(), 49);
        // Beta closes on itself, so the last column repeats the first.
        for row in &envelope.points {
            for k in 0..3 {
                assert!((row[0].load[k] - row[48].load[k]).abs() < 1e-6 * envelope.peak.max(1.0));
            }
        }
    }

    /// Every point is a load the laminate fails at, so scaling it back must
    /// bring the reserve factor to one. Checked on the axis crossings, where
    /// the load is a single component and the answer can be reasoned about.
    #[test]
    fn a_point_on_the_surface_is_a_load_that_just_fails() {
        use crate::clt::{determine_values, get_layer_results, Loads};

        let (laminate, materials) = stack(&[0.0, 90.0, 90.0, 0.0]);
        let clt = CltLaminate::new(&laminate, &materials).unwrap();
        let envelope = run(&[0.0, 90.0, 90.0, 0.0], LaminateFailureKind::FirstPly);
        let registry = default_criterion_registry();

        // The tension-side n_x crossing.
        let n_x = envelope.axis_intersections[0].max(envelope.axis_intersections[1]);
        assert!(n_x > 0.0);

        let mut loads = Loads { n_x, ..Default::default() };
        let mut strains = Default::default();
        determine_values(&clt, &mut loads, &mut strains, &[false; 6]);
        let results =
            get_layer_results(&clt, &loads, &strains, &materials, &registry).unwrap();
        let worst = results
            .iter()
            .flat_map(|r| [r.rr_lower.minimal_reserve_factor, r.rr_upper.minimal_reserve_factor])
            .fold(f64::MAX, f64::min);
        assert!(
            (worst - 1.0).abs() < 0.02,
            "a load taken off the surface should have RF = 1, got {worst}"
        );
    }

    /// A cross-ply carries far more along the fibres than across them at 45
    /// degrees - the surface must not come out round.
    #[test]
    fn the_surface_knows_which_way_the_fibres_run() {
        let envelope = run(&[0.0, 0.0, 0.0, 0.0], LaminateFailureKind::FirstPly);
        let n_x = envelope.axis_intersections[0].abs().max(envelope.axis_intersections[1].abs());
        let n_y = envelope.axis_intersections[2].abs().max(envelope.axis_intersections[3].abs());
        assert!(n_x > 5.0 * n_y, "unidirectional stack: n_x {n_x} vs n_y {n_y}");
    }

    /// Final failure can only be reached at or beyond first-ply failure: the
    /// path starts there and the reported load is the largest along it.
    #[test]
    fn final_failure_never_reports_less_than_first_ply_failure() {
        let first = run(&[0.0, 45.0, -45.0, 90.0], LaminateFailureKind::FirstPly);
        let last = run(&[0.0, 45.0, -45.0, 90.0], LaminateFailureKind::Final);
        assert_eq!(first.points.len(), last.points.len());

        let mut strictly_larger = 0;
        for (row_first, row_last) in first.points.iter().zip(&last.points) {
            for (a, b) in row_first.iter().zip(row_last) {
                let ra = (a.load[0].powi(2) + a.load[1].powi(2) + a.load[2].powi(2)).sqrt();
                let rb = (b.load[0].powi(2) + b.load[1].powi(2) + b.load[2].powi(2)).sqrt();
                assert!(rb >= ra * (1.0 - 1e-9), "final {rb} below first-ply {ra}");
                if rb > ra * 1.01 {
                    strictly_larger += 1;
                }
            }
        }
        // And it is not merely the same surface under another name.
        assert!(strictly_larger > 0, "final failure never exceeded first-ply failure");
    }

    #[test]
    fn rejects_degenerate_input() {
        let (laminate, materials) = stack(&[0.0]);
        let registry = default_criterion_registry();
        assert!(matches!(
            laminate_envelope(
                &laminate,
                &materials,
                &registry,
                &LaminateEnvelopeInput { alpha_steps: 1, beta_steps: 4, ..Default::default() }
            ),
            Err(LaminateEnvelopeError::ResolutionTooLow { .. })
        ));

        let empty = Laminate::new("e", "e");
        assert!(matches!(
            laminate_envelope(&empty, &materials, &registry, &LaminateEnvelopeInput::default()),
            Err(LaminateEnvelopeError::NoLayers)
        ));
    }

    /// The ray through a load meets the surface where the grid does: along a
    /// grid direction, scaled to any length, it reports that grid point.
    #[test]
    fn the_ray_meets_the_surface_where_the_grid_point_is() {
        let angles = [0.0, 45.0, -45.0, 90.0];
        let (laminate, materials) = stack(&angles);
        let registry = default_criterion_registry();
        for kind in [LaminateFailureKind::FirstPly, LaminateFailureKind::Final] {
            let input = LaminateEnvelopeInput { kind, alpha_steps: 12, beta_steps: 24 };
            let envelope = laminate_envelope(&laminate, &materials, &registry, &input).unwrap();
            let d_alpha = std::f64::consts::PI / 12.0;
            let d_beta = 2.0 * std::f64::consts::PI / 24.0;
            for (i, j) in [(6, 0), (6, 6), (3, 5), (9, 17), (2, 11)] {
                let alpha = -std::f64::consts::FRAC_PI_2 + d_alpha * i as f64;
                let beta = d_beta * j as f64;
                let unit = [alpha.sin(), beta.sin() * alpha.cos(), beta.cos() * alpha.cos()];
                let scale = 137.0;
                let load = [unit[0] * scale, unit[1] * scale, unit[2] * scale];
                let ray = laminate_rf_along(&laminate, &materials, &registry, kind, load).unwrap();
                let point = envelope.points[i][j];
                let tolerance = 1e-9 * envelope.peak;
                for ((on_ray, on_grid), applied) in ray.failure_load.iter().zip(point.load).zip(load) {
                    assert!(
                        (on_ray - on_grid).abs() < tolerance,
                        "{kind:?} ({i},{j}): {on_ray} vs {on_grid}"
                    );
                    assert!((ray.rf * applied - on_ray).abs() < tolerance);
                }
                assert_eq!(ray.layer, point.layer);
            }
        }
    }

    /// First-ply failure is linear in the load, so the ray's factor is the
    /// laminate's smallest reserve factor under that load - checked against
    /// the ordinary ply-by-ply analysis, a different code path.
    #[test]
    fn the_first_ply_ray_factor_is_the_smallest_ply_reserve_factor() {
        use crate::clt::{determine_values, get_layer_results, Loads};
        let (laminate, materials) = stack(&[0.0, 45.0, -45.0, 90.0, 90.0, -45.0, 45.0, 0.0]);
        let registry = default_criterion_registry();
        let clt = CltLaminate::new(&laminate, &materials).unwrap();
        for load in [[120.0, -30.0, 15.0], [-80.0, 60.0, 0.0], [0.0, 0.0, 45.0]] {
            let ray = laminate_rf_along(&laminate, &materials, &registry, LaminateFailureKind::FirstPly, load)
                .unwrap();
            let mut loads = Loads { n_x: load[0], n_y: load[1], n_xy: load[2], ..Default::default() };
            let mut strains = Default::default();
            determine_values(&clt, &mut loads, &mut strains, &[false; 6]);
            let results = get_layer_results(&clt, &loads, &strains, &materials, &registry).unwrap();
            let (worst, worst_type) = results
                .iter()
                .flat_map(|r| [&r.rr_lower, &r.rr_upper])
                .fold((f64::MAX, FailureType::Undamaged), |acc, rf| {
                    if rf.minimal_reserve_factor < acc.0 { (rf.minimal_reserve_factor, rf.failure_type) } else { acc }
                });
            assert!((ray.rf - worst).abs() < 1e-9 * worst, "{load:?}: {} vs {worst}", ray.rf);
            assert_eq!(ray.failure_type, worst_type);
        }
        assert_eq!(
            laminate_rf_along(&laminate, &materials, &registry, LaminateFailureKind::FirstPly, [0.0; 3]),
            Err(LaminateEnvelopeError::ZeroLoad)
        );
    }
}
