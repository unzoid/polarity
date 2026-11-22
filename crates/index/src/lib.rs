//! polar-index — our Cinemeta.
//!
//! Serves catalogs (popular / trending / top rated) and full metadata with
//! episodes, keyed by IMDb ids (`tt…`, episodes `tt…:season:episode`) so every
//! Stremio stream addon resolves against it unchanged.
//!
//! Data comes from TMDB when an API key is configured. Without one it falls
//! back to the public Cinemeta API, so a fresh install works immediately.
//! Both paths normalise into the same [`polar_addon`] types and share one cache.
//! Episodes always carry IMDb's numbering: TMDB's are renumbered onto
//! Cinemeta's by air date ([`polar_addon::numbering`]), since stream addons and
//! stored progress go by IMDb's `tt…:season:episode`.

mod cache;
mod cinemeta;
pub mod curate;
mod episode_order;
mod tmdb;

pub use episode_order::{EpisodeOrder, EpisodeOrderGroup, EpisodeOrderInfo};
mod person;

pub use person::{PersonHit, PersonPage};

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::OnceCell;

use polar_addon::{CatalogExtra, Manifest, ManifestCatalog, ManifestResource, Meta, MetaPreview};

pub use cache::scale_capacity;
use cache::TtlCache;

/// Titles per page of a TMDB catalog (`skip` counts titles, not pages).
pub const PAGE_SIZE: u32 = 20;

/// The catalogs every source must provide. Ids are stable; names are UI copy.
pub const CATALOGS: &[(&str, &str)] = &[
    ("trending", "Trending"),
    ("popular", "Popular"),
    ("top_rated", "Top Rated"),
    ("new", "New Releases"),
    ("gems", "Hidden Gems"),
    ("classics", "Classics"),
];

/// Page size of shelves the index ranks itself (from Cinemeta pools).
const CURATED_PAGE: usize = 30;
/// Genres mixed into one day's "Classics".
const CLASSIC_GENRES: usize = 3;

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("not found")]
    NotFound,
    #[error("unsupported id {0} (polar-index serves IMDb ids)")]
    UnsupportedId(String),
    #[error("upstream: {0}")]
    Upstream(String),
}

impl From<reqwest::Error> for IndexError {
    fn from(e: reqwest::Error) -> Self {
        // Without the URL: a TMDB v3 key travels in the query string.
        Self::Upstream(e.without_url().to_string())
    }
}

