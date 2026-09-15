//! Finding a stacking sequence instead of checking one.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Optimzation/ and
//! eLamX2/AdditionalOptimizers/
//!
//! Every other module in this crate answers "what does this laminate do?".
//! This one answers "which laminate would do?", and that is a different kind
//! of thing: a search over stacking sequences, with the other modules as its
//! constraints.
//!
//! The shape is simple enough to state in a sentence. A candidate is a list of
//! ply angles drawn from an allowed set, all of one material and one
//! thickness. A constraint turns a candidate into a reserve factor - the CLT
//! one takes the worst ply under a load case, the buckling one the smallest
//! positive eigenvalue, the deformation one the allowable deflection over the
//! actual. A candidate is acceptable when the SMALLEST reserve factor over all
//! its constraints reaches 1, and the search wants the thinnest such stack.
//!
//! What is deliberately not here is a cost function over stiffness or weight.
//! eLamX optimises for ply count and nothing else, which is the right question
//! when every ply is the same material and thickness - and it is why the
//! search can stop the moment a stack passes rather than having to explore
//! past it.

use serde::{Deserialize, Serialize};

use crate::clt::{determine_values, get_layer_results, CltLaminate, Loads, Strains};
use crate::failure::CriterionRegistry;
use crate::model::{Laminate, Layer, Material};
use crate::plate::{
    calculate_buckling, calculate_deformation, BucklingInput, DeformationInput,
};
use std::collections::HashMap;

/// One requirement the stack has to meet.
///
/// In the Java this is the `MinimalReserveFactorCalculator` interface, with an
/// implementation living in each analysis module. Here it is an enum, for the
/// reason every other service-turned-enum in this crate gives: the set is
/// fixed, it has to survive JSON, and a reader should be able to see what the
/// alternatives are.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Constraint {
    /// A load case the laminate has to carry: the reserve factor is the worst
    /// ply's, over both surfaces.
    Clt { loads: Loads },
    /// A plate cut from the laminate has to not buckle under its load: the
    /// reserve factor is the smallest positive eigenvalue.
    Buckling { input: BucklingInput },
    /// A plate cut from the laminate has to stay within an allowable
    /// deflection: the reserve factor is that allowable over the actual.
    Deformation { input: DeformationInput },
}

impl Constraint {
    /// Whether this constraint can only be evaluated on a symmetric stack.
    ///
    /// Buckling and deformation solve on the D matrix and want no B matrix
    /// under them, so eLamX forces the whole search symmetric as soon as one
    /// of them is present - not as an option but as a consequence.
    pub fn needs_symmetric_laminate(&self) -> bool {
        match self {
            Constraint::Clt { .. } => false,
            Constraint::Buckling { .. } | Constraint::Deformation { .. } => true,
        }
    }

    /// The reserve factor this constraint gives a candidate, or `None` if it
    /// cannot be evaluated on it at all.
    ///
    /// `None` is treated as "this candidate fails", not as an error: a search
    /// walks through stacks that the analyses have nothing to say about (a
    /// single ply has no bending stiffness worth the name), and stopping the
    /// whole optimisation for one of them would be the wrong answer to a
    /// question about a different stack.
    pub fn reserve_factor(
        &self,
        laminate: &CltLaminate,
        materials: &HashMap<String, Material>,
        criteria: &CriterionRegistry,
    ) -> Option<f64> {
        match self {
            Constraint::Clt { loads } => {
                let mut loads = *loads;
                let mut strains = Strains::default();
                determine_values(laminate, &mut loads, &mut strains, &[false; 6]);
                let results =
                    get_layer_results(laminate, &loads, &strains, materials, criteria).ok()?;
                let worst = results.iter().fold(f64::INFINITY, |acc, r| {
                    acc.min(r.rr_lower.minimal_reserve_factor)
                        .min(r.rr_upper.minimal_reserve_factor)
                });
                worst.is_finite().then_some(worst).or(Some(f64::INFINITY))
            }
            Constraint::Buckling { input } => {
                let result = calculate_buckling(laminate, input).ok()?;
                // A plate with no positive eigenvalue cannot buckle under this
                // load at all, which the Java reports as infinity rather than
                // as a failure - and it is right to: nothing constrains it.
                Some(result.critical_factor.unwrap_or(f64::INFINITY))
            }
            Constraint::Deformation { input } => {
                if input.max_displacement_z <= 0.0 {
                    // No limit set is no constraint, not a limit of zero.
                    return Some(f64::INFINITY);
                }
                let result = calculate_deformation(laminate, input).ok()?;
                let peak = result.max_deflection.abs().max(result.min_deflection.abs());
                if peak == 0.0 {
                    return Some(f64::INFINITY);
                }
                Some(input.max_displacement_z / peak)
            }
        }
    }
}

