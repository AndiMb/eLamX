//! Spring-in of an angled part: how far a corner closes when it comes off the tool.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Spring-In/ and
//! eLamX2/AdditionalSpringInModels/
//!
//! A laminate cured over an angled tool does not keep the tool's angle. It
//! shrinks more through its thickness than along its fibres - both while
//! cooling from the cure temperature and while the resin cures - and at a bend
//! that difference has nowhere to go but into the angle. The part comes off
//! measurably sharper than the tool, which is why tools are cut with a
//! deliberate overbend.
//!
//! Radford's model puts a number on it from two coefficients and a temperature
//! drop, with no finite elements anywhere:
//!
//! ```text
//!     d_phi / phi = (a_circ - a_thick) dT / (1 + a_thick dT)
//! ```
//!
//! and the enhanced version adds the same expression built from the cure
//! shrinkage strains instead of the thermal ones. That is the whole module -
//! everything else here is about which numbers go in and what comes out.
//!
//! `a_circ` is not typed in: it is the laminate's own thermal expansion
//! coefficient in the direction that runs around the bend, which the CLT
//! already knows. `a_thick` is, because classical laminate theory is a plane
//! stress theory and has nothing to say about the thickness direction.

use serde::{Deserialize, Serialize};

use crate::clt::{alpha_global, CltLaminate};

/// Which Radford model to evaluate.
///
/// The Java has these as two Lookup services with reflected property sheets;
/// here they are one enum, for the reason given in `plate::stiffener`: the
/// choice has to survive a round trip through JSON and through the `.elamx`
/// file, and an enum says what the alternatives are.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "model", rename_all = "snake_case")]
pub enum SpringInModel {
    /// Thermal contraction only.
    SimpleRadford,
    /// Thermal contraction plus isothermal cure shrinkage.
    ///
    /// **The two fields are named for what the formula does with them, not for
    /// what eLamX's property sheet calls them** - see the note on
    /// [`SpringInModel::chemical_term`].
    EnhancedRadford {
        /// Cure shrinkage strain around the bend. Stored as `eps_cu`.
        eps_circumferential: f64,
        /// Cure shrinkage strain through the thickness. Stored as `eps_cr`.
        eps_thickness: f64,
    },
}

impl SpringInModel {
    /// The identifier used in the UI and nowhere else.
    pub fn code(&self) -> &'static str {
        match self {
            SpringInModel::SimpleRadford => "simple_radford",
            SpringInModel::EnhancedRadford { .. } => "enhanced_radford",
        }
    }

    /// The name eLamX gives a freshly created instance of this model.
    ///
    /// It comes from a resource bundle there, so it is whatever language the
    /// program was running in; this is the English one. See
    /// [`SpringInInput::model_name`] for why it is carried at all.
    pub fn default_name(&self) -> &'static str {
        match self {
            SpringInModel::SimpleRadford => "Simple Radford Model",
            SpringInModel::EnhancedRadford { .. } => "enhanced Radford Model",
        }
    }

    /// The shrinkage contribution to `d_phi / phi`, zero for the simple model.
    ///
    /// **On the two field names.** The Java computes
    /// `(eps_cu - eps_cr) / (1 + eps_cr)`, so whatever `eps_cr` means, it plays
    /// the part `a_thick` plays in the thermal term, and `eps_cu` the part
    /// `a_circ` plays. Their names say the same: `cr` reads as chemical-radial
    /// and `cu` as chemical-circumferential ("Umfang"), and radial IS the
    /// thickness direction at a bend.
    ///
    /// eLamX's property sheet labels them the other way round - `eps_cr` is
    /// shown as the circumferential one, in both languages. That is a bug in
    /// the labels rather than in the formula: taken at face value the term
    /// would come out with the wrong sign, and cure shrinkage would RELIEVE
    /// spring-in, which is neither what it does nor what Radford writes. The
    /// file's tag names are kept (`eps_cr`, `eps_cu`) so a project round trip
    /// is exact; the names here and in the UI are the formula's.
    pub fn chemical_term(&self) -> f64 {
        match *self {
            SpringInModel::SimpleRadford => 0.0,
            SpringInModel::EnhancedRadford { eps_circumferential, eps_thickness } => {
                (eps_circumferential - eps_thickness) / (1.0 + eps_thickness)
            }
        }
    }
}

