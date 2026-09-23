//! Reading and writing `.elamx` project files.
//!
//! `.elamx` is the original program's own XML format, and it stays this
//! crate's format too: a project written here opens in eLamX 3.x and vice
//! versa. That is worth more than a cleaner schema would be - it is what lets
//! the desktop and the web version share files.
//!
//! Reference: eLamX2/File_Support/src/de/elamx/filesupport/{eLamXFileDataObject,
//! LaminateLoadSaveImpl,DefaultMaterialLoadSaveImpl}.java plus one
//! `LoadSaveLaminateHook` per calculation module.
//!
//! What is covered: materials (including the micromechanic ones and the
//! fibres and matrices they are built from), laminates with their layers, CLT
//! calculations, buckling, deformation, vibration, last-ply-failure and
//! pressure-vessel analyses -
//! everything the ported calculation modules need. Everything else is
//! **preserved verbatim** on read and written back unchanged, so opening and
//! saving a file in the web version does not silently destroy what the desktop
//! put there. That holds at both levels the format has: module data under a
//! laminate (vibration, cutouts, spring-in, stiffeners) and whole sections
//! under the root (`<optimizations>`).

pub mod naming;
mod read;
mod reduced;
mod web_extension;
mod write;

pub use read::{read_elamx, ReadError};
pub use reduced::read_elamxb;
pub use web_extension::{
    ComparisonState, ComparisonVariant, ReportTemplate, ImportNotice, LayerCriteriaEntry,
    StaleLayerCriteriaReason, WebExtension,
    WEB_EXTENSION_SCHEMA, WEB_EXTENSION_TAG,
};
pub use write::write_elamx;

use crate::clt::{LastPlyFailureInput, Loads, PressureVesselInput, Strains};
use crate::micromechanics::{Fibre, MatrixMaterial};
use crate::model::{Laminate, Material};
use crate::plate::{BucklingInput, DeformationInput, VibrationInput};
use crate::cutout::CutoutInput;
use crate::optimization::OptimizationInput;
use crate::spring_in::SpringInInput;
use serde::{Deserialize, Serialize};

/// A whole `.elamx` document.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct Project {
    /// Format version from the `<elamx version="...">` attribute. Written back
    /// as read so a file does not silently change format generation.
    pub version: String,
    pub materials: Vec<Material>,
    /// Fibre materials, from `<fibres>`. Not ply materials: they only exist to
    /// be combined with a matrix into one.
    #[serde(default)]
    pub fibres: Vec<Fibre>,
    /// Matrix materials, from `<matrices>`.
    #[serde(default)]
    pub matrices: Vec<MatrixMaterial>,
    pub laminates: Vec<ProjectLaminate>,
    /// Top-level sections this crate does not model - `<optimizations>` - as
    /// raw XML, in file order.
    ///
    /// `<fibres>` and `<matrices>` used to travel this way too, which is how
    /// they survived a save before micromechanics was ported; they are read
    /// properly now.
    #[serde(default)]
    pub unsupported_sections: Vec<RawElement>,
    /// `<optimizations>`, which is a PROJECT-level section rather than a
    /// laminate module: a search is not about a stack, it is looking for one.
    #[serde(default)]
    pub optimizations: Vec<NamedOptimization>,
    /// `<webExtension>`: what only the web version uses. `None` when the file
    /// had none it could read - one of an unknown schema stays in
    /// `unsupported_sections` instead, see `project::web_extension`.
    #[serde(default)]
    pub web_extension: Option<WebExtension>,
    /// What the reader could not use, for the UI to report. Filled on read and
    /// ignored on write.
    #[serde(default)]
    pub import_notices: Vec<ImportNotice>,
}

/// One saved search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedOptimization {
    pub name: String,
    /// Which of the four searches to run, by the code `optimization` uses.
    pub optimizer: String,
    /// eLamX's own id for the angle-set preset the user picked.
    ///
    /// Purely a UI memory - nothing computes with it, and the angles
    /// themselves are stored beside it. Carried so that reopening a project
    /// shows the same preset selected rather than "custom".
    pub angle_type: i32,
    pub input: OptimizationInput,
}

/// A laminate together with the module data attached to it. The original
/// allows SEVERAL named instances per module type ("Berechnung", "Berechnung2"),
/// which is how one compares load cases on the same stack - hence lists, not
/// single values.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct ProjectLaminate {
    pub laminate: Laminate,
    pub calculations: Vec<NamedCalculation>,
    pub bucklings: Vec<NamedBuckling>,
    #[serde(default)]
    pub last_ply_failures: Vec<NamedLastPlyFailure>,
    #[serde(default)]
    pub pressure_vessels: Vec<NamedPressureVessel>,
    #[serde(default)]
    pub deformations: Vec<NamedDeformation>,
    #[serde(default)]
    pub vibrations: Vec<NamedVibration>,
    #[serde(default)]
    pub spring_ins: Vec<NamedSpringIn>,
    #[serde(default)]
    pub cutouts: Vec<NamedCutout>,
    /// Module data from modules this crate does not implement, kept as raw XML
    /// so a read/write cycle is lossless. Order is the order in the file.
    #[serde(default)]
    pub unsupported_modules: Vec<RawElement>,
}

/// One CLT load case.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedCalculation {
    pub name: String,
    pub loads: Loads,
    pub strains: Strains,
    /// Per degree of freedom: `true` prescribes the strain, `false` the load.
    pub use_strain: [bool; 6],
}

/// One plate-buckling analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedBuckling {
    pub name: String,
    pub input: BucklingInput,
}

/// One last-ply-failure analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedLastPlyFailure {
    pub name: String,
    pub input: LastPlyFailureInput,
}

/// One pressure-vessel analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedPressureVessel {
    pub name: String,
    pub input: PressureVesselInput,
}

/// One plate-deformation analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedDeformation {
    pub name: String,
    pub input: DeformationInput,
}

/// One plate-vibration analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedVibration {
    pub name: String,
    pub input: VibrationInput,
}

/// One spring-in analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedSpringIn {
    pub name: String,
    pub input: SpringInInput,
}

/// One cutout analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedCutout {
    pub name: String,
    pub input: CutoutInput,
}

/// An element this crate does not interpret, kept verbatim so that a read/
/// write cycle does not drop it. Used at two levels: under `<laminate>` for
/// module data (spring-in, cutouts, ...) and under `<elamx>` for whole
/// sections (`<fibres>`, `<matrices>`, `<optimizations>`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct RawElement {
    /// Element name, e.g. `springIn` or `fibres`.
    pub tag: String,
    /// The element serialised back to XML, including its own tag.
    pub xml: String,
}
