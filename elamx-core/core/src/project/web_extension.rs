//! `<webExtension>`: what the web version keeps in a project that eLamX 3.x
//! has no place for.
//!
//! One root element holding JSON in a CDATA section, not typed XML. The reason
//! is how the Java program saves: it re-parses the file it opened, changes the
//! sections it knows in place and writes the document back, so a foreign root
//! element survives a save there untouched. But it also finds its own sections
//! with `getElementsByTagName`, which searches ALL descendants - a `<laminate>`
//! or `<layer>` nested anywhere in here would be read as real data. JSON has no
//! tags, so it can never collide with one.
//!
//! The price is that eLamX 3.x keeps this data without understanding it: a
//! layer's extra criteria outlive a change of that layer in the desktop. That
//! is why entries carry fingerprints of what they were attached to, and why
//! the reader reports what it could not use as an [`ImportNotice`] rather than
//! quietly dropping it.

use serde::{Deserialize, Serialize};

/// The `schema` this build writes and the only one it interprets.
///
/// Every field a later phase fills is declared already, so adding data within
/// schema 1 needs no bump. A bump is for an incompatible change - and a file
/// carrying a newer schema is preserved verbatim rather than read, so an older
/// build neither misreads nor destroys what a newer one wrote.
pub const WEB_EXTENSION_SCHEMA: u32 = 1;

/// The element's name. Chosen to share no name with anything eLamX 3.x looks
/// for, for the reason given in the module documentation.
pub const WEB_EXTENSION_TAG: &str = "webExtension";

/// The web version's own part of a project.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct WebExtension {
    /// Format generation of the JSON, mirrored from the element's `schema`
    /// attribute so that the JSON on its own still says what it is.
    pub schema: u32,
    /// Failure criteria beyond the one eLamX 3.x stores per layer.
    ///
    /// Only the file's view: the reader moves these onto the layers
    /// (`Layer::extra_criteria`) and leaves this empty, and the writer builds
    /// it afresh from the layers, whatever a caller put here.
    #[serde(default)]
    pub layer_criteria: Vec<LayerCriteriaEntry>,
    /// Parameter studies (F4.1, F4.2): their definitions only. Results are
    /// never stored - they are recomputed when the study is looked at, so a
    /// file cannot carry numbers that no longer follow from its inputs.
    #[serde(default)]
    pub studies: Vec<Study>,
    /// Frozen laminate variants for the comparison page (F4.3).
    #[serde(default)]
    pub snapshots: Vec<Snapshot>,
    /// Saved report configurations (F3.2), by name.
    #[serde(default)]
    pub report_templates: Vec<ReportTemplate>,
    /// What the comparison page shows.
    #[serde(default)]
    pub comparison: Option<ComparisonState>,
    /// Thresholds of the stacking-rule check, when the user changed them.
    /// Fields a newer version adds are ignored and missing ones take their
    /// defaults, so this never makes a whole extension unreadable.
    #[serde(default)]
    pub stacking_rule_settings: Option<crate::stacking_rules::RuleSettings>,
}

impl WebExtension {
    /// A fresh extension of the current schema with nothing in it.
    pub fn new() -> Self {
        WebExtension {
            schema: WEB_EXTENSION_SCHEMA,
            ..Default::default()
        }
    }

    /// Whether there is anything worth writing.
    ///
    /// An empty extension is not written at all, so a project that uses no
    /// web-only feature stays byte-identical to what the desktop would write.
    pub fn is_empty(&self) -> bool {
        self.layer_criteria.is_empty()
            && self.studies.is_empty()
            && self.snapshots.is_empty()
            && self.report_templates.is_empty()
            && self.comparison.is_none()
            && self.stacking_rule_settings.is_none()
    }
}

/// The extra criteria of one layer.
///
/// Anchored by the layer's uuid, which eLamX 3.x keeps across a save.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LayerCriteriaEntry {
    pub laminate_uuid: String,
    pub layer_uuid: String,
    /// The criterion the layer's own `<criterion>` held when this was written.
    /// A fingerprint: if the file now says something else, the layer was
    /// edited in eLamX 3.x and the extra criteria no longer belong to it.
    pub primary: String,
    /// Criteria 2..n, in the order the user put them.
    pub extra: Vec<String>,
}