/// Everything the search needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct OptimizationInput {
    /// The ply angles the search may choose from, in degrees.
    pub angles: Vec<f64>,
    /// The thickness of one ply, in mm. Every ply has it - that is what makes
    /// "thinnest" the same question as "fewest plies".
    pub thickness: f64,
    pub material_id: String,
    pub criterion_id: String,
    pub constraints: Vec<Constraint>,
    /// Whether the stack must be symmetric. Forced on by a constraint that
    /// needs it, whatever this says.
    pub symmetric: bool,
    /// How many plies the search may add before giving up.
    ///
    /// Not in the original, which loops until the reserve factor reaches 1 and
    /// therefore never returns on a load no stack of these angles can carry.
    pub max_layers: usize,
}

impl Default for OptimizationInput {
    fn default() -> Self {
        OptimizationInput {
            // eLamX's own default set.
            angles: vec![0.0, 45.0, -45.0, 90.0],
            thickness: 0.125,
            material_id: String::new(),
            criterion_id: String::new(),
            constraints: Vec::new(),
            symmetric: false,
            max_layers: 200,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct OptimizationResult {
    /// The STORED stacking sequence, in degrees, outside in.
    ///
    /// Stored, not total: when the search is symmetric this is half the stack,
    /// the way a symmetric laminate is written down and the way eLamX keeps
    /// it. `[-45/45/45]` with `symmetric` set is six plies, not three - which
    /// is also why each step of a symmetric search adds two.
    pub angles: Vec<f64>,
    /// Whether the sequence above is mirrored to make the stack.
    pub symmetric: bool,
    /// Plies in the whole stack, mirroring included.
    pub layer_count: usize,
    /// Its smallest reserve factor over all constraints - at or just above 1
    /// when the search succeeded.
    pub min_reserve_factor: f64,
    /// Total laminate thickness, in mm - the whole stack, not the stored half.
    pub thickness: f64,
    /// How many candidates were built and evaluated. The honest measure of
    /// what the search cost.
    pub checked_laminates: usize,
    /// How many times a constraint was asked for a reserve factor.
    pub constraint_evaluations: usize,
    /// Whether the search reached a stack that carries the load.
    pub succeeded: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OptimizationError {
    /// No angles to choose from.
    NoAngles,
    /// No requirement to satisfy - every stack would do, including none.
    NoConstraints,
    /// A ply thickness of zero or less.
    NonPositiveThickness,
    /// The material the plies are made of is not in the catalogue.
    UnknownMaterial { id: String },
    /// The exhaustive search spent its evaluation budget.
    ///
    /// It has to have one: the original keeps every candidate at every level
    /// and expands all of them, so the work grows as `angles^layers` and there
    /// is no point at which it decides to stop.
    BudgetSpent { checked: usize },
    /// The search hit `max_layers` without the stack carrying the load.
    ///
    /// Reported as a result rather than thrown, because the stack it got to is
    /// worth seeing - it says how far off the requirement is.
    Exhausted { layers: usize },
}

impl std::fmt::Display for OptimizationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OptimizationError::NoAngles => {
                write!(f, "the search needs at least one ply angle to choose from")
            }
            OptimizationError::NoConstraints => write!(
                f,
                "the search needs at least one requirement - without one, the empty laminate is already optimal"
            ),
            OptimizationError::NonPositiveThickness => {
                write!(f, "the ply thickness must be positive")
            }
            OptimizationError::UnknownMaterial { id } => {
                write!(f, "material '{id}' is not in the catalogue")
            }
            OptimizationError::BudgetSpent { checked } => write!(
                f,
                "the exhaustive search looked at {checked} stacking sequences without finding one that carries the load - it enumerates every order, so the work grows as angles^layers"
            ),
            OptimizationError::Exhausted { layers } => write!(
                f,
                "no stack of up to {layers} plies from these angles carries the load"
            ),
        }
    }
}

impl std::error::Error for OptimizationError {}

/// The sequential decision approach.
/// Reference: eLamX2/.../optimization/sda/SequentialDecisionApproach.java
///
/// The simplest of eLamX's four optimisers and the one that always terminates:
/// add a ply in the middle, try it at every allowed angle, keep the angle that
/// leaves the best worst-case reserve factor, repeat until the stack carries
/// the load.
///
/// It is greedy, so it is not guaranteed to find the thinnest stack - a ply
/// chosen early is never revisited. What it is guaranteed to do is terminate
/// in `angles * layers` constraint evaluations rather than `angles^layers`,
/// which is why it is the one to have when the answer is wanted now.
pub fn sequential_decision(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
) -> Result<OptimizationResult, OptimizationError> {
    check(input, materials)?;

    let symmetric =
        input.symmetric || input.constraints.iter().any(Constraint::needs_symmetric_laminate);

    let mut angles: Vec<f64> = Vec::new();
    let mut checked = 0usize;
    let mut evaluations = 0usize;

    while angles.len() < input.max_layers {
        // Where the new ply goes is `getNumberofLayers() / 2` in the Java, and
        // that count is the WHOLE stack - doubled for a symmetric one. So the
        // index works out differently in the two cases, and both are right:
        // a symmetric stack appends to its stored half, which puts the ply at
        // the mid-plane and leaves the outer ones outer; an unsymmetric one
        // inserts in the middle of the real sequence.
        let at = if symmetric { angles.len() } else { angles.len() / 2 };
        angles.insert(at, input.angles[0]);

        let mut best = f64::NEG_INFINITY;
        let mut best_angle = input.angles[0];
        for candidate in &input.angles {
            angles[at] = *candidate;
            let worst = worst_case(&angles, input, materials, criteria, symmetric, &mut evaluations);
            if worst > best {
                best = worst;
                best_angle = *candidate;
            }
        }
        angles[at] = best_angle;
        checked += 1;

        if best >= 1.0 {
            return Ok(finish(
                angles.clone(),
                best,
                input,
                materials,
                symmetric,
                checked,
                evaluations,
            ));
        }
    }

    Err(OptimizationError::Exhausted { layers: input.max_layers })
}

/// The smallest reserve factor this candidate gets from any of its
/// constraints.
fn worst_case(
    angles: &[f64],
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    symmetric: bool,
    evaluations: &mut usize,
) -> f64 {
    let Some(clt) = build(angles, input, materials, symmetric) else {
        return f64::NEG_INFINITY;
    };
    let mut worst = f64::INFINITY;
    for constraint in &input.constraints {
        *evaluations += 1;
        match constraint.reserve_factor(&clt, materials, criteria) {
            Some(value) => worst = worst.min(value),
            // A constraint that cannot judge this candidate rules it out - see
            // `Constraint::reserve_factor`.
            None => return f64::NEG_INFINITY,
        }
    }
    worst
}

/// One candidate as a CLT laminate.
fn build(
    angles: &[f64],
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    symmetric: bool,
) -> Option<CltLaminate> {
    let mut laminate = Laminate::new("opt", "opt");
    laminate.symmetric = symmetric;
    for (i, angle) in angles.iter().enumerate() {
        let mut layer = Layer::new(
            format!("l{i}"),
            format!("{}", i + 1),
            &input.material_id,
            *angle,
            input.thickness,
        );
        layer.criterion_id = Some(input.criterion_id.clone());
        laminate.layers.push(layer);
    }
    CltLaminate::new(&laminate, materials).ok()
}

/// Exhaustive breadth-first search over stacking sequences.
/// Reference: eLamX2/.../additionaloptimizers/branchandbound/BranchAndBoundOptimizer.java
///
/// **eLamX calls this "branch and bound" and it is not.** A branch-and-bound
/// prunes a branch once its best possible outcome cannot beat what is already
/// in hand; this keeps every candidate at every level and expands all of them,
/// so it visits `angles^n` stacks to reach depth `n`. With the default four
/// angles that is a million laminates at ten plies, each one a full CLT solve.
/// The name is kept because it is the one the file format and the user
/// interface use; the behaviour is described here so nobody expects pruning
/// that is not there. [`todoroki`] is the one that actually bounds.
///
/// What it does give is the true optimum for its depth: it looks at every
/// sequence, so nothing is missed by a greedy step. `budget` is what keeps
/// that from being a promise the machine cannot keep - the original has none
/// and simply runs until it finds something or the process is killed.
pub fn exhaustive(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    budget: usize,
) -> Result<OptimizationResult, OptimizationError> {
    check(input, materials)?;
    let symmetric =
        input.symmetric || input.constraints.iter().any(Constraint::needs_symmetric_laminate);

    let mut level: Vec<Vec<f64>> = vec![Vec::new()];
    let mut checked = 0usize;
    let mut evaluations = 0usize;
    let mut best = f64::NEG_INFINITY;
    let mut best_angles: Vec<f64> = Vec::new();

    while level[0].len() < input.max_layers {
        // Every candidate at this level, extended by every angle. The ply goes
        // on the END here, not in the middle as the sequential search puts it
        // - which is the whole point of enumerating: the ORDER is what is
        // being searched over, and appending reaches every order.
        let mut next: Vec<Vec<f64>> = Vec::with_capacity(level.len() * input.angles.len());
        for candidate in &level {
            for angle in &input.angles {
                let mut extended = candidate.clone();
                extended.push(*angle);
                next.push(extended);
            }
        }

        for candidate in &next {
            let worst =
                worst_case(candidate, input, materials, criteria, symmetric, &mut evaluations);
            checked += 1;
            if worst > best {
                best = worst;
                best_angles = candidate.clone();
            }
            if checked >= budget {
                return Err(OptimizationError::BudgetSpent { checked });
            }
        }

        if best >= 1.0 {
            return Ok(finish(best_angles, best, input, materials, symmetric, checked, evaluations));
        }
        level = next;
    }

    Err(OptimizationError::Exhausted { layers: input.max_layers })
}

/// Todoroki's approach: bound the ply count first, then fill it in.
/// Reference: eLamX2/.../additionaloptimizers/todoroki/TodorokiOptimizer.java
///
/// The one optimiser here that earns the name the other one carries, and the
/// idea behind it is worth stating plainly.
///
/// A **super layer** is a ply that does not exist: isotropic, as stiff in
/// every direction as a real ply is along its fibres, and as strong in every
/// direction as the real ply is at its best. No real ply can beat it anywhere,
/// so a stack of `n` super layers that still fails proves that no real stack
/// of `n` plies can pass. Growing super layers until the stack passes
/// therefore gives a hard LOWER bound on the ply count - and running the
/// sequential search first gives an upper one.
///
/// Then the super layers are replaced by real plies one at a time, outside in,
/// keeping every partial stack that still passes. When the last super layer is
/// gone, what survives is a set of real stacks at the smallest count that can
/// work, and the best of them is the answer. If the survivors ever run out, the
/// count was too optimistic and another super layer is added.
///
/// eLamX marks this optimiser symmetric-only, and so is this.
pub fn todoroki(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    budget: usize,
) -> Result<OptimizationResult, OptimizationError> {
    check(input, materials)?;

    // The super material and the catalogue it lives in, beside the real one.
    let real = &materials[&input.material_id];
    let mut catalogue = materials.clone();
    let super_id = "__superlayer";
    catalogue.insert(super_id.to_string(), super_material(real));

    let mut checked = 0usize;
    let mut evaluations = 0usize;

    // 1. The lower bound: how many super layers it takes.
    let mut super_count = 0usize;
    loop {
        super_count += 1;
        if super_count > input.max_layers {
            return Err(OptimizationError::Exhausted { layers: input.max_layers });
        }
        let angles = vec![0.0; super_count];
        let kinds = vec![Ply::Super; super_count];
        let worst = worst_case_mixed(
            &angles,
            &kinds,
            input,
            &catalogue,
            super_id,
            criteria,
            &mut evaluations,
        );
        checked += 1;
        if checked >= budget {
            return Err(OptimizationError::BudgetSpent { checked });
        }
        if worst >= 1.0 {
            break;
        }
    }

    // 2. Replace the super layers, outermost first, keeping what still passes.
    let mut survivors: Vec<Vec<f64>> = vec![vec![0.0; super_count]];
    let mut replaced = 0usize;
    loop {
        if replaced == super_count {
            break;
        }
        let mut next: Vec<Vec<f64>> = Vec::new();
        for survivor in &survivors {
            for angle in &input.angles {
                let mut candidate = survivor.clone();
                candidate[replaced] = *angle;
                let kinds: Vec<Ply> = (0..super_count)
                    .map(|i| if i <= replaced { Ply::Real } else { Ply::Super })
                    .collect();
                let worst = worst_case_mixed(
                    &candidate,
                    &kinds,
                    input,
                    &catalogue,
                    super_id,
                    criteria,
                    &mut evaluations,
                );
                checked += 1;
                if checked >= budget {
                    return Err(OptimizationError::BudgetSpent { checked });
                }
                if worst >= 1.0 {
                    next.push(candidate);
                }
            }
        }

        if next.is_empty() {
            // The bound was too optimistic: one more super layer, start over.
            super_count += 1;
            if super_count > input.max_layers {
                return Err(OptimizationError::Exhausted { layers: input.max_layers });
            }
            survivors = vec![vec![0.0; super_count]];
            replaced = 0;
            continue;
        }

        survivors = next;
        replaced += 1;
    }

    // 3. The best of the survivors - all real plies by now.
    let mut best = f64::NEG_INFINITY;
    let mut best_angles = survivors[0].clone();
    for survivor in &survivors {
        let worst = worst_case(survivor, input, materials, criteria, true, &mut evaluations);
        if worst > best {
            best = worst;
            best_angles = survivor.clone();
        }
    }

    Ok(finish(best_angles, best, input, materials, true, checked, evaluations))
}

/// Whether a ply in a mixed stack is a real one or a super layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ply {
    Real,
    Super,
}

