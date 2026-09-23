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
| `reduced.elamxb` | the original's OWN example of the reduced input format | copied from `eLamX2/Example_Files/` |
| `reduced.txt` | **the expected values for it** | eLamX batch mode |
| `crosscheck/*.elamx` | a second suite's inputs, which the Rust side reads itself | hand-written |
| `crosscheck/*.txt` | **their expected values** | eLamX batch mode |
| `with_extension.elamx` | `reference.elamx` plus a `<webExtension>`, to show eLamX ignores it | by hand, see below |

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

`reduced.txt` is regenerated separately, and only if `reduced.elamxb` changes.
Note the extra switch: without `--reducedinput` the batch tries to read the file
as an ordinary project, fails, and writes a header with nothing under it.

```sh
cd elamx-core/core/tests/golden
"<eLamX>/bin/elamx64.exe" --locale en --userdir /tmp/elamx-batch --reducedinput     --input="$(pwd)/reduced.elamxb"     --output="$(pwd)/reduced.txt"
```

The file is the original's own example rather than one written for this suite,
which is the point: it is the one golden case whose INPUT nobody here chose.

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

- **Cutouts**: all four hole shapes, so every Java class name and every
  property name the format uses - `A`, `B` and the German `Terme` - is written
  and read back at least once. No numbers are compared, as for the two modules
  above; what they cover is the `<cutout>` element and its nested
  `<CutoutGeometry>`. The module itself is checked against Kirsch and Inglis in
  `src/cutout/`, which needs no reference file at all.

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

## `with_extension.elamx`: the web version's own element, as eLamX sees it

The web version stores what the format has no place for - comparisons, extra
layer criteria, later studies and report templates - in one `<webExtension>`
root element holding JSON in a CDATA section (`src/project/web_extension.rs`).
That is only safe if eLamX 3.x ignores the element when it reads a file and
keeps it when it saves one. `with_extension.elamx` is the check of the first
half: `reference.elamx` plus such an element, whose JSON deliberately contains
`<laminate><layer><material>` and a `]]>` - the names eLamX searches for with
`getElementsByTagName`, and the one string a CDATA section cannot hold.

```sh
"<eLamX>/bin/elamx64.exe" --locale en --userdir /tmp/elamx-batch     --input="$(pwd)/with_extension.elamx" --output="$(pwd)/with_extension.txt"
diff <(tail -n +12 reference.txt) <(tail -n +12 with_extension.txt)
```

Run on 2026-09-23 with the installed eLamX 3.x on Windows: no diff, all 6995
lines. `the_java_checked_fixture_is_the_reference_file_plus_an_extension` in
`project_file.rs` keeps the fixture exactly that, so regenerating
`reference.elamx` means regenerating this file too (append the element before
`</elamx>`) and running the check again.

The second half - that a SAVE in eLamX 3.x keeps the element - is not
something the batch mode can show, and the GUI cannot be driven from here. It
rests on the source instead: `eLamXFileDataObject.storeData` re-parses the file
on disk, lets each `LoadSaveHook` rewrite its own section in place and writes
the whole document back; the four hooks (`DefaultMaterialLoadSaveImpl`,
`LaminateLoadSaveImpl`, `MicroMechanicLoadSaveImpl`,
`OptimizationLoadSaveHookImpl`) only look up `materials`, `laminates`,
`fibres`/`matrices` and `optimizations` and touch nothing else under the root.
Whether `XMLUtil.write` keeps the CDATA section or turns it into escaped text,
the reader accepts both (`reads_a_web_extension_stored_as_escaped_text`). A
save by hand in the desktop GUI is still worth doing once before relying on
this for anything valuable.

## A second suite on whole files: `crosscheck/`

Everything above takes ONE case definition (`generate.mjs`) into two forms, so
that the Java run and the Rust test cannot drift apart on the inputs. The price
of that arrangement is that the Rust side never reads the file the original
read: `reference.input.json` is a twin written by the same generator, not the
`.elamx`.

`crosscheck/` closes that gap. Each case there is a pair of files, and both
programs start from the same one:

```text
  crosscheck/<case>.elamx ─┬─[eLamX batch]──────────> crosscheck/<case>.txt
                           └─[project::read_elamx]──> tests/batch_crosscheck.rs
```