/// A report configuration the user saved under a name: what a report of this
/// project contains and how it is set.
///
/// Every field has a default and the choices are plain strings, so a template
/// written by a later version - a section kind this build does not know, a
/// paper size it cannot set - still reads; the web ignores what it does not
/// know rather than losing the whole extension over it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(default)]
pub struct ReportTemplate {
    pub name: String,
    /// Section kinds in report order: `materials`, `laminate`, `abd`,
    /// `loadCases`, `layerResults`, `failureSequence`, `buckling`,
    /// `vibration`, `deformation`, `comparison`.
    pub sections: Vec<String>,
    /// Laminate uuids; empty for every laminate.
    pub laminates: Vec<String>,
    /// `active` (each laminate's active load case) or `all`.
    #[cfg_attr(feature = "ts", ts(type = "\"active\" | \"all\""))]
    pub load_cases: String,
    /// `results` or `derivation`.
    #[cfg_attr(feature = "ts", ts(type = "\"results\" | \"derivation\""))]
    pub detail: String,
    /// `a4` or `letter`.
    #[cfg_attr(feature = "ts", ts(type = "\"a4\" | \"letter\""))]
    pub paper: String,
    pub author: String,
    /// Lines for the author's and a reviewer's signature on the cover (O8).
    pub signature: bool,
}

impl Default for ReportTemplate {
    fn default() -> Self {
        ReportTemplate {
            name: String::new(),
            sections: Vec::new(),
            laminates: Vec::new(),
            load_cases: "active".into(),
            detail: "results".into(),
            paper: "a4".into(),
            author: String::new(),
            signature: false,
        }
    }
}

/// The comparison page's columns.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct ComparisonState {
    pub variants: Vec<ComparisonVariant>,
}

/// One column of the comparison: a laminate under one of its load cases, or a
/// snapshot.
///
/// The load case is named by position AND name because it has no id in the
/// file - a `<calculation>` carries only its name, and the web version gives
/// load cases fresh ids on every open. The position finds it, the name checks
/// that it is still the same one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct ComparisonVariant {
    #[serde(default)]
    pub laminate_uuid: String,
    #[serde(default)]
    pub load_case_index: u32,
    #[serde(default)]
    pub load_case_name: String,
    /// Set when the column is a snapshot (F4.3, O6) rather than a laminate of
    /// the project; the three fields above are empty then.
    #[cfg_attr(feature = "ts", ts(optional))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
}

/// A load case, named the way the file can: by its laminate, its position
/// and its name - see [`ComparisonVariant`] for why an id will not do.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(default)]
pub struct LoadCaseRef {
    pub laminate_uuid: String,
    pub load_case_index: u32,
    pub load_case_name: String,
}

/// A parameter study: a matrix or a sweep, as the user defined it.
///
/// Flat rather than an enum of the two, and with every choice a plain string
/// and every field defaulted, for the reason [`ReportTemplate`] gives: a
/// study of a kind or with an option a later version adds must not make the
/// whole extension unreadable. A study this build cannot interpret is shown
/// as such and written back as it was read.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(default)]
pub struct Study {
    pub id: String,
    pub name: String,
    /// `matrix` or `sweep`; the matching field below holds the definition.
    pub kind: String,
    #[cfg_attr(feature = "ts", ts(optional))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matrix: Option<MatrixSpec>,
    #[cfg_attr(feature = "ts", ts(optional))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sweep: Option<SweepSpec>,
}

/// A matrix (F4.1): one value per laminate and load case, or per laminate and
/// failure criterion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(default)]
pub struct MatrixSpec {
    /// The rows: laminate uuids; empty for every laminate of the project.
    pub laminates: Vec<String>,
    /// `load_case` or `criterion`.
    pub columns: String,
    /// With `load_case` columns: the load cases, each applied to every row's
    /// laminate; empty for every load case of the laminates in the matrix.
    /// With `criterion` columns: the one load case every row is judged under;
    /// empty for each laminate's first.
    pub load_cases: Vec<LoadCaseRef>,
    /// With `criterion` columns: the criteria, each one applied to every ply
    /// in place of the ply's own.
    pub criteria: Vec<String>,
    /// `min_rf` (first ply, from the CLT) or `lpf` (last ply failure).
    pub output: String,
    /// Load cases or criteria as rows and laminates as columns instead.
    pub transpose: bool,
}

impl Default for MatrixSpec {
    fn default() -> Self {
        MatrixSpec {
            laminates: Vec::new(),
            columns: "load_case".into(),
            load_cases: Vec::new(),
            criteria: Vec::new(),
            output: "min_rf".into(),
            transpose: false,
        }
    }
}

