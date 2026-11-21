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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::OnceCell;

use polar_addon::{AddonClient, CatalogExtra, Manifest, ManifestCatalog, ManifestResource, Meta, MetaPreview};

use cache::{Singleflight, TtlCache};

/// Cap on Cinemeta series renumbering join so slow/degraded Cinemeta never stalls series pages for 20s.
const NUMBERING_TIMEOUT: Duration = Duration::from_millis(2500);

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
    /// Optional cache folder for persisting TMDB lookups across mobile restarts.
    pub cache_dir: Option<PathBuf>,
    /// Optional shared `reqwest::Client` to reuse TLS sessions & connection pools across the app.
    pub http: Option<reqwest::Client>,
}

enum Backend {
    Tmdb(Box<tmdb::Tmdb>),
    Cinemeta(cinemeta::Cinemeta),
}

pub struct Indexer {
    backend: Backend,
    catalogs: TtlCache<String, Vec<MetaPreview>>,
    metas: TtlCache<String, Meta>,
    meta_flight: Singleflight<String, Meta>,
    recommend_flight: Singleflight<String, Vec<MetaPreview>>,
    /// Candidate pools (several upstream pages each), shared by curated shelves.
    /// One fetch per pool however many shelves ask for it at once.
    pools: TtlCache<String, Arc<OnceCell<Vec<MetaPreview>>>>,
    /// IMDb's episode numbering for TMDB series.
    numbering: cinemeta::Cinemeta,
    /// Other episode orders (TMDB's episode groups), listed and mapped onto `metas`' episodes.
    orders: episode_order::Cache,
    /// People's pages by TMDB id.
    people: TtlCache<u64, PersonPage>,
    person_flight: Singleflight<u64, PersonPage>,
    /// People search hits by normalized query.
    people_search: TtlCache<String, Vec<PersonHit>>,
    /// Lightweight genre backdrop thumbnails for Search tiles.
    genre_backdrops: TtlCache<String, HashMap<String, String>>,
}

impl Indexer {
    pub fn new(config: IndexConfig) -> Self {
        let addon_client = config.http.clone().map(AddonClient::with_client).unwrap_or_default();
        let backend = match config.tmdb_key.filter(|k| !k.trim().is_empty()) {
            Some(key) => {
                Backend::Tmdb(Box::new(tmdb::Tmdb::new_with(key, config.language, config.http, config.cache_dir)))
            }
            None => Backend::Cinemeta(cinemeta::Cinemeta::with_client(addon_client.clone())),
        };
        Self {
            backend,
            catalogs: TtlCache::new(Duration::from_secs(60 * 60), 256),
            metas: TtlCache::new(Duration::from_secs(6 * 60 * 60), 2048),
            meta_flight: Singleflight::default(),
            recommend_flight: Singleflight::default(),
            pools: TtlCache::new(Duration::from_secs(3 * 60 * 60), 64),
            numbering: cinemeta::Cinemeta::with_client(addon_client),
            orders: episode_order::Cache::new(),
            people: TtlCache::new(Duration::from_secs(6 * 60 * 60), 256),
            person_flight: Singleflight::default(),
            people_search: TtlCache::new(Duration::from_secs(60 * 60), 128),
            genre_backdrops: TtlCache::new(Duration::from_secs(6 * 60 * 60), 16),
        }
    }

    /// Human name of the active data source, shown in settings.
    pub fn source(&self) -> &'static str {
        match self.backend {
            Backend::Tmdb(_) => "TMDB",
            Backend::Cinemeta(_) => "Cinemeta (fallback)",
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
        self.catalogs.insert(key, metas.clone());
        Ok(metas)
    }

