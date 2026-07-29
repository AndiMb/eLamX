//! Rectangular-plate analyses on top of a CLT laminate.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/
//!
//! Buckling is implemented. Vibration, deformation and cutouts are the other
//! members of the Java module and are not ported yet; they share the Ritz
//! machinery here (boundary shape functions, the D-matrix choice, and the
//! generalised eigensolver in mathtools::eigen), so they slot in beside
//! `buckling` rather than replacing any of it.
//!
//! Stiffeners (the Java `Stiffener/` subtree) are also not ported: they are an
//! additive contribution to the stiffness matrix with their own property model
//! and UI, independent of everything below.

pub mod boundary;
mod boundary_tables;
pub mod buckling;
pub mod dmatrix;

pub use boundary::{Boundary, BoundaryCondition};
pub use boundary_tables::MAX_TERMS;
pub use buckling::{
    calculate as calculate_buckling, mode_surface, BucklingError, BucklingInput, BucklingMode,
    BucklingResult,
};
pub use dmatrix::DMatrixKind;
