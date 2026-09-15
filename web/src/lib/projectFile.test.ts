import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportProject, importProject } from "./projectFile";

// The golden reference file, read through this app and written back out.
//
// The Rust side already checks that the file survives its own reader and
// writer. What it cannot check is the step in between: this app takes the
// project apart into atoms and puts it back together, and anything it does not
// carry is gone by the time the core writes. The `<optimizations>` section is
// the one that most needs saying so - the desktop program's batch mode does
// not read it back, so a mistake there would not show up anywhere else.
const REFERENCE = readFileSync(
  fileURLToPath(new URL("../../../elamx-core/core/tests/golden/reference.elamx", import.meta.url)),
  "utf8",
);

/** The original's own example of the reduced input format. */
const REDUCED = readFileSync(
  fileURLToPath(new URL("../../../elamx-core/core/tests/golden/reduced.elamxb", import.meta.url)),
  "utf8",
);

function section(xml: string, tag: string): string {
  const start = xml.indexOf(`<${tag}>`);
  const end = xml.indexOf(`</${tag}>`, start);
  expect(start, `<${tag}> fehlt`).toBeGreaterThanOrEqual(0);
  return xml.slice(start, end + tag.length + 3);
}

describe("ein Projekt durch die App und zurück", () => {
  it("gibt die Optimierungen unverändert wieder aus", async () => {
    const snapshot = await importProject(REFERENCE);

    // One is shown in the module, the rest are carried.
    expect(snapshot.optimization?.name).toBe("GM-Opt-SDA");
    expect(snapshot.extraOptimizations).toHaveLength(3);

    const written = await exportProject(snapshot);
    expect(section(written, "optimizations")).toBe(section(REFERENCE, "optimizations"));
  });

  /// A `.elamxb` opens as an ordinary project, which is the whole claim: the
  /// shorthand is for writing the question, not for holding the answer.
  it("öffnet auch die reduzierte Eingabedatei", async () => {
    const snapshot = await importProject(REDUCED, "reduced");

    // Three laminates from two in the file: the degraded twin the reader
    // invents for the buckling analyses is the third.
    expect(snapshot.laminates.map((l) => l.name)).toEqual([
      "Laminate HSB 37103-01",
      "Laminate HSB 37103-01 Buckling",
      "Beispiellaminat",
    ]);
    // A layer with no thickness of its own took the material's.
    expect(snapshot.laminates[0].layers[0].thickness).toBe(0.125);
    // The load cases became real load cases, by name.
    expect(snapshot.laminates[0].loadCases.map((c) => c.name)).toEqual([
      "Calculation A1",
      "Calculation A2",
    ]);
    // And it saves as an ordinary project.
    const written = await exportProject(snapshot);
    expect(written).toContain("<laminate ");
    expect(written).toContain("Laminate HSB 37103-01 Buckling");
  });
});
