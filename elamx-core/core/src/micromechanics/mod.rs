//! Micromechanical prediction of a ply's stiffness from its fibre and its
//! matrix.
//!
//! Reference: eLamX2/Micromechanics/ and eLamX2/AdditionalMicroMechanicModels/.
//!
//! A micromechanic material is a ply material whose five basic numbers - rho,
//! E_par, E_nor, nue12 and G - are not typed in but computed from a fibre, a
//! matrix and a fibre volume fraction. Each of the five picks its OWN model,
//! and one of the choices is "type it in after all"; that is what
//! `ManualInputDummyModel` is in the original, and `Model::Manual` here.
//!
//! Everything else a ply material carries - the transverse shear moduli, the
//! expansion coefficients, the strengths - is typed in either way. No model in
//! eLamX predicts them, and inventing one here would be putting numbers in the
//! user's mouth.
//!
//! Note what the models do NOT agree on. E_par, nue12 and rho are the rule of
//! mixtures in every one of them; the models differ only in E_nor and G, which
//! is exactly where the rule of mixtures is known to be poor. That is why the
//! choice is per property rather than one model for the material.

use crate::model::Material;
use serde::{Deserialize, Serialize};

/// A fibre material.
///
/// Transversely isotropic, like the ply it ends up in: `e_par` along the
/// filament, `e_nor` across it. The Java class is `micromechanics.Fiber`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct Fibre {
    pub id: String,
    pub name: String,
    pub e_par: f64,
    pub e_nor: f64,
    pub nue12: f64,
    pub g: f64,
    #[serde(default)]
    pub g13: f64,
    #[serde(default)]
    pub g23: f64,
    pub rho: f64,
    #[serde(default)]
    pub alpha_t_par: f64,
    #[serde(default)]
    pub alpha_t_nor: f64,
    #[serde(default)]
    pub beta_par: f64,
    #[serde(default)]
    pub beta_nor: f64,
}

/// A matrix material.
///
/// Isotropic, and that is not a simplification of the model but the Java
/// class: `Matrix` stores E, nue and rho, answers `getEpar()`, `getEnor()` and
/// `getG13()` with the same numbers, and its `setG` throws - the shear modulus
/// is always E / (2 (1 + nue)).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct MatrixMaterial {
    pub id: String,
    pub name: String,
    pub e: f64,
    pub nue: f64,
    pub rho: f64,
    /// Thermal expansion coefficient. Isotropic, so one number.
    #[serde(default)]
    pub alpha: f64,
    /// Moisture expansion coefficient.
    #[serde(default)]
    pub beta: f64,
}

impl MatrixMaterial {
    /// Shear modulus, from E and nue. Not stored: see the type's own note.
    pub fn g(&self) -> f64 {
        self.e / (2.0 * (1.0 + self.nue))
    }
}

/// Which micromechanical model computes one property.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum Model {
    /// Not predicted at all - the value stays whatever was typed in. The Java
    /// `ManualInputDummyModel`, which is a model only so that the choice can be
    /// one dropdown instead of a dropdown and a checkbox.
    Manual,
    /// Rule of mixtures. The original's default, and the fallback its reader
    /// substitutes for a model it cannot resolve.
    RuleOfMixture,
    Abolinsh,
    Chamis,
    HalpinTsai,
    HopkinsChamis,
    Puck,
    /// HSB 37102-02, the German aerospace handbook sheet. Renamed explicitly
    /// because snake_case would spell the sheet number `hsb3710202`, which is
    /// a number nobody could look up.
    #[serde(rename = "hsb_37102_02")]
    Hsb3710202,
}

impl Model {
    pub const ALL: [Model; 8] = [
        Model::Manual,
        Model::RuleOfMixture,
        Model::Abolinsh,
        Model::Chamis,
        Model::HalpinTsai,
        Model::HopkinsChamis,
        Model::Puck,
        Model::Hsb3710202,
    ];