/// A sweep (F4.2): one laminate and load case, one or two inputs varied over
/// a range, the chosen outputs at every point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(default)]
pub struct SweepSpec {
    pub laminate_uuid: String,
    /// The load case; `None` for the laminate's first.
    pub load_case: Option<LoadCaseRef>,
    pub x: Variation,
    /// A second input, for a carpet of curves.
    pub y: Option<Variation>,
    /// `min_rf`, `lpf`, `buckling_factor`, `f1`, `ex`, `ey`, `gxy`,
    /// `max_deflection`.
    pub outputs: Vec<String>,
    /// The ply count of the generated laminate when a ply fraction is varied -
    /// the whole stack, which is symmetric.
    pub plies: u32,
    /// The fractions of 0, +-45 and 90 degree plies the varied ones start
    /// from: what is not varied shares the rest in these proportions.
    pub fractions: [f64; 3],
}

impl Default for SweepSpec {
    fn default() -> Self {
        SweepSpec {
            laminate_uuid: String::new(),
            load_case: None,
            x: Variation::default(),
            y: None,
            outputs: vec!["min_rf".into()],
            plies: 16,
            fractions: [0.5, 0.25, 0.25],
        }
    }
}

/// One varied input of a sweep, with its range.
///
/// Flat, like [`Study`]: `kind` says which of the fields apply, and a kind
/// this build does not know leaves the study uninterpretable but readable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(default)]
pub struct Variation {
    /// `angle`, `fraction`, `load`, `plate` or `thickness`.
    pub kind: String,
    /// `angle`: the layers set to the value; `thickness`: the layers whose
    /// thickness is the value, empty for all. Layer uuids.
    pub layers: Vec<String>,
    /// `angle`: the layers set to the negative value - the other half of a
    /// +-theta pair.
    pub negated: Vec<String>,
    /// `fraction`: `0`, `45` or `90`.
    pub family: String,
    /// `load`: `n_x`, `n_y`, `n_xy`, `m_x`, `m_y`, `m_xy` or `factor`.
    pub component: String,
    /// `plate`: `a` or `b`.
    pub dim: String,
    pub from: f64,
    pub to: f64,
    /// Points over the range, both ends included.
    pub steps: u32,
}

impl Default for Variation {
    fn default() -> Self {
        Variation {
            kind: "angle".into(),
            layers: Vec::new(),
            negated: Vec::new(),
            family: String::new(),
            component: String::new(),
            dim: String::new(),
            from: 0.0,
            to: 90.0,
            steps: 19,
        }
    }
}

/// A laminate under a load case, frozen under a name (F4.3).
///
/// Self-contained on purpose: the laminate and every material it uses are
/// copied in, so the snapshot still means the same thing after the laminate
/// is edited or deleted. Its results are computed afresh from this copy;
/// `key_figures` only records what they were when it was taken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct Snapshot {
    pub id: String,
    pub name: String,
    /// When it was taken, as an ISO 8601 date and time.
    pub at: String,
    pub laminate: crate::model::Laminate,
    pub materials: Vec<crate::model::Material>,
    pub load_case: SnapshotLoadCase,
    /// The figures at the time, by name (`min_rf`, `ex`, ...).
    #[serde(default)]
    pub key_figures: std::collections::BTreeMap<String, f64>,
}

/// A load case as the web version keeps one: per degree of freedom a value
/// and whether it is a strain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct SnapshotLoadCase {
    pub name: String,
    pub dof_values: Vec<f64>,
    pub use_strain: Vec<bool>,
    #[serde(default)]
    pub delta_t: f64,
    #[serde(default)]
    pub delta_h: f64,
}

/// Something about the file the reader could not use, for the UI to tell the
/// user about. Never an error: the project itself was read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImportNotice {
    /// A `<webExtension>` of a schema this build does not know - written by a
    /// newer version. Kept verbatim and written back, but not interpreted.
    UnknownWebExtensionSchema { schema: String },
    /// A `<webExtension>` whose content is not valid JSON of its schema. Kept
    /// verbatim for the same reason: it is still somebody's data.
    InvalidWebExtension { message: String },
    /// A layer's extra criteria were dropped because the file was changed in
    /// eLamX 3.x since they were written: the layer is gone, or its own
    /// criterion is no longer the one they were written beside.
    StaleLayerCriteria {
        /// The laminate's name, or its uuid when the laminate is gone too.
        laminate: String,
        /// The layer's name, `None` when the layer no longer exists.
        layer: Option<String>,
        reason: StaleLayerCriteriaReason,
        /// The criteria that were dropped.
        extra: Vec<String>,
    },
    /// An extra criterion this build does not know - written by a newer one.
    /// Dropped from the layer; the layer's other criteria stay.
    UnknownLayerCriterion { laminate: String, layer: String, criterion: String },
}

