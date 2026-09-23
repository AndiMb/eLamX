//! Design rules for a stacking sequence (F2.7): the checks a stress
//! engineer runs by eye on every layup before any number is computed.
//!
//! Not in the Java original. They are advisory - nothing refuses a laminate
//! that breaks one - and they live in the core rather than in the frontend
//! because the optimiser's candidates need the same verdicts as the editor.
//!
//! Every rule reads the EXPANDED stack, the one `Laminate::all_layers`
//! builds: the plies a symmetric laminate mirrors, and its middle ply once,
//! are as real to a rule as the stored half. Angles are compared after
//! reduction to -90..=90, so 90 and -90 are the same orientation.
//!
//! The five rules and their usual thresholds:
//!
//! 1. **Symmetric** about the mid-plane, so that no bending-extension
//!    coupling (B matrix) warps the part when it cures or is loaded.
//! 2. **Balanced**: as many -theta as +theta plies for every off-axis angle,
//!    so that no extension-shear coupling (A16, A26) appears.
//! 3. **Minimum share per orientation**, 10 % of the plies by default, in
//!    each of the three families 0, +-45 and 90 - the "10 % rule" that keeps
//!    a laminate from being hopeless in any direction it was not designed
//!    for. +45 and -45 count as ONE family: balance is rule 2's business.
//! 4. **At most N equal plies in a row**, 4 by default, since a thick block
//!    of one orientation cracks at its interfaces (free-edge delamination,
//!    matrix cracking between the plies).
//! 5. **+-45 outside**: both surface plies at +45 or -45, for damage
//!    tolerance and buckling.

use serde::{Deserialize, Serialize};

/// Two angles closer than this are the same orientation. Plies are specified
/// in whole or tenths of degrees; this only absorbs floating-point noise.
const ANGLE_TOLERANCE: f64 = 1.0e-6;

/// The thresholds of the rules that have one. Unknown or missing fields fall
/// back to the defaults, so settings written by another version still read.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(default)]
pub struct RuleSettings {
    /// Smallest share of the plies each orientation family needs, 0..1.
    pub min_fraction: f64,
    /// Most plies of one angle allowed next to each other.
    pub max_consecutive: u32,
}

