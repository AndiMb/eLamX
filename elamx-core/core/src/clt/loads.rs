//! Applied loads (forces/moments) and hygrothermal state.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory/src/de/elamx/clt/Loads.java

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Loads {
    pub n_x: f64,
    pub n_y: f64,
    pub n_xy: f64,
    pub m_x: f64,
    pub m_y: f64,
    pub m_xy: f64,
    pub delta_t: f64,
    pub delta_h: f64,

    /// Hygrothermal force/moment contribution, filled in by `determine_values`.
    pub nt_x: f64,
    pub nt_y: f64,
    pub nt_xy: f64,
    pub mt_x: f64,
    pub mt_y: f64,
    pub mt_xy: f64,
}

impl Loads {
    pub fn force_moment_vector(&self) -> [f64; 6] {
        [self.n_x, self.n_y, self.n_xy, self.m_x, self.m_y, self.m_xy]
    }

    pub fn set_hygrothermal_forces_vector(&mut self, forces: [f64; 6]) {
        self.nt_x = forces[0];
        self.nt_y = forces[1];
        self.nt_xy = forces[2];
        self.mt_x = forces[3];
        self.mt_y = forces[4];
        self.mt_xy = forces[5];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn force_moment_vector_matches_field_order() {
        let loads = Loads {
            n_x: 1.0,
            n_y: 2.0,
            n_xy: 3.0,
            m_x: 4.0,
            m_y: 5.0,
            m_xy: 6.0,
            ..Default::default()
        };
        assert_eq!(loads.force_moment_vector(), [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    }

    #[test]
    fn set_hygrothermal_forces_vector_assigns_all_fields() {
        let mut loads = Loads::default();
        loads.set_hygrothermal_forces_vector([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(loads.nt_x, 1.0);
        assert_eq!(loads.mt_xy, 6.0);
    }
}
