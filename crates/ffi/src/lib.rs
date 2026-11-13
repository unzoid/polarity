//! The core crates for the native apps, through UniFFI: the Apple TV app
//! (`apple-tv/`) calls [`Core`] from Swift. Home's rows, title pages, sources
//! ranked by `polar_addon`, and watch progress kept by `polar_library` on the
//! device. Sign-in and the account's settings stay in Swift: the app hands the
//! core the add-ons and keys it read from the settings document.
//!
//! The Swift side is generated: `scripts/apple-tv-core.sh`.

mod model;
mod store;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::future::join_all;
use polar_addon::{rank_asked, AddonClient, Asked, Manifest, StreamFilter, WantedEpisode};
use polar_index::{IndexConfig, Indexer};
use polar_library::Space;

pub use model::{Addon, Card, Episode, Header, PlayerOption, Resume, Row, Source, Sources, Title};

uniffi::setup_scaffolding!();

/// How long an add-on gets to answer, as on the other apps.
const ADDON_TIMEOUT: Duration = Duration::from_secs(8);

/// Past this share of a video it counts as watched (the apps' default in Settings → Playback).
const WATCHED: f64 = 0.92;

/// Home's rows from the index, in the order the other apps' Home uses them (no genre or
/// "Because you watched" rows yet).
const INDEX_ROWS: &[(&str, &str, &str)] = &[
    ("series", "trending", "Trending Series"),
    ("movie", "new", "New Movies"),
    ("series", "popular", "Popular Series"),
    ("movie", "popular", "Popular Movies"),
    ("movie", "gems", "Hidden Gems"),
    ("series", "new", "New Series"),
    ("movie", "classics", "Classic Movies"),
    ("series", "top_rated", "Top Rated Series"),
    ("series", "gems", "Hidden Gem Series"),
    ("movie", "top_rated", "Top Rated Movies"),
    ("series", "classics", "Classic Series"),
];

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    /// A source or add-on couldn't be reached or answered badly. Never carries a link
    /// (an add-on's can hold the user's token).
    #[error("{message}")]
    Network { message: String },
    #[error("not found")]
    NotFound,
    /// No installed add-on or index serves this kind of id.
    #[error("{message}")]
    Unsupported { message: String },
    /// The data file couldn't be read or written.
    #[error("{message}")]
    Storage { message: String },
}

impl From<polar_index::IndexError> for CoreError {
    fn from(e: polar_index::IndexError) -> Self {
        match e {
            polar_index::IndexError::NotFound => Self::NotFound,
            polar_index::IndexError::UnsupportedId(id) => Self::Unsupported { message: format!("unsupported id {id}") },
            polar_index::IndexError::Upstream(message) => Self::Network { message },
        }
    }
}

impl From<polar_addon::AddonError> for CoreError {
    fn from(e: polar_addon::AddonError) -> Self {
        Self::Network { message: e.to_string() }
    }
}

#[derive(Clone)]
struct Installed {
    url: String,
    manifest: Manifest,
}

impl Installed {
    /// Catalogs Home can show: no extra the user must type or pick.
    fn rows(&self) -> impl Iterator<Item = &polar_addon::ManifestCatalog> {
        self.manifest.catalogs.iter().filter(|c| c.extra.iter().all(|e| !e.is_required))
    }
}

/// The app's one handle on the core. Every method can be called from any thread.
#[derive(uniffi::Object)]
pub struct Core {
    /// `None` in tests: Home then has only the add-ons' rows.
    index: RwLock<Option<Arc<Indexer>>>,
    addons: AddonClient,
    installed: RwLock<Vec<Installed>>,
    space: Mutex<Space>,
    file: store::File,
}

#[uniffi::export(async_runtime = "tokio")]
impl Core {
    /// Opens the progress kept in `data_dir` (the app's Application Support folder). Index rows
    /// come from TMDB once [`Core::set_tmdb`] has a key, from Cinemeta until then.
    #[uniffi::constructor]
    pub fn new(data_dir: String) -> Result<Arc<Self>, CoreError> {
        Self::open(PathBuf::from(data_dir), Some(Indexer::new(IndexConfig::default())))
    }

