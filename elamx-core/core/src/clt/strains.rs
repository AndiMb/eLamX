//! Mid-plane strains and curvatures.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory/src/de/elamx/clt/Strains.java

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct Strains {
    pub epsilon_x: f64,
    pub epsilon_y: f64,
    pub gamma_xy: f64,
    pub kappa_x: f64,
    pub kappa_y: f64,
    pub kappa_xy: f64,
}

impl Strains {
    pub fn epsilon_kappa_vector(&self) -> [f64; 6] {
        [
            self.epsilon_x,
            self.epsilon_y,
            self.gamma_xy,
            self.kappa_x,
            self.kappa_y,
            self.kappa_xy,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epsilon_kappa_vector_matches_field_order() {
        let strains = Strains {
            epsilon_x: 1.0,
            epsilon_y: 2.0,
            gamma_xy: 3.0,
            kappa_x: 4.0,
            kappa_y: 5.0,
            kappa_xy: 6.0,
        };
        assert_eq!(
            strains.epsilon_kappa_vector(),
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        );
    }
}
