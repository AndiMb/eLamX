//! Reads an `.elamx` file and writes it back out through this crate.
//!
//! The middle step of the writer check in `tests/golden/README.md`: eLamX 3.x
//! then calculates from the rewritten file, and its output must match the one
//! it produced from the original. That is the only way to test the writer
//! against the program that has to read what it writes - a Rust test can only
//! check that this crate reads its own output again.
//!
//! ```sh
//! cargo run --example rewrite_elamx -- tests/golden/reference.elamx rewritten.elamx
//! ```

use elamx_core::project::{read_elamx, write_elamx};

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(input), Some(output)) = (args.next(), args.next()) else {
        eprintln!("Aufruf: rewrite_elamx <eingabe.elamx> <ausgabe.elamx>");
        std::process::exit(2);
    };

    let xml = std::fs::read_to_string(&input)
        .unwrap_or_else(|e| fail(&format!("{input} nicht lesbar: {e}")));
    let project =
        read_elamx(&xml).unwrap_or_else(|e| fail(&format!("{input} nicht einlesbar: {e}")));
    std::fs::write(&output, write_elamx(&project))
        .unwrap_or_else(|e| fail(&format!("{output} nicht schreibbar: {e}")));

    println!(
        "{input} -> {output}: {} Materialien, {} Laminate",
        project.materials.len(),
        project.laminates.len()
    );
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}