/// Everything the analysis needs besides the laminate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct SpringInInput {
    pub model: SpringInModel,
    /// What the chosen model instance is called.
    ///
    /// Decoration: eLamX shows it in the project tree and lets it be renamed,
    /// and nothing computes with it. It is carried because the `.elamx` file
    /// stores it, and because its default comes out of a resource bundle - so
    /// a project saved by the German build has a German name in it, and
    /// dropping the field would silently rewrite that.
    #[serde(default = "default_model_name")]
    pub model_name: String,
    /// How far the part turns at the bend, in degrees - the arc the corner
    /// sweeps, not the angle enclosed between the two flanges. The two agree at
    /// 90 degrees, which is why the distinction is easy to miss; in general the
    /// enclosed angle is `180 - angle`. eLamX's own drawing is what settles it,
    /// and the port draws the same one.
    pub angle: f64,
    /// Mid-surface radius of the bend, in mm. Only the drawing uses it - and
    /// the check that it is not smaller than half the laminate thickness.
    pub radius: f64,
    /// Thermal expansion coefficient through the thickness, in 1/K.
    ///
    /// Typed in rather than computed: the CLT is a plane stress theory and has
    /// no through-thickness coefficient to offer. For a carbon/epoxy laminate
    /// it is close to the matrix's own, around 3e-5 - two orders above the
    /// in-plane value, which is the whole reason spring-in exists.
    pub alphat_thick: f64,
    /// The temperature the part is measured at, in degrees C. Usually room
    /// temperature.
    pub base_temp: f64,
    /// The cure temperature, in degrees C - where the part was stress free.
    pub hardening_temp: f64,
    /// Persisted by eLamX, read by nothing.
    ///
    /// The original has a checkbox "autocalc alpha_T,thick" and a field it
    /// would fill, but no code anywhere computes it: the flag is written to the
    /// project file and loaded back, and that is all it ever does. Kept for the
    /// round trip, unlike last-ply-failure's `useStrains` - that one has no
    /// setter at all, this one is state a user can change.
    pub use_auto_calc_alphat_thick: bool,
    /// Whether the laminate's 0 degree direction runs around the bend. If not,
    /// the 90 degree direction does.
    pub zero_deg_as_circum_dir: bool,
}

fn default_model_name() -> String {
    SpringInModel::SimpleRadford.default_name().to_string()
}

impl Default for SpringInInput {
    fn default() -> Self {
        // SpringInInput's no-arg Java constructor, value for value.
        SpringInInput {
            model: SpringInModel::SimpleRadford,
            model_name: default_model_name(),
            angle: 90.0,
            radius: 10.0,
            alphat_thick: 3.0E-5,
            base_temp: 25.0,
            hardening_temp: 180.0,
            use_auto_calc_alphat_thick: false,
            zero_deg_as_circum_dir: true,
        }
    }
}