impl Default for RuleSettings {
    fn default() -> Self {
        RuleSettings { min_fraction: 0.10, max_consecutive: 4 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum StackingRule {
    Symmetric,
    Balanced,
    MinFraction,
    MaxConsecutive,
    OuterPlies45,
}

/// The three orientation families of the minimum-share rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum OrientationFamily {
    Zero,
    PlusMinus45,
    Ninety,
}

/// What a rule found, in numbers the UI can phrase.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuleDetail {
    /// Symmetric by construction, or the first mirrored pair that differs
    /// (1-based ply numbers from the top).
    Symmetry { mismatch: Option<[u32; 2]> },
    /// Every off-axis angle whose +theta and -theta counts differ.
    Balance { unbalanced: Vec<AngleCount> },
    /// The share of each family, in the order 0, +-45, 90.
    Fractions { shares: Vec<FamilyShare> },
    /// The longest run of one angle: where it starts (1-based) and how long.
    LongestRun { angle: f64, start: u32, length: u32 },
    /// The two surface plies' angles, top first.
    Surfaces { top: f64, bottom: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct AngleCount {
    /// The positive angle of the pair.
    pub angle: f64,
    pub plus: u32,
    pub minus: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct FamilyShare {
    pub family: OrientationFamily,
    pub plies: u32,
    /// Share of all plies, 0..1.
    pub share: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct RuleResult {
    pub rule: StackingRule,
    pub passed: bool,
    pub detail: RuleDetail,
}

/// Checks a stacking sequence against the five rules, in the order listed in
/// the module documentation. `angles` is the STORED sequence, outside in, as
/// a laminate keeps it; `symmetric` and `with_middle_layer` expand it the way
/// `Laminate::all_layers` does. An empty stack has nothing to check and
/// returns no results.
pub fn check_stacking_rules(
    angles: &[f64],
    symmetric: bool,
    with_middle_layer: bool,
    settings: &RuleSettings,
) -> Vec<RuleResult> {
    let stack = expand(angles, symmetric, with_middle_layer);
    if stack.is_empty() {
        return Vec::new();
    }
    vec![
        symmetry(&stack),
        balance(&stack),
        fractions(&stack, settings.min_fraction),
        longest_run(&stack, settings.max_consecutive),
        surfaces(&stack),
    ]
}

/// The whole stack, top ply first, every angle reduced to -90..=90.
fn expand(angles: &[f64], symmetric: bool, with_middle_layer: bool) -> Vec<f64> {
    let mut stack: Vec<f64> = angles.iter().map(|a| reduce(*a)).collect();
    if symmetric {
        let mirrored = if with_middle_layer && !stack.is_empty() {
            &stack[..stack.len() - 1]
        } else {
            &stack[..]
        };
        let tail: Vec<f64> = mirrored.iter().rev().copied().collect();
        stack.extend(tail);
    }
    stack
}

fn reduce(angle: f64) -> f64 {
    let mut a = angle % 180.0;
    if a > 90.0 {
        a -= 180.0;
    } else if a <= -90.0 {
        a += 180.0;
    }
    // -90 and 90 are one orientation; call it 90.
    if (a + 90.0).abs() < ANGLE_TOLERANCE {
        90.0
    } else {
        a
    }
}

fn same(a: f64, b: f64) -> bool {
    (a - b).abs() < ANGLE_TOLERANCE
}

fn symmetry(stack: &[f64]) -> RuleResult {
    let n = stack.len();
    let mismatch = (0..n / 2)
        .find(|&i| !same(stack[i], stack[n - 1 - i]))
        .map(|i| [i as u32 + 1, (n - i) as u32]);
    RuleResult {
        rule: StackingRule::Symmetric,
        passed: mismatch.is_none(),
        detail: RuleDetail::Symmetry { mismatch },
    }
}

fn balance(stack: &[f64]) -> RuleResult {
    let mut pairs: Vec<AngleCount> = Vec::new();
    for &angle in stack {
        // 0 and 90 are their own mirror image and need no partner.
        if same(angle, 0.0) || same(angle.abs(), 90.0) {
            continue;
        }
        let magnitude = angle.abs();
        let entry = match pairs.iter_mut().position(|p| same(p.angle, magnitude)) {
            Some(i) => &mut pairs[i],
            None => {
                pairs.push(AngleCount { angle: magnitude, plus: 0, minus: 0 });
                pairs.last_mut().expect("just pushed")
            }
        };
        if angle > 0.0 {
            entry.plus += 1;
        } else {
            entry.minus += 1;
        }
    }
    let unbalanced: Vec<AngleCount> = pairs.into_iter().filter(|p| p.plus != p.minus).collect();
    RuleResult {
        rule: StackingRule::Balanced,
        passed: unbalanced.is_empty(),
        detail: RuleDetail::Balance { unbalanced },
    }
}

fn fractions(stack: &[f64], min_fraction: f64) -> RuleResult {
    let total = stack.len() as f64;
    let count = |pred: &dyn Fn(f64) -> bool| stack.iter().filter(|a| pred(**a)).count() as u32;
    let shares: Vec<FamilyShare> = [
        (OrientationFamily::Zero, count(&|a| same(a, 0.0))),
        (OrientationFamily::PlusMinus45, count(&|a| same(a.abs(), 45.0))),
        (OrientationFamily::Ninety, count(&|a| same(a, 90.0))),
    ]
    .into_iter()
    .map(|(family, plies)| FamilyShare { family, plies, share: plies as f64 / total })
    .collect();
    // A share exactly at the threshold passes; the tolerance keeps 1 ply of
    // 10 at 10 % from failing on 0.1 not being exact in binary.
    let passed = shares.iter().all(|s| s.share >= min_fraction - 1.0e-12);
    RuleResult { rule: StackingRule::MinFraction, passed, detail: RuleDetail::Fractions { shares } }
}

fn longest_run(stack: &[f64], max_consecutive: u32) -> RuleResult {
    let (mut best_start, mut best_length) = (0usize, 1usize);
    let mut start = 0usize;
    for i in 1..=stack.len() {
        if i == stack.len() || !same(stack[i], stack[start]) {
            if i - start > best_length {
                best_start = start;
                best_length = i - start;
            }
            start = i;
        }
    }
    RuleResult {
        rule: StackingRule::MaxConsecutive,
        passed: best_length as u32 <= max_consecutive,
        detail: RuleDetail::LongestRun {
            angle: stack[best_start],
            start: best_start as u32 + 1,
            length: best_length as u32,
        },
    }
}

fn surfaces(stack: &[f64]) -> RuleResult {
    let top = stack[0];
    let bottom = stack[stack.len() - 1];
    RuleResult {
        rule: StackingRule::OuterPlies45,
        passed: same(top.abs(), 45.0) && same(bottom.abs(), 45.0),
        detail: RuleDetail::Surfaces { top, bottom },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(angles: &[f64], symmetric: bool, middle: bool) -> Vec<RuleResult> {
        check_stacking_rules(angles, symmetric, middle, &RuleSettings::default())
    }

    fn rule(results: &[RuleResult], rule: StackingRule) -> &RuleResult {
        results.iter().find(|r| r.rule == rule).expect("every rule reports")
    }

    /// The textbook good layup: quasi-isotropic, symmetric, balanced, 25 %
    /// in each of 0 and 90 and 50 % at +-45, no run longer than two (the
    /// mirrored 90s at the mid-plane), +-45 outside.
    #[test]
    fn a_quasi_isotropic_layup_passes_every_rule() {
        let results = check(&[45.0, -45.0, 0.0, 90.0], true, false);
        assert_eq!(results.len(), 5);
        for r in &results {
            assert!(r.passed, "{:?}: {:?}", r.rule, r.detail);
        }
        match &rule(&results, StackingRule::MinFraction).detail {
            RuleDetail::Fractions { shares } => {
                let s: Vec<f64> = shares.iter().map(|s| s.share).collect();
                assert_eq!(s, [0.25, 0.5, 0.25]);
            }
            other => panic!("{other:?}"),
        }
        match rule(&results, StackingRule::MaxConsecutive).detail {
            RuleDetail::LongestRun { angle, start, length } => {
                assert_eq!((angle, start, length), (90.0, 4, 2));
            }
            ref other => panic!("{other:?}"),
        }
    }

    /// Symmetry is read off the expanded stack, so a stored stack that is
    /// itself a palindrome is symmetric without the flag - and the report
    /// names the first mirrored pair that differs.
    #[test]
    fn symmetry_is_checked_on_the_expanded_stack() {
        assert!(rule(&check(&[0.0, 90.0, 90.0, 0.0], false, false), StackingRule::Symmetric).passed);
        let unsymmetric = check(&[0.0, 45.0, 90.0, 0.0], false, false);
        let r = rule(&unsymmetric, StackingRule::Symmetric);
        assert!(!r.passed);
        assert_eq!(r.detail, RuleDetail::Symmetry { mismatch: Some([2, 3]) });
    }

    /// With an odd middle ply the stack has 2n - 1 plies: the middle one is
    /// counted once, stands alone in the palindrome check, and only joins a
    /// run with its real neighbours.
    #[test]
    fn an_odd_middle_ply_is_counted_once() {
        let results = check(&[45.0, -45.0, 0.0, 90.0], true, true);
        // 45 -45 0 90 0 -45 45: seven plies, one of them at 90.
        match &rule(&results, StackingRule::MinFraction).detail {
            RuleDetail::Fractions { shares } => {
                let plies: Vec<u32> = shares.iter().map(|s| s.plies).collect();
                assert_eq!(plies, [2, 4, 1]);
                assert!((shares[2].share - 1.0 / 7.0).abs() < 1e-15);
            }
            other => panic!("{other:?}"),
        }
        assert!(rule(&results, StackingRule::Symmetric).passed);
        match rule(&results, StackingRule::MaxConsecutive).detail {
            RuleDetail::LongestRun { length, .. } => assert_eq!(length, 1),
            ref other => panic!("{other:?}"),
        }
        // Without the middle ply flag the two 90s meet at the mid-plane.
        match rule(&check(&[45.0, -45.0, 0.0, 90.0, 90.0], true, false), StackingRule::MaxConsecutive)
            .detail
        {
            RuleDetail::LongestRun { angle, length, .. } => assert_eq!((angle, length), (90.0, 4)),
            ref other => panic!("{other:?}"),
        }
    }

    /// +45 and -45 are one family for the share rule but a pair for the
    /// balance rule: a stack with only +45 has its +-45 share and fails
    /// balance, one with both passes both.
    #[test]
    fn plus_and_minus_45_are_one_family_and_a_pair() {
        let one_sided = check(&[45.0, 0.0, 90.0, 45.0], false, false);
        assert!(rule(&one_sided, StackingRule::MinFraction).passed);
        let balance = rule(&one_sided, StackingRule::Balanced);
        assert!(!balance.passed);
        assert_eq!(
            balance.detail,
            RuleDetail::Balance { unbalanced: vec![AngleCount { angle: 45.0, plus: 2, minus: 0 }] }
        );
        assert!(rule(&check(&[45.0, 0.0, 90.0, -45.0], false, false), StackingRule::Balanced).passed);
        // -90 is 90, and 0/90 need no partner.
        assert!(rule(&check(&[0.0, -90.0, 90.0], false, false), StackingRule::Balanced).passed);
        // An angle over 90 is reduced first: 135 is -45.
        assert!(rule(&check(&[45.0, 135.0], false, false), StackingRule::Balanced).passed);
    }

    /// Thresholds at the boundary: exactly the minimum share passes, one ply
    /// less fails; exactly N in a row passes, N + 1 fails.
    #[test]
    fn thresholds_hold_at_their_boundary() {
        // Ten plies, one at 90: exactly 10 %.
        let mut angles = vec![0.0, 45.0, -45.0, 0.0, 45.0, -45.0, 0.0, 45.0, -45.0, 90.0];
        assert!(rule(&check(&angles, false, false), StackingRule::MinFraction).passed);
        angles[9] = 0.0;
        let r = check(&angles, false, false);
        assert!(!rule(&r, StackingRule::MinFraction).passed);

        let four = [0.0, 0.0, 0.0, 0.0, 90.0];
        assert!(rule(&check(&four, false, false), StackingRule::MaxConsecutive).passed);
        let five = [90.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        let r = check(&five, false, false);
        let run = rule(&r, StackingRule::MaxConsecutive);
        assert!(!run.passed);
        assert_eq!(run.detail, RuleDetail::LongestRun { angle: 0.0, start: 2, length: 5 });

        let strict = RuleSettings { min_fraction: 0.3, max_consecutive: 1 };
        let r = check_stacking_rules(&[45.0, -45.0, 0.0, 90.0], true, false, &strict);
        assert!(!rule(&r, StackingRule::MinFraction).passed, "25 % is below 30 %");
        assert!(!rule(&r, StackingRule::MaxConsecutive).passed, "the mid-plane 90s are two");
    }

    #[test]
    fn surface_plies_must_both_be_45() {
        let r = check(&[45.0, 0.0, -45.0], false, false);
        assert!(rule(&r, StackingRule::OuterPlies45).passed);
        let r = check(&[45.0, 0.0, 90.0], false, false);
        let surfaces = rule(&r, StackingRule::OuterPlies45);
        assert!(!surfaces.passed);
        assert_eq!(surfaces.detail, RuleDetail::Surfaces { top: 45.0, bottom: 90.0 });
        // A single ply is both surfaces.
        assert!(rule(&check(&[-45.0], false, false), StackingRule::OuterPlies45).passed);
    }

    #[test]
    fn an_empty_stack_has_nothing_to_check() {
        assert!(check(&[], true, true).is_empty());
    }

    /// Settings written by another version - unknown fields, missing fields -
    /// still read, with the defaults filling the gaps.
    #[test]
    fn settings_read_with_defaults() {
        let s: RuleSettings = serde_json::from_str(r#"{"maxSameAngle":4,"min_fraction":0.2}"#).unwrap();
        assert_eq!(s, RuleSettings { min_fraction: 0.2, max_consecutive: 4 });
    }

    /// The expansion here and the one every calculation uses must agree, or
    /// the rules would judge a different stack than the one computed.
    #[test]
    fn the_expanded_stack_is_the_one_the_laminate_builds() {
        use crate::model::{Laminate, Layer};
        for (angles, symmetric, middle) in [
            (vec![45.0, -45.0, 0.0, 90.0], true, false),
            (vec![45.0, -45.0, 0.0, 90.0], true, true),
            (vec![30.0, 100.0, -90.0], false, false),
            (vec![0.0], true, true),
        ] {
            let mut laminate = Laminate::new("l", "l");
            laminate.symmetric = symmetric;
            laminate.with_middle_layer = middle;
            for (i, a) in angles.iter().enumerate() {
                laminate.layers.push(Layer::new(format!("{i}"), "", "m", *a, 0.1));
            }
            let from_laminate: Vec<f64> = laminate.all_layers().iter().map(|r| reduce(r.angle)).collect();
            assert_eq!(expand(&angles, symmetric, middle), from_laminate, "{angles:?}");
        }
    }
}
