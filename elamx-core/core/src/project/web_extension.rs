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
    /// Thresholds of the stacking-rule check. Opaque for the same reason.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(type = "unknown"))]
    pub stacking_rule_settings: Option<serde_json::Value>,
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
}

/// The element's body: the JSON, as a CDATA section.
///
/// A CDATA section cannot contain its own terminator, and a user-typed name
/// can. The standard way around it is to end the section in the middle of
/// `]]>` and open another one, which an XML reader joins back together.
pub(super) fn to_cdata(json: &str) -> String {
    format!("<![CDATA[{}]]>", json.replace("]]>", "]]]]><![CDATA[>"))
}