So a stack the reader assembles differently - a mirrored one, an offset
reference plane, a reversed stacking order, an angle written outside -90..90 -
fails here even where the arithmetic downstream of it is perfect. Dropping the
`offset` attribute in `project::read` turns 319 comparisons red; that fault is
invisible to `golden_master.rs`, which would read the offset from the JSON
either way.

The inputs are hand-written rather than generated, and chosen independently of
the cases above:

| File | Laminates |
|---|---|
| `stacks.elamx` | `XC-QI`, the quasi-isotropic `[45/-45/0/90]s`; `XC-Kreuz`, a two-ply `[0/90]` whose B matrix is as large as B gets, under a temperature change alone; `XC-Hybrid`, two materials and two ply thicknesses around a shared middle layer, with a different criterion on every ply |
| `awkward.elamx` | `XC-Dick`, 24 plies of an ultra-high-modulus carbon (E11/E22 ≈ 48) under a 14x14 Ritz problem; `XC-Versetzt`, a 1.5 mm reference-plane offset, `invert_z`, five plies in five thicknesses of two materials at angles a user would type (12.5, -78, 100, -135, 220) and every degree of freedom prescribed as a strain in one of its load cases; `XC-Gewebe`, a balanced fabric where E11 = E22 but the strengths differ |

Regenerating a `.txt` after changing its `.elamx` - same three warnings as in
step 2 above about `--locale`, the `=` and the stale `lock`:

```sh
cd elamx-core/core/tests/golden/crosscheck
"<eLamX>/bin/elamx64.exe" --locale en --userdir /tmp/elamx-batch     --input="$(pwd)/stacks.elamx" --output="$(pwd)/stacks.txt"
```

Adding a case is dropping two more files into that directory: the test walks
it and needs no edit.

### Two tolerances that are not the printed precision

Neither is a concession to the port.

**Ply stresses and strains are compared in separate groups**, with an
absolute floor per unit (a micropascal, and a strain of 1e-12) - in `mod
limits` in `batch_crosscheck.rs`. `close_group` takes its floor from the
largest value in the group, and a stress in MPa is some thousands of times a
strain - so a group holding both compares the strains to the precision of the
stresses, which is to say not at all. The floors themselves are for the plies
that are exactly zero in theory: the mid-plane ply of `XC-QI` under pure
bending prints 1.9e-15 MPa on one side and 1.4e-14 on the other, and comparing
two kinds of rounding noise to each other says only which one rounded first.

**The buckling spectrum is compared in mu = -1/lambda, as a set** - in
`check_buckling_spectrum` in `tests/common/mod.rs`, which both suites use. The
batch prints eleven digits, but the Jacobi solver both programs share does not
solve to eleven: it stops once a rotation moves no diagonal entry of the mu
problem by more than 1e-10, so what it leaves is absolute in mu, and larger
where two eigenvalues sit close together. Windows and Linux round a libm call
in the stiffness matrix differently, which is enough to stop it at another
rotation - 6212 against 6021 in `XC-QI-Beul-Schub`, a shear-loaded plate whose
spectrum spans 32 to 1.2e10. On Windows, Rust and Java then agree to every
printed digit; on Linux, a clustered pair in mid-spectrum moves by 3e-7 in mu
(3e-4 in lambda), `n_crit` by 1e-8 relative, and the +/- pairs a shear load
produces swap places, since their magnitudes agree only that far.

So the spectrum is sorted by mu on both sides and compared to 1e-6 absolute,
and the critical load to 1e-9 in mu - a thousand times tighter, because it is
the largest |mu| and clear of its neighbours. Both limits are about three times
the worst seen on either platform. The old comparison, eight digits relative
to the group, looked stricter and was not: it took its floor from the largest
eigenvalue, 1e-8 x 1.2e10, so it passed anything within about 100 at the
bottom of the spectrum. The fault counts below rose when it was replaced.

### Keeping this one honest too

The same standard as above - each of these faults, introduced and then
reverted, turns `every_crosscheck_file_matches_elamx` red:

| Fault | Failing comparisons of 15763 |
|---|---|
| `project::read` ignores the laminate's `offset` attribute | 319 |
| `all_layers` does not reverse for `invert_z` | 387 |
| the special-orthotropic D matrix keeps its `D_{16}` | 83 |
| Puck reads `p_spz` where `p_spd` belongs | 5 |

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
