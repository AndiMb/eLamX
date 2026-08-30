//! A local stress/strain state at a point, used both by CLT layer results and
//! failure criteria. Reference: eLamX2/Laminate/src/de/elamx/laminate/StressStrainState.java
//!
//! The Java original also carries a mutable, cacheable `rf: ReserveFactor`
//! field. That's dropped here: this module returns fresh values rather than
//! mutating a live object graph, so there is nothing to cache onto.

use serde::{Deserialize, Serialize};

/// Stress/strain state at a point, in order (11, 22, 12) - i.e. fibre-parallel,
/// fibre-perpendicular, in-plane shear.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct StressStrainState {
    pub stress: [f64; 3],
    pub strain: [f64; 3],
}
