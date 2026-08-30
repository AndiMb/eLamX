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
//! What is covered: materials, laminates with their layers, CLT calculations,
//! buckling, last-ply-failure and pressure-vessel analyses - everything the
//! ported calculation modules need. Module data this crate cannot calculate yet
//! (cutouts, spring-in, optimisation, stiffeners) is **preserved verbatim** on
//! read and written back unchanged, so opening and saving a file in the web
//! version does not silently destroy what the desktop put there.

pub mod naming;
mod read;
mod write;

pub use read::{read_elamx, ReadError};
pub use write::write_elamx;

use crate::clt::{LastPlyFailureInput, Loads, PressureVesselInput, Strains};
use crate::model::{Laminate, Material};
use crate::plate::BucklingInput;
use serde::{Deserialize, Serialize};

/// A whole `.elamx` document.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Project {
    /// Format version from the `<elamx version="...">` attribute. Written back
    /// as read so a file does not silently change format generation.
    pub version: String,
    pub materials: Vec<Material>,
    pub laminates: Vec<ProjectLaminate>,
}

/// A laminate together with the module data attached to it. The original
/// allows SEVERAL named instances per module type ("Berechnung", "Berechnung2"),
/// which is how one compares load cases on the same stack - hence lists, not
/// single values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectLaminate {
    pub laminate: Laminate,
    pub calculations: Vec<NamedCalculation>,
    pub bucklings: Vec<NamedBuckling>,
    #[serde(default)]
    pub last_ply_failures: Vec<NamedLastPlyFailure>,
    #[serde(default)]
    pub pressure_vessels: Vec<NamedPressureVessel>,
    /// Module data from modules this crate does not implement, kept as raw XML
    /// so a read/write cycle is lossless. Order is the order in the file.
    #[serde(default)]
    pub unsupported_modules: Vec<RawModule>,
}

/// One CLT load case.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedCalculation {
    pub name: String,
    pub loads: Loads,
    pub strains: Strains,
    /// Per degree of freedom: `true` prescribes the strain, `false` the load.
    pub use_strain: [bool; 6],
}

/// One plate-buckling analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedBuckling {
    pub name: String,
    pub input: BucklingInput,
}

/// One last-ply-failure analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedLastPlyFailure {
    pub name: String,
    pub input: LastPlyFailureInput,
}

/// One pressure-vessel analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedPressureVessel {
    pub name: String,
    pub input: PressureVesselInput,
}

/// An element under `<laminate>` that this crate does not interpret.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawModule {
    /// Element name, e.g. `springIn`.
    pub tag: String,
    /// The element serialised back to XML, including its own tag.
    pub xml: String,
}