    /// Titles like `id`, for "Because you watched …" shelves.
    pub async fn recommend(&self, ty: &str, id: &str) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let key = format!("{ty}/recommend/{id}");
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        self.recommend_flight
            .run(key.clone(), async {
                if let Some(hit) = self.catalogs.get(&key) {
                    return Ok(hit);
                }
                let metas = match &self.backend {
                    Backend::Tmdb(t) => t.recommendations(ty, id).await?,
                    Backend::Cinemeta(c) => {
                        let seed = self.meta(ty, id).await?.preview;
                        let genres: Vec<Option<String>> =
                            seed.genres.iter().take(2).cloned().map(Some).chain([None]).collect();
                        let lists = futures::future::join_all(genres.iter().map(|g| {
                            let g = g.as_deref();
                            self.pooled(format!("{ty}/{}", g.unwrap_or("")), c.pool(ty, g))
                        }))
                        .await;
                        let lists: Vec<Vec<MetaPreview>> = lists.into_iter().filter_map(|l| l.ok()).collect();
                        curate::similar(&seed, &lists, curate::today()).into_iter().take(CURATED_PAGE).collect()
                    }
                };
                self.catalogs.insert(key.clone(), metas.clone());
                Ok(metas)
            })
            .await
    }

    /// Lightweight backdrop URL per genre (no N+1 IMDb lookups) for Search genre tiles.
    pub async fn genre_backdrops(&self, ty: &str, genres: &[String]) -> Result<HashMap<String, String>> {
        check_type(ty)?;
        let key = format!("{ty}/{}", genres.join(","));
        if let Some(hit) = self.genre_backdrops.get(&key) {
            return Ok(hit);
        }
        let map = match &self.backend {
            Backend::Tmdb(t) => t.genre_backdrops(ty, genres).await,
            Backend::Cinemeta(c) => {
                let futs = genres.iter().map(|g| async move {
                    let bg = c
                        .top(ty, 0, Some(g))
                        .await
                        .ok()
                        .and_then(|list| list.into_iter().find_map(|m| m.background));
                    (g.clone(), bg)
                });
                futures::future::join_all(futs)
                    .await
                    .into_iter()
                    .filter_map(|(k, v)| v.map(|url| (k, url)))
                    .collect()
            }
        };
        if !map.is_empty() {
            self.genre_backdrops.insert(key, map.clone());
        }
        Ok(map)
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
        self.catalogs.insert(key, metas.clone());
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
        check_type(ty)?;
        if !id.starts_with("tt") {
            return Err(IndexError::UnsupportedId(id.into()));
        }
        let key = format!("{ty}/{id}");
        if let Some(hit) = self.metas.get(&key) {
            return Ok(hit);
        }
        self.meta_flight
            .run(key.clone(), async {
                if let Some(hit) = self.metas.get(&key) {
                    return Ok(hit);
                }
                let meta = match &self.backend {
                    Backend::Tmdb(t) if ty == "series" => {
                        let (meta, imdb) = futures::join!(
                            t.meta(ty, id),
                            tokio::time::timeout(NUMBERING_TIMEOUT, self.numbering.meta(ty, id))
                        );
                        let mut meta = meta?;
                        match imdb {
                            Ok(Ok(imdb)) => meta.videos = polar_addon::numbering::renumber(meta.videos, &imdb.videos),
                            Ok(Err(e)) => tracing::warn!("no IMDb numbering for a show, keeping TMDB's: {e}"),
                            Err(_) => tracing::warn!("IMDb numbering timed out after {:?}, keeping TMDB's", NUMBERING_TIMEOUT),
                        }
                        meta
                    }
                    Backend::Tmdb(t) => t.meta(ty, id).await?,
                    Backend::Cinemeta(c) => c.meta(ty, id).await?,
                };
                self.metas.insert(key.clone(), meta.clone());
                Ok(meta)
            })
            .await
    }

    /// A person's page by their TMDB id: who they are and the titles they act in or directed. Only
    /// TMDB names people by id; without a TMDB key there are none to ask for (not found).
    pub async fn person(&self, tmdb_id: u64) -> Result<PersonPage> {
        let Backend::Tmdb(t) = &self.backend else { return Err(IndexError::NotFound) };
        if let Some(hit) = self.people.get(&tmdb_id) {
            return Ok(hit);
        }
        self.person_flight
            .run(tmdb_id, async {
                if let Some(hit) = self.people.get(&tmdb_id) {
                    return Ok(hit);
                }
                let page = t.person(tmdb_id).await?;
                self.people.insert(tmdb_id, page.clone());
                Ok(page)
            })
            .await
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn tmdb_ids_need_a_tmdb_key() {
        let ix = Indexer::new(IndexConfig::default());
        assert_eq!(ix.imdb_for_tmdb("movie", 603).await.unwrap(), None);
        assert!(ix.imdb_for_tmdb("anime", 603).await.is_err());
    }
}