impl SpringInInput {
    /// The flange length eLamX draws, twice the radius.
    ///
    /// Not an input and not part of the result: the model has no length in it
    /// at all, so this is purely how long the legs are drawn.
    pub fn flange_length(&self) -> f64 {
        self.radius * 2.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct SpringInResult {
    /// The change of the bend angle, in degrees. Positive means the corner
    /// turns further, so the part is sharper than the tool - spring-in.
    pub delta_angle: f64,
    /// `angle + delta_angle`, the angle the part comes off with.
    pub final_angle: f64,
    /// How much of `delta_angle` comes from cooling.
    pub thermal_angle: f64,
    /// How much comes from cure shrinkage. Zero for the simple model.
    pub chemical_angle: f64,
    /// The laminate coefficient the model used, in 1/K - `alpha_x` or
    /// `alpha_y` depending on `zero_deg_as_circum_dir`. Reported because it is
    /// the one number in the calculation nobody typed in.
    pub alpha_circumferential: f64,
    /// `base_temp - hardening_temp`, in K. Negative for a normal cure.
    pub delta_t: f64,
    /// Laminate thickness, in mm. The drawing needs it, and the radius check
    /// used it.
    pub thickness: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SpringInError {
    /// The laminate has no plies.
    EmptyLaminate,
    /// Not a symmetric stack.
    ///
    /// eLamX warns and refuses to compute, and so does this. The reason is
    /// narrower than it looks: an unsymmetric laminate warps under a
    /// temperature change instead of merely shrinking, so a single expansion
    /// coefficient no longer describes what happens to the corner, and the
    /// model's one number would be answering a different question.
    UnsymmetricLaminate,
    /// Half the laminate is thicker than the bend radius, so the inner surface
    /// would have to curve the wrong way.
    RadiusTooSmall { radius: f64, half_thickness: f64 },
    /// `1 + alpha_thick * delta_t` came out zero.
    ///
    /// Only reachable with a through-thickness coefficient some thousand times
    /// the physical one, but the Java divides by it unguarded and would report
    /// an infinite angle.
    DegenerateThermalTerm { alphat_thick: f64, delta_t: f64 },
    /// `1 + eps_thickness` came out zero, for the same reason.
    DegenerateChemicalTerm { eps_thickness: f64 },
}

impl std::fmt::Display for SpringInError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpringInError::EmptyLaminate => write!(f, "the laminate has no layers"),
            SpringInError::UnsymmetricLaminate => write!(
                f,
                "spring-in needs a symmetric laminate: an unsymmetric one warps as it cools instead of only shrinking, and a single expansion coefficient no longer describes the corner"
            ),
            SpringInError::RadiusTooSmall { radius, half_thickness } => write!(
                f,
                "the bend radius {radius} mm is smaller than half the laminate thickness {half_thickness} mm, so the inner surface would turn inside out"
            ),
            SpringInError::DegenerateThermalTerm { alphat_thick, delta_t } => write!(
                f,
                "1 + alpha_thick * delta_T is zero (alpha_thick = {alphat_thick} 1/K, delta_T = {delta_t} K), so the model has no finite answer"
            ),
            SpringInError::DegenerateChemicalTerm { eps_thickness } => write!(
                f,
                "1 + the through-thickness cure shrinkage is zero (eps = {eps_thickness}), so the model has no finite answer"
            ),
        }
    }
}

impl std::error::Error for SpringInError {}

