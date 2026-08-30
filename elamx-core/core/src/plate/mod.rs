//! Rectangular-plate analyses on top of a CLT laminate.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/
//!
//! Buckling and deformation are implemented, and share the Ritz machinery in
//! `ritz` (the stiffness assembly and the evaluation of a coefficient grid
//! into a displacement field) on top of the boundary shape functions and the
//! D-matrix choice. Vibration is the remaining member of the Java module: it
//! needs a mass matrix beside the same stiffness matrix and the generalised
//! eigensolver in mathtools::eigen, so it slots in beside these two rather
//! than replacing anything. Cutouts are their own problem.
//!
//! Stiffeners (the Java `Stiffener/` subtree) are also not ported: they are an
//! additive contribution to the stiffness matrix with their own property model
//! and UI, independent of everything below.

pub mod boundary;
mod boundary_tables;
pub mod buckling;
pub mod deformation;
pub mod dmatrix;
pub mod ritz;

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
