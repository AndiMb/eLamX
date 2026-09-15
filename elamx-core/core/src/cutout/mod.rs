//! Stress and moment resultants around a hole in a laminate.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Cutout/ and
//! eLamX2/AdditionalCutoutGeometries/
//!
//! The one module in eLamX that is not a discretisation of anything: it is a
//! closed-form elasticity solution, Lekhnitskii's complex potentials as
//! extended by Ukadgaonker and Rao, evaluated exactly on the hole's edge. What
//! it answers is the question a drawing raises - "the load path has to go round
//! this hole; how much worse does it get at the edge?" - and it answers it
//! without a mesh.
//!
//! Two papers, two paths:
//!
//! - *A general solution for stresses around holes in symmetric laminates
//!   under inplane loading* - the force resultants;
//! - *A general solution for moments around holes in symmetric laminates* -
//!   the moment resultants.
//!
//! and for an unsymmetric stack a third, where the two cannot be separated
//! because the B matrix couples them.

pub mod geometry;

pub use geometry::{CutoutGeometry, DEFAULT_TERMS, MAX_TERMS};
