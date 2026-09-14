//! Beam stiffeners riding on a rectangular plate.
//!
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/Stiffener/
//! and the two profiles in eLamX2/AdditionalStiffeners/.
//!
//! A stiffener is a beam glued along one grid line of the plate. It never gets
//! degrees of freedom of its own: it is forced to follow the plate's deflection
//! at its line, so its bending and torsional energy can be written in the
//! plate's own Ritz coefficients and simply added to the stiffness matrix. That
//! is the whole model - which is why the same code serves buckling and
//! deformation, and why nothing here knows about loads.
//!
//! In the Java original the section properties are a service interface with one
//! implementation per profile, discovered through Lookup. This app bundles a
//! fixed set, so the shapes are an enum - the same call the D-matrix choice
//! makes, and for the same reason: the choice has to survive a round trip
//! through JSON and through the `.elamx` file.

use serde::{Deserialize, Serialize};

use super::boundary::Boundary;

/// Which way a stiffener runs.
///
/// The name says the direction the beam RUNS, so an `X` stiffener is a line of
/// constant y and its `position` is measured along y. The Java constants are
/// 1 and 2 and the file stores those numbers; the names are ours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum StiffenerDirection {
    X,
    Y,
}

impl StiffenerDirection {
    pub const ALL: [StiffenerDirection; 2] = [StiffenerDirection::X, StiffenerDirection::Y];

    pub fn code(&self) -> &'static str {
        match self {
            StiffenerDirection::X => "x",
            StiffenerDirection::Y => "y",
        }
    }

    /// The number the `.elamx` file stores (`Stiffener.X_DIRECTION` = 1).
    pub fn java_index(&self) -> i32 {
        match self {
            StiffenerDirection::X => 1,
            StiffenerDirection::Y => 2,
        }
    }

    pub fn from_java_index(index: i32) -> Option<Self> {
        match index {
            1 => Some(StiffenerDirection::X),
            2 => Some(StiffenerDirection::Y),
            _ => None,
        }
    }
}

/// Where a stiffener's section properties come from.
///
/// `Direct` is eLamX's "Freie Eingabe": the numbers the stiffness matrix
/// actually wants, typed in. The two profiles compute the same numbers from
/// their geometry, exactly as `I_StiffenerProperties` and
/// `T_StiffenerProperties` do.
///
/// One property of the Java model is deliberately missing: `getZ()`, the
/// stiffener's centroid height. It is declared on the interface and implemented
/// by all three, but nothing ever reads it (not the analyses, not the 3D view),
/// and the direct input does not even persist it. Carrying it would suggest it
/// meant something.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "profile", rename_all = "snake_case")]
pub enum StiffenerGeometry {
    /// The section properties typed in directly.
    Direct {
        /// Young's modulus, in MPa.
        e: f64,
        /// Second moment of area about the plate's mid-plane, in mm^4.
        i: f64,
        /// Shear modulus, in MPa.
        g: f64,
        /// Torsion constant, in mm^4.
        j: f64,
        /// Cross-section area, in mm^2. Only a mass matrix would use it.
        a: f64,
        /// Density, in t/mm^3. Only a mass matrix would use it.
        rho: f64,
    },
    /// A blade standing on the plate: height `w1`, thickness `t1`. eLamX calls
    /// it the I profile.
    IProfile { w1: f64, t1: f64, e: f64, g: f64, rho: f64 },
    /// A blade of height `w2` and thickness `t2` carrying a flange of width
    /// `w1` and thickness `t1` on top.
    TProfile { w1: f64, t1: f64, w2: f64, t2: f64, e: f64, g: f64, rho: f64 },
}

impl StiffenerGeometry {
    /// Young's modulus, in MPa.
    pub fn e(&self) -> f64 {
        match *self {
            StiffenerGeometry::Direct { e, .. }
            | StiffenerGeometry::IProfile { e, .. }
            | StiffenerGeometry::TProfile { e, .. } => e,
        }
    }

    /// Shear modulus, in MPa.
    pub fn g(&self) -> f64 {
        match *self {
            StiffenerGeometry::Direct { g, .. }
            | StiffenerGeometry::IProfile { g, .. }
            | StiffenerGeometry::TProfile { g, .. } => g,
        }
    }