/// Why a layer's extra criteria were dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum StaleLayerCriteriaReason {
    /// No layer with the entry's uuid exists any more.
    LayerMissing,
    /// The layer's `<criterion>` differs from the fingerprint.
    CriterionChanged,
}

/// The criterion a layer's `<criterion>` element holds - or will hold once
/// written: an id the file format cannot name is written as Puck, the
/// format's default, so that is what the fingerprint has to say too.
fn written_criterion(layer: &crate::model::Layer) -> &str {
    layer
        .criterion_id
        .as_deref()
        .filter(|id| super::naming::criterion_to_java(id).is_some())
        .unwrap_or(crate::failure::PUCK_ID)
}

/// Moves the extra criteria of `entries` onto the layers they belong to.
///
/// An entry is dropped - and reported - when its layer is gone or when the
/// layer's own criterion is no longer the `primary` it was written beside:
/// both mean the file was edited in eLamX 3.x, which keeps this element
/// without understanding it, so the extras may no longer be what the user
/// wants for that layer. A criterion id this build does not know is dropped
/// on its own and reported too.
pub(super) fn apply_layer_criteria(
    laminates: &mut [super::ProjectLaminate],
    entries: Vec<LayerCriteriaEntry>,
    notices: &mut Vec<ImportNotice>,
) {
    for entry in entries {
        let laminate = laminates.iter_mut().find(|l| l.laminate.id == entry.laminate_uuid);
        let Some(laminate) = laminate else {
            notices.push(ImportNotice::StaleLayerCriteria {
                laminate: entry.laminate_uuid,
                layer: None,
                reason: StaleLayerCriteriaReason::LayerMissing,
                extra: entry.extra,
            });
            continue;
        };
        let laminate_name = laminate.laminate.name.clone();
        let Some(layer) = laminate.laminate.layers.iter_mut().find(|l| l.id == entry.layer_uuid)
        else {
            notices.push(ImportNotice::StaleLayerCriteria {
                laminate: laminate_name,
                layer: None,
                reason: StaleLayerCriteriaReason::LayerMissing,
                extra: entry.extra,
            });
            continue;
        };
        if written_criterion(layer) != entry.primary {
            notices.push(ImportNotice::StaleLayerCriteria {
                laminate: laminate_name,
                layer: Some(layer.name.clone()),
                reason: StaleLayerCriteriaReason::CriterionChanged,
                extra: entry.extra,
            });
            continue;
        }
        let mut extra = Vec::with_capacity(entry.extra.len());
        for criterion in entry.extra {
            if super::naming::criterion_to_java(&criterion).is_some() {
                extra.push(criterion);
            } else {
                notices.push(ImportNotice::UnknownLayerCriterion {
                    laminate: laminate_name.clone(),
                    layer: layer.name.clone(),
                    criterion,
                });
            }
        }
        layer.extra_criteria = extra;
    }
}

/// The reverse: one entry per layer that has extra criteria, fingerprinted
/// with the criterion its `<criterion>` element is written with.
pub(super) fn collect_layer_criteria(laminates: &[super::ProjectLaminate]) -> Vec<LayerCriteriaEntry> {
    laminates
        .iter()
        .flat_map(|entry| {
            let laminate = &entry.laminate;
            laminate.layers.iter().filter(|l| !l.extra_criteria.is_empty()).map(|layer| {
                LayerCriteriaEntry {
                    laminate_uuid: laminate.id.clone(),
                    layer_uuid: layer.id.clone(),
                    primary: written_criterion(layer).to_string(),
                    extra: layer.extra_criteria.clone(),
                }
            })
        })
        .collect()
}

/// The element's body: the JSON, as a CDATA section.
///
/// A CDATA section cannot contain its own terminator, and a user-typed name
/// can. The standard way around it is to end the section in the middle of
/// `]]>` and open another one, which an XML reader joins back together.
pub(super) fn to_cdata(json: &str) -> String {
    format!("<![CDATA[{}]]>", json.replace("]]>", "]]]]><![CDATA[>"))
}