    pub fn code(&self) -> &'static str {
        match self {
            Model::Manual => "manual",
            Model::RuleOfMixture => "rule_of_mixture",
            Model::Abolinsh => "abolinsh",
            Model::Chamis => "chamis",
            Model::HalpinTsai => "halpin_tsai",
            Model::HopkinsChamis => "hopkins_chamis",
            Model::Puck => "puck",
            Model::Hsb3710202 => "hsb_37102_02",
        }
    }

    /// Whether this model predicts anything. `Manual` does not.
    pub fn predicts(&self) -> bool {
        *self != Model::Manual
    }

    /// Density. Every model inherits the rule of mixtures from
    /// `MicroMechModel.getRho` - none of them overrides it.
    pub fn rho(&self, fibre: &Fibre, matrix: &MatrixMaterial, phi: f64) -> Option<f64> {
        self.predicts()
            .then_some(fibre.rho * phi + matrix.rho * (1.0 - phi))
    }

    /// Stiffness along the fibre. The rule of mixtures in every model - none
    /// of them overrides `getE11` with anything else.
    pub fn e_par(&self, fibre: &Fibre, matrix: &MatrixMaterial, phi: f64) -> Option<f64> {
        self.predicts()
            .then_some(fibre.e_par * phi + matrix.e * (1.0 - phi))
    }

    /// Poisson's ratio. Likewise the rule of mixtures everywhere.
    pub fn nue12(&self, fibre: &Fibre, matrix: &MatrixMaterial, phi: f64) -> Option<f64> {
        self.predicts()
            .then_some(fibre.nue12 * phi + matrix.nue * (1.0 - phi))
    }

    /// Stiffness across the fibre - the first of the two properties the models
    /// actually disagree about.
    pub fn e_nor(&self, fibre: &Fibre, matrix: &MatrixMaterial, phi: f64) -> Option<f64> {
        let (ef, em) = (fibre.e_nor, matrix.e);
        Some(match self {
            Model::Manual => return None,
            Model::RuleOfMixture => (ef * em) / (em * phi + ef * (1.0 - phi)),
            Model::Abolinsh => {
                let ratio = ef / em;
                let a1 = ratio * (1.0 + (ratio - 1.0) * phi) * em;
                let a2 = ratio * matrix.nue - fibre.nue12;
                let a3 = (phi + ratio * (1.0 - phi)) * (1.0 + (ratio - 1.0) * phi)
                    - a2 * a2 * phi * (1.0 - phi);
                a1 / a3
            }
            Model::Chamis => chamis(ef, em, phi),
            Model::HalpinTsai => halpin_tsai(ef, em, phi, ETA_E22),
            Model::HopkinsChamis => hopkins_chamis(ef, em, phi),
            Model::Puck => {
                let nue_sq = matrix.nue * matrix.nue;
                (em / (1.0 - nue_sq))
                    * ((1.0 + 0.85 * phi * phi)
                        / ((1.0 - phi).powf(1.25) + phi * (em / (ef * (1.0 - nue_sq)))))
            }
            Model::Hsb3710202 => hsb(ef, em, phi),
        })
    }

    /// In-plane shear modulus - the other property the models disagree about.
    pub fn g(&self, fibre: &Fibre, matrix: &MatrixMaterial, phi: f64) -> Option<f64> {
        let (gf, gm) = (fibre.g, matrix.g());
        Some(match self {
            Model::Manual => return None,
            Model::RuleOfMixture => (gf * gm) / (gf * (1.0 - phi) + gm * phi),
            Model::Abolinsh => {
                let ratio = gf / gm;
                let a1 = ratio * (1.0 + phi) + 1.0 - phi;
                let a2 = ratio * (1.0 - phi) + 1.0 + phi;
                a1 / a2 * gm
            }
            Model::Chamis => chamis(gf, gm, phi),
            Model::HalpinTsai => halpin_tsai(gf, gm, phi, ETA_G),
            Model::HopkinsChamis => hopkins_chamis(gf, gm, phi),
            Model::Puck => gm * (1.0 + 0.4 * phi.sqrt()) / ((1.0 - phi).powf(1.45) + phi * (gm / gf)),
            Model::Hsb3710202 => hsb(gf, gm, phi),
        })
    }
}

