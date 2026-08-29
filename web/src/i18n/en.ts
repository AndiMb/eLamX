// The English catalog is the SINGLE SOURCE OF TRUTH for the message-key set:
// `MessageKey` is derived from it (see ./index.ts), so every other catalog is
// typed as `Messages` and a forgotten or misspelled key is a compile error,
// not a silent runtime fallback. English (not German) holds that role for the
// same reason the Java original does: eLamX2's NetBeans bundles use
// `Bundle.properties` (English) as the default and `Bundle_de.properties` as
// the overlay, so English is the language a missing translation degrades to.
//
// Terminology is deliberately taken from the Java original's own bundles
// wherever one exists (e.g. LaminatEditor/Bundle.properties: "Stacking
// Sequence", "Edit Stack", "with middle layer"; AdditionalFailureCriteria/
// Bundle.properties: the failure-mode names) so users moving between the
// desktop and the web version meet the same words.
//
// Placeholders are `{name}` and are substituted by t()/tx().
export const en = {
  // --- App shell -----------------------------------------------------------
  "app.title": "eLamX – Classical laminate theory",

  "topbar.studentMode": "Student mode",
  "topbar.studentMode.hint": "Expand explanation panels by default",
  "topbar.theme.light": "Light theme",
  "topbar.theme.dark": "Dark theme",
  "topbar.language": "Language",
  "topbar.open": "Open",
  "topbar.open.hint": "Open an .elamx project file",
  "topbar.save": "Save",
  "topbar.save.hint": "Save the project as an .elamx file",
  "project.readError": "{message}",
  "project.readError.title": "This file could not be opened",
  "project.dismiss": "Dismiss",

  "nav.laminates": "Laminates",
  "nav.laminate": "Laminate",
  "nav.materials": "Materials",
  "nav.settings": "Settings",
  "nav.formatSettings": "Number formats & units",

  // --- Shared vocabulary ---------------------------------------------------
  "common.name": "Name",
  "common.yes": "yes",
  "common.no": "no",
  "common.local": "local",
  "common.global": "global",
  "common.top": "top",
  "common.bottom": "bottom",
  "common.renders": "(renders: {count})",

  // --- Sidebar tree --------------------------------------------------------
  "tree.rename": "Rename",
  "tree.renameHint": "{name} (double-click to rename)",
  "tree.expand": "Expand",
  "tree.collapse": "Collapse",

  // --- Laminates -----------------------------------------------------------
  "laminate.add": "Add laminate",
  "laminate.duplicate": "Duplicate laminate",
  "laminate.delete": "Delete laminate",

  // --- Materials -----------------------------------------------------------
  "material.add": "Add material",
  "material.duplicate": "Duplicate material",
  "material.delete": "Delete material",
  "material.delete.inUse": "Material is used by a laminate",
  "material.delete.last": "The last material cannot be deleted",
  "material.notFound": "Material not found.",
  "material.properties": "Material properties",
  "material.strengths": "Strengths",
  "material.hygrothermal": "Hygrothermal coefficients",
  "material.hygrothermal.hint": "Thermal (α) and hygral (β) expansion coefficients, parallel and transverse to the fibre. They are what turns a temperature or moisture change into the hygrothermal load vector — leave them at 0 and ΔT/ΔH have no effect.",
  "material.criterionParams": "Additional parameters per failure criterion",
  "material.criterionParams.hint":
    "These apply material-wide to every laminate using this material – depending on which criterion each layer selects. Collapsed by default: only needed if a layer actually uses that criterion.",
  "material.maxStrain.useGlobal": "global (instead of local)",
  // Subscript letters on the material symbols. The base notation (R∥, R⊥, ε)
  // is international, but these three subscripts are abbreviated WORDS and
  // are language-specific - German writes R∥,z / R∥,d for Zug/Druck, English
  // R∥,t / R∥,c for tension/compression. (eLamX2 localizes the same symbols,
  // see File_View/.../Bundle*.properties.)
  "material.sym.tension": "t",
  "material.sym.compression": "c",
  "material.sym.critical": "crit",

  // --- Welcome screen ------------------------------------------------------
  "welcome.title": "Welcome to eLamX",
  "welcome.body":
    "Select a laminate or a material on the left, or create a new one with the {plus} buttons in the tree. All results update live as you type.",

  // --- Layup editor --------------------------------------------------------
  "layers.title": "Stacking sequence",
  "layers.empty": "No layers yet — add the first one below.",
  "layers.selectAll": "Select all",
  "layers.selected.one": "{count} layer selected",
  "layers.selected.other": "{count} layers selected",
  "layers.select": "Select {name}",
  "layers.bulk.setAngle": "Set angle for selected layers",
  "layers.bulk.setThickness": "Set thickness for selected layers",
  "layers.bulk.setMaterial": "Set material for selected layers",
  "layers.bulk.setCriterion": "Set failure criterion for selected layers",
  "layers.bulk.materialPlaceholder": "Set material…",
  "layers.bulk.criterionPlaceholder": "Set criterion…",
  "layers.bulk.delete": "Delete selected layers",
  "layers.column.nr": "No.",
  "layers.column.angle": "Angle",
  "layers.column.thickness": "Thickness",
  "layers.column.material": "Material",
  "layers.column.criterion": "Criterion",
  "layers.moveUp": "Move layer up",
  "layers.moveDown": "Move layer down",
  "layers.duplicate": "Duplicate layer",
  "layers.delete": "Delete layer",
  "layers.add.title": "Add layer",
  "layers.add.placeholder": "Angles, e.g. 0/45/-45/90",
  "layers.add.aria": "Angles of the new layers",
  "layers.add.button": "Add layer(s)",
  "layers.add.hint":
    "Several angles separated by / create several layers (thickness, material and criterion are inherited from the last layer).",
  "layers.preview": "Preview",
  "layers.viz.aria": "Stacking sequence, drawn to scale by thickness",
  "layers.totalThickness": "Total thickness",
  "layers.count.one": "layer",
  "layers.count.other": "layers",
  "layers.mirrorNote": " (incl. mirrored half)",
  "layers.editStack": "Edit stack",
  "layers.invert": "Invert",
  "layers.rotateBy": "Rotate by",
  "layers.symmetryGroup": "Symmetry & orientation",
  "layers.symmetric": "symmetric",
  "layers.withMiddleLayer": "with middle layer",
  "layers.invertZ": "invert z-axis",

  "context.openLayup": "Open the layup",
  "context.plies": "{count} plies",

  // --- Modules -------------------------------------------------------------
  "modules.title": "Modules",
  "modules.unknown": "Unknown module.",
  "module.clt.label": "Layer-by-layer analysis",
  "module.clt.description": "Loads/strains, ABD matrix, stresses and failure check per layer",
  "module.buckling.label": "Plate buckling",
  "module.buckling.description": "Critical load and buckling mode of a rectangular plate under in-plane loads",
  "module.lastPlyFailure.label": "Last ply failure",
  "module.lastPlyFailure.description": "How much load the laminate still carries after its first ply has failed",

  "buckling.intro": "Stability of a rectangular plate cut from this laminate. The result is the factor by which the applied load flows have to be scaled to make the plate buckle.",
  "buckling.input.title": "Plate and load",
  "buckling.geometry": "Geometry",
  "buckling.loads": "In-plane load flows",
  "buckling.loads.hint": "Only the RATIO of these matters — the result scales all three by one common factor. Negative means compression, and only compression or shear can buckle a plate.",
  "buckling.boundary": "Edge conditions",
  "buckling.boundary.hint": "Two letters per edge pair: S = simply supported, C = clamped, F = free.",
  "buckling.bcX": "Edges normal to x",
  "buckling.bcY": "Edges normal to y",
  "buckling.bc.SS": "both simply supported",
  "buckling.bc.CC": "both clamped",
  "buckling.bc.CF": "clamped / free",
  "buckling.bc.FF": "both free",
  "buckling.bc.SC": "simply supported / clamped",
  "buckling.bc.SF": "simply supported / free",
  "buckling.method": "Method",
  "buckling.dMatrix": "Bending stiffness",
  "buckling.dMatrix.standard": "D matrix (needs a symmetric laminate)",
  "buckling.dMatrix.specialOrthotropic": "D with D16 = D26 = 0 (special orthotropic)",
  "buckling.dMatrix.dTilde": "D̃ = D − B A⁻¹ B (also for unsymmetric laminates)",
  "buckling.terms.hint": "Ritz terms per direction, 1 to {max}. More terms give a lower and more accurate load, at a cost growing with (m·n)³.",
  "buckling.error": "Buckling calculation failed: {message}",
  "buckling.result.title": "Critical load",
  "buckling.loadFactor": "Load factor λ",
  "buckling.noBuckling": "This load does not buckle the plate — under pure tension there is no positive load factor.",
  "buckling.symmetryWarning": "The selected bending stiffness assumes a symmetric laminate, but this one is not symmetric. Use D̃ instead, or make the layup symmetric.",
  "buckling.symmetryWarning.link": "Open the layup",
  "buckling.how.title": "Buckling eigenvalue problem",
  "buckling.how.hint": "The out-of-plane displacement is approximated by a Ritz series of {m}·{n} products of beam shape functions. That turns stability into a generalised eigenvalue problem; the smallest positive eigenvalue is the critical load factor.",
  "buckling.modes.title": "Buckling mode",
  "buckling.modes.list": "Further modes",
  "buckling.modes.column.nr": "Mode",
  "buckling.modes.column.ratio": "vs. 1st",
  "buckling.modes.list.hint": "Modes close together mean the plate has several nearly equally likely ways to buckle — imperfections then decide which one appears.",
  "buckling.shape.title": "Buckling mode",
  "buckling.shape.mode": "Mode",
  "buckling.shape.modeOption": "{nr}. — λ = {value}",
  "buckling.shape.exaggeration": "Exaggeration",
  "buckling.shape.hint": "Only the SHAPE is meaningful: a buckling mode has no absolute amplitude, so the height is exaggerated by the slider and the colour just repeats the sign and size of the deflection.",
  "buckling.plate3d.aria": "Rotatable 3D view of the buckled plate",
  "buckling.plate3d.hint": "Drag to rotate, scroll or pinch to zoom. The dashed outline is the undeformed plate.",
  "buckling.plate3d.reset": "Reset view",
  "clt.criterionHint": "Failure criterion and layer names are set in the {link}.",
  "clt.criterionHint.link": "stacking sequence",

  // --- CLT equation panel --------------------------------------------------
  "equation.title": "Equation",
  "equation.loads": "Mechanical loads",
  "equation.hygrothermalLoads": "Hygrothermal loads",
  "equation.hygrothermalLoads.hint": "The hygrothermal force/moment vector is computed from ΔT/ΔH and each layer's thermal and hygral expansion coefficients — it cannot be entered directly.",
  "equation.hygrothermalState": "Temperature and moisture change",
  "equation.hygrothermalState.hint": "Not operands of the equation: these two values are what the hygrothermal load vector is derived from.",
  "equation.strains": "Strains",
  "equation.prescribe": "Prescribe {name} instead",
  "equation.prescribe.title": "Prescribe {name} instead (currently computed)",

  // --- Results -------------------------------------------------------------

  // --- Last ply failure ----------------------------------------------------
  "lpf.intro": "A laminate does not fail when its first ply does: the cracked ply is degraded, the load redistributes, and the rest carries on. This analysis repeats that step until nothing is left to degrade.",
  "lpf.input.title": "Load and degradation",
  "lpf.loads": "Load",
  "lpf.loads.hint": "Unlike buckling, this is a magnitude, not just a direction: every reserve factor below is a multiple of exactly this load. A temperature or moisture load has no place here — the analysis cannot use one.",
  "lpf.degradation": "Degradation",
  "lpf.degradationFactor": "Degradation factor η",
  "lpf.degradeAllOnFibreFailure": "fibre failure also degrades the matrix",
  "lpf.degradation.hint": "η is what a degraded ply's stiffness is multiplied by — small, but not zero, since a ply carrying nothing at all would make the laminate singular. j_A knocks down the reported reserve factor of an inter-fibre failure, which is a crack rather than a failed laminate. ε_crit is the fibre-direction strain treated as allowable.",
  "lpf.ignores": "As in eLamX, this analysis rebuilds every ply on a fresh material: it uses the criteria's default parameters rather than the ones stored on your materials, ignores their thermal and moisture expansion, and analyses the stack about its own mid-plane regardless of the reference-plane offset.",
  "lpf.error": "Last-ply-failure analysis failed: {message}",
  "lpf.result.title": "Load factors",
  "lpf.rfIff": "RF first inter-fibre failure",
  "lpf.rfFf": "RF first fibre failure",
  "lpf.rfEpsilon": "RF critical strain",
  "lpf.efLpf": "Load factor at final failure",
  "lpf.fibreBeforeMatrix": "The fibres break before any matrix crack appears — there is no warning stage in this laminate under this load.",
  "lpf.noFailure": "No ply fails under this load, so there is nothing to degrade.",
  "lpf.how.title": "Progressive degradation",
  "lpf.how.hint": "Each step finds the ply with the smallest reserve factor and multiplies its stiffness by η — the matrix moduli for an inter-fibre failure, the fibre modulus for a fibre failure. The laminate is then recomputed under the same load. This run took {steps} steps.",
  "lpf.path.title": "Degradation path",
  "lpf.path.hint": "Reserve factors along the path are not monotonic: once a ply is degraded, the load it carried moves to the others, so the next step can happen at a much higher or much lower factor.",
  "lpf.path.column.step": "Step",
  "lpf.path.column.layer": "Layer",
  "lpf.path.column.type": "Failure",
  "lpf.path.column.mode": "Mode",
  "lpf.path.column.rf": "Reserve factor",
  "lpf.path.column.damage": "Degraded",
  "lpf.path.damage": "{iff}/{total} matrix, {ff}/{total} fibres",
  "lpf.type.ff": "fibre",
  "lpf.type.iff": "inter-fibre",
  "lpf.type.gmf": "material",
  "lpf.type.none": "none",
  "layerResults.clickHint": "Click a ply for its failure body: the criterion's failure surface with this ply's own stress state inside or outside it.",
  "layerDetail.title": "Ply {nr} — failure body",
  "layerDetail.close": "Close",
  "layerDetail.subtitle": "{material} at {angle}°, evaluated with {criterion}. The surface is every stress state the criterion calls exactly failing; the dots are this ply's state at its two surfaces.",
  "layerDetail.hint": "Drag to rotate, scroll or pinch to zoom. Each axis is scaled to its own extent — the fibre strength is some thirty times the shear strength, and at true scale the body would be a needle.",
  "layerDetail.rf": "Reserve factor",
  "layerDetail.error": "Failure body could not be computed: {message}",
  "failureBody.aria": "Rotatable 3D view of the failure body with the ply's stress state",

  "results.error": "Error: {message}",
  "results.computing": "Computing…",
  "results.abdVisualization": "ABD matrix – visualization",

  "abd.title": "ABD matrix",
  "abd.legend.a": "A (membrane)",
  "abd.legend.b": "B (coupling)",
  "abd.legend.d": "D (bending)",

  "summary.title": "Key figures",
  "summary.symmetric": "symmetric (B≈0)",
  "summary.areaWeight": "Area weight",
  "summary.ex.title": "Engineering constant Ex (with Poisson effect, “simple”)",
  "summary.ex.hint":
    "(ABD⁻¹) is the inverse of the full 6×6 ABD matrix – it also accounts for the coupling between strain and curvature (B block). Analogous for Ey, G and νyx.",
  "summary.nuxy.title": "Poisson's ratio νxy",

  "howComputed.toggle": "How was this computed? {title}",
  "howComputed.withValues": "With this laminate's current values:",

  "abdExplanation.localQ.title": "local stiffness Q (layer 1)",
  "abdExplanation.localQ.hint":
    "From the material properties (E∥, E⊥, ν12, G) of “{material}” – see the material page.",
  "abdExplanation.qBar.title": "Rotation into the laminate coordinate system (Q̄, layer 1)",
  "abdExplanation.qBar.hint": "Analogous for Q̄12, Q̄16, Q̄22, Q̄26, Q̄66.",
  "abdExplanation.qBar.actualValue": "actual value from the computation",
  "abdExplanation.aMatrix.title": "Assembly of the A matrix (A11)",
  "abdExplanation.aMatrix.hint":
    "Each summand is one layer's contribution to A (that layer's Q̄11 times its thickness t).",

  "layerResults.title": "Layer results",
  "layerResults.rfLower": "RF bottom",
  "layerResults.rfUpper": "RF top",
  "layerResults.modeLower": "Mode bottom",
  "layerResults.modeUpper": "Mode top",
  "layerResults.status": "Status",
  "layerResults.failed": "failed",
  "layerResults.passed": "passed",

  // --- Charts --------------------------------------------------------------
  "chart.showTable": "Show table",
  "chart.showChart": "Show chart",
  "chart.layer": "Layer {nr}",
  "chart.abdHeatmap.title": "ABD matrix by magnitude (each A/B/D block normalized separately)",
  "chart.abdHeatmap.aria": "ABD matrix heatmap",
  "chart.angleSweep.title": "Angle sweep: A11/A22/A66 over the rotation angle",
  "chart.angleSweep.aria": "Angle sweep chart for A11, A22 and A66",
  "chart.angleSweep.column.angle": "Angle",
  "chart.reserveFactor.title": "Reserve factors per layer",
  "chart.reserveFactor.aria": "Reserve factors per layer",
  "chart.throughThickness.title": "Through-thickness distribution: stress / strain",
  "chart.throughThickness.aria": "Through-thickness distribution of {component}",
  "chart.throughThickness.column.layer": "Layer",
  "chart.throughThickness.column.zLower": "z bottom",
  "chart.throughThickness.column.zUpper": "z top",
  "chart.throughThickness.column.valueLower": "Value bottom",
  "chart.throughThickness.column.valueUpper": "Value top",

  // --- Failure types (elamx-core's FailureType enum) -----------------------
  "failureType.Undamaged": "undamaged",
  "failureType.FiberFailure": "fibre failure",
  "failureType.MatrixFailure": "inter-fibre failure",
  "failureType.GeneralMaterialFailure": "general material failure",

  // --- Failure modes -------------------------------------------------------
  // Keys are the raw `failure_name` strings elamx-core emits (see
  // core/src/failure/*.rs). The core mixes the "Fiber"/"Fibre" spellings
  // between criteria, so both variants are listed verbatim rather than
  // normalized here - a key that matches the core exactly is far easier to
  // audit against the Rust source than a clever transformation, and an
  // unknown name falls back to the raw string anyway (see failureModeLabel).
  "failureMode.Failure": "Failure",
  "failureMode.FiberFailure": "Fiber Failure",
  "failureMode.FiberFailureTension": "Fiber Failure Tension",
  "failureMode.FiberFailureCompression": "Fiber Failure Compression",
  "failureMode.FibreFailureTension": "Fibre Failure Tension",
  "failureMode.FibreFailureCompression": "Fibre Failure Compression",
  "failureMode.FibreShearFailure": "Fibre Shear Failure",
  "failureMode.MatrixFailure": "Matrix Failure",
  "failureMode.MatrixFailureTension": "Matrix Failure Tension",
  "failureMode.MatrixFailureCompression": "Matrix Failure Compression",
  "failureMode.MatrixFailureShear": "Matrix Failure Shear",
  "failureMode.MatrixShearFailure": "Matrix Shear Failure",
  "failureMode.MatrixFailureModusA": "Matrix Failure Mode A",
  "failureMode.MatrixFailureModusB": "Matrix Failure Mode B",
  "failureMode.MatrixFailureModusC": "Matrix Failure Mode C",
  "failureMode.ShearFailure": "Shear Failure",

  // --- Failure criteria ----------------------------------------------------
  "criterion.max_stress": "Max. stress",
  "criterion.tsai_hill": "Tsai-Hill",
  "criterion.hashin": "Hashin",
  "criterion.tsai_wu": "Tsai-Wu",
  "criterion.max_strain": "Max. strain",
  "criterion.puck": "Puck",
  "criterion.christensen": "Christensen",
  "criterion.edge": "Edge",
  "criterion.fibre_failure": "Fibre failure only",
  "criterion.fmc": "FMC (Cuntze)",
  "criterion.hoffman": "Hoffman",
  "criterion.mayes": "Mayes",
  "criterion.rotem": "Rotem",
  "criterion.sun": "Sun",
  "criterion.ztl": "ZTL",

  // --- Quantity categories & units (lib/units.ts) -------------------------
  "quantity.stiffness": "Stiffness",
  "quantity.stress": "Stress / strength",
  "quantity.poissonRatio": "Poisson's ratio",
  "quantity.thickness": "Thickness",
  "quantity.angle": "Angle",
  "quantity.density": "Density",
  "quantity.force": "Force",
  "quantity.strain": "Strain",
  "quantity.temperature": "Temperature",
  "quantity.temperatureDelta": "Temperature change",
  "quantity.thermalExpansion": "Thermal expansion coefficient",
  "quantity.hygralExpansion": "Hygral expansion coefficient",
  "quantity.reserveFactor": "Reserve factor",
  "quantity.percent": "Moisture change",
  "unit.fraction": "fraction",
  "unit.perFraction": "per fraction",

  // --- Format settings page ------------------------------------------------
  "format.hint":
    "Changes take effect immediately in every display and input field – nothing to save. Internal calculations always use the canonical unit system (MPa, mm, °) regardless of this selection.",
  "format.column.quantity": "Quantity",
  "format.column.unit": "Unit",
  "format.column.decimals": "Decimals",
  "format.column.notation": "Notation",
  "format.dimensionless": "dimensionless",
  "format.notation.fixed": "Fixed-point",
  "format.notation.scientific": "Scientific",

  // --- Default names for newly created objects ----------------------------
  // These become user DATA the moment they are created (the user can rename
  // them), so they are resolved once at creation time in the language then
  // active - deliberately NOT re-translated afterwards, which would silently
  // rewrite names the user may have kept or referred to.
  "default.laminateName": "Laminate {nr}",
  "default.newLaminate": "New laminate",
  "default.layerName": "Layer {nr}",
  "default.materialName": "Material {nr}",
  "default.material.udCfrp": "UD-CFRP",
  "default.copy": "{name} copy",
} as const;
