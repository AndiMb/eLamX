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

- **All 15 ported failure criteria**, each on a ply at its own angle, under five
  load cases (tension, compression, shear, bending, combined) so that different
  branches inside each criterion are reached.
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
calculation, buckling, and last-ply-failure - which is exactly what
`elamx-core` implements today, so the current port is fully covered. Everything
else in the original (pressure vessel, spring-in, cutouts, optimization,
micromechanics, deformation, vibration) has no batch output and will need one
before it can be validated this way. That is worth knowing before choosing what
to port next: those modules can be checked against analytical cases and against
the desktop GUI by hand, but not by this suite.
