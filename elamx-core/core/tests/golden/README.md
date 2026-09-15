# Golden-master reference data

The numbers in `reference.txt` were produced by the **original Java eLamX 3.x**,
not by this codebase. `../golden_master.rs` replays the same inputs through
`elamx-core` and compares. That is the only test kind that answers the question
a port has to answer — *does it compute the same thing?* — as opposed to the
unit tests in `src/`, which check self-consistency and analytically known values
and would stay green even if a formula were mistranscribed.

## Files

| File | Role | Written by |
|---|---|---|
| `generate.mjs` | the single definition of every reference case | hand-maintained |
| `reference.elamx` | inputs, in the original's own project format | `generate.mjs` |
| `reference.input.json` | the *same* inputs in `elamx-core`'s serde shape | `generate.mjs` |
| `reference.txt` | **the expected values** | eLamX batch mode |

Both input files come from one `CASES` definition, so the Java run and the Rust
test cannot drift apart on the inputs; only `reference.txt` carries expectations.

## Regenerating

Needed after changing `generate.mjs`, and only then. All three generated files
must be regenerated together and committed together.

```sh
# 1. Rebuild the two input files.
cd elamx-core/core/tests/golden
node generate.mjs

# 2. Recompute the expected values with the original program.
#    Adjust the path to your eLamX 3.x installation.
"<eLamX>/bin/elamx64.exe" --locale en --userdir /tmp/elamx-batch \
    --input="$(pwd)/reference.elamx" \
    --output="$(pwd)/reference.txt"

# 3. Confirm the port still agrees.
cd ../../.. && cargo test --test golden_master
```

Three details about step 2 that will otherwise cost time:

- **`--locale en` is required.** The batch output prints each ply's failure
  criterion by *display name*, and those are localized. Without a fixed locale
  the file is not reproducible across machines, and the criterion check in
  `golden_master.rs` fails on a German JVM.
- **The `=` in `--input=`/`--output=` is required.** The launcher rejects the
  space-separated form (`--input <path>`) for these options.
- **A batch run leaves a stale `lock` in the user directory** (`~/.elamx/3.0/`
  by default), which blocks the *next* start — of the batch mode and of the GUI.
  Delete it between runs, or pass a separate `--userdir` as above. Note that
  `--userdir` takes its value space-separated; only `--input`/`--output` want
  the `=` form.

## What the cases cover

`reference_data_covers_every_ported_criterion` in `golden_master.rs` enforces
most of this, so the list cannot quietly rot:

- **All 15 ported composite failure criteria**, each on a ply at its own angle,
  under five load cases (tension, compression, shear, bending, combined) so
  that different branches inside each criterion are reached.
- **The two isotropic yield criteria**, Tresca and von Mises, on a laminate of
  their own (`GM-Metall`) made of an exactly isotropic aluminium. Their own
  laminate for a reason worth knowing before touching this file: eLamX shows a
  MODAL DIALOG when either meets a non-isotropic material, and a modal dialog
  in a batch run is a hang rather than a warning. Three loads, because the two
  agree under uniaxial tension and differ most under shear.
- Both branches of `MaxStrain`'s global/local flag (the two materials differ in
  it deliberately).
- Symmetric stacks **with** and **without** a shared middle layer, a non-zero
  reference-plane offset, and a reversed stacking order (`invert_z`).
- Ply angles stored outside −90..90, to check that both sides' angle reduction
  agrees rather than merely that each has one.
- Hygrothermal loads (ΔT and Δc), alone and combined with a mechanical load.
- Mixed boundary conditions, where some degrees of freedom prescribe the strain
  and the rest the load.
- **Last ply failure**: the degradation path itself - which ply fails in which
  step, under which criterion verdict, at which reserve factor, and which plies
  carry which damage afterwards - plus the four reported load factors and the
  `FF before IFF` flag. Covered across the cases: `degradeAllOnFibreFailure` in
  both settings, a non-default degradation factor and strain limit, a jA != 1 on
  a case that actually reaches an inter-fibre failure (it scales nothing else),
  a load so large that no step ever reaches a reserve factor of 1 (so eLamX
  prints `-` for the strain-based factor), a symmetric stack, an inverted one,
  and one whose reference-plane offset the analysis is expected to ignore.
