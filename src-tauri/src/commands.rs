//! The IPC surface the UI talks to. Every command is async and never blocks
//! the UI thread; network fan-out happens concurrently.

use std::sync::Arc;
use std::time::Duration;

use futures::future::join_all;
use futures::stream::{FuturesUnordered, StreamExt};
use polar_addon::{
    prepare_asked, rank_prepared, Asked, Manifest, Meta, MetaPreview, RankedStream, Stream, WantedEpisode,
};
use polar_index::Indexer;
use polar_library::AnimeLink;
use serde::Serialize;
use tauri::State;

use crate::downloads::Downloads;
use crate::locks::{Locked, ReadWrite};
use crate::store::{now, InstalledAddon, LibraryItem, Progress, Settings};
use crate::AppState;

/// How a command fails. It crosses IPC as `{ code, message }` (src/lib/errors.ts):
/// `code` for the UI to act on, `message` for people.
#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error(transparent)]
    Index(#[from] polar_index::IndexError),
    #[error(transparent)]
    Addon(#[from] polar_addon::AddonError),
    /// What was asked for isn't there (any more).
    #[error("{0}")]
    NotFound(String),
    /// Not something Polarity does: an id it doesn't key by, a link it won't open.
    #[error("{0}")]
    Unsupported(String),
    /// A web service (Seekr, IntroDB) failed or said no.
    #[error("{0}")]
    Upstream(String),
    /// Writing to disk failed.
    #[error("{0}")]
    Save(String),
    /// The link check found the source won't play; the reason says why.
    #[error("{0}")]
    Source(String),
    /// The player (mpv) didn't start or answer.
    #[error("{0}")]
    Player(String),
    #[error("{0}")]
    Other(String),
}

impl CmdError {
    pub fn code(&self) -> &'static str {
        use polar_addon::AddonError;
        use polar_index::IndexError;
        match self {
            CmdError::Index(IndexError::NotFound) | CmdError::NotFound(_) => "not_found",
            CmdError::Index(IndexError::UnsupportedId(_)) | CmdError::Unsupported(_) => "unsupported",
            CmdError::Index(IndexError::Upstream(_)) | CmdError::Upstream(_) => "upstream",
            CmdError::Addon(AddonError::Http(_)) => "network",
            CmdError::Addon(AddonError::Decode(_)) => "bad_answer",
            CmdError::Save(_) => "save_failed",
            CmdError::Source(_) => "source",
            CmdError::Player(_) => "player",
            CmdError::Other(_) => "other",
        }
    }
}

impl Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut e = s.serialize_struct("CmdError", 2)?;
        e.serialize_field("code", self.code())?;
        e.serialize_field("message", &self.to_string())?;
        e.end()
    }
}

pub type Result<T> = std::result::Result<T, CmdError>;

/// Per-addon budget. A slow addon must never hold the whole list hostage.
const ADDON_TIMEOUT: Duration = Duration::from_secs(8);

// --- Discovery -----------------------------------------------------------

#[tauri::command]
pub async fn catalog(
    state: State<'_, AppState>,
    ty: String,
    id: String,
    skip: Option<u32>,
    genre: Option<String>,
    // An age limit's bound for TMDB's film lists: the country and its highest certification allowed.
    cert_country: Option<String>,
    cert_max: Option<String>,
) -> Result<Vec<MetaPreview>> {
    let bound = cert_country.as_deref().zip(cert_max.as_deref());
    Ok(state.indexer().catalog_within(&ty, &id, skip.unwrap_or(0), genre.as_deref(), bound).await?)
}

/// One page of an installed addon's catalog (#206), its extra arguments
/// (`genre`, `skip`, `search`) as the manifest declares them. A catalog the
/// manifest doesn't list, or an argument it doesn't take, is refused.
#[tauri::command]
pub async fn addon_catalog(
    state: State<'_, AppState>,
    addon: String,
    ty: String,
    id: String,
    extra: Vec<(String, String)>,
) -> Result<Vec<MetaPreview>> {
    let found = active(&state).into_iter().find(|a| a.manifest.id == addon);
    let addon = found.ok_or_else(|| CmdError::NotFound("that add-on isn't installed".into()))?;
    let declared = addon.manifest.catalogs.iter().find(|c| c.ty == ty && c.id == id);
    if !declared.is_some_and(|c| c.accepts(&extra)) || extra.iter().any(|(_, v)| v.len() > 200) {
        return Err(CmdError::Unsupported("the add-on doesn't offer that list".into()));
    }
    let args: Vec<(&str, &str)> = extra.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let fetch = state.addons.catalog(&addon.manifest_url, &ty, &id, &args);
    match tokio::time::timeout(ADDON_TIMEOUT, fetch).await {
        Ok(page) => Ok(page?),
        Err(_) => Err(CmdError::Upstream(format!("{} took too long to answer", addon.manifest.name))),
    }
}

/// Titles like `id` ("Because you watched …").
#[tauri::command]
pub async fn recommend(state: State<'_, AppState>, ty: String, id: String) -> Result<Vec<MetaPreview>> {
    Ok(state.indexer().recommend(&ty, &id).await?)
}

#[derive(Serialize)]
pub struct SearchResults {
    movies: Vec<MetaPreview>,
    series: Vec<MetaPreview>,
    people: Vec<polar_index::PersonHit>,
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String) -> Result<SearchResults> {
    let ix: Arc<Indexer> = state.indexer();
    let (movies, series, people) =
        tokio::join!(ix.search("movie", &query), ix.search("series", &query), ix.search_people(&query));
    // Partial results beat a dead search: only fail when neither movies nor series answered.
    let (movies, series) = match (movies, series) {
        (Ok(m), Ok(s)) => (m, s),
        (Ok(m), Err(e)) => {
            tracing::warn!("series search failed, returning movies only: {e}");
            (m, Vec::new())
        }
        (Err(e), Ok(s)) => {
            tracing::warn!("movie search failed, returning series only: {e}");
            (Vec::new(), s)
        }
        (Err(e), Err(_)) => return Err(e.into()),
    };
    let people = people.unwrap_or_else(|e| {
        tracing::warn!("people search failed: {e}");
        Vec::new()
    });
    Ok(SearchResults { movies, series, people })
}

/// Films in a TMDB collection / franchise (`/collection/{id}`); empty without a TMDB key.
#[tauri::command]
pub async fn collection(state: State<'_, AppState>, id: u64) -> Result<Vec<MetaPreview>> {
    Ok(state.indexer().collection(id).await?)
}

/// Films only, narrowed to a release year where the catalog can: what an
/// import matching titles by name and year asks (#87).
#[tauri::command]
pub async fn search_movies(state: State<'_, AppState>, query: String, year: Option<u16>) -> Result<Vec<MetaPreview>> {
    Ok(state.indexer().search_in("movie", &query, year).await?)
}