    /// The account's TMDB key and language (`en-US`), from its settings. `None` or empty: Cinemeta.
    pub fn set_tmdb(&self, key: Option<String>, language: Option<String>) {
        let indexer = Indexer::new(IndexConfig { tmdb_key: key, language });
        *self.index.write().unwrap_or_else(PoisonError::into_inner) = Some(Arc::new(indexer));
    }

    /// Where the index's rows and titles come from: "TMDB" or "Cinemeta (fallback)".
    pub fn index_source(&self) -> Option<String> {
        self.indexer().map(|i| i.source().to_owned())
    }

    /// The account's add-ons, by manifest link, in its order. Each manifest is fetched; one that
    /// fails is left out of the answer (and of Home and sources) until the next call.
    pub async fn set_addons(&self, urls: Vec<String>) -> Vec<Addon> {
        let fetched = join_all(urls.iter().map(|url| async move {
            let got = tokio::time::timeout(ADDON_TIMEOUT, self.addons.manifest(url)).await;
            got.ok()?.ok().map(|manifest| Installed { url: url.clone(), manifest })
        }))
        .await;
        let installed: Vec<Installed> = fetched.into_iter().flatten().collect();
        let listed = installed
            .iter()
            .map(|a| Addon {
                url: a.url.clone(),
                name: a.manifest.name.clone(),
                streams: a.manifest.resources.iter().any(|r| resource_name(r) == "stream"),
                rows: a.rows().count() as u32,
            })
            .collect();
        *self.installed.write().unwrap_or_else(PoisonError::into_inner) = installed;
        listed
    }

    /// Home's rows: the index's, then each add-on's catalogs. Rows that fail or come back empty
    /// are left out; Continue Watching is [`Core::continue_watching`].
    pub async fn home(&self) -> Vec<Row> {
        let index = self.indexer();
        let index_rows = INDEX_ROWS.iter().map(|&(kind, id, title)| {
            let index = index.clone();
            async move {
                let cards = index?.catalog(kind, id, 0, None).await.ok()?;
                Some(row(format!("index/{kind}/{id}"), title.to_owned(), cards))
            }
        });
        let installed = self.installed();
        let addon_rows = installed.iter().enumerate().flat_map(|(n, a)| {
            a.rows().map(move |c| async move {
                let base = AddonClient::base_url(&a.url);
                let fetch = self.addons.catalog(base, &c.ty, &c.id, &[]);
                let cards = tokio::time::timeout(ADDON_TIMEOUT, fetch).await.ok()?.ok()?;
                let name = c.name.clone().unwrap_or_else(|| c.id.clone());
                Some(row(format!("addon/{n}/{}/{}", c.ty, c.id), format!("{name} · {}", a.manifest.name), cards))
            })
        });
        let (index_rows, addon_rows) = futures::join!(join_all(index_rows), join_all(addon_rows));
        index_rows.into_iter().chain(addon_rows).flatten().filter(|r| !r.cards.is_empty()).collect()
    }

    /// A title page. `tt…` ids come from the index; others from the first add-on that serves them.
    pub async fn title(&self, kind: String, id: String) -> Result<Title, CoreError> {
        if id.starts_with("tt") {
            if let Some(index) = self.indexer() {
                return Ok(index.meta(&kind, &id).await?.into());
            }
        }
        let addon = self
            .installed()
            .into_iter()
            .find(|a| a.manifest.serves("meta", &kind, &id))
            .ok_or_else(|| CoreError::Unsupported { message: format!("no add-on describes {id}") })?;
        let meta = self.addons.meta(AddonClient::base_url(&addon.url), &kind, &id).await?;
        Ok(meta.into())
    }

