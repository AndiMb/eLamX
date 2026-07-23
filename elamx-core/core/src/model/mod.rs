//! Material/Layer/Laminate data model. Reference: eLamX2/Laminate/src/de/elamx/laminate/{Laminat,DataLayer,DefaultMaterial}.java

pub mod laminate;
pub mod layer;
pub mod material;
pub mod stress_strain_state;

pub use laminate::{Laminate, ResolvedLayer};
pub use layer::Layer;
pub use material::Material;
pub use stress_strain_state::StressStrainState;