#[tauri::command]
pub async fn meta(state: State<'_, AppState>, ty: String, id: String) -> Result<Meta> {
    if id.starts_with("tt") {
        return Ok(state.indexer().meta(&ty, &id).await?);
    }
    if let Some(mal_str) = id.strip_prefix("mal:") {
        if let Ok(mal_id) = mal_str.parse::<u32>() {
            if let Some(m) = state.anime_lists.find(&polar_anime::AnimeKey::Mal(mal_id)).await {
                if let Some(imdb) = m.imdb_id.filter(|s| s.starts_with("tt")) {
                    if let Ok(meta) = state.indexer().meta(&ty, &imdb).await {
                        return Ok(meta);
                    }
                }
            }
            return mal_fallback_meta(&state, mal_id, None).await;
        }
    }
    if let Some(al_str) = id.strip_prefix("anilist:") {
        if let Ok(al_id) = al_str.parse::<u32>() {
            if let Some(m) = state.anime_lists.find(&polar_anime::AnimeKey::Anilist(al_id)).await {
                if let Some(imdb) = m.imdb_id.filter(|s| s.starts_with("tt")) {
                    if let Ok(meta) = state.indexer().meta(&ty, &imdb).await {
                        return Ok(meta);
                    }
                }
            }
            return anilist_fallback_meta(&state, al_id).await;
        }
    }
    if let Some(kitsu_str) = id.strip_prefix("kitsu:") {
        if let Ok(kitsu_id) = kitsu_str.parse::<u32>() {
            if let Some(m) = state.anime_lists.find(&polar_anime::AnimeKey::Kitsu(kitsu_id)).await {
                if let Some(imdb) = m.imdb_id.filter(|s| s.starts_with("tt")) {
                    if let Ok(meta) = state.indexer().meta(&ty, &imdb).await {
                        return Ok(meta);
                    }
                }
                if let Some(mal_id) = m.mal_id {
                    return mal_fallback_meta(&state, mal_id, Some(kitsu_id)).await;
                }
            }
        }
    }
    // Non-IMDb ids belong to whichever installed addon claims them.
    let addon = active(&state)
        .into_iter()
        .find(|a| a.manifest.serves("meta", &ty, &id))
        .ok_or_else(|| CmdError::Unsupported(format!("no addon provides metadata for {id}")))?;
    Ok(state.addons.meta(&addon.manifest_url, &ty, &id).await?)
}

async fn mal_fallback_meta(state: &AppState, mal_id: u32, kitsu: Option<u32>) -> Result<Meta> {
    let (item, eps) = state.anime_catalog.mal_entry(mal_id, &state.anime_lists).await.map_err(CmdError::Upstream)?;
    Ok(anime_item_to_fallback_meta(item, eps, kitsu, format!("mal:{mal_id}")))
}

async fn anilist_fallback_meta(state: &AppState, anilist_id: u32) -> Result<Meta> {
    let (item, eps) =
        state.anime_catalog.anilist_entry(anilist_id, &state.anime_lists).await.map_err(CmdError::Upstream)?;
    Ok(anime_item_to_fallback_meta(item, eps, None, format!("anilist:{anilist_id}")))
}

fn anime_item_to_fallback_meta(
    item: polar_anime::AnimeItem,
    eps: Vec<polar_anime::JikanEpisode>,
    kitsu: Option<u32>,
    fallback_prefix: String,
) -> Meta {
    let kitsu = kitsu.or(item.kitsu_id);
    let prefix = kitsu.map(|k| format!("kitsu:{k}")).unwrap_or(fallback_prefix);
    let videos: Vec<polar_addon::Video> = if item.ty == "movie" {
        Vec::new()
    } else if !eps.is_empty() {
        eps.into_iter()
            .map(|e| polar_addon::Video {
                id: format!("{prefix}:{}", e.number),
                title: e.title,
                season: 1,
                episode: e.number,
                released: e.aired,
                thumbnail: item.background.clone().or_else(|| item.poster.clone()),
                overview: None,
                rating: None,
            })
            .collect()
    } else {
        (1..=item.episodes.unwrap_or(0))
            .map(|n| polar_addon::Video {
                id: format!("{prefix}:{n}"),
                title: format!("Episode {n}"),
                season: 1,
                episode: n,
                released: None,
                thumbnail: item.background.clone().or_else(|| item.poster.clone()),
                overview: None,
                rating: None,
            })
            .collect()
    };
    Meta {
        preview: MetaPreview {
            id: item.id,
            ty: item.ty,
            name: item.name,
            poster: item.poster,
            background: item.background,
            logo: item.logo,
            logos: item.logos,
            description: item.description,
            release_info: item.year.map(|y| y.to_string()),
            imdb_rating: item.score.map(|s| format!("{s:.1}")),
            genres: item.genres,
            certification: item.certification,
        },
        runtime: item.duration.map(|d| format!("{d} min")),
        cast: Vec::new(),
        director: Vec::new(),
        trailer_yt_id: None,
        trailer_source: None,
        videos,
        people: Vec::new(),
        details: polar_addon::MetaDetails::default(),
        crew: Vec::new(),
        extras: Vec::new(),
    }
}

/// Lightweight metadata projection for background library hydration (`fillUntitled`): skips
/// Cinemeta episode renumbering and per-season TMDB fan-out (`MetaMask::Display`).
#[tauri::command]
pub async fn meta_display(state: State<'_, AppState>, ty: String, id: String) -> Result<Meta> {
    if id.starts_with("tt") {
        return Ok(state.indexer().meta_with(&ty, &id, polar_index::MetaMask::Display).await?);
    }
    meta(state, ty, id).await
}

/// The IMDb id of a TMDB title (a TMDB page opened in Polarity, #208); `None` without a TMDB key.
#[tauri::command]
pub async fn imdb_for_tmdb(state: State<'_, AppState>, ty: String, id: u64) -> Result<Option<String>> {
    Ok(state.indexer().imdb_for_tmdb(&ty, id).await?)
}

/// The orders a show can be watched in besides as aired (TMDB's episode groups); empty without a TMDB key.
#[tauri::command]
pub async fn episode_orders(state: State<'_, AppState>, id: String) -> Result<Vec<polar_index::EpisodeOrderInfo>> {
    Ok(state.indexer().episode_orders(&id).await?)
}

/// One of those orders, its episodes as ids of the show's episode list.
#[tauri::command]
pub async fn episode_order(state: State<'_, AppState>, id: String, order: String) -> Result<polar_index::EpisodeOrder> {
    Ok(state.indexer().episode_order(&id, &order).await?)
}

/// A person's page by TMDB id: who they are and their titles; not found without a TMDB key.
#[tauri::command]
pub async fn person(state: State<'_, AppState>, id: u64) -> Result<polar_index::PersonPage> {
    Ok(state.indexer().person(id).await?)
}

// --- Streams -------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamsResult {
    streams: Vec<RankedStream>,
    /// Addons that failed or timed out, so the UI can say so instead of
    /// silently showing fewer results.
    failed: Vec<String>,
    /// Sources left out by the filters in Settings → Sources.
    hidden: usize,
    /// The addons asked (whatever they answered), for the player's start log: "none asked" and "asked,
    /// nothing found" are different failures.
    asked: Vec<String>,
    /// The ids they were asked for: the episode's, then its other ids.
    ids: Vec<String>,
    /// The add-ons still to answer: only in a partial answer; none in the whole one.
    waiting: Vec<String>,
}

