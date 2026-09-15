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
});