impl From<polar_addon::AddonError> for IndexError {
    fn from(e: polar_addon::AddonError) -> Self {
        Self::Upstream(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, IndexError>;

#[derive(Debug, Clone, Default)]
pub struct IndexConfig {
    /// TMDB v3 API key or v4 read access token.
    pub tmdb_key: Option<String>,
    /// TMDB language, e.g. `en-US`.
    pub language: Option<String>,
}

/// Read projection for [`Indexer::meta_with`] (Netflix #451): avoids per-season TMDB fan-out
/// and Cinemeta episode renumbering when the caller only needs display fields (name/poster/backdrop).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetaMask {
    /// Name, poster, backdrop, rating, genres (used by `fillUntitled` library hydration).
    Display,
    /// Full title details, logos, cast and trailers, without per-season episode lists.
    Overview,
    /// Everything, including all seasons/episodes renumbered onto IMDb ids.
    Full,
}

enum Backend {
    Tmdb(Box<tmdb::Tmdb>),
    Cinemeta(cinemeta::Cinemeta),
}

pub struct Indexer {
    backend: Backend,
    catalogs: TtlCache<String, Vec<MetaPreview>>,
    metas: TtlCache<String, Meta>,
    /// Lightweight `MetaMask::Display` / `Overview` cache so `fillUntitled` never pollutes full `metas`.
    display_metas: TtlCache<String, Meta>,
    /// Candidate pools (several upstream pages each), shared by curated shelves.
    /// One fetch per pool however many shelves ask for it at once.
    pools: TtlCache<String, Arc<OnceCell<Vec<MetaPreview>>>>,
    /// IMDb's episode numbering for TMDB series.
    numbering: cinemeta::Cinemeta,
    /// Other episode orders (TMDB's episode groups), listed and mapped onto `metas`' episodes.
    orders: episode_order::Cache,
    /// People's pages by TMDB id.
    people: TtlCache<u64, PersonPage>,
    /// People search hits by normalized query.
    people_search: TtlCache<String, Vec<PersonHit>>,
}

impl Indexer {
    pub fn new(config: IndexConfig) -> Self {
        Self::with_client(config, polar_addon::shared_http_client())
    }

    pub fn with_client(config: IndexConfig, http: reqwest::Client) -> Self {
        let backend = match config.tmdb_key.filter(|k| !k.trim().is_empty()) {
            Some(key) => Backend::Tmdb(Box::new(tmdb::Tmdb::with_client(key, config.language, http.clone()))),
            None => Backend::Cinemeta(cinemeta::Cinemeta::with_client(http.clone())),
        };
        Self {
            backend,
            catalogs: TtlCache::new(Duration::from_secs(60 * 60), 256),
            metas: TtlCache::new(Duration::from_secs(6 * 60 * 60), 2048),
            display_metas: TtlCache::new(Duration::from_secs(12 * 60 * 60), 2048),
            pools: TtlCache::new(Duration::from_secs(3 * 60 * 60), 64),
            numbering: cinemeta::Cinemeta::with_client(http),
            orders: episode_order::Cache::new(),
            people: TtlCache::new(Duration::from_secs(6 * 60 * 60), 256),
            people_search: TtlCache::new(Duration::from_secs(60 * 60), 128),
        }
    }

    /// Human name of the active data source, shown in settings.
    pub fn source(&self) -> &'static str {
        match self.backend {
            Backend::Tmdb(_) => "TMDB",
            Backend::Cinemeta(_) => "Cinemeta (fallback)",
        }
    }

    /// 3-level OOM governor hook: sheds cached metadata proportionally to OS/device memory pressure.
    /// - Level 1 (moderate): drop expired entries + oldest 25% of secondary caches.
    /// - Level 2 (high): evict 50% of all caches and clear candidate pools.
    /// - Level 3 (critical): clear pools/people/search caches and evict 75% of metadata caches.
    pub fn trim_memory(&self, level: u8) -> usize {
        match level {
            0 => 0,
            1 => {
                self.pools.evict_fraction(0.25)
                    + self.people.evict_fraction(0.25)
                    + self.people_search.evict_fraction(0.25)
                    + self.catalogs.evict_fraction(0.25)
                    + self.display_metas.evict_fraction(0.15)
            }
            2 => {
                let mut n = self.pools.clear();
                n += self.people.evict_fraction(0.5);
                n += self.people_search.evict_fraction(0.5);
                n += self.catalogs.evict_fraction(0.5);
                n += self.display_metas.evict_fraction(0.5);
                n += self.metas.evict_fraction(0.5);
                n
            }
            _ => {
                let mut n = self.pools.clear();
                n += self.people.clear();
                n += self.people_search.clear();
                n += self.catalogs.evict_fraction(0.75);
                n += self.display_metas.evict_fraction(0.75);
                n += self.metas.evict_fraction(0.75);
                n
            }
        }
    }

    /// `genre` narrows a catalog to one genre ("Action", "Sci-Fi", …).
    pub async fn catalog(&self, ty: &str, id: &str, skip: u32, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        self.catalog_within(ty, id, skip, genre, None).await
    }

    /// [`Indexer::catalog`] with an age limit's certification bound (`(country, highest)`), which TMDB's
    /// film `/discover` lists apply ([`tmdb::Tmdb::catalog_within`]); Cinemeta has no ratings and ignores it.
    pub async fn catalog_within(
        &self,
        ty: &str,
        id: &str,
        skip: u32,
        genre: Option<&str>,
        bound: Option<(&str, &str)>,
    ) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let genre = genre.map(str::trim).filter(|g| !g.is_empty());
        let c = match &self.backend {
            // Its own cache: one growing list per catalog, sliced by `skip`.
            Backend::Tmdb(t) => return t.catalog_within(ty, id, skip, genre, bound).await,
            Backend::Cinemeta(c) => c,
        };
        let key = format!("{ty}/{id}/{}/{skip}", genre.unwrap_or(""));
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let metas = match id {
            "trending" => c.top(ty, skip, genre).await?,
            "classics" => {
                let day = curate::today();
                let genres = match genre {
                    Some(g) => vec![g],
                    None => curate::classic_genres(ty, day, CLASSIC_GENRES),
                };
                let lists = futures::future::join_all(
                    genres.iter().map(|g| self.pooled(format!("{ty}/{g}"), c.pool(ty, Some(g)))),
                )
                .await;
                let lists: Vec<Vec<MetaPreview>> = lists.into_iter().filter_map(|l| l.ok()).collect();
                paged(curate::classics(&lists, day), skip)
            }
            id if curate::is_curated(id) => {
                let pool = self.pooled(format!("{ty}/{}", genre.unwrap_or("")), c.pool(ty, genre)).await?;
                paged(curate::curate(id, &pool, curate::today()), skip)
            }
            _ => return Err(IndexError::NotFound),
        };
        let metas =
            self.catalogs.insert_if_valid(key, metas, Duration::from_secs(60 * 60), |old, new| catalog_valid(old, new));
        Ok(metas)
    }

