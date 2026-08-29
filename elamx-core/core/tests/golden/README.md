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
"<eLamX>/bin/elamx64.exe" --locale en \
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
  Delete it between runs, or pass a separate `--userdir`.

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

## Not covered by the batch mode

eLamX's batch mode implements `BatchRunService` for three modules only: the CLT
calculation, buckling, and last-ply-failure. The CLT calculation is exactly what
`elamx-core` implements today, so the current port is fully covered. Buckling
and last-ply-failure can join this suite as soon as they are ported. Everything
else in the original (pressure vessel, spring-in, cutouts, optimization,
micromechanics, deformation, vibration) has no batch output and will need one
before it can be validated this way.