    /// Every add-on that serves the video is asked at once; the answers are ranked by the core
    /// and only links the TV can play are kept.
    pub async fn sources(&self, kind: String, video_id: String) -> Sources {
        let jobs: Vec<Installed> =
            self.installed().into_iter().filter(|a| a.manifest.serves("stream", &kind, &video_id)).collect();
        let (ty, id) = (kind.as_str(), video_id.as_str());
        let answers = join_all(jobs.iter().map(|a| async move {
            let fetch = self.addons.streams(AddonClient::base_url(&a.url), ty, id);
            (a, tokio::time::timeout(ADDON_TIMEOUT, fetch).await)
        }))
        .await;
        let mut all = Vec::new();
        let mut failed = Vec::new();
        for (a, answer) in answers {
            match answer {
                Ok(Ok(streams)) => all.extend(streams.into_iter().map(|stream| Asked {
                    addon: a.manifest.name.clone(),
                    request: Some(video_id.clone()),
                    stream,
                })),
                _ => failed.push(a.manifest.name.clone()),
            }
        }
        let wanted = WantedEpisode::from_ids([video_id.as_str()], &[]);
        let (ranked, _) = rank_asked(all, &StreamFilter::default(), wanted.as_ref());
        Sources {
            sources: ranked.into_iter().filter_map(Source::from_ranked).collect(),
            asked: jobs.iter().map(|a| a.manifest.name.clone()).collect(),
            failed,
        }
    }

    /// Saves where someone got to, now. `updated_at` is set here.
    pub fn save_progress(&self, resume: Resume) -> Result<(), CoreError> {
        let mut space = self.space.lock().unwrap_or_else(PoisonError::into_inner);
        space.progress_save(vec![resume.into()], now_ms());
        self.file.save(&space)
    }

    /// The latest unfinished video per title, newest first.
    pub fn continue_watching(&self) -> Vec<Resume> {
        let space = self.space.lock().unwrap_or_else(PoisonError::into_inner);
        space.continue_watching(WATCHED).into_iter().map(Resume::from).collect()
    }

    /// Every video of one title with progress (each episode of a show).
    pub fn progress_for(&self, meta_id: String) -> Vec<Resume> {
        let space = self.space.lock().unwrap_or_else(PoisonError::into_inner);
        space.progress_for(&meta_id).into_iter().map(Resume::from).collect()
    }

    /// Why the progress file couldn't be read at start, when it couldn't: the TV then keeps
    /// progress for this run only and never writes over the file.
    pub fn storage_problem(&self) -> Option<String> {
        self.file.problem()
    }
}

/// mpv's options on Apple TV: the iPhone's (cache, audio output, certificates, VideoToolbox frames
/// copied back), and nothing fetched or opened that the app didn't ask for.
#[uniffi::export]
pub fn player_options() -> Vec<PlayerOption> {
    let common = ["--ytdl=no", "--sub-auto=no", "--audio-file-auto=no"];
    common
        .into_iter()
        .chain(polar_player::tune::IOS_ARGS.iter().copied())
        .filter_map(|arg| {
            let (name, value) = arg.strip_prefix("--")?.split_once('=')?;
            Some(PlayerOption { name: name.to_owned(), value: value.to_owned() })
        })
        .collect()
}

/// mpv's `http-header-fields` for a source's headers.
#[uniffi::export]
pub fn header_fields(headers: Vec<Header>) -> String {
    let pairs: Vec<(String, String)> = headers.into_iter().map(|h| (h.name, h.value)).collect();
    polar_player::headers::mpv_fields(&pairs).join(",")
}

impl Core {
    fn open(dir: PathBuf, indexer: Option<Indexer>) -> Result<Arc<Self>, CoreError> {
        let (file, space) = store::File::open(dir)?;
        Ok(Arc::new(Self {
            index: RwLock::new(indexer.map(Arc::new)),
            addons: AddonClient::new(),
            installed: RwLock::default(),
            space: Mutex::new(space),
            file,
        }))
    }

    fn indexer(&self) -> Option<Arc<Indexer>> {
        self.index.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn installed(&self) -> Vec<Installed> {
        self.installed.read().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

fn row(key: String, title: String, cards: Vec<polar_addon::MetaPreview>) -> Row {
    Row { key, title, cards: cards.into_iter().map(Card::from).collect() }
}

fn resource_name(r: &polar_addon::ManifestResource) -> &str {
    match r {
        polar_addon::ManifestResource::Name(name) => name,
        polar_addon::ManifestResource::Full { name, .. } => name,
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests;