    /// Titles like `id`, for "Because you watched …" shelves.
    pub async fn recommend(&self, ty: &str, id: &str) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let key = format!("{ty}/recommend/{id}");
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let metas = match &self.backend {
            Backend::Tmdb(t) => t.recommendations(ty, id).await?,
            Backend::Cinemeta(c) => {
                // Pools for the seed's two main genres, plus the general one
                // so close matches outside those genres still surface.
                let seed = self.meta(ty, id).await?.preview;
                let genres: Vec<Option<String>> = seed.genres.iter().take(2).cloned().map(Some).chain([None]).collect();
                let lists = futures::future::join_all(genres.iter().map(|g| {
                    let g = g.as_deref();
                    self.pooled(format!("{ty}/{}", g.unwrap_or("")), c.pool(ty, g))
                }))
                .await;
                let lists: Vec<Vec<MetaPreview>> = lists.into_iter().filter_map(|l| l.ok()).collect();
                curate::similar(&seed, &lists, curate::today()).into_iter().take(CURATED_PAGE).collect()
            }
        };
        let metas =
            self.catalogs.insert_if_valid(key, metas, Duration::from_secs(60 * 60), |old, new| catalog_valid(old, new));
        Ok(metas)
    }

    async fn pooled(
        &self,
        key: String,
        fetch: impl std::future::Future<Output = Result<Vec<MetaPreview>>>,
    ) -> Result<Vec<MetaPreview>> {
        // A failed fetch leaves the cell empty, so the next ask tries again.
        let cell = self.pools.get_or_insert_with(key, || Arc::new(OnceCell::new()));
        cell.get_or_try_init(|| fetch).await.cloned()
    }

    pub async fn search(&self, ty: &str, query: &str) -> Result<Vec<MetaPreview>> {
        self.search_in(ty, query, None).await
    }

    /// A search narrowed to titles released in `year` where the backend can
    /// (TMDB); Cinemeta's search has no year, so it answers the plain search.
    pub async fn search_in(&self, ty: &str, query: &str, year: Option<u16>) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let year = year.filter(|_| matches!(self.backend, Backend::Tmdb(_)));
        let key = match year {
            Some(y) => format!("{ty}/search/{y}/{}", query.to_lowercase()),
            None => format!("{ty}/search/{}", query.to_lowercase()),
        };
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let metas = match &self.backend {
            Backend::Tmdb(t) => t.search(ty, query, year).await?,
            Backend::Cinemeta(c) => c.search(ty, query).await?,
        };
        let metas =
            self.catalogs.insert_if_valid(key, metas, Duration::from_secs(60 * 60), |old, new| catalog_valid(old, new));
        Ok(metas)
    }

    /// People matching `query` (TMDB); empty without a TMDB key.
    pub async fn search_people(&self, query: &str) -> Result<Vec<PersonHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let Backend::Tmdb(t) = &self.backend else { return Ok(Vec::new()) };
        let key = query.to_lowercase();
        if let Some(hit) = self.people_search.get(&key) {
            return Ok(hit);
        }
        let found = t.search_people(query).await?;
        self.people_search.insert(key, found.clone());
        Ok(found)
    }

    /// Films in a TMDB collection / franchise (`/collection/{id}`); empty without a TMDB key.
    pub async fn collection(&self, id: u64) -> Result<Vec<MetaPreview>> {
        let Backend::Tmdb(t) = &self.backend else { return Ok(Vec::new()) };
        let key = format!("collection/{id}");
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let items = t.collection(id).await?;
        self.catalogs.insert(key, items.clone());
        Ok(items)
    }

    pub async fn meta(&self, ty: &str, id: &str) -> Result<Meta> {
        self.meta_with(ty, id, MetaMask::Full).await
    }

    /// Fetch title metadata projected to `mask` ([`MetaMask::Display`] skips Cinemeta episode
    /// renumbering and per-season TMDB fan-out). Always serves from the full cache when warm.
    pub async fn meta_with(&self, ty: &str, id: &str, mask: MetaMask) -> Result<Meta> {
        check_type(ty)?;
        if !id.starts_with("tt") {
            return Err(IndexError::UnsupportedId(id.into()));
        }
        let key = format!("{ty}/{id}");
        if let Some(hit) = self.metas.get(&key) {
            return Ok(hit);
        }
        if mask != MetaMask::Full {
            let proj_key = format!("{}/{key}", if mask == MetaMask::Display { "d" } else { "o" });
            if let Some(hit) = self.display_metas.get(&proj_key) {
                return Ok(hit);
            }
            let meta = match &self.backend {
                Backend::Tmdb(t) => t.meta_projection(ty, id, mask == MetaMask::Overview).await?,
                Backend::Cinemeta(c) => c.meta(ty, id).await?,
            };
            let ttl = meta_ttl(&meta, curate::today());
            let meta = self.display_metas.insert_if_valid(proj_key, meta, ttl, meta_valid);
            return Ok(meta);
        }
        let meta = match &self.backend {
            Backend::Tmdb(t) if ty == "series" => {
                let (meta, imdb) = futures::join!(t.meta(ty, id), self.numbering.meta(ty, id));
                let mut meta = meta?;
                match imdb {
                    Ok(imdb) => meta.videos = polar_addon::numbering::renumber(meta.videos, &imdb.videos),
                    // TMDB's own numbers rather than nothing; addons may miss some episodes.
                    Err(e) => tracing::warn!("no IMDb numbering for a show, keeping TMDB's: {e}"),
                }
                meta
            }
            Backend::Tmdb(t) => t.meta(ty, id).await?,
            Backend::Cinemeta(c) => c.meta(ty, id).await?,
        };
        let ttl = meta_ttl(&meta, curate::today());
        let meta = self.metas.insert_if_valid(key, meta, ttl, meta_valid);
        Ok(meta)
    }

    /// A person's page by their TMDB id: who they are and the titles they act in or directed. Only
    /// TMDB names people by id; without a TMDB key there are none to ask for (not found).
    pub async fn person(&self, tmdb_id: u64) -> Result<PersonPage> {
        let Backend::Tmdb(t) = &self.backend else { return Err(IndexError::NotFound) };
        if let Some(hit) = self.people.get(&tmdb_id) {
            return Ok(hit);
        }
        let page = t.person(tmdb_id).await?;
        self.people.insert(tmdb_id, page.clone());
        Ok(page)
    }

    /// The IMDb id of a TMDB title, for links that carry TMDB's id (#208). Only TMDB knows its own
    /// ids: without a TMDB key this is `None`, and so is a title TMDB lists no IMDb id for.
    pub async fn imdb_for_tmdb(&self, ty: &str, tmdb_id: u64) -> Result<Option<String>> {
        check_type(ty)?;
        match &self.backend {
            Backend::Tmdb(t) => match t.imdb_of(ty, tmdb_id).await {
                Err(IndexError::NotFound) => Ok(None),
                found => found,
            },
            Backend::Cinemeta(_) => Ok(None),
        }
    }

    /// The addon manifest, so the index can also be mounted as a Stremio addon.
    pub fn manifest() -> Manifest {
        let catalogs = ["movie", "series"]
            .iter()
            .flat_map(|ty| {
                CATALOGS.iter().map(move |(id, name)| ManifestCatalog {
                    ty: (*ty).into(),
                    id: (*id).into(),
                    name: Some((*name).into()),
                    extra: vec![
                        CatalogExtra { name: "search".into(), options: None, is_required: false },
                        CatalogExtra { name: "skip".into(), options: None, is_required: false },
                        // The server reads it (`catalog`'s `genre`); listed so add-on clients offer it.
                        CatalogExtra { name: "genre".into(), options: None, is_required: false },
                    ],
                })
            })
            .collect();
        Manifest {
            id: "app.getpolar.index".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            name: "Polarity Index".into(),
            description: Some("Movie and series catalogs with full episode metadata.".into()),
            logo: None,
            resources: vec![ManifestResource::Name("catalog".into()), ManifestResource::Name("meta".into())],
            types: vec!["movie".into(), "series".into()],
            catalogs,
            id_prefixes: Some(vec!["tt".into()]),
            behavior_hints: None,
        }
    }
}

