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

// `<webExtension>`: what only this app keeps in a project.
describe("die Web-Erweiterung der Projektdatei", () => {
  /// A project that uses nothing web-only must come out exactly as the desktop
  /// would write it - otherwise every desktop file opened and saved here would
  /// carry a diff for nothing.
  it("schreibt keine Erweiterung, solange nichts drinsteht", async () => {
    const snapshot = await importProject(REFERENCE);
    expect(snapshot.comparison).toEqual([]);
    expect(snapshot.importNotices).toEqual([]);
    expect(await exportProject(snapshot)).not.toContain("webExtension");
  });

  it("nimmt den Vergleich in die Datei mit und bringt ihn zurück", async () => {
    const opened = await importProject(REFERENCE);
    const [first, second] = opened.laminates;
    const comparison = [
      { laminateId: first.id, loadCaseId: first.loadCases[1].id },
      { laminateId: second.id, loadCaseId: second.loadCases[0].id },
    ];

    const written = await exportProject({ ...opened, comparison });
    expect(written).toContain('<webExtension schema="1">');
    const reopened = await importProject(written);

    // Load cases get fresh ids on every open, so what has to survive is which
    // laminate and which of its load cases each column shows.
    const named = (s: typeof reopened) =>
      s.comparison.map((v) => {
        const laminate = s.laminates.find((l) => l.id === v.laminateId)!;
        return [laminate.name, laminate.loadCases.find((c) => c.id === v.loadCaseId)!.name];
      });
    expect(named(reopened)).toEqual(named({ ...opened, comparison }));
    expect(reopened.importNotices).toEqual([]);
  });

  /// A load case renamed or reordered in eLamX 3.x: the position no longer
  /// matches, the name still finds it.
  it("findet eine Vergleichsspalte über den Namen, wenn die Position nicht mehr stimmt", async () => {
    const opened = await importProject(REFERENCE);
    const laminate = opened.laminates[0];
    const target = laminate.loadCases[2];
    const written = await exportProject({
      ...opened,
      comparison: [{ laminateId: laminate.id, loadCaseId: target.id }],
    });
    // What an edit in the desktop amounts to: the first load case is gone.
    const edited = written.replace(/<calculation name="[^"]*">[\s\S]*?<\/calculation>/, "");
    const reopened = await importProject(edited);
    const column = reopened.comparison[0];
    expect(
      reopened.laminates[0].loadCases.find((c) => c.id === column.loadCaseId)?.name,
    ).toBe(target.name);
  });

  it("meldet eine Vergleichsspalte, die es nicht mehr gibt, statt sie still zu verlieren", async () => {
    const opened = await importProject(REFERENCE);
    const laminate = opened.laminates[0];
    const written = await exportProject({
      ...opened,
      comparison: [{ laminateId: laminate.id, loadCaseId: laminate.loadCases[0].id }],
    });
    const renamed = written.replaceAll(
      `"load_case_name":"${laminate.loadCases[0].name}"`,
      '"load_case_name":"Gibt es nicht"',
    );
    const reopened = await importProject(renamed);
    expect(reopened.comparison).toEqual([]);
    expect(reopened.importNotices).toEqual([
      { kind: "comparison_variant_dropped", laminate: laminate.name, loadCase: "Gibt es nicht" },
    ]);
  });

  /// The fields later features will own are carried untouched by this build,
  /// so opening and saving here does not lose what a newer one wrote.
  it("trägt die Teile der Erweiterung weiter, die hier noch niemand bearbeitet", async () => {
    const opened = await importProject(REFERENCE);
    const carry = {
      studies: [{ id: "s1", kind: "matrix" }],
      snapshots: [{ id: "snap" }],
      reportTemplates: [{ name: "Standard" }],
      stackingRuleSettings: { maxSameAngle: 4 },
    };
    const reopened = await importProject(
      await exportProject({ ...opened, webExtensionCarry: carry }),
    );
    expect(reopened.webExtensionCarry).toEqual(carry);
  });

  it("reicht den Hinweis des Kerns auf ein unbekanntes Schema durch", async () => {
    const newer = REFERENCE.replace(
      "</elamx>",
      '    <webExtension schema="9"><![CDATA[{"schema":9}]]></webExtension>\n</elamx>',
    );
    const opened = await importProject(newer);
    expect(opened.importNotices).toEqual([{ kind: "unknown_web_extension_schema", schema: "9" }]);
    // Kept as it came.
    expect(await exportProject(opened)).toContain('<webExtension schema="9">');
  });
});

describe("Zusatzkriterien je Lage in der Datei", () => {
  /// Web -> file -> web: what the table shows comes back as it was, and what
  /// eLamX 3.x reads - each layer's own criterion - is untouched.
  it("überstehen Speichern und Öffnen", async () => {
    const opened = await importProject(REFERENCE);
    const laminate = opened.laminates[0];
    const [first, second] = laminate.layers;
    const edited = {
      ...opened,
      laminates: [
        {
          ...laminate,
          layers: laminate.layers.map((l) =>
            l.id === first.id
              ? { ...l, extraCriteria: ["tsai_wu" as const, "hashin" as const] }
              : l,
          ),
        },
        ...opened.laminates.slice(1),
      ],
    };
    const written = await exportProject(edited);
    expect(written).toContain(`"layer_uuid":"${first.id}","primary":"${first.criterionId}"`);

    const reopened = await importProject(written);
    expect(reopened.importNotices).toEqual([]);
    expect(reopened.laminates[0].layers[0].extraCriteria).toEqual(["tsai_wu", "hashin"]);
    expect(reopened.laminates[0].layers[1]).toEqual(second);
    expect(reopened.laminates[0].layers.map((l) => l.criterionId)).toEqual(
      laminate.layers.map((l) => l.criterionId),
    );
  });

  /// A change of the layer's criterion in eLamX 3.x leaves the extension in
  /// place but no longer true, so the extras go and the user is told.
  it("werden verworfen, wenn eLamX 3.x das Kriterium geändert hat", async () => {
    const opened = await importProject(REFERENCE);
    const laminate = opened.laminates[0];
    const first = laminate.layers[0];
    const written = await exportProject({
      ...opened,
      laminates: [
        { ...laminate, layers: [{ ...first, extraCriteria: ["puck"] }, ...laminate.layers.slice(1)] },
        ...opened.laminates.slice(1),
      ],
    });
    const javaEdited = written.replace(
      "<criterion>de.elamx.laminate.addFailureCriteria.MaxStress</criterion>",
      "<criterion>de.elamx.laminate.addFailureCriteria.Hoffman</criterion>",
    );
    const reopened = await importProject(javaEdited);
    expect(reopened.laminates[0].layers[0].extraCriteria).toBeUndefined();
    expect(reopened.laminates[0].layers[0].criterionId).toBe("hoffman");
    expect(reopened.importNotices).toEqual([
      {
        kind: "stale_layer_criteria",
        laminate: laminate.name,
        layer: first.name,
        reason: "criterion_changed",
        extra: ["puck"],
      },
    ]);
  });
});
