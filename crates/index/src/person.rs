//! A person's page: who they are and the titles they're in, from TMDB (`tmdb::people`).

use polar_addon::MetaPreview;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonPage {
    /// TMDB's id for the person.
    pub id: u64,
    pub name: String,
    /// Portrait URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub biography: Option<String>,
    /// `YYYY-MM-DD`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub born: Option<String>,
    /// `YYYY-MM-DD`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub died: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub birthplace: Option<String>,
    /// What they're best known for: "Acting", "Directing", "Writing"…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_for: Option<String>,
    /// Titles they act in, most notable first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub acting: Vec<MetaPreview>,
    /// Titles they directed or created, most notable first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub directing: Vec<MetaPreview>,
    /// Titles they wrote, most notable first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub writing: Vec<MetaPreview>,
}

/// One person returned by search (`/search/person`), opening their [`PersonPage`].
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonHit {
    pub id: u64,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_for: Option<String>,
}