/// Query every installed stream addon concurrently, then rank and dedupe. The ranking so far goes to `partial`
/// each time an add-on answers before the last (with `waiting` naming the rest), so a list can show sources
/// as they come; what's returned is the whole answer.
#[tauri::command]
pub async fn streams(
    state: State<'_, AppState>,
    ty: String,
    video_id: String,
    // Other ids for the same episode (an anime's Kitsu id): asked of every addon that serves them, results merged.
    alt_ids: Option<Vec<String>>,
    // The episode's absolute number(s), when the app knows them (an anime's): a file numbered that way is this episode.
    absolute: Option<Vec<u32>>,
    // A later anime season's own titles: a file named by one without a season number is that season's.
    season_names: Option<Vec<String>>,
    partial: tauri::ipc::Channel<StreamsResult>,
) -> Result<StreamsResult> {
    let mut ids = vec![video_id];
    ids.extend(alt_ids.unwrap_or_default());
    // What every file is checked against: another episode's file is listed last and never picked by itself.
    let names = season_names.unwrap_or_default();
    let wanted = WantedEpisode::from_ids(ids.iter().map(String::as_str), &absolute.unwrap_or_default())
        .map(|w| w.with_names(names.iter().map(String::as_str)));

    // One request per (addon, id) the addon claims to serve.
    let jobs: Vec<(InstalledAddon, String)> = active(&state)
        .into_iter()
        .flat_map(|a| {
            ids.iter()
                .filter(|id| a.manifest.serves("stream", &ty, id))
                .map(|id| (a.clone(), id.clone()))
                .collect::<Vec<_>>()
        })
        .collect();

    let client = &state.addons;
    let kind = ty.as_str();
    let filter = state.store.locked().data.settings.stream_filter(&ty);
    let mut pending: FuturesUnordered<_> = jobs
        .iter()
        .enumerate()
        .map(|(at, (a, id))| async move {
            let fetch = client.streams(&a.manifest_url, kind, id);
            (at, tokio::time::timeout(ADDON_TIMEOUT, fetch).await.ok().and_then(|r| r.ok()))
        })
        .collect();
    // Each job's answer in the add-ons' order, whatever order they come in: ties in the ranking keep that order.
    // Quality and episode regexes run once when a slot arrives instead of re-parsing earlier add-ons on each update.
    let mut slots: Vec<Option<PreparedAnswer>> = vec![None; jobs.len()];
    while let Some((at, answer)) = pending.next().await {
        let (addon, req_id) = &jobs[at];
        slots[at] = Some(answer.map(|streams| {
            prepare_asked(
                streams.into_iter().map(|stream| Asked {
                    addon: addon.manifest.name.clone(),
                    request: Some(req_id.clone()),
                    stream,
                }),
                wanted.as_ref(),
            )
        }));
        if !pending.is_empty() {
            // The page may have moved on: nothing to do about a list nobody listens to.
            let _ = partial.send(summarize(&jobs, &slots, &filter, &ids));
        }
    }
    Ok(summarize(&jobs, &slots, &filter, &ids))
}

/// One request's pre-parsed answer: the add-on's parsed sources, or none when it failed or ran out of time.
type PreparedAnswer = Option<Vec<RankedStream>>;

/// The sources the add-ons answered with so far, ranked, and who failed, answered or is still out. `slots` are
/// `jobs`' answers, `None` while one is out.
fn summarize(
    jobs: &[(InstalledAddon, String)],
    slots: &[Option<PreparedAnswer>],
    filter: &polar_addon::StreamFilter,
    ids: &[String],
) -> StreamsResult {
    use std::collections::HashSet;
    // Add-ons go by their manifest URL here: two may share a name (L22).
    let mut all = Vec::new();
    let mut answered = HashSet::new();
    let mut out = HashSet::new();
    for ((a, _), slot) in jobs.iter().zip(slots) {
        match slot {
            Some(Some(streams)) => {
                answered.insert(&a.manifest_url);
                all.extend(streams.iter().cloned());
            }
            None => {
                out.insert(&a.manifest_url);
            }
            Some(None) => {}
        }
    }
    // An addon that answered for one of the ids isn't "failed" because it timed out on another, one still
    // out for an id isn't failed yet, and each is named once.
    let named = |keep: &dyn Fn(&String, &Option<PreparedAnswer>) -> bool| {
        let mut seen = HashSet::new();
        jobs.iter()
            .zip(slots)
            .filter(|((a, _), slot)| keep(&a.manifest_url, slot) && seen.insert(&a.manifest_url))
            .map(|((a, _), _)| a.manifest.name.clone())
            .collect::<Vec<_>>()
    };
    let failed = named(&|url, slot| matches!(slot, Some(None)) && !answered.contains(url) && !out.contains(url));
    let waiting = named(&|url, slot| slot.is_none() && !answered.contains(url));
    let asked = named(&|_, _| true);
    let (streams, hidden) = rank_prepared(all, filter);
    StreamsResult { streams, failed, hidden, asked, ids: ids.to_vec(), waiting }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Playable {
    /// Plays in the built-in player.
    Url {
        url: String,
    },
    /// A torrent from the user's add-on: the player opens it with `torrent_open`.
    Torrent {},
    /// Needs a browser (e.g. YouTube trailers, "watch on" links).
    External {
        url: String,
    },
    Unsupported {
        reason: String,
    },
}

/// Turn a stream into something playable: a link, a torrent, or a YouTube video opened outside.
#[tauri::command(async)]
pub fn resolve_stream(stream: Stream) -> Result<Playable> {
    Ok(resolve(stream))
}

/// Shared by playback and downloads.
pub fn resolve(stream: Stream) -> Playable {
    if let Some(url) = stream.url {
        // A download played back: a path on this machine, which may have been deleted since.
        if crate::downloads::is_local(&url) && !std::path::Path::new(&url).exists() {
            return Playable::Unsupported { reason: "This download is no longer on this device.".into() };
        }
        return Playable::Url { url };
    }
    if stream.info_hash.is_some() {
        return Playable::Torrent {};
    }
    if let Some(yt) = stream.yt_id {
        // An add-on's id goes into a link the system opens: only a real video id gets through (L13).
        if !is_youtube_id(&yt) {
            return Playable::Unsupported { reason: "This stream's YouTube id isn't valid.".into() };
        }
        return Playable::External { url: format!("https://www.youtube.com/watch?v={yt}") };
    }
    if let Some(url) = stream.external_url {
        return Playable::External { url };
    }
    Playable::Unsupported { reason: "This stream has no playable source.".into() }
}

// --- Addons --------------------------------------------------------------

fn installed(state: &State<'_, AppState>) -> Vec<InstalledAddon> {
    state.store.locked().data.addons.clone()
}

/// The add-ons that are on, in the user's order: the ones asked for sources, subtitles, titles and lists.
fn active(state: &State<'_, AppState>) -> Vec<InstalledAddon> {
    state.store.locked().data.addons.iter().filter(|a| !a.disabled).cloned().collect()
}

#[tauri::command(async)]
pub fn addons_list(state: State<'_, AppState>) -> Vec<InstalledAddon> {
    installed(&state)
}

/// The manifest URLs of the add-ons the app installs itself: a profile new to this device keeps
/// them when it starts without anyone else's add-ons (#80).
#[tauri::command]
pub fn addons_bundled() -> Vec<String> {
    crate::BUNDLED_ADDONS.iter().map(|u| u.to_string()).collect()
}

/// An add-on's manifest, read but not installed: what an install link from outside asks the user
/// to confirm (#163). Only `https://` addresses, the only kind those links stand for.
#[tauri::command]
pub async fn addon_preview(state: State<'_, AppState>, url: String) -> Result<Manifest> {
    if !url.starts_with("https://") || !(url.ends_with("/manifest.json") || url.contains("/manifest.json?")) {
        return Err(CmdError::Unsupported("Not an add-on's address".into()));
    }
    Ok(state.addons.manifest(&url).await?)
}

#[tauri::command]
pub async fn addon_install(state: State<'_, AppState>, url: String) -> Result<InstalledAddon> {
    let url = url.trim().replace("stremio://", "https://");
    let manifest_url =
        if url.ends_with("/manifest.json") { url } else { format!("{}/manifest.json", url.trim_end_matches('/')) };
    let mut manifest = state.addons.manifest(&manifest_url).await?;
    manifest.behavior_hints.get_or_insert_with(Default::default);
    let mut addon = InstalledAddon { manifest_url, manifest, disabled: false };
    state.persist_now(|d| {
        // Reinstalling (or reconfiguring) keeps the addon's place in the order, and whether it's on.
        match d.addons.iter_mut().find(|a| a.manifest.id == addon.manifest.id) {
            Some(slot) => {
                addon.disabled = slot.disabled;
                *slot = addon.clone();
            }
            None => d.addons.push(addon.clone()),
        }
    })?;
    Ok(addon)
}

/// Switch an installed add-on off (kept, asked for nothing) or back on.
#[tauri::command(async)]
pub fn addon_set_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Result<()> {
    state.persist_now(|d| {
        if let Some(a) = d.addons.iter_mut().find(|a| a.manifest.id == id) {
            a.disabled = !enabled;
        }
    })
}

/// Put the installed add-ons in the order of `ids` (a drag on Settings → Add-ons): the order titles,
/// subtitles and lists are asked in, and ties between sources are broken by. Add-ons `ids` leaves out
/// keep their order after the listed ones; ids of add-ons not installed are ignored.
#[tauri::command(async)]
pub fn addon_reorder(state: State<'_, AppState>, ids: Vec<String>) -> Result<()> {
    state.persist_now(|d| {
        d.addons.sort_by_key(|a| ids.iter().position(|id| *id == a.manifest.id).unwrap_or(usize::MAX));
    })
}

#[tauri::command(async)]
pub fn addon_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    state.persist_now(|d| d.addons.retain(|a| a.manifest.id != id))
}

