//! The failure body: a criterion's failure surface in the ply's own stress
//! space, sampled as a quad grid.
//! Reference: eLamX2/Laminate/src/de/elamx/laminate/failure/Criterion.java
//! (`getAsMesh`), rendered there by the FailureCriterionView3D module.
//!
//! What it is, and why it is worth drawing: a failure criterion is a scalar
//! verdict, and a reserve factor of 0.8 says a ply fails without saying *how
//! close to which mechanism* it is. The surface makes that visible - it is the
//! set of stress states the criterion calls "exactly failing", and a ply's own
//! stress state sits either inside it (safe) or outside it (failed), in a
//! direction that names the mechanism.
//!
//! Construction, following the original exactly: rays are shot from the origin
//! in every direction of an ellipsoid scaled to the material's strengths, and
//! each ray's stress state is scaled by its own reserve factor. That lands
//! every sample exactly on the surface, because scaling a stress state by its
//! reserve factor is what "reserve factor" means - and it makes the body
//! star-shaped about the origin, which is what lets a painter's-algorithm
//! renderer draw it without a depth buffer.

use super::{Criterion, CriterionError};
use crate::mathtools;
use crate::model::{Material, StressStrainState};
use serde::Serialize;

/// A sampled failure surface. `points[i][j]` is the surface point for polar
/// angle i and azimuth j, in the local system `[sigma_par, sigma_nor, tau]`.
///
/// `None` marks a direction the criterion could not evaluate (its equations
/// produced an undefined result there). The original throws in that case and
/// loses the whole body; keeping the hole lets the rest still be drawn.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct FailureEnvelope {
    pub points: Vec<Vec<Option<[f64; 3]>>>,
    /// Number of polar (theta) and azimuthal (phi) samples - the grid's shape,
    /// repeated here so a consumer need not measure it.
    pub polar_samples: usize,
    pub azimuth_samples: usize,
}

/// Quality 1.0 gives the Java default of 30 azimuth samples; the polar
/// direction always gets twice as many, as in the original.
pub const DEFAULT_QUALITY: f64 = 1.0;

/// Samples `criterion`'s failure surface for `material`.
///
/// `quality` scales the sample count exactly as the Java slider does:
/// `azimuth = 30 * quality`, `polar = 2 * azimuth`. The cost is one criterion
/// evaluation per grid point, so quality 1.0 is 1800 of them - fast enough to
/// recompute whenever the material changes.
pub fn failure_envelope(
    criterion: &dyn Criterion,
    material: &Material,
    quality: f64,
) -> Result<FailureEnvelope, CriterionError> {
    let azimuth_samples = ((quality * 30.0).round() as usize).max(4);
    let polar_samples = 2 * azimuth_samples;

    // The unit sphere is stretched into the box the strengths span: the fibre
    // axis is offset by transverse tension/compression asymmetry, the other two
    // share one scale. This only decides where the samples sit - the reserve
    // factor then moves each one onto the surface - but a sphere shaped like
    // the material keeps the samples evenly spread over the real body.
    let scale_par = (material.r_par_ten + material.r_par_com) / 2.0;
    let offset_par = (material.r_par_ten - material.r_par_com) / 2.0;
    let scale_nor = (material.r_nor_ten + material.r_nor_com + material.r_shear) / 3.0;

    let compliance = local_compliance(material);

    let delta_theta = std::f64::consts::PI / (polar_samples - 1) as f64;
    let delta_phi = 2.0 * std::f64::consts::PI / (azimuth_samples - 1) as f64;

    // A criterion that cannot evaluate ONE direction leaves a hole; one that
    // cannot evaluate ANY is not missing a bit of surface, it is misconfigured
    // (a material without Puck's parameters, say), and that has to be reported
    // rather than drawn as an empty body.
    let mut first_error: Option<CriterionError> = None;
    let mut evaluated = 0usize;

    let mut points = Vec::with_capacity(polar_samples);
    for i in 0..polar_samples {
        let theta = i as f64 * delta_theta;
        let x = theta.cos() * scale_par + offset_par;
        let ring = theta.sin();

        let mut row = Vec::with_capacity(azimuth_samples);
        for j in 0..azimuth_samples {
            let phi = j as f64 * delta_phi;
            let y = ring * phi.cos() * scale_nor;
            let z = ring * phi.sin() * scale_nor;

            let stress = [x, y, z];
            let strain = mathtools::mat_vec_mult(&compliance, &stress);
            let state = StressStrainState {
                stress,
                strain: [strain[0], strain[1], strain[2]],
            };

            // No layer context: the body belongs to the material and its
            // criterion, not to a ply at an angle. That matches the original,
            // which passes null here.
            row.push(match criterion.reserve_factor(material, None, &state) {
                Ok(rf) => {
                    let factor = rf.minimal_reserve_factor;
                    if factor.is_finite() {
                        evaluated += 1;
                        Some([x * factor, y * factor, z * factor])
                    } else {
                        None
                    }
                }
                Err(e) => {
                    first_error.get_or_insert(e);
                    None
                }
            });
        }
        points.push(row);
    }

    if evaluated == 0 {
        return Err(first_error.unwrap_or_else(|| {
            CriterionError("the criterion produced no finite reserve factor anywhere".into())
        }));
    }

    Ok(FailureEnvelope {
        points,
        polar_samples,
        azimuth_samples,
    })
}