- **Plate buckling**: all six edge conditions (SS, CC, CF, FF, SC, SF), all three
  bending-stiffness idealisations (standard D, special orthotropic, D-tilde),
  square and rectangular plates, uniaxial / biaxial / shear loading, asymmetric
  Ritz term counts, and both a symmetric laminate (where the plain D matrix is
  valid) and an unsymmetric one (where it is not, and eLamX computes it anyway).
  Compared per analysis: the D matrix actually used, the critical load flows and
  the *complete* eigenvalue spectrum - up to 144 values per analysis.
- **Micromechanics**: all seven predicting models plus the manual-input dummy,
  one ply each, across two fibres and two matrices and fibre volume fractions
  from 0.45 to 0.66. One material uses a different model for each of its four
  properties, which is the only case that can catch the model choices being
  read in the wrong order, and one leaves two of them typed in. What is
  compared is the ply's E11, E22, v12 and G12 as the batch printed them - and
  the reference file stores `1.0` for every model-driven property on purpose,
  because eLamX ignores what is stored and asks the model. A port that trusted
  the file would report 1.0 MPa. The density has no check: it prints as
  `%10.5f` and a real one is about 1e-9, so the original writes `0.00000` for
  every material in the file.
- **Stiffeners**, on five of those buckling analyses: all three profiles (direct
  input, I and T), both directions, a case with two stiffeners of different
  profiles at once, a torsion-only case (I = 0, so only the G·J term acts), and
  a case on mixed clamped/free edges, where the shape functions are the
  hyperbolic ones and are sampled at the stiffener's line rather than
  integrated. Deformation has no batch output, but it adds the *same*
  contribution to the *same* stiffness matrix, so these cover it too.

- **Plate vibration**: two analyses, one of them with stiffeners. No numbers
  are compared, because the batch mode prints none for this module - what they
  cover is the `<vibration>` element, and the check that matters is the rewrite
  below: the same file, written back out by `elamx-core`, still opens in the
  Java program and computes identically.

- **Spring-in**: two analyses, one per model, on the symmetric stack (the
  module refuses an unsymmetric one). The batch prints nothing for this module
  either, but it is not untested for that reason - see
  `spring_in_follows_the_expansion_elamx_reports`. The whole model is the
  laminate's thermal expansion coefficient around the bend plus four typed-in
  numbers, and the coefficient IS something the original prints if asked the
  right question: `GM-Sym-AlphaT` puts a temperature change and nothing else on
  a symmetric stack, so the strains it reports, divided by dT, are that
  coefficient. What the two spring-in entries add on top is the `<springIn>`
  element, including the nested `<SpringInModel>` with its Java class name and
  the enhanced model's two shrinkage properties.

  Worth knowing about the tag names: a single wrong one is **not** a silent
  loss. `LoadSaveLaminateHookImpl` reads them with
  `Double.parseDouble(getTagValue(...))`, which throws on a missing element and
  takes the rest of the load with it - renaming `baseTemp` to `basetemp` in the
  reference file truncates the batch output after the first laminate. So a
  rewrite run that produces no diff is proof the original read every one of
  them.

## Tolerances

Derived from the batch writer's own `printf` format strings
(`GeneralOutputWriterServiceImpl` and `CalculationOutputWriterServiceImpl` in
the Java sources), not chosen by feel — see `mod tolerances` in
`golden_master.rs`. The expected values are only as precise as the original
printed them, so e.g. the ABD matrix (`%10.1f`) is compared to ±0.05 absolute
while strains (`%17.10E`) are compared to 5e-10 relative.

## Keeping the test honest

A golden test that cannot fail is worse than none. When changing it, verify it
still detects a deliberately introduced fault:

```sh
# Should turn the reserve-factor test red.
sed -i 's/additional_value(material, PSPD)/additional_value(material, PSPZ)/' \
    ../../src/failure/puck.rs
cargo test --test golden_master
git checkout -- ../../src/failure/puck.rs
```

The last-ply-failure cases were chosen against the same standard - each of these
faults, introduced in `src/clt/last_ply_failure.rs`, is caught by the current
data (the numbers are the comparisons that failed when they were tried):