/// Halpin-Tsai's reinforcing factors, as the Java hard-codes them.
const ETA_E22: f64 = 2.0;
const ETA_G: f64 = 1.0;

fn chamis(val_f: f64, val_m: f64, phi: f64) -> f64 {
    let x = phi.sqrt();
    val_m / (1.0 - x * (1.0 - val_m / val_f))
}

fn hopkins_chamis(val_f: f64, val_m: f64, phi: f64) -> f64 {
    let x = phi.sqrt();
    val_m * ((1.0 - x) + x / (1.0 - x * (1.0 - val_m / val_f)))
}

fn halpin_tsai(val_f: f64, val_m: f64, phi: f64, eta: f64) -> f64 {
    let ratio = val_f / val_m;
    let mue = (ratio - 1.0) / (ratio + eta);
    ((1.0 + eta * mue * phi) / (1.0 - mue * phi)) * val_m
}

/// HSB 37102-02, with both of the Java's own corrections.
///
/// The closed form has a square root and an arc tangent of a fraction that can
/// go negative, at a fibre volume fraction that depends on the fibre/matrix
/// ratio. The original catches that and returns the FIBRE value instead - a
/// comment there says outright that this is not part of the source - and then
/// clamps the whole thing to the fibre value so the curve has no jump. Both
/// are reproduced: they change the number in the region where they fire, and a
/// port that quietly returned NaN there would not be the same program.
fn hsb(val_f: f64, val_m: f64, phi: f64) -> f64 {
    let ratio = 1.0 - val_m / val_f;
    let root = (phi / std::f64::consts::PI).sqrt();

    let val1 = 1.0 - 2.0 * root;
    let val2 = std::f64::consts::PI / (2.0 * ratio);
    let val3 = 2.0 / (ratio * (1.0 - 4.0 * phi / std::f64::consts::PI * ratio * ratio).sqrt());
    let val4 = ((1.0 + 2.0 * root * ratio) / (1.0 - 2.0 * root * ratio)).sqrt().atan();

    let mut value = val_m * (val1 - val2 + val3 * val4);
    if (1.0 - 2.0 * root * ratio) < 0.0 {
        value = val_f;
    }
    value.min(val_f)
}

/// How a material's five basic properties are predicted.
///
/// One model per property, because that is the choice eLamX offers: the models
/// agree on three of the five and only differ where the rule of mixtures is
/// weak, so pinning the whole material to one of them would be a choice the
/// original does not make.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct MicroMechanics {
    /// Id of the fibre in the project's fibre list.
    pub fibre_id: String,
    /// Id of the matrix in the project's matrix list.
    pub matrix_id: String,
    /// Fibre volume fraction, 0..1.
    pub phi: f64,
    /// Not stored in the `.elamx` file: `MicroMechanicMaterialLoadSaveImpl`
    /// writes a model tag for the other four and none for the density, so a
    /// saved and reopened material is back on the constructor's choice. Kept
    /// here because the running program does have the choice; the writer
    /// documents why it does not travel.
    pub rho_model: Model,
    pub e_par_model: Model,
    pub e_nor_model: Model,
    pub nue12_model: Model,
    pub g_model: Model,
}

impl Default for MicroMechanics {
    fn default() -> Self {
        // The Java constructor's choice: the rule of mixtures for everything.
        MicroMechanics {
            fibre_id: String::new(),
            matrix_id: String::new(),
            phi: 0.5,
            rho_model: Model::RuleOfMixture,
            e_par_model: Model::RuleOfMixture,
            e_nor_model: Model::RuleOfMixture,
            nue12_model: Model::RuleOfMixture,
            g_model: Model::RuleOfMixture,
        }
    }
}

/// The five properties a micromechanic material predicts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct BasicProperties {
    pub rho: f64,
    pub e_par: f64,
    pub e_nor: f64,
    pub nue12: f64,
    pub g: f64,
}

