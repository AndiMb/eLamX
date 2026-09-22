//! The id tables the frontend keeps by hand, checked against the core.
//!
//! Most of the boundary is generated: `ts-rs` writes web/src/lib/generated/
//! from the Rust structs, and CI fails if regenerating moves anything. The
//! string ids are the part that is not. `CRITERIA` in web/src/lib/types.ts is
//! transcribed from the registry below, and nothing but this test notices when
//! the two drift.
//!
//! Drift is not a missing label. The frontend looks a criterion up by id and
//! reads its label off the result; a criterion the core returns and the table
//! does not list ends that lookup in `undefined`, and the module renders a
//! blank screen rather than a result. In the other direction it is worse: an
//! id the table offers and the core does not implement is a choice the user
//! can make that every calculation then refuses.
//!
//! Reading the TypeScript as text is the point - it means the check needs no
//! Node, no build of the frontend and no wasm, so it runs in the Rust job
//! beside the tests that already know what the core computes.
use std::collections::BTreeSet;
use std::path::PathBuf;

use elamx_core::failure::default_criterion_registry;

fn types_ts() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/types.ts");
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

/// The ids listed in one `export const NAME = [ ... ];` table, in the order
/// they appear. Deliberately a small scan rather than a regex crate: the shape
/// it reads is one `{ id: "...", ... }` per line, which is how the file is
/// written and how it stays diffable.
fn ids_of_table(source: &str, name: &str) -> Vec<String> {
    let header = format!("export const {name} = [");
    let start = source
        .find(&header)
        .unwrap_or_else(|| panic!("web/src/lib/types.ts has no `{header}`"))
        + header.len();
    let body = &source[start..];
    // The table closes on a `]` in the first column; what follows it varies
    // (`;`, or the `as const satisfies ...` that pins the label keys).
    let end = body
        .find("\n]")
        .unwrap_or_else(|| panic!("`export const {name}` is never closed"));

    body[..end]
        .lines()
        .filter_map(|line| {
            let rest = line.trim_start().strip_prefix("{ id: \"")?;
            let id = rest.split('"').next()?;
            Some(id.to_string())
        })
        .collect()
}

#[test]
fn the_frontend_lists_every_criterion_the_core_implements() {
    let implemented: BTreeSet<String> = default_criterion_registry().into_keys().collect();
    let listed: BTreeSet<String> = ids_of_table(&types_ts(), "CRITERIA").into_iter().collect();

    let missing: Vec<&String> = implemented.difference(&listed).collect();
    assert!(
        missing.is_empty(),
        "web/src/lib/types.ts CRITERIA is missing {missing:?} - add each with a \
         `criterion.<id>` entry in both message catalogs, or the module that \
         looks its label up will fail on a result the core can return"
    );
}

#[test]
fn the_frontend_offers_no_criterion_the_core_cannot_evaluate() {
    let implemented: BTreeSet<String> = default_criterion_registry().into_keys().collect();
    let listed: BTreeSet<String> = ids_of_table(&types_ts(), "CRITERIA").into_iter().collect();

    let unknown: Vec<&String> = listed.difference(&implemented).collect();
    assert!(
        unknown.is_empty(),
        "web/src/lib/types.ts CRITERIA offers {unknown:?}, which the core does \
         not implement - picking one would make every calculation refuse"
    );
}

#[test]
fn the_table_is_read_the_way_the_file_is_written() {
    // Guards the reader itself: were the scan to stop matching the file's
    // shape it would find nothing, and both tests above would pass vacuously.
    let ids = ids_of_table(&types_ts(), "CRITERIA");
    assert!(
        ids.len() >= default_criterion_registry().len(),
        "read only {} ids out of web/src/lib/types.ts - the scan has stopped \
         matching how the table is written",
        ids.len()
    );
    assert!(ids.contains(&"puck".to_string()), "read {ids:?}, which has no puck in it");
}