// --- Library & progress --------------------------------------------------

// Everything here acts on the active space (the signed-out "local" space or
// the selected profile), see `store::Space`.

#[tauri::command(async)]
pub fn library_list(state: State<'_, AppState>) -> Vec<LibraryItem> {
    let store = state.store.locked();
    store.data.space().map(|s| s.library_list()).unwrap_or_default()
}

/// Returns whether the item is in the library afterwards.
#[tauri::command(async)]
pub fn library_toggle(state: State<'_, AppState>, item: MetaPreview) -> Result<bool> {
    let item =
        LibraryItem { id: item.id, ty: item.ty, name: item.name, poster: item.poster, added_at: 0, updated_at: 0 };
    let mut added = false;
    state.persist_now(|d| added = d.space_mut().library_toggle(item, now()))?;
    Ok(added)
}

/// All progress entries for one title (every episode of a series), under
/// any of its ids.
#[tauri::command(async)]
pub fn progress_for(state: State<'_, AppState>, meta_id: String) -> Vec<Progress> {
    let store = state.store.locked();
    store.data.space().map(|s| s.progress_for(&meta_id)).unwrap_or_default()
}

#[tauri::command(async)]
pub fn progress_save(state: State<'_, AppState>, progress: Progress) -> Result<()> {
    state.persist(|d| d.space_mut().progress_save(vec![progress], now()))
}

/// Several entries in one save (marking a whole show watched). They count as
/// touched in the order given, so the last one is the title's latest.
#[tauri::command(async)]
pub fn progress_save_many(state: State<'_, AppState>, progress: Vec<Progress>) -> Result<()> {
    state.persist(|d| d.space_mut().progress_save(progress, now()))
}

/// What was added by [`library_import`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub library: usize,
    pub progress: usize,
}

/// Library items and progress exported by another app, with their own times
/// (`Space::import_exported`): nothing newer here is overwritten, and importing the same
/// file again adds nothing.
#[tauri::command(async)]
pub fn library_import(
    state: State<'_, AppState>,
    library: Vec<LibraryItem>,
    progress: Vec<Progress>,
) -> Result<Imported> {
    let mut added = (0, 0);
    state.persist_now(|d| added = d.space_mut().import_exported(library, progress, now()))?;
    Ok(Imported { library: added.0, progress: added.1 })
}

/// Latest unfinished video per title, newest first.
#[tauri::command(async)]
pub fn continue_watching(state: State<'_, AppState>) -> Vec<Progress> {
    let store = state.store.locked();
    let watched = store.data.settings.watched_fraction();
    store.data.space().map(|s| s.continue_watching(watched)).unwrap_or_default()
}

/// Everything you've watched: the latest video per title — finished or well
/// under way — newest first. The Library's "Watched" shelf.
#[tauri::command(async)]
pub fn watch_history(state: State<'_, AppState>) -> Vec<Progress> {
    let store = state.store.locked();
    let watched = store.data.settings.watched_fraction();
    store.data.space().map(|s| s.watch_history(watched)).unwrap_or_default()
}

/// Records which id an anime is played from, and moves library items and
/// progress kept under its other ids onto that one (docs/anime-identity.md).
/// `updatedAt` is set here. Returns whether anything changed: the anime
/// pages call this on every visit, and a link that says what the stored one
/// already does keeps the stored one's time (so sync has nothing to send).
/// A link the anime id lists already give, for a show with nothing kept
/// under its ids yet, isn't stored at all (#102, `Space::needs_link`).
#[tauri::command]
pub async fn link_anime(state: State<'_, AppState>, mut link: AnimeLink) -> Result<bool> {
    if !link.is_valid() {
        return Err(CmdError::Unsupported(format!("not a title id Polarity keys by: {}", link.canonical)));
    }
    let already_same = {
        let store = state.store.locked();
        store.data.space().is_some_and(|s| s.links.get(&link.anilist).is_some_and(|old| old.same_target(&link)))
    };
    if already_same {
        return Ok(false);
    }
    // What the anime id lists say (none when they can't be read: then the link is kept).
    let listed = state.anime_lists.find(&polar_anime::AnimeKey::Anilist(link.anilist)).await.and_then(|m| m.imdb_id);
    let skip = {
        let store = state.store.locked();
        store.data.space().is_some_and(|s| {
            s.links.get(&link.anilist).is_some_and(|old| old.same_target(&link))
                || !s.needs_link(&link, listed.as_deref())
        })
    };
    if skip {
        return Ok(false);
    }
    link.updated_at = now();
    let mut changed = false;
    state.persist(|d| changed = d.space_mut().link_anime(link))?;
    Ok(changed)
}

/// Takes back the link stored for an anime (#335, "Use Polarity's match"): it plays from what the
/// id lists or the title search find again, and what the link moved goes back. The removal syncs.
/// Returns whether there was a link to take back.
#[tauri::command]
pub async fn unlink_anime(state: State<'_, AppState>, anilist: u32) -> Result<bool> {
    let mut changed = false;
    state.persist(|d| changed = d.space_mut().unlink_anime(anilist, now()))?;
    Ok(changed)
}

