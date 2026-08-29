//! ABD-matrix assembly and load/strain resolution.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory/src/de/elamx/clt/{CLT_Calculator,CLT_Laminate,CLT_Layer,CLT_LayerResult,Loads,Strains}.java

// These solvers read and write several matrix indices per loop body, so
// index-based loops stay closer to the underlying linear algebra than the
// iterator-chain rewrites clippy suggests (see mathtools for the same rationale).
#![allow(clippy::needless_range_loop)]

pub mod calculator;
pub mod laminate;
pub mod last_ply_failure;
pub mod layer;
pub mod loads;
pub mod strains;

pub use calculator::{
    alpha_global, beta_global, determine_values, get_layer_results, get_layer_results_radial,
    hygro_thermal_forces, LayerResult, LayerResultError,
};
pub use laminate::{CltLaminate, LayerContribution, MassMoments, MissingMaterialError};
pub use last_ply_failure::{
    calculate as calculate_last_ply_failure, LastPlyFailureError, LastPlyFailureEvent,
    LastPlyFailureInput, LastPlyFailureIteration, LastPlyFailureResult,
};
pub use layer::{CltLayer, LayerPosition};
pub use loads::Loads;
pub use strains::Strains;

/// Re-exported for convenience - `StressStrainState` lives in `model` since
/// `clt` and `failure` both need it (matching the Java original, which puts
/// it in the shared `de.elamx.laminate` package rather than the CLT package).
pub use crate::model::StressStrainState;