impl MicroMechanics {
    /// The predicted properties, with `manual` supplying every one whose model
    /// is `Manual`.
    ///
    /// Takes the manual values rather than reaching into a material, so the
    /// same call serves the file reader, the frontend and a test.
    pub fn evaluate(
        &self,
        fibre: &Fibre,
        matrix: &MatrixMaterial,
        manual: BasicProperties,
    ) -> BasicProperties {
        BasicProperties {
            rho: self.rho_model.rho(fibre, matrix, self.phi).unwrap_or(manual.rho),
            e_par: self
                .e_par_model
                .e_par(fibre, matrix, self.phi)
                .unwrap_or(manual.e_par),
            e_nor: self
                .e_nor_model
                .e_nor(fibre, matrix, self.phi)
                .unwrap_or(manual.e_nor),
            nue12: self
                .nue12_model
                .nue12(fibre, matrix, self.phi)
                .unwrap_or(manual.nue12),
            g: self.g_model.g(fibre, matrix, self.phi).unwrap_or(manual.g),
        }
    }
}

/// A micromechanic material whose fibre or matrix is not in the project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingConstituent {
    pub material: String,
    /// `"Faser"` or `"Matrix"` - which of the two is missing.
    pub kind: &'static str,
    pub id: String,
}

/// Rewrites every micromechanic material's five basic properties with what its
/// models predict.
///
/// This is what makes the rest of the crate able to ignore micromechanics
/// entirely: after it runs, a material carries the numbers an analysis needs,
/// whether they were typed in or computed. It is also what eLamX does - its
/// `getEpar()` asks the model on every call and only falls back to the stored
/// value for the manual dummy, so the values in a file are a cache the
/// original itself does not trust. Running this on read means this crate does
/// not trust them either.
pub fn resolve(
    materials: &mut [Material],
    fibres: &[Fibre],
    matrices: &[MatrixMaterial],
) -> Result<(), MissingConstituent> {
    for material in materials.iter_mut() {
        let Some(micro) = material.micro.clone() else {
            continue;
        };
        let fibre = fibres.iter().find(|f| f.id == micro.fibre_id).ok_or_else(|| {
            MissingConstituent {
                material: material.name.clone(),
                kind: "Faser",
                id: micro.fibre_id.clone(),
            }
        })?;
        let matrix = matrices.iter().find(|m| m.id == micro.matrix_id).ok_or_else(|| {
            MissingConstituent {
                material: material.name.clone(),
                kind: "Matrix",
                id: micro.matrix_id.clone(),
            }
        })?;

        let stored = BasicProperties {
            rho: material.rho,
            e_par: material.e_par,
            e_nor: material.e_nor,
            nue12: material.nue12,
            g: material.g,
        };
        let derived = micro.evaluate(fibre, matrix, stored);
        material.rho = derived.rho;
        material.e_par = derived.e_par;
        material.e_nor = derived.e_nor;
        material.nue12 = derived.nue12;
        material.g = derived.g;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fibre() -> Fibre {
        // Roughly a high-strength carbon fibre.
        Fibre {
            id: "f".into(),
            name: "C".into(),
            e_par: 230000.0,
            e_nor: 15000.0,
            nue12: 0.28,
            g: 15000.0,
            g13: 0.0,
            g23: 0.0,
            rho: 1.78e-9,
            alpha_t_par: 0.0,
            alpha_t_nor: 0.0,
            beta_par: 0.0,
            beta_nor: 0.0,
        }
    }

    fn matrix() -> MatrixMaterial {
        MatrixMaterial {
            id: "m".into(),
            name: "EP".into(),
            e: 3400.0,
            nue: 0.35,
            rho: 1.2e-9,
            alpha: 0.0,
            beta: 0.0,
        }
    }

    #[test]
    fn the_matrix_shear_modulus_follows_from_e_and_nue() {
        let m = matrix();
        assert!((m.g() - 3400.0 / (2.0 * 1.35)).abs() < 1e-12);
    }

    /// Puck's is an empirical fit rather than an interpolation, and it does
    /// not reduce to its constituents at either end - see
    /// `pucks_model_does_not_reduce_to_its_constituents`, which pins what it
    /// does instead. So the two structural tests below exclude it, and it
    /// rests on the golden master against the original.
    fn interpolating_models() -> impl Iterator<Item = &'static Model> {
        Model::ALL
            .iter()
            .filter(|model| model.predicts() && **model != Model::Puck)
    }

    /// Every model must reduce to the pure constituent at the ends of the
    /// range: all matrix at phi = 0, all fibre at phi = 1. This is the check
    /// that catches a swapped fibre and matrix, which no amount of staring at
    /// an interpolation formula reliably does.
    #[test]
    fn every_model_reproduces_its_constituents_at_the_ends() {
        let (f, m) = (fibre(), matrix());
        for model in interpolating_models() {
            for (phi, expected_e_par, expected_e_nor, expected_g, expected_nue, expected_rho) in [
                (0.0, m.e, m.e, m.g(), m.nue, m.rho),
                (1.0, f.e_par, f.e_nor, f.g, f.nue12, f.rho),
            ] {
                let tol = |a: f64, b: f64| (a - b).abs() <= 1e-6 * b.abs().max(1.0);
                assert!(
                    tol(model.e_par(&f, &m, phi).unwrap(), expected_e_par),
                    "{model:?} E_par at phi={phi}"
                );
                assert!(
                    tol(model.e_nor(&f, &m, phi).unwrap(), expected_e_nor),
                    "{model:?} E_nor at phi={phi}: {}",
                    model.e_nor(&f, &m, phi).unwrap()
                );
                assert!(tol(model.g(&f, &m, phi).unwrap(), expected_g), "{model:?} G at phi={phi}");
                assert!(
                    tol(model.nue12(&f, &m, phi).unwrap(), expected_nue),
                    "{model:?} nue12 at phi={phi}"
                );
                assert!(
                    tol(model.rho(&f, &m, phi).unwrap(), expected_rho),
                    "{model:?} rho at phi={phi}"
                );
            }
        }
    }

    /// Between the ends every model has to stay between them, and rise with
    /// the fibre content. A sign slip inside one of the closed forms shows up
    /// here and nowhere in the end-point test above.
    #[test]
    fn every_model_is_monotonic_and_bracketed() {
        let (f, m) = (fibre(), matrix());
        for model in interpolating_models() {
            let mut previous_e = m.e;
            let mut previous_g = m.g();
            for step in 1..=20 {
                let phi = step as f64 / 20.0;
                let e = model.e_nor(&f, &m, phi).unwrap();
                let g = model.g(&f, &m, phi).unwrap();
                assert!(e.is_finite() && g.is_finite(), "{model:?} at phi={phi}: {e}, {g}");
                assert!(
                    e >= previous_e - 1e-9 && e <= f.e_nor + 1e-6,
                    "{model:?} E_nor at phi={phi}: {e} after {previous_e}"
                );
                assert!(
                    g >= previous_g - 1e-9 && g <= f.g + 1e-6,
                    "{model:?} G at phi={phi}: {g} after {previous_g}"
                );
                previous_e = e;
                previous_g = g;
            }
        }
    }

    /// What Puck's fit actually does at the ends, written down so that nobody
    /// "fixes" it back into an interpolation.
    ///
    /// At phi = 0 its transverse modulus is the matrix's PLANE-STRAIN modulus
    /// E_m / (1 - nue_m^2), not E_m - 14% above it for this matrix. At phi = 1
    /// it is 1.85 times the fibre's transverse modulus, and the shear modulus
    /// is 1.4 times the fibre's. Both follow directly from the formula eLamX
    /// implements, and both are reproduced here on purpose: the model is only
    /// meant for the fibre volume fractions a real laminate has, and the port
    /// follows the original rather than the physics of the limit.
    #[test]
    fn pucks_model_does_not_reduce_to_its_constituents() {
        let (f, m) = (fibre(), matrix());
        let plane_strain = m.e / (1.0 - m.nue * m.nue);
        let at_zero = Model::Puck.e_nor(&f, &m, 0.0).unwrap();
        assert!((at_zero - plane_strain).abs() < 1e-9, "{at_zero} vs {plane_strain}");
        assert!(at_zero > m.e);

        assert!((Model::Puck.e_nor(&f, &m, 1.0).unwrap() - 1.85 * f.e_nor).abs() < 1e-6);
        assert!((Model::Puck.g(&f, &m, 1.0).unwrap() - 1.4 * f.g).abs() < 1e-6);

        // In the range anyone uses it is still a sensible, rising curve.
        let mut previous = Model::Puck.e_nor(&f, &m, 0.3).unwrap();
        for step in 4..=7 {
            let value = Model::Puck.e_nor(&f, &m, step as f64 / 10.0).unwrap();
            assert!(value > previous, "Puck E_nor fell at phi={}", step as f64 / 10.0);
            previous = value;
        }
    }

    /// The rule of mixtures, against the textbook formulas written out by
    /// hand - the one model whose numbers can be checked without the original.
    #[test]
    fn the_rule_of_mixtures_matches_its_closed_form() {
        let (f, m) = (fibre(), matrix());
        let phi = 0.6;
        let model = Model::RuleOfMixture;
        assert!((model.e_par(&f, &m, phi).unwrap() - (230000.0 * 0.6 + 3400.0 * 0.4)).abs() < 1e-9);
        // The series (Reuss) bound across the fibres: 1/E = phi/Ef + (1-phi)/Em.
        let reuss = 1.0 / (phi / 15000.0 + 0.4 / 3400.0);
        assert!((model.e_nor(&f, &m, phi).unwrap() - reuss).abs() < 1e-6);
        let reuss_g = 1.0 / (phi / f.g + 0.4 / m.g());
        assert!((model.g(&f, &m, phi).unwrap() - reuss_g).abs() < 1e-6);
    }

    /// The HSB sheet's own escape hatch. Its closed form takes the square root
    /// of a fraction that turns negative once the fibre is stiff enough
    /// relative to the matrix, and eLamX returns the fibre value there instead
    /// of NaN. A port without that guard is not merely less pretty - it hands
    /// a NaN to the whole laminate.
    #[test]
    fn the_hsb_model_stays_finite_where_its_closed_form_does_not() {
        let mut f = fibre();
        // A ratio extreme enough to push the arc tangent's argument negative.
        f.e_nor = 400000.0;
        f.g = 400000.0;
        let m = matrix();
        for step in 0..=100 {
            let phi = step as f64 / 100.0;
            let e = Model::Hsb3710202.e_nor(&f, &m, phi).unwrap();
            let g = Model::Hsb3710202.g(&f, &m, phi).unwrap();
            assert!(e.is_finite(), "E_nor at phi={phi}");
            assert!(g.is_finite(), "G at phi={phi}");
            assert!(e <= f.e_nor + 1e-6 && g <= f.g + 1e-6);
        }
    }

    #[test]
    fn a_manual_property_keeps_the_value_it_was_given() {
        let manual = BasicProperties {
            rho: 1.0,
            e_par: 2.0,
            e_nor: 3.0,
            nue12: 4.0,
            g: 5.0,
        };
        let mut definition = MicroMechanics {
            fibre_id: "f".into(),
            matrix_id: "m".into(),
            phi: 0.6,
            ..Default::default()
        };
        definition.e_nor_model = Model::Manual;
        definition.rho_model = Model::Manual;

        let got = definition.evaluate(&fibre(), &matrix(), manual);
        assert_eq!(got.e_nor, 3.0);
        assert_eq!(got.rho, 1.0);
        // And the rest are still predicted.
        assert_ne!(got.e_par, 2.0);
        assert_ne!(got.g, 5.0);
    }
}