/// The anime links of the active space; removed ones say nothing, so they're left out.
#[tauri::command(async)]
pub fn anime_links(state: State<'_, AppState>) -> Vec<AnimeLink> {
    let store = state.store.locked();
    store.data.space().map(|s| s.links.values().filter(|l| !l.removed).cloned().collect()).unwrap_or_default()
}

// --- Settings ------------------------------------------------------------

/// Why a data file couldn't be read at start-up, if one couldn't: changes
/// then last only until the app quits, and the app says so (critique C1).
#[tauri::command(async)]
pub fn store_problem(state: State<'_, AppState>, downloads: State<'_, Arc<Downloads>>) -> Option<String> {
    let store = state.store.locked().problem().map(str::to_owned);
    store.or_else(|| downloads.problem().map(str::to_owned))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    settings: Settings,
    metadata_source: &'static str,
}

#[tauri::command(async)]
pub fn settings_get(state: State<'_, AppState>) -> SettingsView {
    let settings = state.store.locked().data.settings.clone();
    SettingsView { settings, metadata_source: state.indexer().source() }
}

#[tauri::command(async)]
pub fn settings_set(state: State<'_, AppState>, mut settings: Settings) -> Result<SettingsView> {
    settings.bound_custom_themes();
    let rebuild = {
        let store = state.store.locked();
        store.data.settings.tmdb_key != settings.tmdb_key
            || store.data.settings.language != settings.language
            || store.data.settings.tmdb_modules != settings.tmdb_modules
    };
    if rebuild {
        *state.indexer.writing() = Arc::new(Indexer::new(crate::index_config(&settings)));
    }
    let next = settings.clone();
    state.persist_now(|d| d.settings = next)?;
    Ok(SettingsView { settings, metadata_source: state.indexer().source() })
}

/// What every setting is until someone changes it: settings sync sends only
/// the ones that differ (docs/supabase-storage.md §3.3).
#[tauri::command]
pub fn settings_defaults() -> Settings {
    Settings::default()
}

/// Everything back to the defaults, except what took effort to set up: API
/// keys and the metadata language.
#[tauri::command(async)]
pub fn settings_reset(state: State<'_, AppState>) -> Result<SettingsView> {
    let current = state.store.locked().data.settings.clone();
    let fresh = Settings {
        tmdb_key: current.tmdb_key,
        seekr_key: current.seekr_key,
        mdblist_key: current.mdblist_key,
        omdb_key: current.omdb_key,
        language: current.language,
        ..Settings::default()
    };
    settings_set(state, fresh)
}

// --- Subtitles -----------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleOption {
    id: String,
    url: String,
    lang: String,
    addon: String,
}

/// External subtitles from every installed addon that serves them. `video_size` and `filename`
/// are the playing stream's hints, when it has them: add-ons match subtitles to the file by them.
#[tauri::command]
pub async fn subtitles(
    state: State<'_, AppState>,
    ty: String,
    video_id: String,
    video_size: Option<u64>,
    filename: Option<String>,
) -> Result<Vec<SubtitleOption>> {
    let addons: Vec<InstalledAddon> =
        active(&state).into_iter().filter(|a| a.manifest.serves("subtitles", &ty, &video_id)).collect();
    let client = &state.addons;
    let file = polar_addon::VideoFile {
        size: video_size.filter(|n| *n > 0),
        name: filename.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty()),
    };
    let file = &file;
    let results = join_all(addons.iter().map(|a| async {
        let res = tokio::time::timeout(ADDON_TIMEOUT, client.subtitles(&a.manifest_url, &ty, &video_id, file)).await;
        (a.manifest.name.clone(), res)
    }))
    .await;
    let options: Vec<SubtitleOption> = results
        .into_iter()
        .filter_map(|(addon, res)| Some((addon, res.ok()?.ok()?)))
        .flat_map(|(addon, subs)| {
            subs.into_iter().map(move |s| SubtitleOption { id: s.id, url: s.url, lang: s.lang, addon: addon.clone() })
        })
        .collect();
    state.subtitle_urls.offer(options.iter().map(|o| o.url.as_str()));
    Ok(options)
}

/// Download a subtitle file and return it as WebVTT. Done in Rust so CORS and
/// SRT/encoding quirks never reach the UI; for that same reason only a URL
/// `subtitles` listed, so the page can't read the LAN or this machine (M13).
#[tauri::command]
pub async fn subtitle_vtt(state: State<'_, AppState>, url: String) -> Result<String> {
    if !state.subtitle_urls.was_offered(&url) {
        return Err(CmdError::Unsupported("not a subtitle an addon offered".into()));
    }
    let bytes = state.addons.fetch_bytes(&url).await?;
    Ok(polar_addon::subs::to_vtt(&bytes))
}

/// A logo's or backdrop's bytes for the app to measure (#354), for hosts whose
/// pictures the web view can't read (no CORS headers). Public `https` pictures
/// only (`polar_addon::pictures`); a failure is logged with the host alone.
#[tauri::command]
pub async fn picture_bytes(state: State<'_, AppState>, url: String) -> Result<tauri::ipc::Response> {
    match state.pictures.fetch(&url).await {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(reason) => {
            let host = reqwest::Url::parse(&url).ok().and_then(|u| u.host_str().map(str::to_owned)).unwrap_or_default();
            tracing::warn!(target: "polar", "logo: no picture from {host} to measure: {reason}");
            Err(CmdError::Upstream(reason))
        }
    }
}

// --- Seek previews (Seekr) -------------------------------------------------

/// Thumbnail track for the seek bar, or `None` when the feature is off, no key
/// is set, or the title has no previews.
#[tauri::command]
pub async fn seek_previews(
    state: State<'_, AppState>,
    video_id: String,
    duration_ms: u64,
) -> Result<Option<crate::seekr::PreviewTrack>> {
    let key = {
        let settings = &state.store.locked().data.settings;
        settings.seekr_key.clone().filter(|k| settings.seek_previews && !k.trim().is_empty())
    };
    let Some(key) = key else { return Ok(None) };
    state.seekr.track(key.trim(), &video_id, duration_ms).await.map_err(CmdError::Upstream)
}

/// The key's tier (e.g. `free_preview`) if Seekr accepts it, else `None`.
#[tauri::command]
pub async fn seekr_validate(state: State<'_, AppState>, key: String) -> Result<Option<String>> {
    state.seekr.validate(key.trim()).await.map_err(CmdError::Upstream)
}

// --- Skip segments (IntroDB) -------------------------------------------------

/// Intro / recap / credits timings for a movie (`tt…`) or episode (`tt…:s:e`).
#[tauri::command]
pub async fn skip_segments(state: State<'_, AppState>, video_id: String) -> Result<crate::introdb::Segments> {
    state.introdb.segments(&video_id).await.map_err(CmdError::Upstream)
}

// --- MyAnimeList (#84) -----------------------------------------------------

/// A request to a linked MyAnimeList list, with the profile's token: only the
/// list paths and fields src-tauri/src/mal.rs lets through.
#[tauri::command]
pub async fn mal_api(
    state: State<'_, AppState>,
    method: String,
    path: String,
    query: Vec<(String, String)>,
    form: Vec<(String, String)>,
    token: String,
) -> Result<crate::mal::Answer> {
    state.mal.api(&method, &path, &query, &form, &token).await.map_err(CmdError::Upstream)
}

