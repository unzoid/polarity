//! What crosses to Swift: plain records made from the core's types, with only
//! what the Apple TV app shows or plays.

use polar_addon::{Meta, MetaPreview, RankedStream, Video};
use polar_library::Progress;

/// A title on a shelf.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Card {
    /// `tt…` for titles from the index; an add-on's own id otherwise.
    pub id: String,
    /// `movie` or `series` (add-ons may name others).
    pub kind: String,
    pub name: String,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    /// The year, or years for a show ("2019–2023").
    pub release_info: Option<String>,
    pub rating: Option<String>,
}

impl From<MetaPreview> for Card {
    fn from(m: MetaPreview) -> Self {
        Self {
            id: m.id,
            kind: m.ty,
            name: m.name,
            poster: m.poster,
            background: m.background,
            logo: m.logo,
            release_info: m.release_info,
            rating: m.imdb_rating,
        }
    }
}

/// One shelf on Home.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Row {
    /// Stable across loads: `index/<kind>/<catalog>` or `addon/<n>/<kind>/<catalog>`.
    pub key: String,
    pub title: String,
    pub cards: Vec<Card>,
}

/// One episode of a show.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Episode {
    /// What add-ons are asked for its sources (`tt…:1:5`).
    pub id: String,
    pub season: u32,
    pub episode: u32,
    pub title: String,
    pub overview: Option<String>,
    pub thumbnail: Option<String>,
    /// `YYYY-MM-DD` or a full date-time, as the source gives it.
    pub released: Option<String>,
}

impl From<Video> for Episode {
    fn from(v: Video) -> Self {
        Self {
            id: v.id,
            season: v.season,
            episode: v.episode,
            title: v.title,
            overview: v.overview,
            thumbnail: v.thumbnail,
            released: v.released,
        }
    }
}

/// A title page.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Title {
    pub card: Card,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub runtime: Option<String>,
    pub cast: Vec<String>,
    pub director: Vec<String>,
    /// In season and episode order; season 0 (specials) last. Empty for a movie.
    pub episodes: Vec<Episode>,
}

impl From<Meta> for Title {
    fn from(m: Meta) -> Self {
        let description = m.preview.description.clone();
        let genres = m.preview.genres.clone();
        let mut episodes: Vec<Episode> = m.videos.into_iter().map(Episode::from).collect();
        episodes.sort_by_key(|e| (e.season == 0, e.season, e.episode));
        Self {
            card: m.preview.into(),
            description,
            genres,
            runtime: m.runtime,
            cast: m.cast,
            director: m.director,
            episodes,
        }
    }
}

/// A request header the player sends with a source (`User-Agent`, `Referer`, `Origin` only).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Header {
    pub name: String,
    pub value: String,
}

/// A source the player can open as it is: an http(s) link.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Source {
    /// The add-on's name, as its manifest gives it.
    pub addon: String,
    /// Short quality line, e.g. "4K · HDR · 12.4 GB"; may be empty.
    pub label: String,
    /// The add-on's own lines for it (`name`, `title`), joined.
    pub text: String,
    pub url: String,
    pub headers: Vec<Header>,
    /// Its file names another episode than the one asked for: listed last, never played by itself.
    pub other_episode: bool,
    /// The add-on's whole answer for it (JSON), kept with the progress so resume plays the same file.
    pub stream_json: String,
}

impl Source {
    /// `None` for what the Apple TV can't open: torrents (no engine there), YouTube ids and
    /// links meant for a browser.
    pub(crate) fn from_ranked(r: RankedStream) -> Option<Self> {
        let url = r.stream.url.clone().filter(|u| polar_player::allow::is_web_url(u))?;
        let text = [&r.stream.name, &r.stream.title]
            .into_iter()
            .flatten()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Some(Self {
            addon: r.addon,
            label: r.label,
            text,
            headers: headers_of(&r.stream),
            other_episode: r.other_episode,
            stream_json: serde_json::to_string(&r.stream).unwrap_or_default(),
            url,
        })
    }
}

/// `behaviorHints.proxyHeaders.request`, as far as playback passes them on.
fn headers_of(stream: &polar_addon::Stream) -> Vec<Header> {
    let asked: std::collections::HashMap<String, String> = stream
        .behavior_hints
        .as_ref()
        .and_then(|h| h.pointer("/proxyHeaders/request"))
        .and_then(|r| r.as_object())
        .map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_owned()))).collect())
        .unwrap_or_default();
    polar_player::headers::playback_headers(&asked).into_iter().map(|(name, value)| Header { name, value }).collect()
}

/// The answer to a sources request.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Sources {
    /// Best first; the first one not `other_episode` is the one to play.
    pub sources: Vec<Source>,
    /// Add-ons asked, whatever they answered: none means no add-on serves this title.
    pub asked: Vec<String>,
    /// Add-ons that failed or timed out.
    pub failed: Vec<String>,
}

/// An installed add-on, as its manifest describes it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Addon {
    pub url: String,
    pub name: String,
    pub streams: bool,
    /// Home rows it adds (catalogs that need nothing typed in).
    pub rows: u32,
}

/// Where someone got to in one video, kept on the TV.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Resume {
    /// The title's id.
    pub meta_id: String,
    /// The video's: the movie's id, or the episode's (`tt…:1:5`).
    pub video_id: String,
    pub kind: String,
    pub name: String,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_title: Option<String>,
    /// Seconds.
    pub position: f64,
    pub duration: f64,
    /// [`Source::stream_json`] of what was playing, or empty.
    pub stream_json: String,
    /// When it was saved (ms since 1970); set by the core.
    pub updated_at: u64,
}

impl From<Progress> for Resume {
    fn from(p: Progress) -> Self {
        Self {
            meta_id: p.meta_id,
            video_id: p.video_id,
            kind: p.ty,
            name: p.name,
            poster: p.poster,
            background: p.background,
            season: p.season,
            episode: p.episode,
            episode_title: p.episode_title,
            position: p.position,
            duration: p.duration,
            stream_json: p.stream.and_then(|s| serde_json::to_string(&s).ok()).unwrap_or_default(),
            updated_at: p.updated_at,
        }
    }
}

impl From<Resume> for Progress {
    fn from(r: Resume) -> Self {
        Self {
            meta_id: r.meta_id,
            video_id: r.video_id,
            ty: r.kind,
            name: r.name,
            background: r.background,
            poster: r.poster,
            season: r.season,
            episode: r.episode,
            episode_title: r.episode_title,
            stream: serde_json::from_str(&r.stream_json).ok(),
            position: r.position,
            duration: r.duration,
            updated_at: r.updated_at,
        }
    }
}

/// One mpv option, set before the player starts (`mpv_set_option_string`).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PlayerOption {
    pub name: String,
    pub value: String,
}