fn paged(list: Vec<MetaPreview>, skip: u32) -> Vec<MetaPreview> {
    list.into_iter().skip(skip as usize).take(CURATED_PAGE).collect()
}

fn check_type(ty: &str) -> Result<()> {
    match ty {
        "movie" | "series" => Ok(()),
        _ => Err(IndexError::NotFound),
    }
}

/// Data Canary LKG predicate for catalogs: reject HTTP-200 empty responses or >80% sudden drops
/// when overwriting a previously populated list.
fn catalog_valid(old: &[MetaPreview], new: &[MetaPreview]) -> bool {
    if old.is_empty() {
        return true;
    }
    if new.is_empty() {
        return false;
    }
    !(old.len() >= 10 && new.len() * 5 < old.len())
}

/// Data Canary LKG predicate for full metadata: never let an empty episode list overwrite a
/// previously populated series.
fn meta_valid(old: &Meta, new: &Meta) -> bool {
    !(old.preview.ty == "series" && !old.videos.is_empty() && new.videos.is_empty())
}

/// Parse `YYYY-MM-DD` (or ISO prefix) into Unix day count (matching [`curate::today`]).
fn parse_day(date: &str) -> Option<u64> {
    let prefix = date.get(..10)?;
    let mut parts = prefix.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let d: i64 = parts.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = y - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days).ok()
}