/// A MyAnimeList sign-in code, or refresh token, traded for new tokens.
#[tauri::command]
pub async fn mal_token(state: State<'_, AppState>, form: Vec<(String, String)>) -> Result<crate::mal::Answer> {
    state.mal.token(&form).await.map_err(CmdError::Upstream)
}

// --- Ratings (MDBList / OMDb) ----------------------------------------------

/// Rotten Tomatoes, Metacritic, Letterboxd… scores for a title, from whichever
/// ratings services have a key in Settings → Services. Empty without one.
#[tauri::command]
pub async fn ratings(state: State<'_, AppState>, ty: String, id: String) -> Result<crate::ratings::Ratings> {
    let (mdblist, omdb, providers) = {
        let s = &state.store.locked().data.settings;
        let key = |k: &Option<String>| k.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(str::to_owned);
        (key(&s.mdblist_key), key(&s.omdb_key), s.ratings_providers.clone())
    };
    let mut r = state.ratings.get(&id, &ty, mdblist.as_deref(), omdb.as_deref()).await;
    if !providers.imdb {
        r.imdb = None;
        r.imdb_votes = None;
        r.links.remove("imdb");
    }
    if !providers.tmdb {
        r.tmdb = None;
        r.links.remove("tmdb");
    }
    if !providers.rotten_tomatoes {
        r.rotten_tomatoes = None;
        r.links.remove("rottenTomatoes");
    }
    if !providers.audience {
        r.audience = None;
        r.links.remove("audience");
    }
    if !providers.metacritic {
        r.metacritic = None;
        r.links.remove("metacritic");
    }
    if !providers.trakt {
        r.trakt = None;
        r.links.remove("trakt");
    }
    if !providers.letterboxd {
        r.letterboxd = None;
        r.links.remove("letterboxd");
    }
    if !providers.mal {
        r.mal = None;
        r.links.remove("mal");
    }
    Ok(r)
}

/// A show's IMDb rating for each episode (the Episode Ratings chart), or none known.
#[tauri::command]
pub async fn episode_ratings(imdb_id: String) -> Vec<crate::episode_ratings::EpisodeRating> {
    crate::episode_ratings::get(&imdb_id).await
}

/// A public Letterboxd list's name and films, from a pasted link (Import Playlist).
#[tauri::command]
pub async fn letterboxd_list(url: String) -> Result<crate::letterboxd::LetterboxdList> {
    crate::letterboxd::read_list(&url).await
}

// --- External links ------------------------------------------------------

/// A title's trailer as a playable file (IMDb), or none.
#[tauri::command]
pub async fn trailer(imdb_id: String) -> Option<crate::trailers::Trailer> {
    crate::trailers::imdb_trailer(&imdb_id).await
}

/// An anime's filler and recap episodes by MAL id (Jikan, then
/// animefillerlist.com by `slugs`), cached on disk for a day.
#[tauri::command]
pub async fn anime_episode_flags(
    state: State<'_, AppState>,
    mal_id: u32,
    slugs: Vec<String>,
) -> Result<polar_anime::EpisodeFlags> {
    Ok(state.fillers.get(mal_id, &slugs).await)
}