/// The ply no real ply can beat.
///
/// Isotropic at the real ply's fibre-direction stiffness, with Poisson's ratio
/// zero, and as strong in every direction as the real ply is at its strongest.
/// The shear strength is `2R/3` - and that one is eLamX's own note: "ACHTUNG:
/// Der Schubwert ist durch reine Versuche bestimmt", determined by trial. It
/// is the one number in the bound that is not an argument, so a super layer is
/// a near-bound rather than a proven one where shear governs.
fn super_material(real: &Material) -> Material {
    let e = real.e_par;
    let mut m = Material::new("__superlayer", "Superlayer", e, e, 0.0, e / 2.0, 0.0);
    let r = real.r_par_ten.max(real.r_par_com);
    m.r_par_ten = r;
    m.set_r_par_com(r);
    m.r_nor_ten = r;
    m.set_r_nor_com(r);
    m.set_r_shear(2.0 * r / 3.0);
    m
}

/// The worst reserve factor of a stack whose plies are a mix of real and
/// super ones.
#[allow(clippy::too_many_arguments)]
fn worst_case_mixed(
    angles: &[f64],
    kinds: &[Ply],
    input: &OptimizationInput,
    catalogue: &HashMap<String, Material>,
    super_id: &str,
    criteria: &CriterionRegistry,
    evaluations: &mut usize,
) -> f64 {
    let mut laminate = Laminate::new("opt", "opt");
    laminate.symmetric = true;
    for (i, angle) in angles.iter().enumerate() {
        let is_super = kinds[i] == Ply::Super;
        let mut layer = Layer::new(
            format!("l{i}"),
            format!("{}", i + 1),
            if is_super { super_id } else { &input.material_id },
            *angle,
            input.thickness,
        );
        // A super layer is judged by max stress, as eLamX judges it - the
        // criterion has to be one that reads the isotropic strengths it was
        // given rather than a composite one.
        layer.criterion_id =
            Some(if is_super { "max_stress".to_string() } else { input.criterion_id.clone() });
        laminate.layers.push(layer);
    }
    let Ok(clt) = CltLaminate::new(&laminate, catalogue) else {
        return f64::NEG_INFINITY;
    };

    let mut worst = f64::INFINITY;
    for constraint in &input.constraints {
        *evaluations += 1;
        match constraint.reserve_factor(&clt, catalogue, criteria) {
            Some(value) => worst = worst.min(value),
            None => return f64::NEG_INFINITY,
        }
    }
    worst
}