/// Volatility-matched TTL for title metadata (Netflix #630 / #654):
/// - Series with an episode airing within ±2 days (live edge): 45 min
/// - Ended/canceled series or films released >180 days ago (settled): 24 hours
/// - Active returning series / recent releases: 6 hours
fn meta_ttl(meta: &Meta, today_day: u64) -> Duration {
    const LIVE: Duration = Duration::from_secs(45 * 60);
    const DEFAULT: Duration = Duration::from_secs(6 * 60 * 60);
    const SETTLED: Duration = Duration::from_secs(24 * 60 * 60);

    if meta.preview.ty == "series" {
        let airing_near = meta
            .videos
            .iter()
            .any(|v| v.released.as_deref().and_then(parse_day).is_some_and(|d| d.abs_diff(today_day) <= 2));
        if airing_near {
            return LIVE;
        }
        let ended = meta.details.status.as_deref().is_some_and(|s| {
            s.eq_ignore_ascii_case("ended") || s.eq_ignore_ascii_case("canceled") || s.eq_ignore_ascii_case("cancelled")
        });
        if ended {
            return SETTLED;
        }
        return DEFAULT;
    }

    if let Some(day) = meta.details.released.as_deref().and_then(parse_day) {
        if today_day.saturating_sub(day) > 180 {
            return SETTLED;
        }
    }
    DEFAULT
}

#[cfg(test)]
mod tests {
    use super::*;
    use polar_addon::{MetaDetails, Video};

