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
    /// Parameter studies (matrix and sweep definitions). Their shape belongs to
    /// the study feature and is carried opaquely until it exists.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(type = "Array<unknown>"))]
    pub studies: Vec<serde_json::Value>,
    /// Frozen laminate variants for the comparison page. Opaque for the same
    /// reason as `studies`.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(type = "Array<unknown>"))]
    pub snapshots: Vec<serde_json::Value>,
    /// Saved report configurations. Opaque for the same reason.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(type = "Array<unknown>"))]
    pub report_templates: Vec<serde_json::Value>,
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

/// The comparison page's columns.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct ComparisonState {
    pub variants: Vec<ComparisonVariant>,
}

/// One column of the comparison: a laminate under one of its load cases.
///
/// The load case is named by position AND name because it has no id in the
/// file - a `<calculation>` carries only its name, and the web version gives
/// load cases fresh ids on every open. The position finds it, the name checks
/// that it is still the same one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct ComparisonVariant {
    pub laminate_uuid: String,
    pub load_case_index: u32,
    pub load_case_name: String,
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