/// An anime's ids from Fribb/anime-lists, for when ani.zip can't be reached:
/// `key` is `anilist_id`, `mal_id`, `kitsu_id` or `imdb_id`, as ani.zip takes them.
#[tauri::command]
pub async fn anime_ids(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<Option<polar_anime::AnimeMapping>> {
    use polar_anime::AnimeKey;
    let num = || value.parse::<u32>().ok();
    let key = match key.as_str() {
        "anilist_id" => num().map(AnimeKey::Anilist),
        "mal_id" => num().map(AnimeKey::Mal),
        "kitsu_id" => num().map(AnimeKey::Kitsu),
        "imdb_id" => Some(AnimeKey::Imdb(value.clone())),
        _ => None,
    };
    let Some(key) = key else { return Ok(None) };
    Ok(state.anime_lists.find(&key).await)
}

#[derive(Serialize)]
pub struct CacheInfo {
    path: String,
    bytes: u64,
}

/// The anime cache folder and the size of what the app keeps there, for Settings.
#[tauri::command]
pub async fn anime_cache(state: State<'_, AppState>) -> Result<CacheInfo> {
    let dir = state.fillers.path().parent().map(|d| d.display().to_string()).unwrap_or_default();
    Ok(CacheInfo {
        path: dir,
        bytes: state.fillers.size().await + state.anime_lists.size().await + state.anime_catalog.size().await,
    })
}

/// Deletes the anime cache files; they are fetched again when next needed.
#[tauri::command]
pub async fn anime_cache_clear(state: State<'_, AppState>) -> Result<()> {
    state.fillers.clear().await;
    state.anime_lists.clear().await;
    state.anime_catalog.clear().await;
    Ok(())
}

// --- Show-First Anime Catalog (TMDB Discover + Jikan + Local Fribb) --------

async fn hydrate_anime_items(
    indexer: &polar_index::Indexer,
    items: Vec<polar_anime::AnimeItem>,
) -> Vec<polar_anime::AnimeItem> {
    use futures::stream::{self, StreamExt};
    use std::collections::HashSet;

    if !indexer.has_tmdb() {
        return items;
    }
    let hydrated: Vec<polar_anime::AnimeItem> = stream::iter(items)
        .map(|mut item| async move {
            let imdb = item.id.starts_with("tt").then_some(item.id.as_str());
            if let Some(art) = indexer.anime_art(&item.ty, item.tmdb_id.map(u64::from), imdb).await {
                if let Some(tt) = art.imdb_id.filter(|s| s.starts_with("tt")) {
                    item.id = tt;
                }
                item.tmdb_id = Some(art.tmdb_id as u32);
                if let Some(bg) = art.background {
                    item.background = Some(bg);
                }
                if let Some(poster) = art.poster {
                    item.poster = Some(poster);
                }
                if !art.logos.is_empty() {
                    item.logo = art.logo.or_else(|| art.logos.first().cloned());
                    item.logos = art.logos;
                }
                if art.certification.is_some() {
                    item.certification = art.certification;
                }
            }
            item
        })
        .buffered(12)
        .collect()
        .await;

    let mut seen = HashSet::new();
    hydrated.into_iter().filter(|i| seen.insert(i.id.clone())).collect()
}

async fn previews_to_anime_items(
    previews: Vec<MetaPreview>,
    lists: &polar_anime::AnimeLists,
) -> Vec<polar_anime::AnimeItem> {
    let mut out = Vec::with_capacity(previews.len());
    for p in previews {
        let mapped =
            if p.id.starts_with("tt") { lists.find(&polar_anime::AnimeKey::Imdb(p.id.clone())).await } else { None };
        let year = p.release_info.as_deref().and_then(|s| s.get(..4)).and_then(|y| y.parse::<u16>().ok());
        let score = p.imdb_rating.as_deref().and_then(|s| s.parse::<f32>().ok());
        let format = Some(if p.ty == "movie" { "MOVIE" } else { "TV" }.to_owned());
        out.push(polar_anime::AnimeItem {
            id: p.id,
            ty: p.ty,
            titles: polar_anime::AnimeTitle { english: Some(p.name.clone()), romaji: None, native: None },
            name: p.name,
            poster: p.poster,
            background: p.background,
            logo: p.logo,
            logos: p.logos,
            description: p.description,
            year,
            score,
            genres: p.genres,
            format,
            status: None,
            episodes: None,
            duration: None,
            certification: p.certification,
            season_hint: None,
            season_label: None,
            airing: None,
            mal_id: mapped.as_ref().and_then(|m| m.mal_id),
            anilist_id: mapped.as_ref().and_then(|m| m.anilist_id),
            kitsu_id: mapped.as_ref().and_then(|m| m.kitsu_id),
            tmdb_id: mapped.as_ref().and_then(|m| m.themoviedb_id),
            start_date: None,
            mature: false,
        });
    }
    out
}

async fn resolve_evergreen_shelf(
    state: &AppState,
    indexer: &polar_index::Indexer,
    use_tmdb: bool,
    shelf: &str,
    genre: Option<&str>,
    page: u32,
) -> Result<polar_anime::AnimeBrowsePage> {
    if use_tmdb {
        if let Ok((previews, has_next_page)) = indexer.anime_discover(shelf, genre, page).await {
            let items = previews_to_anime_items(previews, &state.anime_lists).await;
            return Ok(polar_anime::AnimeBrowsePage { items, has_next_page });
        }
    }
    let page =
        state.anime_catalog.catalog_shelf(shelf, genre, page, &state.anime_lists).await.map_err(CmdError::Upstream)?;
    let items = hydrate_anime_items(indexer, page.items).await;
    Ok(polar_anime::AnimeBrowsePage { items, has_next_page: page.has_next_page })
}

/// All primary shelves for the Anime tab in one fast parallel Rust call (TMDB Discover for
/// evergreen shelves when enabled + single batched AniList query for seasonal shelves, hydrated
/// with 16:9 art & logos). Without TMDB, all 6 shelves come from one single batched AniList POST.
#[tauri::command]
pub async fn anime_home(state: State<'_, AppState>) -> Result<polar_anime::AnimeHome> {
    let indexer = state.indexer();
    let use_tmdb = indexer.has_tmdb() && state.store.locked().data.settings.tmdb_anime_catalogs;

    if !use_tmdb {
        let home = state.anime_catalog.home(&state.anime_lists, true).await.map_err(|e| {
            tracing::warn!("anime_home batch failed: {e}");
            CmdError::Upstream(e)
        })?;
        // When a TMDB key is set (just with TMDB anime catalogs toggled off), still hydrate 16:9 art & logos.
        if indexer.has_tmdb() {
            let (season, upcoming, trending, top, popular, movies) = tokio::join!(
                hydrate_anime_items(&indexer, home.season),
                hydrate_anime_items(&indexer, home.upcoming),
                hydrate_anime_items(&indexer, home.trending),
                hydrate_anime_items(&indexer, home.top),
                hydrate_anime_items(&indexer, home.popular),
                hydrate_anime_items(&indexer, home.movies),
            );
            return Ok(polar_anime::AnimeHome { season, trending, upcoming, top, popular, movies });
        }
        return Ok(home);
    }

    let (seasonal, trending, top, popular, movies) = tokio::join!(
        async {
            match state.anime_catalog.home(&state.anime_lists, false).await {
                Ok(h) => {
                    let (season, upcoming) = tokio::join!(
                        hydrate_anime_items(&indexer, h.season),
                        hydrate_anime_items(&indexer, h.upcoming),
                    );
                    (season, upcoming)
                }
                Err(e) => {
                    tracing::warn!("anime_home seasonal failed: {e}");
                    (Vec::new(), Vec::new())
                }
            }
        },
        resolve_evergreen_shelf(&state, &indexer, true, "trending", None, 1),
        resolve_evergreen_shelf(&state, &indexer, true, "top", None, 1),
        resolve_evergreen_shelf(&state, &indexer, true, "popular", None, 1),
        resolve_evergreen_shelf(&state, &indexer, true, "movies", None, 1),
    );

    let (season, upcoming) = seasonal;
    let trending = trending.map(|p| p.items).unwrap_or_default();
    let top = top.map(|p| p.items).unwrap_or_default();
    let popular = popular.map(|p| p.items).unwrap_or_default();
    let movies = movies.map(|p| p.items).unwrap_or_default();

    if season.is_empty() && trending.is_empty() && top.is_empty() && popular.is_empty() {
        return Err(CmdError::Upstream("Could not load anime catalogs".into()));
    }

    Ok(polar_anime::AnimeHome { season, trending, upcoming, top, popular, movies })
}

/// One anime shelf or genre shelf, paged.
#[tauri::command]
pub async fn anime_shelf(
    state: State<'_, AppState>,
    shelf: String,
    genre: Option<String>,
    page: Option<u32>,
) -> Result<polar_anime::AnimeBrowsePage> {
    let indexer = state.indexer();
    let use_tmdb = indexer.has_tmdb() && state.store.locked().data.settings.tmdb_anime_catalogs;
    resolve_evergreen_shelf(&state, &indexer, use_tmdb, &shelf, genre.as_deref(), page.unwrap_or(1)).await
}

/// Airing schedule for one weekday (`"monday"`..`"sunday"`) or all days when omitted.
#[tauri::command]
pub async fn anime_schedule(state: State<'_, AppState>, day: Option<String>) -> Result<Vec<polar_anime::AnimeItem>> {
    let indexer = state.indexer();
    let raw = state.anime_catalog.schedule(day.as_deref(), &state.anime_lists).await.map_err(CmdError::Upstream)?;
    Ok(hydrate_anime_items(&indexer, raw).await)
}

/// Filterable/searchable anime browse grid.
#[tauri::command]
pub async fn anime_browse(
    state: State<'_, AppState>,
    query: polar_anime::AnimeBrowseQuery,
) -> Result<polar_anime::AnimeBrowsePage> {
    let indexer = state.indexer();
    let page = state.anime_catalog.browse(&query, &state.anime_lists).await.map_err(CmdError::Upstream)?;
    let items = hydrate_anime_items(&indexer, page.items).await;
    Ok(polar_anime::AnimeBrowsePage { items, has_next_page: page.has_next_page })
}

/// Instant 0ms local lookup returning anime cross-IDs and season mappings for any `tt…`, `kitsu:…`, or `mal:…` id.
#[tauri::command]
pub async fn anime_show_info(state: State<'_, AppState>, id: String) -> Result<polar_anime::AnimeShowInfo> {
    use polar_anime::AnimeKey;
    if id.starts_with("tt") {
        let seasons = state.anime_lists.find_all_for_imdb(&id).await;
        if let Some(first) = seasons.first() {
            return Ok(polar_anime::AnimeShowInfo {
                is_anime: true,
                mal_id: first.mal_id,
                anilist_id: first.anilist_id,
                kitsu_id: first.kitsu_id,
                imdb_id: Some(id),
                seasons,
            });
        }
        return Ok(polar_anime::AnimeShowInfo::default());
    }
    if let Some(kitsu) = id.strip_prefix("kitsu:").and_then(|s| s.parse::<u32>().ok()) {
        if let Some(m) = state.anime_lists.find(&AnimeKey::Kitsu(kitsu)).await {
            let seasons = match &m.imdb_id {
                Some(imdb) => state.anime_lists.find_all_for_imdb(imdb).await,
                None => vec![m.clone()],
            };
            return Ok(polar_anime::AnimeShowInfo {
                is_anime: true,
                mal_id: m.mal_id,
                anilist_id: m.anilist_id,
                kitsu_id: Some(kitsu),
                imdb_id: m.imdb_id,
                seasons,
            });
        }
        return Ok(polar_anime::AnimeShowInfo { is_anime: true, kitsu_id: Some(kitsu), ..Default::default() });
    }
    if let Some(mal) = id.strip_prefix("mal:").and_then(|s| s.parse::<u32>().ok()) {
        if let Some(m) = state.anime_lists.find(&AnimeKey::Mal(mal)).await {
            let seasons = match &m.imdb_id {
                Some(imdb) => state.anime_lists.find_all_for_imdb(imdb).await,
                None => vec![m.clone()],
            };
            return Ok(polar_anime::AnimeShowInfo {
                is_anime: true,
                mal_id: Some(mal),
                anilist_id: m.anilist_id,
                kitsu_id: m.kitsu_id,
                imdb_id: m.imdb_id,
                seasons,
            });
        }
        return Ok(polar_anime::AnimeShowInfo { is_anime: true, mal_id: Some(mal), ..Default::default() });
    }
    if let Some(al) = id.strip_prefix("anilist:").and_then(|s| s.parse::<u32>().ok()) {
        if let Some(m) = state.anime_lists.find(&AnimeKey::Anilist(al)).await {
            let seasons = match &m.imdb_id {
                Some(imdb) => state.anime_lists.find_all_for_imdb(imdb).await,
                None => vec![m.clone()],
            };
            return Ok(polar_anime::AnimeShowInfo {
                is_anime: true,
                mal_id: m.mal_id,
                anilist_id: Some(al),
                kitsu_id: m.kitsu_id,
                imdb_id: m.imdb_id,
                seasons,
            });
        }
        return Ok(polar_anime::AnimeShowInfo { is_anime: true, anilist_id: Some(al), ..Default::default() });
    }
    Ok(polar_anime::AnimeShowInfo::default())
}

/// Lazy-loaded characters & voice actors for an anime (cached 7 days on disk).
#[tauri::command]
pub async fn anime_characters(state: State<'_, AppState>, mal_id: u32) -> Result<Vec<polar_anime::AnimeCharacter>> {
    state.anime_catalog.characters(mal_id).await.map_err(CmdError::Upstream)
}

/// Lazy-loaded rich anime details (rankings, studios, facts, tags, official links & characters) in one request.
#[tauri::command]
pub async fn anime_details(
    state: State<'_, AppState>,
    anilist_id: Option<u32>,
    mal_id: Option<u32>,
) -> Result<polar_anime::AnimeRichDetails> {
    state.anime_catalog.details(anilist_id, mal_id).await.map_err(CmdError::Upstream)
}

/// Opens a web page (e.g. a title on IMDb) in the default browser. Only
/// https links, so the webview can't use this to launch anything else.
#[tauri::command(async)]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") {
        return Err(CmdError::Unsupported("only https links can be opened".into()));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| CmdError::Other(e.to_string()))
}