/// The ply's compliance in its own system, so a sampled stress state carries
/// the matching strain - the criteria that read strain (MaxStrain) need it.
fn local_compliance(material: &Material) -> mathtools::Matrix {
    let nue21 = material.nue21();
    let factor = 1.0 / (1.0 - material.nue12 * nue21);
    let q = vec![
        vec![factor * material.e_par, factor * material.e_par * nue21, 0.0],
        vec![factor * material.e_par * nue21, factor * material.e_nor, 0.0],
        vec![0.0, 0.0, material.g],
    ];
    mathtools::get_inverse(&q)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::{default_criterion_registry, MAX_STRESS_ID, PUCK_ID};

    fn material() -> Material {
        let mut m = Material::new("mat", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m.additional_values = crate::failure::default_additional_values();
        m
    }

    fn envelope(id: &str) -> FailureEnvelope {
        let registry = default_criterion_registry();
        failure_envelope(registry[id].as_ref(), &material(), 0.5).expect("envelope")
    }

    #[test]
    fn the_grid_has_the_shape_the_quality_asks_for() {
        let e = envelope(MAX_STRESS_ID);
        assert_eq!(e.azimuth_samples, 15);
        assert_eq!(e.polar_samples, 30);
        assert_eq!(e.points.len(), e.polar_samples);
        assert!(e.points.iter().all(|row| row.len() == e.azimuth_samples));
    }

    /// The defining property: every sampled point is a stress state the
    /// criterion calls exactly failing, so evaluating it again must give a
    /// reserve factor of 1.
    #[test]
    fn every_point_sits_on_the_failure_surface() {
        let registry = default_criterion_registry();
        let material = material();
        for id in [MAX_STRESS_ID, PUCK_ID, "tsai_wu", "hashin"] {
            let criterion = registry[id].as_ref();
            let e = failure_envelope(criterion, &material, 0.4).expect("envelope");
            let compliance = local_compliance(&material);

            for row in &e.points {
                for point in row.iter().flatten() {
                    let strain = mathtools::mat_vec_mult(&compliance, point);
                    let state = StressStrainState {
                        stress: *point,
                        strain: [strain[0], strain[1], strain[2]],
                    };
                    let rf = criterion
                        .reserve_factor(&material, None, &state)
                        .expect("a point on the surface is evaluable")
                        .minimal_reserve_factor;
                    assert!(
                        (rf - 1.0).abs() < 1e-6,
                        "{id}: point {point:?} has RF {rf}, expected 1"
                    );
                }
            }
        }
    }

    /// The uniaxial poles are the strengths themselves - the one place where
    /// the surface has an answer everybody can check by hand.
    #[test]
    fn the_fibre_direction_poles_are_the_fibre_strengths() {
        let e = envelope(MAX_STRESS_ID);
        let first = e.points[0][0].expect("theta = 0 is evaluable");
        let last = e.points[e.polar_samples - 1][0].expect("theta = pi is evaluable");

        assert!((first[0] - 2000.0).abs() < 1e-6, "tension pole: {first:?}");
        assert!((last[0] + 1200.0).abs() < 1e-6, "compression pole: {last:?}");
        for k in [1, 2] {
            assert!(first[k].abs() < 1e-9);
            assert!(last[k].abs() < 1e-9);
        }
    }

    /// A criterion that cannot evaluate a direction leaves a hole rather than
    /// taking the whole body down with it.
    /// A material without the parameters its criterion needs is a
    /// configuration error, not a body with holes in it.
    #[test]
    fn a_criterion_that_can_evaluate_nothing_is_an_error() {
        let registry = default_criterion_registry();
        let mut bare = material();
        bare.additional_values.clear();
        assert!(failure_envelope(registry[PUCK_ID].as_ref(), &bare, 0.4).is_err());
    }

    #[test]
    fn an_unevaluable_direction_becomes_a_hole() {
        struct Refuses;
        impl Criterion for Refuses {
            fn reserve_factor(
                &self,
                _material: &Material,
                _context: Option<&super::super::LayerContext>,
                state: &StressStrainState,
            ) -> Result<super::super::ReserveFactor, CriterionError> {
                if state.stress[0] > 0.0 {
                    return Err(CriterionError("nope".into()));
                }
                Ok(super::super::ReserveFactor {
                    failure_name: "x".into(),
                    minimal_reserve_factor: 1.0,
                    failure_type: super::super::FailureType::FiberFailure,
                })
            }
        }

        let e = failure_envelope(&Refuses, &material(), 0.4).expect("envelope");
        let holes = e.points.iter().flatten().filter(|p| p.is_none()).count();
        let filled = e.points.iter().flatten().filter(|p| p.is_some()).count();
        assert!(holes > 0 && filled > 0, "{holes} holes, {filled} points");
    }
}