| Fault | Failures |
|---|---|
| pass the laminate's reference-plane offset through to the working stack | 346 |
| ignore `degrade_all_on_fibre_failure` and never degrade the matrix with the fibres | 886 |
| take the ply with the smallest reserve factor on a tie instead of keeping the first | 384 |
| drop the `j_a` knock-down on an inter-fibre failure | 8 |
| carry the material's own criterion parameters over instead of the defaults | 3 |

The last two are the thin ones, and both only because a single case exercises
them: `j_a != 1` is only visible where an inter-fibre failure actually happens,
and the default-parameter quirk only where a material's parameter differs from
the criterion's default (the MaxStrain global/local flag on `m-gfk`). Adding a
case that removes either would make the suite quietly weaker.

For the metal criteria, changing von Mises's `3.0 * tau^2` to `2.0 * tau^2`
turns `layer_results_and_reserve_factors_match_elamx` red on four comparisons -
the shear and combined load cases, where that term actually carries something.

For the micromechanics, swapping the fibre and the matrix inside `chamis` in
`src/micromechanics/mod.rs` turns `material_data_matches_elamx` red on three
comparisons - the Chamis material's E22 and G12 and the mixed material's E22,
which is exactly the set that model drives.

For spring-in, always taking `alpha[0]` instead of choosing by
`zero_deg_as_circum_dir` turns `spring_in_follows_the_expansion_elamx_reports`
red on three comparisons - the enhanced case is the one that runs around the
90 degree direction, and it is there precisely so that the choice is exercised
rather than merely available.

For the stiffeners the same standard is met by the crudest fault there is:
dropping the `add_stiffener_stiffness` call from `plate::buckling::calculate`
turns `buckling_matches_elamx` red. That is what says the stiffener cases carry
weight rather than merely running.

## Also a fixture for the `.elamx` reader and writer

`tests/project_file.rs` reads `reference.elamx` and checks the result against
`reference.input.json` - two files a *different* generator wrote from the same
definition, so the reader has to reproduce something it did not produce itself.

The strongest check on the writer is not in the test suite, because it needs
the Java program. Run it after changing `project::write`:

```sh
# Read the reference file and write it back out through elamx-core, then let
# eLamX calculate from the rewritten file and compare against reference.txt.
cd ../../..                       # elamx-core/
cargo run --example rewrite_elamx -- core/tests/golden/reference.elamx rewritten.elamx
"<eLamX>/bin/elamx64.exe" --locale en --userdir /tmp/elamx-batch \
    --input="$(pwd)/rewritten.elamx" --output="$(pwd)/rewritten.txt"
diff <(tail -n +12 core/tests/golden/reference.txt) <(tail -n +12 rewritten.txt)
```

The first 11 lines carry a timestamp, the input path and its MD5 sum, so they
differ by construction; everything after them must be identical. Both
`reference.elamx` and eLamX's own `Example_Files/batchexample1.elamx` pass.

## Quirks of the batch output worth knowing

Three things in the Java writers cost time if you meet them unprepared, and the
parser in `golden_master.rs` works around all three:

- The per-ply `Crit. = ...` text is printed on the **same line** as `S12`, because
  the preceding `printf` has no newline. It is not at the start of a line.
- In the buckling section **both** boundary-condition lines are captioned `x`
  (`GeneralOutputWriterServiceImpl` prints `getBcy()` under an `x` caption), so
  the two must be told apart by position, not by their label.
- Free edges legitimately produce **infinite** buckling factors (rigid-body
  modes). Both implementations report them, and they compare equal only by exact
  equality - their difference is NaN.

## Not covered by the batch mode

eLamX's batch mode implements `BatchRunService` for three modules only: the CLT
calculation, buckling, and last-ply-failure. Everything else in the original
(pressure vessel, spring-in, cutouts, optimization, deformation, vibration) has
no batch output of its own - though the general output turned out to print more
than expected: its `Material data :` block gives every ply's E11, E22, v12 and
G12, which is how the micromechanical models are compared against the original
without micromechanics having a batch module. Before deciding a module cannot
be validated this way, check what the general output already prints for it.

What is left over - the pressure vessel, the plate deformation and the plate
vibration - can be checked against closed-form cases and against the desktop
GUI by hand, but not by this suite. Their INPUTS still belong in the reference
file even so: a `<deformation>` or `<vibration>` element that this crate writes
wrongly would stop the Java program from opening the file at all, and the
rewrite check above catches that.
