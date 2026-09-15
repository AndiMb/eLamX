import io


def patch(path, pairs):
    t = io.open(path, encoding="utf-8").read()
    for old, new in pairs:
        assert old in t, (path, old[:70])
        t = t.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(t)


EXPORT_BLOCK = '''      <div className="flags">
        {/* The scene as a file, the way the original's 3D views export it: one
            four-cornered cell per face, points listed per corner. The importer
            next door reads exactly this, which is the only reason it can now be
            checked against a file rather than against a description of one. */}
        <button
          type="button"
          onClick={() =>
            downloadVtk(
              quadsToVtk(bodies.flatMap((body) => body.quads ?? gridToQuads(body.points ?? []))),
              exportName,
            )
          }
        >
          {t("failureBody.export")}
        </button>
      </div>
'''

patch("web/src/components/FailureBodyModuleContent.tsx", [
    ('import { FailureBody3D, type FailureBodySurface } from "./charts/FailureBody3D";',
     'import { FailureBody3D, type FailureBodySurface } from "./charts/FailureBody3D";\n'
     'import { downloadVtk, gridToQuads, quadsToVtk } from "../lib/vtkExport";'),
    ("""      <FailureBody3D bodies={bodies} markers={[]} />
    </>
  );
}""",
     """      <FailureBody3D bodies={bodies} markers={[]} />
""" + EXPORT_BLOCK + """    </>
  );
}"""),
])

# The inner component needs a name for the file.
t = io.open("web/src/components/FailureBodyModuleContent.tsx", encoding="utf-8").read()
assert "function FailureBodies({" in t
start = t.index("function FailureBodies({")
head_end = t.index("{", t.index(")", start)) + 1
t = t[:head_end] + "\n  const exportName = `versagenskoerper-${materialId}`;" + t[head_end:]
io.open("web/src/components/FailureBodyModuleContent.tsx", "w", encoding="utf-8", newline="").write(t)

patch("web/src/components/LaminateFailureModuleContent.tsx", [
    ('import { FailureBody3D } from "./charts/FailureBody3D";',
     'import { FailureBody3D } from "./charts/FailureBody3D";\n'
     'import { downloadVtk, gridToQuads, quadsToVtk } from "../lib/vtkExport";'),
    ("""            <FailureBody3D bodies={bodies} markers={[]} axisLabels={AXES} />""",
     """            <FailureBody3D bodies={bodies} markers={[]} axisLabels={AXES} />
            <div className="flags">
              <button
                type="button"
                onClick={() =>
                  downloadVtk(
                    quadsToVtk(
                      bodies.flatMap((body) => body.quads ?? gridToQuads(body.points ?? [])),
                    ),
                    `laminatversagenskoerper-${laminateId}`,
                  )
                }
              >
                {t("failureBody.export")}
              </button>
            </div>"""),
])


def add_messages(path, messages, anchor):
    t = io.open(path, encoding="utf-8").read()
    assert anchor in t, path
    block = "".join('  "%s": "%s",\n' % (k, v) for k, v in messages.items())
    t = t.replace(anchor, block + anchor, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(t)


add_messages("web/src/i18n/de.ts", {"failureBody.export": "Als VTK exportieren"},
             '  "module.export.label":')
add_messages("web/src/i18n/en.ts", {"failureBody.export": "Export as VTK"},
             '  "module.export.label":')
print("ok")