    /// Density, in t/mm^3.
    pub fn rho(&self) -> f64 {
        match *self {
            StiffenerGeometry::Direct { rho, .. }
            | StiffenerGeometry::IProfile { rho, .. }
            | StiffenerGeometry::TProfile { rho, .. } => rho,
        }
    }

    /// Second moment of area, in mm^4.
    ///
    /// Note where it is taken: about the plate's mid-surface, not about the
    /// stiffener's own centroid. That is what the coupling assumption requires,
    /// since the beam bends with the plate's surface, and it is what both
    /// profiles compute - each Steiner term is measured from z = 0 at the plate.
    pub fn i(&self) -> f64 {
        match *self {
            StiffenerGeometry::Direct { i, .. } => i,
            StiffenerGeometry::IProfile { w1, t1, .. } => {
                let zm = w1 / 2.0;
                t1 * w1 * w1 * w1 / 12.0 + zm * zm * w1 * t1
            }
            StiffenerGeometry::TProfile { w1, t1, w2, t2, .. } => {
                let zm1 = w2 + t1 / 2.0;
                let zm2 = w2 / 2.0;
                w1 * t1 * t1 * t1 / 12.0
                    + zm1 * zm1 * w1 * t1
                    + t2 * w2 * w2 * w2 / 12.0
                    + zm2 * zm2 * w2 * t2
            }
        }
    }

    /// Torsion constant, in mm^4.
    ///
    /// Both profiles use the thin-open-section approximation sum(b t^3)/3,
    /// which needs every wall to be much wider than it is thick. The Java
    /// source says so in a comment on the T profile; the same holds for the
    /// blade.
    pub fn j(&self) -> f64 {
        match *self {
            StiffenerGeometry::Direct { j, .. } => j,
            StiffenerGeometry::IProfile { w1, t1, .. } => w1 * t1 * t1 * t1 / 3.0,
            StiffenerGeometry::TProfile { w1, t1, w2, t2, .. } => {
                (w1 * t1 * t1 * t1 + (w2 + t1 / 2.0) * t2 * t2 * t2) / 3.0
            }
        }
    }

    /// Cross-section area, in mm^2.
    pub fn a(&self) -> f64 {
        match *self {
            StiffenerGeometry::Direct { a, .. } => a,
            StiffenerGeometry::IProfile { w1, t1, .. } => w1 * t1,
            StiffenerGeometry::TProfile { w1, t1, w2, t2, .. } => w1 * t1 + w2 * t2,
        }
    }

    /// How tall the stiffener stands on the plate, in mm - what a 3D view has
    /// to draw. Zero for the direct input, which knows only stiffnesses.
    pub fn height(&self) -> f64 {
        match *self {
            StiffenerGeometry::Direct { .. } => 0.0,
            StiffenerGeometry::IProfile { w1, .. } => w1,
            StiffenerGeometry::TProfile { t1, w2, .. } => w2 + t1,
        }
    }

    /// The code the file and the UI use for the profile.
    pub fn code(&self) -> &'static str {
        match self {
            StiffenerGeometry::Direct { .. } => "direct",
            StiffenerGeometry::IProfile { .. } => "i_profile",
            StiffenerGeometry::TProfile { .. } => "t_profile",
        }
    }
}

/// A stiffener: a named beam, running one way, at one position.
///
/// `position` is measured from the plate's CENTRE, like the point load's
/// coordinates and like eLamX's own input - the shape functions live on
/// [0, a], so every use of it adds half the span first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct Stiffener {
    pub name: String,
    pub direction: StiffenerDirection,
    /// Distance from the plate's centre, in mm.
    pub position: f64,
    #[serde(flatten)]
    pub geometry: StiffenerGeometry,
}