/// Whether the window can be pinned on top of the others (the player's Pin
/// window, #266). Not on Wayland, where most compositors don't let an app
/// keep itself on top; through XWayland (`GDK_BACKEND=x11`) it can.
#[tauri::command]
pub fn window_can_pin() -> bool {
    #[cfg(target_os = "linux")]
    {
        let wayland = std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s.eq_ignore_ascii_case("wayland"))
            || std::env::var_os("WAYLAND_DISPLAY").is_some();
        let x11 = std::env::var("GDK_BACKEND").is_ok_and(|b| b.starts_with("x11"));
        !wayland || x11
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

// Inside this module so it can build the result types above, whose fields are private.
#[cfg(test)]
#[path = "contract.rs"]
mod contract;

/// YouTube video ids: 11 characters of letters, digits, `-` and `_`.
fn is_youtube_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod youtube_tests {
    use super::is_youtube_id;

    #[test]
    fn only_real_video_ids_pass() {
        assert!(is_youtube_id("dQw4w9WgXcQ"));
        assert!(is_youtube_id("a-b_c-d_e-f"));
        assert!(!is_youtube_id("dQw4w9WgXc"));
        assert!(!is_youtube_id("dQw4w9WgXcQ&list=x"));
        assert!(!is_youtube_id("dQw4w9WgX/Q"));
    }
}

#[cfg(test)]
mod streams_tests {
    use super::*;

    fn addon(name: &str) -> InstalledAddon {
        let manifest = Manifest {
            id: name.into(),
            version: "1".into(),
            name: name.into(),
            description: None,
            logo: None,
            resources: vec![],
            types: vec![],
            catalogs: vec![],
            id_prefixes: None,
            behavior_hints: None,
        };
        InstalledAddon { manifest_url: format!("https://{name}.example.com/manifest.json"), manifest, disabled: false }
    }

    fn source(title: &str) -> Stream {
        Stream {
            url: Some(format!("https://media.example.com/{title}.mkv")),
            title: Some(title.into()),
            ..Default::default()
        }
    }

    fn summary(jobs: &[(InstalledAddon, String)], slots: &[Option<Option<Vec<Stream>>>]) -> StreamsResult {
        let prepared: Vec<Option<PreparedAnswer>> = jobs
            .iter()
            .zip(slots)
            .map(|((a, id), slot)| {
                slot.as_ref().map(|ans| {
                    ans.as_ref().map(|streams| {
                        prepare_asked(
                            streams.iter().cloned().map(|stream| Asked {
                                addon: a.manifest.name.clone(),
                                request: Some(id.clone()),
                                stream,
                            }),
                            None,
                        )
                    })
                })
            })
            .collect();
        summarize(jobs, &prepared, &Settings::default().stream_filter("movie"), &["tt0000000".into()])
    }

    #[test]
    fn a_partial_answer_names_who_is_still_out() {
        let jobs = vec![(addon("first"), "tt0000000".into()), (addon("second"), "tt0000000".into())];
        let so_far = summary(&jobs, &[None, Some(Some(vec![source("film 1080p")]))]);
        assert_eq!(so_far.streams.len(), 1);
        assert_eq!(so_far.waiting, vec!["first".to_string()]);
        assert!(so_far.failed.is_empty());
        assert_eq!(so_far.asked, vec!["first".to_string(), "second".to_string()]);

        let whole = summary(&jobs, &[Some(None), Some(Some(vec![source("film 1080p")]))]);
        assert!(whole.waiting.is_empty());
        assert_eq!(whole.failed, vec!["first".to_string()]);
    }

    #[test]
    fn equally_good_sources_keep_the_add_on_order_whoever_answers_first() {
        let jobs = vec![(addon("first"), "tt0000000".into()), (addon("second"), "tt0000000".into())];
        let whole =
            summary(&jobs, &[Some(Some(vec![source("film a 1080p")])), Some(Some(vec![source("film b 1080p")]))]);
        let addons: Vec<_> = whole.streams.iter().map(|s| s.addon.clone()).collect();
        assert_eq!(addons, vec!["first".to_string(), "second".to_string()]);
    }

    #[test]
    fn an_add_on_still_out_for_one_id_is_not_failed_yet() {
        let a = addon("both");
        let jobs = vec![(a.clone(), "tt0000000".into()), (a, "kitsu:1".into())];
        let so_far = summary(&jobs, &[Some(None), None]);
        assert!(so_far.failed.is_empty());
        assert_eq!(so_far.waiting, vec!["both".to_string()]);
    }
}