/// The guards every optimiser shares.
fn check(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
) -> Result<(), OptimizationError> {
    if input.angles.is_empty() {
        return Err(OptimizationError::NoAngles);
    }
    if input.constraints.is_empty() {
        return Err(OptimizationError::NoConstraints);
    }
    if input.thickness <= 0.0 {
        return Err(OptimizationError::NonPositiveThickness);
    }
    if !materials.contains_key(&input.material_id) {
        return Err(OptimizationError::UnknownMaterial { id: input.material_id.clone() });
    }
    Ok(())
}

/// The result, with the layer count and thickness taken from the stack that
/// was actually built rather than from the stored sequence.
fn finish(
    angles: Vec<f64>,
    min_reserve_factor: f64,
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    symmetric: bool,
    checked: usize,
    evaluations: usize,
) -> OptimizationResult {
    let layer_count =
        build(&angles, input, materials, symmetric).map_or(angles.len(), |l| l.layers().len());
    OptimizationResult {
        angles,
        symmetric,
        layer_count,
        min_reserve_factor,
        thickness: input.thickness * layer_count as f64,
        checked_laminates: checked,
        constraint_evaluations: evaluations,
        succeeded: min_reserve_factor >= 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::default_criterion_registry;
    use crate::plate::BoundaryCondition;

    fn carbon() -> HashMap<String, Material> {
        let mut material =
            Material::new("cfk", "CFK", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
        material.r_par_ten = 2000.0;
        material.set_r_par_com(1200.0);
        material.r_nor_ten = 50.0;
        material.set_r_nor_com(150.0);
        material.set_r_shear(70.0);
        let mut materials = HashMap::new();
        materials.insert("cfk".to_string(), material);
        materials
    }

    fn base(constraints: Vec<Constraint>) -> OptimizationInput {
        OptimizationInput {
            material_id: "cfk".to_string(),
            criterion_id: "max_stress".to_string(),
            constraints,
            ..Default::default()
        }
    }

    fn run(input: &OptimizationInput) -> Result<OptimizationResult, OptimizationError> {
        sequential_decision(input, &carbon(), &default_criterion_registry())
    }

    fn loads(n_x: f64, n_y: f64, n_xy: f64) -> Loads {
        Loads { n_x, n_y, n_xy, ..Default::default() }
    }

    /// Pulled along x and nothing else, the search has one sensible answer:
    /// put every fibre along x. Nothing in the code says so - the angles are
    /// all offered at every step and the criterion decides - which is what
    /// makes this a check on the search rather than on a table.
    #[test]
    fn a_stack_pulled_along_x_comes_out_all_zero_degrees() {
        let result = run(&base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])).unwrap();

        assert!(result.succeeded);
        assert!(result.angles.iter().all(|a| *a == 0.0), "{:?}", result.angles);
        assert!(result.min_reserve_factor >= 1.0);
        // And only just: a greedy search stops at the first stack that carries
        // the load, so one ply fewer must not.
        let thinner = OptimizationInput {
            max_layers: result.angles.len() - 1,
            ..base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])
        };
        assert!(matches!(run(&thinner), Err(OptimizationError::Exhausted { .. })));
    }

    /// Pure shear is carried by fibres at 45 degrees, so that is what comes
    /// out - and the pair, not one of them twice, because the criterion sees
    /// the sign of the shear.
    #[test]
    fn pure_shear_comes_out_at_forty_five_degrees() {
        let result = run(&base(vec![Constraint::Clt { loads: loads(0.0, 0.0, 200.0) }])).unwrap();

        assert!(result.succeeded);
        assert!(
            result.angles.iter().all(|a| a.abs() == 45.0),
            "{:?}",
            result.angles
        );
    }

    /// Twice the load needs more plies. Not exactly twice - the reserve factor
    /// is not linear in the ply count once the stack starts carrying the load
    /// in more than one direction - but more, and monotonically so.
    #[test]
    fn a_bigger_load_needs_a_thicker_stack() {
        let mut previous = 0;
        for load in [200.0, 400.0, 800.0, 1600.0] {
            let result = run(&base(vec![Constraint::Clt { loads: loads(load, 0.0, 0.0) }])).unwrap();
            assert!(
                result.angles.len() > previous,
                "{load} N/mm: {} Lagen nach {previous}",
                result.angles.len()
            );
            assert_eq!(result.thickness, 0.125 * result.layer_count as f64);
            assert_eq!(result.layer_count, result.angles.len(), "unsymmetrisch: kein Spiegeln");
            previous = result.angles.len();
        }
    }

    /// Two load cases at once: the stack has to carry both, so it comes out
    /// thicker than either alone and mixes the angles they each want.
    #[test]
    fn two_load_cases_produce_a_stack_that_carries_both() {
        let along = run(&base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])).unwrap();
        let across = run(&base(vec![Constraint::Clt { loads: loads(0.0, 400.0, 0.0) }])).unwrap();
        let both = run(&base(vec![
            Constraint::Clt { loads: loads(400.0, 0.0, 0.0) },
            Constraint::Clt { loads: loads(0.0, 400.0, 0.0) },
        ]))
        .unwrap();

        assert!(both.angles.len() > along.angles.len());
        assert!(both.angles.len() > across.angles.len());
        // What it picks is NOT 0 and 90, which is what one expects before
        // looking: equal tension in both directions is carried best by plies
        // at 45 degrees, which take a share of each. That the greedy search
        // finds that rather than the obvious answer is the point of having it.
        assert!(both.angles.iter().all(|a| a.abs() == 45.0), "{:?}", both.angles);
        assert!(both.min_reserve_factor >= 1.0);
        // Both constraints were asked at every step, which is what the count
        // is for.
        assert!(both.constraint_evaluations >= 2 * both.checked_laminates);
    }

    /// A buckling constraint forces the stack symmetric whatever the input
    /// says - it solves on the D matrix and wants no B matrix under it.
    #[test]
    fn a_buckling_constraint_forces_a_symmetric_stack() {
        let buckling = Constraint::Buckling {
            input: BucklingInput {
                length: 300.0,
                width: 300.0,
                n_x: -1.0,
                bc_x: BoundaryCondition::SimplySimply,
                bc_y: BoundaryCondition::SimplySimply,
                m: 6,
                n: 6,
                ..Default::default()
            },
        };
        assert!(buckling.needs_symmetric_laminate());

        let result = run(&OptimizationInput {
            max_layers: 40,
            ..base(vec![buckling])
        })
        .unwrap();
        assert!(result.succeeded);
        assert!(result.symmetric, "eine Beulbedingung erzwingt Symmetrie");
        // The stored sequence is HALF the stack - a symmetric search adds two
        // plies per step, which is what the layer count has to show.
        assert_eq!(result.layer_count, 2 * result.angles.len());
        assert_eq!(result.thickness, 0.125 * result.layer_count as f64);
    }

    /// A deflection limit is a constraint like any other, and no limit is no
    /// constraint - not a limit of zero, which would be unsatisfiable.
    #[test]
    fn an_unset_deflection_limit_constrains_nothing() {
        let unset = Constraint::Deformation { input: DeformationInput::default() };
        let materials = carbon();
        let criteria = default_criterion_registry();
        let laminate = build(
            &[0.0, 90.0, 90.0, 0.0],
            &base(vec![unset.clone()]),
            &materials,
            true,
        )
        .unwrap();
        assert_eq!(unset.reserve_factor(&laminate, &materials, &criteria), Some(f64::INFINITY));

        let limited = Constraint::Deformation {
            input: DeformationInput { max_displacement_z: 1.0, ..Default::default() },
        };
        let factor = limited.reserve_factor(&laminate, &materials, &criteria).unwrap();
        assert!(factor.is_finite() && factor > 0.0, "{factor}");
    }

    /// A limit that is only just met needs fewer plies than a strict one.
    #[test]
    fn a_stricter_deflection_limit_needs_more_plies() {
        let stack_for = |allowable: f64| {
            run(&OptimizationInput {
                max_layers: 60,
                ..base(vec![Constraint::Deformation {
                    input: DeformationInput {
                        max_displacement_z: allowable,
                        ..Default::default()
                    },
                }])
            })
            .unwrap()
            .angles
            .len()
        };
        assert!(stack_for(1.0) > stack_for(5.0));
    }

    /// The greedy search is what it says: a ply chosen early is never
    /// revisited, so the count it lands on is an upper bound and not
    /// necessarily the minimum. Worth stating in a test rather than only in a
    /// comment, because it is the property that distinguishes this optimiser
    /// from the three eLamX offers beside it.
    #[test]
    fn the_search_costs_angles_times_layers_and_no_more() {
        let result = run(&base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])).unwrap();
        let angles = 4;
        assert_eq!(result.checked_laminates, result.angles.len());
        assert_eq!(result.constraint_evaluations, angles * result.angles.len());
    }

    /// The exhaustive search looks at every order, so on a problem small
    /// enough for it to finish it cannot do worse than the greedy one.
    #[test]
    fn the_exhaustive_search_is_never_beaten_by_the_greedy_one() {
        let input = base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }]);
        let greedy = run(&input).unwrap();
        let every =
            exhaustive(&input, &carbon(), &default_criterion_registry(), 100_000).unwrap();

        assert!(every.succeeded);
        assert!(every.layer_count <= greedy.layer_count, "{} vs {}", every.layer_count, greedy.layer_count);
        assert!(every.min_reserve_factor >= 1.0);
    }

    /// And it costs what it says it costs: `angles^n` at depth n, which is why
    /// it needs a budget and the greedy one does not.
    #[test]
    fn the_exhaustive_search_pays_angles_to_the_power_of_layers() {
        let input = base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }]);
        let every =
            exhaustive(&input, &carbon(), &default_criterion_registry(), 100_000).unwrap();

        // Every level is fully enumerated, so the count is the sum of a
        // geometric series in the number of angles.
        let angles = input.angles.len();
        let expected: usize = (1..=every.angles.len()).map(|n| angles.pow(n as u32)).sum();
        assert_eq!(every.checked_laminates, expected);

        // A budget below that stops rather than running on.
        assert!(matches!(
            exhaustive(&input, &carbon(), &default_criterion_registry(), 10),
            Err(OptimizationError::BudgetSpent { .. })
        ));
    }

    /// Todoroki bounds the ply count from below with super layers and from
    /// above with the greedy search, so what it returns sits between the two -
    /// and it is a real stack, not a fictitious one.
    #[test]
    fn todoroki_lands_between_its_two_bounds() {
        let input = OptimizationInput {
            symmetric: true,
            ..base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])
        };
        let greedy = run(&input).unwrap();
        let bounded = todoroki(&input, &carbon(), &default_criterion_registry(), 100_000).unwrap();

        assert!(bounded.succeeded);
        assert!(bounded.min_reserve_factor >= 1.0);
        assert!(
            bounded.layer_count <= greedy.layer_count,
            "{} vs {}",
            bounded.layer_count,
            greedy.layer_count
        );
        assert!(bounded.symmetric, "Todoroki ist nur symmetrisch definiert");
        // Every angle in the answer is one that was offered - no super layer
        // survived into the result.
        for angle in &bounded.angles {
            assert!(input.angles.contains(angle), "{angle} war nicht zur Wahl");
        }
    }

    /// The super layer is the bound, so it has to be at least as good as any
    /// real ply in every direction - otherwise the count it proves is not a
    /// bound at all.
    #[test]
    fn a_super_layer_beats_the_real_ply_it_stands_for() {
        let materials = carbon();
        let real = &materials["cfk"];
        let fake = super_material(real);

        // As stiff across as the real one is along, and isotropic.
        assert_eq!(fake.e_par, real.e_par);
        assert_eq!(fake.e_nor, real.e_par);
        assert!(fake.e_nor > real.e_nor);
        assert_eq!(fake.nue12, 0.0);

        // And as strong in every direction as the real one is at its best.
        let best = real.r_par_ten.max(real.r_par_com);
        for strength in [fake.r_par_ten, fake.r_par_com, fake.r_nor_ten, fake.r_nor_com] {
            assert_eq!(strength, best);
        }
        assert!(fake.r_nor_ten > real.r_nor_ten);
        // The shear value is the one eLamX arrived at by trial rather than by
        // argument - see `super_material`.
        assert_eq!(fake.r_shear, 2.0 * best / 3.0);
        assert!(fake.r_shear > real.r_shear);
    }

    /// All three searches agree that the same load needs about the same stack.
    /// They disagree about how hard they work for it, which is the whole
    /// reason there is more than one.
    #[test]
    fn the_three_searches_agree_on_the_answer_and_not_on_the_price() {
        let input = OptimizationInput {
            symmetric: true,
            ..base(vec![Constraint::Clt { loads: loads(600.0, 100.0, 0.0) }])
        };
        let materials = carbon();
        let criteria = default_criterion_registry();

        let greedy = sequential_decision(&input, &materials, &criteria).unwrap();
        let every = exhaustive(&input, &materials, &criteria, 200_000).unwrap();
        let bounded = todoroki(&input, &materials, &criteria, 200_000).unwrap();

        for result in [&greedy, &every, &bounded] {
            assert!(result.succeeded);
            assert!(result.min_reserve_factor >= 1.0);
        }
        // The exhaustive one is optimal by construction; neither of the others
        // can beat it, and neither should be far off.
        assert!(every.layer_count <= greedy.layer_count);
        assert!(every.layer_count <= bounded.layer_count);
        assert!(greedy.layer_count <= every.layer_count + 4);

        // The prices, in constraint evaluations, are orders apart.
        assert!(every.constraint_evaluations > 10 * greedy.constraint_evaluations);
    }

    #[test]
    fn the_guards_refuse_what_cannot_be_searched() {
        let materials = carbon();
        let criteria = default_criterion_registry();
        let ok = base(vec![Constraint::Clt { loads: loads(100.0, 0.0, 0.0) }]);

        assert_eq!(
            sequential_decision(
                &OptimizationInput { angles: vec![], ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::NoAngles)
        );
        assert_eq!(
            sequential_decision(
                &OptimizationInput { constraints: vec![], ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::NoConstraints)
        );
        assert_eq!(
            sequential_decision(
                &OptimizationInput { thickness: 0.0, ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::NonPositiveThickness)
        );
        assert_eq!(
            sequential_decision(
                &OptimizationInput { material_id: "nope".to_string(), ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::UnknownMaterial { id: "nope".to_string() })
        );

        // And a load no stack of these angles can ever carry stops rather than
        // running forever, which is what the original does.
        assert_eq!(
            sequential_decision(
                &OptimizationInput {
                    max_layers: 12,
                    constraints: vec![Constraint::Clt { loads: loads(1.0e7, 0.0, 0.0) }],
                    ..ok
                },
                &materials,
                &criteria
            ),
            Err(OptimizationError::Exhausted { layers: 12 })
        );
    }
}