/// Adds every stiffener's contribution to the Ritz stiffness matrix.
///
/// Port of `Stiffenerx.addStiffness` and `Stiffenery.addStiffness`, with the
/// shape-function evaluations lifted out of the innermost loop: the Java code
/// calls `wx` inside a quadruple loop, which evaluates the same `m + n` values
/// (m*n)^2 times over. The arithmetic is identical, only how often it happens
/// differs.
pub fn add_stiffener_stiffness(
    k: &mut [Vec<f64>],
    stiffeners: &[Stiffener],
    m: usize,
    n: usize,
    bx: &Boundary,
    by: &Boundary,
) {
    for stiffener in stiffeners {
        let ei = stiffener.geometry.e() * stiffener.geometry.i();
        let gj = stiffener.geometry.g() * stiffener.geometry.j();
        if ei == 0.0 && gj == 0.0 {
            continue;
        }

        // The direction the beam runs is the one it integrates over; the other
        // one is only sampled, at the stiffener's line. Naming them "along" and
        // "across" lets the two directions share the assembly below.
        let (along, across, runs_along_x) = match stiffener.direction {
            StiffenerDirection::X => (bx, by, true),
            StiffenerDirection::Y => (by, bx, false),
        };
        let t_pos = stiffener.position + across.length() / 2.0;

        let terms_across = if runs_along_x { n } else { m };
        let w: Vec<f64> = (0..terms_across).map(|i| across.wx(i, t_pos)).collect();
        let wd: Vec<f64> = (0..terms_across).map(|i| across.wdx(i, t_pos)).collect();

        let mut row = 0;
        for pp in 0..m {
            for qq in 0..n {
                // (pp, qq) is the variation, (ii, jj) the displacement. The
                // index running along the beam picks the integral, the one
                // across it the sampled shape function.
                let (along_var, across_var) = if runs_along_x { (pp, qq) } else { (qq, pp) };
                let mut col = 0;
                for ii in 0..m {
                    for jj in 0..n {
                        let (along_disp, across_disp) =
                            if runs_along_x { (ii, jj) } else { (jj, ii) };
                        k[row][col] += ei
                            * along.idx2dx2(along_disp, along_var)
                            * w[across_disp]
                            * w[across_var]
                            + gj * along.idxdx(along_disp, along_var)
                                * wd[across_disp]
                                * wd[across_var];
                        col += 1;
                    }
                }
                row += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plate::BoundaryCondition;

    /// The section properties of the blade, against the textbook values for a
    /// rectangle standing on the plate surface.
    #[test]
    fn the_blade_profile_matches_its_closed_form() {
        let blade = StiffenerGeometry::IProfile {
            w1: 30.0,
            t1: 3.0,
            e: 70000.0,
            g: 27000.0,
            rho: 2.7e-9,
        };
        assert!((blade.a() - 90.0).abs() < 1e-12);
        // About the plate surface a rectangle of height h and width t has
        // t h^3 / 3 - the centroidal t h^3 / 12 plus the Steiner term at h/2.
        assert!((blade.i() - 3.0 * 30.0f64.powi(3) / 3.0).abs() < 1e-9);
        // Thin open section: b t^3 / 3.
        assert!((blade.j() - 30.0 * 27.0 / 3.0).abs() < 1e-12);
        assert!((blade.height() - 30.0).abs() < 1e-12);
    }

    /// The T profile against the same quantities summed over its two walls by
    /// hand - the point being that the Steiner terms are taken from the plate
    /// surface, not from the section's own centroid.
    #[test]
    fn the_t_profile_sums_its_two_walls() {
        let t = StiffenerGeometry::TProfile {
            w1: 20.0,
            t1: 2.0,
            w2: 25.0,
            t2: 3.0,
            e: 70000.0,
            g: 27000.0,
            rho: 2.7e-9,
        };
        assert!((t.a() - (20.0 * 2.0 + 25.0 * 3.0)).abs() < 1e-12);

        let flange_centre = 25.0 + 1.0;
        let web_centre = 12.5;
        let expected = 20.0 * 8.0 / 12.0
            + flange_centre * flange_centre * 40.0
            + 3.0 * 25.0f64.powi(3) / 12.0
            + web_centre * web_centre * 75.0;
        assert!((t.i() - expected).abs() < 1e-9);
        assert!((t.height() - 27.0).abs() < 1e-12);
    }

    fn assemble(stiffeners: &[Stiffener], m: usize, n: usize) -> Vec<Vec<f64>> {
        let bx = Boundary::new(BoundaryCondition::SimplySimply, 400.0);
        let by = Boundary::new(BoundaryCondition::SimplySimply, 400.0);
        let mut k = vec![vec![0.0; m * n]; m * n];
        add_stiffener_stiffness(&mut k, stiffeners, m, n, &bx, &by);
        k
    }

    fn blade(direction: StiffenerDirection, position: f64) -> Stiffener {
        Stiffener {
            name: "s".into(),
            direction,
            position,
            geometry: StiffenerGeometry::IProfile {
                w1: 30.0,
                t1: 3.0,
                e: 70000.0,
                g: 27000.0,
                rho: 2.7e-9,
            },
        }
    }

    /// The contribution has to be symmetric: it comes from an energy, so the
    /// variation and the displacement index enter it the same way. An index
    /// transposed in the assembly above would break this and nothing else.
    #[test]
    fn the_contribution_is_symmetric() {
        for direction in StiffenerDirection::ALL {
            let k = assemble(&[blade(direction, 37.0)], 5, 6);
            for (r, row) in k.iter().enumerate() {
                for (c, value) in row.iter().enumerate() {
                    let other = k[c][r];
                    assert!(
                        (value - other).abs() <= 1e-9 * value.abs().max(1.0),
                        "{direction:?}: K[{r}][{c}] = {value} but K[{c}][{r}] = {other}",
                    );
                }
            }
        }
    }

    /// On a square plate with equal edge conditions, turning the stiffener and
    /// the plate together has to give the same matrix under the index swap
    /// (i, j) -> (j, i). This is the check that the two directions are each
    /// other's mirror rather than two independently mistyped formulas.
    #[test]
    fn the_two_directions_mirror_each_other() {
        let (m, n) = (6, 6);
        let along_x = assemble(&[blade(StiffenerDirection::X, 55.0)], m, n);
        let along_y = assemble(&[blade(StiffenerDirection::Y, 55.0)], m, n);

        for pp in 0..m {
            for qq in 0..n {
                for ii in 0..m {
                    for jj in 0..n {
                        let x = along_x[pp * n + qq][ii * n + jj];
                        let y = along_y[qq * n + pp][jj * n + ii];
                        assert!(
                            (x - y).abs() <= 1e-9 * x.abs().max(1.0),
                            "({pp},{qq},{ii},{jj}): {x} vs {y}",
                        );
                    }
                }
            }
        }
    }

    /// A stiffener sitting exactly on a simply supported edge cannot stiffen
    /// anything in bending: every shape function vanishes there, and the
    /// bending term goes with it. Only torsion, which rides on the slope,
    /// would survive - so this probe switches it off.
    #[test]
    fn a_stiffener_on_a_simply_supported_edge_adds_no_bending() {
        let mut s = blade(StiffenerDirection::X, -200.0);
        s.geometry = StiffenerGeometry::Direct {
            e: 70000.0,
            i: 1.0e5,
            g: 0.0,
            j: 0.0,
            a: 90.0,
            rho: 2.7e-9,
        };
        let k = assemble(&[s], 4, 4);
        let peak = k.iter().flat_map(|r| r.iter()).fold(0.0f64, |a, v| a.max(v.abs()));
        assert!(peak < 1e-9, "expected no contribution, peak was {peak}");
    }

    /// Two identical stiffeners at the same place are exactly one of twice the
    /// stiffness - the contribution is linear in E*I and G*J and additive over
    /// the list.
    #[test]
    fn stiffeners_add_up() {
        let one = assemble(&[blade(StiffenerDirection::Y, -60.0)], 4, 5);
        let two = assemble(
            &[blade(StiffenerDirection::Y, -60.0), blade(StiffenerDirection::Y, -60.0)],
            4,
            5,
        );
        for (a, b) in one.iter().flatten().zip(two.iter().flatten()) {
            assert!((2.0 * a - b).abs() <= 1e-9 * b.abs().max(1.0));
        }
    }
}