/// Evaluates one of the two models on a laminate.
///
/// The guards are eLamX's own, from `ControlPanel.checkInput` and
/// `SpringInModel.checkInput`, with the two degenerate denominators added.
pub fn calculate(
    laminate: &CltLaminate,
    input: &SpringInInput,
) -> Result<SpringInResult, SpringInError> {
    if laminate.layers().is_empty() {
        return Err(SpringInError::EmptyLaminate);
    }
    if !laminate.is_symmetric() {
        return Err(SpringInError::UnsymmetricLaminate);
    }

    let thickness = laminate.tges();
    if thickness / 2.0 > input.radius {
        return Err(SpringInError::RadiusTooSmall {
            radius: input.radius,
            half_thickness: thickness / 2.0,
        });
    }

    let alpha = alpha_global(laminate);
    let alpha_circumferential = if input.zero_deg_as_circum_dir { alpha[0] } else { alpha[1] };

    let delta_t = input.base_temp - input.hardening_temp;

    let denominator = 1.0 + input.alphat_thick * delta_t;
    if denominator == 0.0 {
        return Err(SpringInError::DegenerateThermalTerm {
            alphat_thick: input.alphat_thick,
            delta_t,
        });
    }
    let thermal = (alpha_circumferential - input.alphat_thick) * delta_t / denominator;

    if let SpringInModel::EnhancedRadford { eps_thickness, .. } = input.model {
        if 1.0 + eps_thickness == 0.0 {
            return Err(SpringInError::DegenerateChemicalTerm { eps_thickness });
        }
    }
    let chemical = input.model.chemical_term();

    // Both terms are relative angle changes, so the angle multiplies them - and
    // it has to be in radians first, because that is the form the model is
    // derived in. eLamX converts to radians, multiplies, converts back; the
    // factor is dimensionless so the two conversions cancel, and the port keeps
    // them only so the arithmetic matches digit for digit.
    let scale = input.angle.to_radians();
    let thermal_angle = (thermal * scale).to_degrees();
    let chemical_angle = (chemical * scale).to_degrees();
    let delta_angle = thermal_angle + chemical_angle;

    Ok(SpringInResult {
        delta_angle,
        final_angle: input.angle + delta_angle,
        thermal_angle,
        chemical_angle,
        alpha_circumferential,
        delta_t,
        thickness,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Laminate, Layer, Material};
    use std::collections::HashMap;

    /// A symmetric stack of identical plies, all at the same angle.
    ///
    /// A laminate like this is homogeneous, so a temperature change puts no
    /// stress in it at all and it simply expands by the ply's own
    /// coefficients. That gives the whole calculation a known
    /// `alpha_circumferential` without having to trust `alpha_global` - which
    /// is the point of using it for the numeric checks below.
    fn uniform(angle: f64, alpha_par: f64, alpha_nor: f64) -> CltLaminate {
        let mut material = Material::new("m", "m", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
        material.alpha_t_par = alpha_par;
        material.alpha_t_nor = alpha_nor;
        let mut materials = HashMap::new();
        materials.insert("m".to_string(), material);

        let mut laminate = Laminate::new("l", "l");
        for i in 0..4 {
            laminate
                .layers
                .push(Layer::new(format!("y{i}"), "", "m", angle, 0.125));
        }
        CltLaminate::new(&laminate, &materials).unwrap()
    }

    /// The worked example, by hand.
    ///
    /// A 0 degree stack of a ply with `alpha_par = 1e-6` expands by exactly
    /// that in x, so with `alpha_thick = 3e-5` and a cure from 180 down to 25:
    ///
    /// ```text
    ///   dT      = 25 - 180              = -155 K
    ///   thermal = (1e-6 - 3e-5)(-155) / (1 + 3e-5 * (-155))
    ///           = 0.004495 / 0.99535    = 0.00451600
    ///   d_phi   = 90 * 0.00451600       = 0.406440 degrees
    /// ```
    ///
    /// Positive, so the corner turns further than the tool: the part comes off
    /// sharper. That is spring-in, and its size - four tenths of a degree on a
    /// right angle - is the order of magnitude the effect actually has.
    #[test]
    fn a_unidirectional_corner_springs_in_by_the_hand_computed_amount() {
        let result = calculate(&uniform(0.0, 1.0e-6, 3.0e-5), &SpringInInput::default()).unwrap();

        assert!((result.alpha_circumferential - 1.0e-6).abs() < 1e-15);
        assert!((result.delta_t - (-155.0)).abs() < 1e-12);
        assert!(
            (result.delta_angle - 0.406440).abs() < 1e-6,
            "{}",
            result.delta_angle
        );
        assert!((result.final_angle - 90.406440).abs() < 1e-6);
        assert_eq!(result.chemical_angle, 0.0);
        assert!((result.thickness - 0.5).abs() < 1e-12);
    }

    /// Which laminate direction runs around the bend is a real choice, not a
    /// label: on the same stack it changes the answer completely. Turned to
    /// 90 degrees, the direction around the bend is the ply's transverse one,
    /// whose coefficient here EQUALS the through-thickness one - and a part
    /// that shrinks the same way in both directions has no spring-in at all.
    #[test]
    fn the_circumferential_direction_selects_which_coefficient_is_used() {
        let plate = uniform(0.0, 1.0e-6, 3.0e-5);
        let input = SpringInInput { zero_deg_as_circum_dir: false, ..Default::default() };
        let result = calculate(&plate, &input).unwrap();

        assert!((result.alpha_circumferential - 3.0e-5).abs() < 1e-15);
        assert!(result.delta_angle.abs() < 1e-12, "{}", result.delta_angle);
    }

    /// The same statement from the other side, and the strongest check there
    /// is on the chain as a whole: a material that expands equally in every
    /// direction cannot distort a corner, whatever the temperature does.
    #[test]
    fn an_isotropic_laminate_holds_its_angle() {
        let plate = uniform(30.0, 2.0e-5, 2.0e-5);
        let input = SpringInInput { alphat_thick: 2.0e-5, ..Default::default() };
        let result = calculate(&plate, &input).unwrap();
        assert!(result.delta_angle.abs() < 1e-12, "{}", result.delta_angle);
    }

    /// Cure shrinkage on its own, with the process isothermal so nothing else
    /// contributes. The resin shrinks one percent through the thickness and
    /// not at all around the bend, which by Radford's second term is
    /// `(0 - (-0.01)) / (1 - 0.01)` per radian of bend.
    ///
    /// The sign is the whole reason this test exists: shrinking MORE through
    /// the thickness than around the bend closes the corner, exactly as
    /// cooling does. eLamX's property sheet labels the two strains the other
    /// way round, and reading them that way would turn this positive number
    /// negative - see `SpringInModel::chemical_term`.
    #[test]
    fn cure_shrinkage_alone_also_closes_the_corner() {
        let plate = uniform(0.0, 1.0e-6, 3.0e-5);
        let input = SpringInInput {
            model: SpringInModel::EnhancedRadford {
                eps_circumferential: 0.0,
                eps_thickness: -0.01,
            },
            base_temp: 180.0,
            hardening_temp: 180.0,
            ..Default::default()
        };
        let result = calculate(&plate, &input).unwrap();

        assert_eq!(result.thermal_angle, 0.0);
        assert!(
            (result.chemical_angle - 90.0 * 0.01 / 0.99).abs() < 1e-12,
            "{}",
            result.chemical_angle
        );
        assert!(result.delta_angle > 0.0);
    }

    /// The enhanced model is the simple one plus that term, and eLamX adds
    /// them before scaling by the angle - so the two parts are separable, and
    /// the split the result reports is a real one.
    #[test]
    fn the_enhanced_model_is_the_simple_one_plus_the_shrinkage_term() {
        let plate = uniform(0.0, 1.0e-6, 3.0e-5);
        let simple = calculate(&plate, &SpringInInput::default()).unwrap();
        let enhanced = calculate(
            &plate,
            &SpringInInput {
                model: SpringInModel::EnhancedRadford {
                    eps_circumferential: -0.001,
                    eps_thickness: -0.008,
                },
                ..Default::default()
            },
        )
        .unwrap();

        assert!((enhanced.thermal_angle - simple.delta_angle).abs() < 1e-14);
        assert!(
            (enhanced.chemical_angle - 90.0 * 0.007 / 0.992).abs() < 1e-12,
            "{}",
            enhanced.chemical_angle
        );
        assert!(
            (enhanced.delta_angle - (enhanced.thermal_angle + enhanced.chemical_angle)).abs()
                < 1e-15
        );
    }

    /// The model is a relative change, so a bend that turns twice as far
    /// springs in twice as much. Worth pinning because it is the one place the
    /// degree/radian conversion could hide a factor.
    #[test]
    fn the_angle_change_is_proportional_to_the_angle() {
        let plate = uniform(0.0, 1.0e-6, 3.0e-5);
        let at = |angle: f64| {
            calculate(&plate, &SpringInInput { angle, ..Default::default() })
                .unwrap()
                .delta_angle
        };
        assert!((at(180.0) - 2.0 * at(90.0)).abs() < 1e-12);
        assert!(at(0.0).abs() < 1e-15);
    }

    /// Heating a part instead of cooling it reverses the distortion, and the
    /// model is not quite antisymmetric about that - the denominator sees the
    /// sign of dT too. Both facts in one test.
    #[test]
    fn warming_the_part_opens_the_corner_instead() {
        let plate = uniform(0.0, 1.0e-6, 3.0e-5);
        let cooled = calculate(&plate, &SpringInInput::default()).unwrap();
        let heated = calculate(
            &plate,
            &SpringInInput { base_temp: 335.0, ..Default::default() },
        )
        .unwrap();

        assert!(heated.delta_t > 0.0 && cooled.delta_t < 0.0);
        assert!(heated.delta_angle < 0.0 && cooled.delta_angle > 0.0);
        assert!(heated.delta_angle.abs() < cooled.delta_angle.abs());
    }

    #[test]
    fn the_guards_are_the_originals() {
        let plate = uniform(0.0, 1.0e-6, 3.0e-5);

        // Half a 0.5 mm laminate is 0.25 mm, so a radius below that leaves the
        // inner surface nowhere to be.
        assert_eq!(
            calculate(&plate, &SpringInInput { radius: 0.2, ..Default::default() }),
            Err(SpringInError::RadiusTooSmall { radius: 0.2, half_thickness: 0.25 })
        );
        assert!(calculate(&plate, &SpringInInput { radius: 0.25, ..Default::default() }).is_ok());

        let mut materials = HashMap::new();
        materials.insert(
            "m".to_string(),
            Material::new("m", "m", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9),
        );
        let mut stack = Laminate::new("l", "l");
        assert_eq!(
            calculate(
                &CltLaminate::new(&stack, &materials).unwrap(),
                &SpringInInput::default()
            ),
            Err(SpringInError::EmptyLaminate)
        );

        stack.layers.push(Layer::new("a", "", "m", 0.0, 0.125));
        stack.layers.push(Layer::new("b", "", "m", 45.0, 0.125));
        assert_eq!(
            calculate(
                &CltLaminate::new(&stack, &materials).unwrap(),
                &SpringInInput::default()
            ),
            Err(SpringInError::UnsymmetricLaminate)
        );

        // A coefficient this large is nonsense, but eLamX would answer
        // "infinity degrees" rather than say so.
        let degenerate = SpringInInput { alphat_thick: 1.0 / 155.0, ..Default::default() };
        assert!(matches!(
            calculate(&plate, &degenerate),
            Err(SpringInError::DegenerateThermalTerm { .. })
        ));
        assert!(matches!(
            calculate(
                &plate,
                &SpringInInput {
                    model: SpringInModel::EnhancedRadford {
                        eps_circumferential: 0.0,
                        eps_thickness: -1.0,
                    },
                    ..Default::default()
                }
            ),
            Err(SpringInError::DegenerateChemicalTerm { .. })
        ));
    }

    /// The default input is eLamX's, which matters because the module page
    /// opens with it and a reader comparing the two programs starts there.
    #[test]
    fn the_default_input_is_the_originals() {
        let input = SpringInInput::default();
        assert_eq!(input.model, SpringInModel::SimpleRadford);
        assert_eq!(input.angle, 90.0);
        assert_eq!(input.radius, 10.0);
        assert_eq!(input.alphat_thick, 3.0e-5);
        assert_eq!(input.base_temp, 25.0);
        assert_eq!(input.hardening_temp, 180.0);
        assert!(!input.use_auto_calc_alphat_thick);
        assert!(input.zero_deg_as_circum_dir);
        assert_eq!(input.flange_length(), 20.0);
    }
}
