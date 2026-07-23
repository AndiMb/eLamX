//! Result type for failure criteria.
//! Reference: eLamX2/Laminate/src/de/elamx/laminate/failure/ReserveFactor.java

use serde::{Deserialize, Serialize};

/// Which failure mechanism a reserve factor corresponds to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailureType {
    Undamaged,
    FiberFailure,
    MatrixFailure,
    GeneralMaterialFailure,
}

/// Result of evaluating a failure criterion at a stress/strain state: the
/// governing reserve factor, which mechanism produced it, and a short name
/// identifying the failure mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReserveFactor {
    pub failure_name: String,
    pub minimal_reserve_factor: f64,
    pub failure_type: FailureType,
}

impl ReserveFactor {
    /// No load is acting in any of the evaluated directions, so the criterion
    /// cannot govern failure - an infinite reserve.
    pub fn undamaged() -> Self {
        ReserveFactor {
            failure_name: String::new(),
            minimal_reserve_factor: f64::INFINITY,
            failure_type: FailureType::Undamaged,
        }
    }
}
