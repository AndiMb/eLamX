//! Rectangular-plate analyses on top of a CLT laminate.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/
//!
//! All three of the Java module's analyses are here - buckling, deformation
//! and vibration - and they share the Ritz machinery in `ritz` (the stiffness
//! assembly and the evaluation of a coefficient grid into a displacement
//! field) on top of the boundary shape functions and the D-matrix choice.
//! What distinguishes them is only what stands beside that stiffness matrix: a
//! geometric stiffness and an eigenvalue problem, a load vector and a linear
//! solve, or a mass matrix and the same eigenvalue problem. Cutouts are their
//! own problem.
//!
//! Stiffeners live in `stiffener`: an additive contribution to the same
//! stiffness matrix, which is why both analyses carry a list of them and
//! neither had to change anywhere else.

pub mod boundary;
mod boundary_tables;
pub mod buckling;
pub mod deformation;
pub mod dmatrix;
pub mod field;
pub mod ritz;
pub mod stiffener;
pub mod vibration;

pub use boundary::{Boundary, BoundaryCondition};
pub use boundary_tables::MAX_TERMS;
pub use buckling::{
    calculate as calculate_buckling, mode_surface, BucklingError, BucklingInput, BucklingMode,
    BucklingResult,
};
pub use deformation::{
    calculate as calculate_deformation, DeformationError, DeformationInput, DeformationResult,
    NamedLoad, TransverseLoad,
};
pub use dmatrix::DMatrixKind;
pub use field::{
    evaluate as evaluate_plate_field, PlateField, PlateFieldError, PlateFieldResult,
    PlateFieldSelection, DEFAULT_SAMPLES, MAX_SAMPLES, MIN_SAMPLES,
};
pub use stiffener::{
    add_stiffener_mass, add_stiffener_stiffness, Stiffener, StiffenerDirection, StiffenerGeometry,
};
pub use vibration::{
    calculate as calculate_vibration, mode_surface as vibration_mode_surface, VibrationError,
    VibrationInput, VibrationMode, VibrationResult,
};