    fn preview(ty: &str) -> MetaPreview {
        MetaPreview {
            id: "tt0000001".into(),
            ty: ty.into(),
            name: "Test Title".into(),
            poster: None,
            background: None,
            logo: None,
            logos: Vec::new(),
            description: None,
            release_info: None,
            imdb_rating: None,
            genres: Vec::new(),
            certification: None,
        }
    }

    fn test_meta(ty: &str, details: MetaDetails, videos: Vec<Video>) -> Meta {
        Meta {
            preview: preview(ty),
            runtime: None,
            cast: Vec::new(),
            director: Vec::new(),
            trailer_yt_id: None,
            trailer_source: None,
            videos,
            people: Vec::new(),
            details,
            crew: Vec::new(),
            extras: Vec::new(),
        }
    }

    fn ep(id: &str, season: u32, episode: u32, released: Option<&str>) -> Video {
        Video {
            id: id.into(),
            title: format!("Episode {episode}"),
            season,
            episode,
            released: released.map(str::to_owned),
            thumbnail: None,
            overview: None,
            rating: None,
        }
    }

    #[tokio::test]
    async fn tmdb_ids_need_a_tmdb_key() {
        let ix = Indexer::new(IndexConfig::default());
        assert_eq!(ix.imdb_for_tmdb("movie", 603).await.unwrap(), None);
        assert!(ix.imdb_for_tmdb("anime", 603).await.is_err());
    }

    #[test]
    fn meta_ttl_matches_title_volatility() {
        let today = parse_day("2026-11-22").unwrap();
        let ended_show =
            test_meta("series", MetaDetails { status: Some("Ended".into()), ..Default::default() }, vec![]);
        assert_eq!(meta_ttl(&ended_show, today), Duration::from_secs(24 * 60 * 60));

        let airing_show = test_meta("series", MetaDetails::default(), vec![ep("tt1:1:5", 1, 5, Some("2026-11-23"))]);
        assert_eq!(meta_ttl(&airing_show, today), Duration::from_secs(45 * 60));

        let old_film =
            test_meta("movie", MetaDetails { released: Some("2024-01-10".into()), ..Default::default() }, vec![]);
        assert_eq!(meta_ttl(&old_film, today), Duration::from_secs(24 * 60 * 60));

        let new_film =
            test_meta("movie", MetaDetails { released: Some("2026-10-15".into()), ..Default::default() }, vec![]);
        assert_eq!(meta_ttl(&new_film, today), Duration::from_secs(6 * 60 * 60));
    }

    #[test]
    fn data_canary_guards_reject_empty_overwrites() {
        let prev_show = test_meta("series", MetaDetails::default(), vec![ep("tt1:1:1", 1, 1, None)]);
        let empty_show = test_meta("series", MetaDetails::default(), vec![]);
        assert!(!meta_valid(&prev_show, &empty_show));
        assert!(meta_valid(&empty_show, &prev_show));

        let populated: Vec<MetaPreview> = (0..12).map(|_| preview("movie")).collect();
        assert!(!catalog_valid(&populated, &[]));
        assert!(!catalog_valid(&populated, &[preview("movie")]));
        assert!(catalog_valid(&populated, &populated[..5]));
    }

    #[test]
    fn trim_memory_evicts_proportionally_across_levels() {
        let ix = Indexer::new(IndexConfig::default());
        for i in 0..8 {
            ix.metas.insert(format!("tt000000{i}"), test_meta("movie", MetaDetails::default(), vec![]));
            ix.catalogs.insert(format!("movie/trending/{i}"), vec![preview("movie")]);
        }
        assert_eq!(ix.trim_memory(0), 0);
        let l1 = ix.trim_memory(1);
        assert!(l1 >= 2, "level 1 should trim secondary caches, trimmed {l1}");
        let l2 = ix.trim_memory(2);
        assert!(l2 >= 4, "level 2 should evict half of caches, trimmed {l2}");
        let l3 = ix.trim_memory(3);
        assert!(l3 >= 2, "level 3 should aggressively evict remaining entries, trimmed {l3}");
    }
}
