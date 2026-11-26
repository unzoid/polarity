//! Show-first anime catalog, seasonal feeds, schedules, browse/search and lazy character details.
//!
//! Powered by batched AniList GraphQL queries in Rust with polite rate pacing, singleflight
//! coalescing, per-key atomic disk caching in the app cache folder, and stale-while-error fallback.
//!
//! Unlike per-card frontend GraphQL waterfalls, the entire Anime home screen (all 6 shelves) is
//! fetched in a **single** batched GraphQL POST (or 2 seasonal aliases when TMDB Discover serves
//! evergreen shelves) and cached on disk for 4–12 hours. Every entry is mapped onto a show-level
//! canonical id (`tt…`, `kitsu:…`, or `mal:…`) using the local [`AnimeLists`] index (0ms) so the
//! UI renders immediately with zero per-card network calls.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{Mutex, OnceCell};

use crate::anime_lists::{AnimeKey, AnimeLists, AnimeMapping};

const ANILIST_ENDPOINT: &str = "https://graphql.anilist.co";
const CACHE_DIR: &str = "anime-catalog";
const CACHE_VERSION: u32 = 2;
/// Minimum spacing between outbound AniList requests (~2.8 req/s, well under the 30/min cap).
const ANILIST_PACE: Duration = Duration::from_millis(350);
const MAX_RETRIES: u32 = 3;

pub const TTL_SEASONAL: Duration = Duration::from_secs(4 * 60 * 60);
pub const TTL_SCHEDULE: Duration = Duration::from_secs(2 * 60 * 60);
pub const TTL_EVERGREEN: Duration = Duration::from_secs(12 * 60 * 60);
pub const TTL_BROWSE: Duration = Duration::from_secs(15 * 60);
pub const TTL_CHARACTERS: Duration = Duration::from_secs(7 * 24 * 60 * 60);
pub const TTL_META: Duration = Duration::from_secs(6 * 60 * 60);

const CARD_FRAGMENT: &str = r#"
fragment Card on Media {
  id
  idMal
  title { english romaji native }
  format
  status
  episodes
  duration
  seasonYear
  averageScore
  description(asHtml: false)
  genres
  isAdult
  startDate { year month day }
  coverImage { extraLarge large }
  bannerImage
  nextAiringEpisode { airingAt episode }
}
"#;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeTitle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub english: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub romaji: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeAiring {
    /// Unix timestamp (seconds) of the next scheduled broadcast.
    pub airing_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode: Option<u32>,
}

/// Render-ready, show-grouped anime card returned by every shelf, hero, schedule, and browse query.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeItem {
    /// Canonical Polarity id (`tt…`, `kitsu:…`, or `mal:…`).
    pub id: String,
    /// `"series"` or `"movie"`.
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    pub titles: AnimeTitle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub logos: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
    /// Score out of 10 (e.g. 8.7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episodes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certification: Option<String>,
    /// Season number to auto-select inside the unified show view when opened from a seasonal/schedule shelf.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_hint: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub airing: Option<AnimeAiring>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mal_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anilist_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kitsu_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmdb_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default)]
    pub mature: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeHome {
    pub season: Vec<AnimeItem>,
    pub trending: Vec<AnimeItem>,
    pub upcoming: Vec<AnimeItem>,
    pub top: Vec<AnimeItem>,
    pub popular: Vec<AnimeItem>,
    pub movies: Vec<AnimeItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeBrowseQuery {
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub genre: String,
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub season: String,
    #[serde(default)]
    pub year: u16,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub sort: String,
    #[serde(default = "default_page")]
    pub page: u32,
}

fn default_page() -> u32 {
    1
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeBrowsePage {
    pub items: Vec<AnimeItem>,
    pub has_next_page: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeVoiceActor {
    pub id: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeCharacter {
    pub id: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_ja: Option<AnimeVoiceActor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_en: Option<AnimeVoiceActor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeRanking {
    pub rank: u32,
    pub context: String,
    pub all_time: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeTag {
    pub name: String,
    pub rank: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub spoiler: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeExternalLink {
    pub site: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// Lazy-loaded rich anime details + characters & voice actors (1 AniList request, cached 7 days on disk).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeRichDetails {
    pub anilist_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mal_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episodes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_year: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub average_score: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favourites: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub studios: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub producers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub synonyms: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rankings: Vec<AnimeRanking>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<AnimeTag>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub streaming_links: Vec<AnimeExternalLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub characters: Vec<AnimeCharacter>,
}

/// Fast local anime identity info for any IMDb/Kitsu/MAL show opened in the unified title dialog.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeShowInfo {
    pub is_anime: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mal_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anilist_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kitsu_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imdb_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seasons: Vec<AnimeMapping>,
}

/// Basic episode metadata for unmapped (`mal:` / `kitsu:`) shows that have no IMDb/TMDB entry yet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JikanEpisode {
    pub number: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aired: Option<String>,
    #[serde(default)]
    pub filler: bool,
    #[serde(default)]
    pub recap: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedBlob {
    version: u32,
    fetched_at: u64,
    data: serde_json::Value,
}

pub struct AnimeCatalog {
    cache_dir: PathBuf,
    http: reqwest::Client,
    endpoint: String,
    pace: Duration,
    last_req: Mutex<Option<Instant>>,
    inflight: Mutex<HashMap<String, Arc<OnceCell<serde_json::Value>>>>,
    mem: Mutex<HashMap<String, (u64, serde_json::Value)>>,
}

impl AnimeCatalog {
    pub fn with_client(cache_dir: PathBuf, http: reqwest::Client) -> Self {
        Self::with_endpoint(cache_dir, http, ANILIST_ENDPOINT, ANILIST_PACE)
    }

    pub fn with_endpoint(cache_dir: PathBuf, http: reqwest::Client, endpoint: &str, pace: Duration) -> Self {
        Self {
            cache_dir: cache_dir.join(CACHE_DIR),
            http,
            endpoint: endpoint.trim_end_matches('/').to_owned(),
            pace,
            last_req: Mutex::new(None),
            inflight: Mutex::new(HashMap::new()),
            mem: Mutex::new(HashMap::new()),
        }
    }

    /// Total bytes on disk across cached anime catalog files.
    pub async fn size(&self) -> u64 {
        let mut total = 0u64;
        let Ok(mut rd) = tokio::fs::read_dir(&self.cache_dir).await else { return 0 };
        while let Ok(Some(entry)) = rd.next_entry().await {
            if let Ok(meta) = entry.metadata().await {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
        total
    }

    /// Clears both in-memory and disk anime catalog caches.
    pub async fn clear(&self) {
        self.mem.lock().await.clear();
        self.inflight.lock().await.clear();
        let _ = tokio::fs::remove_dir_all(&self.cache_dir).await;
    }

    /// Fetches the Anime home shelves in **one single batched GraphQL POST**.
    ///
    /// When `include_evergreen` is `false` (TMDB Discover serves evergreen shelves), only `season`
    /// and `upcoming` are requested. When `true`, all 6 shelves come back in one request.
    pub async fn home(&self, lists: &AnimeLists, include_evergreen: bool) -> Result<AnimeHome, String> {
        let (season, season_year) = current_anime_season(now_unix());
        let (next_season, next_year) = next_anime_season(season, season_year);

        let key = if include_evergreen {
            format!("home_full_{season}_{season_year}")
        } else {
            format!("home_seasonal_{season}_{season_year}")
        };

        let query = if include_evergreen {
            format!(
                r#"
query ($season: MediaSeason, $seasonYear: Int, $nextSeason: MediaSeason, $nextYear: Int) {{
  season: Page(page: 1, perPage: 25) {{
    media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
  upcoming: Page(page: 1, perPage: 25) {{
    media(type: ANIME, season: $nextSeason, seasonYear: $nextYear, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
  trending: Page(page: 1, perPage: 25) {{
    media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {{ ...Card }}
  }}
  top: Page(page: 1, perPage: 25) {{
    media(type: ANIME, sort: SCORE_DESC, isAdult: false) {{ ...Card }}
  }}
  popular: Page(page: 1, perPage: 25) {{
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
  movies: Page(page: 1, perPage: 25) {{
    media(type: ANIME, format: MOVIE, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
            )
        } else {
            format!(
                r#"
query ($season: MediaSeason, $seasonYear: Int, $nextSeason: MediaSeason, $nextYear: Int) {{
  season: Page(page: 1, perPage: 25) {{
    media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
  upcoming: Page(page: 1, perPage: 25) {{
    media(type: ANIME, season: $nextSeason, seasonYear: $nextYear, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
            )
        };

        let variables = json!({
            "season": season,
            "seasonYear": season_year,
            "nextSeason": next_season,
            "nextYear": next_year,
        });

        let raw = self.cached_query(&key, &query, variables, TTL_SEASONAL).await?;
        let data: RawHomeData = serde_json::from_value(raw).map_err(|e| format!("decode anime home: {e}"))?;

        Ok(AnimeHome {
            season: map_media_list(data.season.map(|p| p.media).unwrap_or_default(), lists, true).await,
            upcoming: map_media_list(data.upcoming.map(|p| p.media).unwrap_or_default(), lists, true).await,
            trending: map_media_list(data.trending.map(|p| p.media).unwrap_or_default(), lists, false).await,
            top: map_media_list(data.top.map(|p| p.media).unwrap_or_default(), lists, false).await,
            popular: map_media_list(data.popular.map(|p| p.media).unwrap_or_default(), lists, false).await,
            movies: map_media_list(data.movies.map(|p| p.media).unwrap_or_default(), lists, false).await,
        })
    }

    pub async fn catalog_shelf(
        &self,
        shelf: &str,
        genre: Option<&str>,
        page: u32,
        lists: &AnimeLists,
    ) -> Result<AnimeBrowsePage, String> {
        let p = page.max(1);
        if let Some(g) = genre.map(str::trim).filter(|g| !g.is_empty()) {
            let key = format!("genre_{}_p{p}", g.to_ascii_lowercase());
            let query = format!(
                r#"
query ($page: Int, $genre: String) {{
  Page(page: $page, perPage: 25) {{
    pageInfo {{ hasNextPage }}
    media(type: ANIME, genre: $genre, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
            );
            return self.page_query(&key, &query, json!({ "page": p, "genre": g }), TTL_EVERGREEN, lists, false).await;
        }

        let (season, season_year) = current_anime_season(now_unix());
        let (next_season, next_year) = next_anime_season(season, season_year);
        match shelf {
            "season" => {
                let query = format!(
                    r#"
query ($page: Int, $season: MediaSeason, $year: Int) {{
  Page(page: $page, perPage: 25) {{
    pageInfo {{ hasNextPage }}
    media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
                );
                self.page_query(
                    &format!("season_{season}_{season_year}_p{p}"),
                    &query,
                    json!({ "page": p, "season": season, "year": season_year }),
                    TTL_SEASONAL,
                    lists,
                    true,
                )
                .await
            }
            "upcoming" => {
                let query = format!(
                    r#"
query ($page: Int, $season: MediaSeason, $year: Int) {{
  Page(page: $page, perPage: 25) {{
    pageInfo {{ hasNextPage }}
    media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
                );
                self.page_query(
                    &format!("upcoming_{next_season}_{next_year}_p{p}"),
                    &query,
                    json!({ "page": p, "season": next_season, "year": next_year }),
                    TTL_SEASONAL,
                    lists,
                    true,
                )
                .await
            }
            "trending" => self.sorted_shelf("trending", "TRENDING_DESC", None, p, TTL_SEASONAL, lists).await,
            "top" => self.sorted_shelf("top", "SCORE_DESC", None, p, TTL_EVERGREEN, lists).await,
            "popular" => self.sorted_shelf("popular", "POPULARITY_DESC", None, p, TTL_EVERGREEN, lists).await,
            "movies" => self.sorted_shelf("movies", "POPULARITY_DESC", Some("MOVIE"), p, TTL_EVERGREEN, lists).await,
            _ => Err(format!("unknown anime shelf: {shelf}")),
        }
    }

    async fn sorted_shelf(
        &self,
        name: &str,
        sort: &str,
        format_filter: Option<&str>,
        page: u32,
        ttl: Duration,
        lists: &AnimeLists,
    ) -> Result<AnimeBrowsePage, String> {
        let key = format!("shelf_{name}_p{page}");
        let query = match format_filter {
            Some(_) => format!(
                r#"
query ($page: Int, $sort: [MediaSort], $format: MediaFormat) {{
  Page(page: $page, perPage: 25) {{
    pageInfo {{ hasNextPage }}
    media(type: ANIME, format: $format, sort: $sort, isAdult: false) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
            ),
            None => format!(
                r#"
query ($page: Int, $sort: [MediaSort]) {{
  Page(page: $page, perPage: 25) {{
    pageInfo {{ hasNextPage }}
    media(type: ANIME, sort: $sort, isAdult: false) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
            ),
        };
        let mut vars = json!({ "page": page, "sort": [sort] });
        if let Some(f) = format_filter {
            vars["format"] = json!(f);
        }
        self.page_query(&key, &query, vars, ttl, lists, false).await
    }

    /// Airing schedule for one weekday (`"monday"`..`"sunday"`) or the next 7 days when `None`.
    pub async fn schedule(&self, day: Option<&str>, lists: &AnimeLists) -> Result<Vec<AnimeItem>, String> {
        let now = now_unix();
        let day_norm = day.map(|d| d.trim().to_ascii_lowercase()).filter(|d| !d.is_empty());
        let (key, from, to) = match day_norm.as_deref().and_then(parse_weekday) {
            Some(target_wd) => {
                let (start, end) = weekday_utc_window(now, target_wd);
                let bucket = start / 86_400;
                (format!("schedule_{target_wd}_{bucket}"), start, end)
            }
            None => {
                let bucket = now / 3600;
                (format!("schedule_week_{bucket}"), now.saturating_sub(1800), now + 7 * 86_400)
            }
        };

        let query = format!(
            r#"
query ($from: Int, $to: Int) {{
  Page(page: 1, perPage: 50) {{
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {{
      airingAt
      episode
      media {{ ...Card }}
    }}
  }}
}}
{CARD_FRAGMENT}
"#
        );
        let raw = self.cached_query(&key, &query, json!({ "from": from, "to": to }), TTL_SCHEDULE).await?;
        let resp: RawScheduleResp = serde_json::from_value(raw).map_err(|e| format!("decode schedule: {e}"))?;

        let mut items = Vec::new();
        let mut seen = HashSet::new();
        for slot in resp.page.airing_schedules {
            let Some(media) = slot.media else { continue };
            if media.is_adult {
                continue;
            }
            let mapped = lookup_mapping(lists, media.id, media.id_mal).await;
            let mut item = raw_to_item(media, mapped.as_ref(), true);
            item.airing = Some(AnimeAiring { airing_at: slot.airing_at, label: None, episode: Some(slot.episode) });
            if seen.insert(item.id.clone()) {
                items.push(item);
            }
        }
        items.sort_by_key(|a| a.airing.as_ref().map(|x| x.airing_at).unwrap_or(u64::MAX));
        Ok(items)
    }

    /// Filterable/searchable anime browse grid powered by batched AniList GraphQL.
    pub async fn browse(&self, q: &AnimeBrowseQuery, lists: &AnimeLists) -> Result<AnimeBrowsePage, String> {
        let page = q.page.max(1);
        let search = q.search.trim();
        let genre = q.genre.trim();
        let tag = q.tag.trim();
        let season = anilist_season(&q.season);
        let format = anilist_format(&q.format);
        let status = anilist_status(&q.status);
        let sort: Vec<&str> = match q.sort.trim() {
            "SCORE_DESC" => vec!["SCORE_DESC"],
            "START_DATE_DESC" => vec!["START_DATE_DESC"],
            "TITLE_ROMAJI" => vec!["TITLE_ROMAJI"],
            "TRENDING_DESC" => vec!["TRENDING_DESC"],
            "POPULARITY_DESC" => vec!["POPULARITY_DESC"],
            _ if !search.is_empty() => vec!["SEARCH_MATCH", "POPULARITY_DESC"],
            _ => vec!["POPULARITY_DESC"],
        };

        let mut vars = serde_json::Map::new();
        vars.insert("page".into(), json!(page));
        vars.insert("sort".into(), json!(sort));
        if !search.is_empty() {
            vars.insert("search".into(), json!(search));
        }
        if !genre.is_empty() {
            vars.insert("genre".into(), json!(genre));
        }
        if !tag.is_empty() {
            vars.insert("tag".into(), json!(tag));
        }
        if let Some(s) = season {
            vars.insert("season".into(), json!(s));
        }
        if q.year > 0 {
            vars.insert("seasonYear".into(), json!(q.year));
        }
        if let Some(f) = format {
            vars.insert("format".into(), json!(f));
        }
        if let Some(st) = status {
            vars.insert("status".into(), json!(st));
        }

        let query = format!(
            r#"
query (
  $page: Int,
  $search: String,
  $genre: String,
  $tag: String,
  $season: MediaSeason,
  $seasonYear: Int,
  $format: MediaFormat,
  $status: MediaStatus,
  $sort: [MediaSort]
) {{
  Page(page: $page, perPage: 25) {{
    pageInfo {{ hasNextPage }}
    media(
      type: ANIME,
      search: $search,
      genre: $genre,
      tag: $tag,
      season: $season,
      seasonYear: $seasonYear,
      format: $format,
      status: $status,
      sort: $sort,
      isAdult: false
    ) {{ ...Card }}
  }}
}}
{CARD_FRAGMENT}
"#
        );

        let vars_val = serde_json::Value::Object(vars);
        let key = format!("browse_{:x}", fnv1a(vars_val.to_string().as_bytes()));
        let seasonal = season.is_some();
        self.page_query(&key, &query, vars_val, TTL_BROWSE, lists, seasonal).await
    }

    /// Lazy-loaded rich anime details (rankings, facts, studios, tags, official links, characters & VAs)
    /// in a single AniList request, cached 7 days on disk.
    pub async fn details(&self, anilist_id: Option<u32>, mal_id: Option<u32>) -> Result<AnimeRichDetails, String> {
        let (key, lookup_arg, vars) = if let Some(al) = anilist_id.filter(|&n| n > 0) {
            (format!("details_al_{al}"), "id: $id", json!({ "id": al }))
        } else if let Some(mal) = mal_id.filter(|&n| n > 0) {
            (format!("details_mal_{mal}"), "idMal: $id", json!({ "id": mal }))
        } else {
            return Err("anime details needs anilist_id or mal_id".into());
        };
        let query = format!(
            r#"
query ($id: Int) {{
  Media({lookup_arg}, type: ANIME) {{
    id
    idMal
    title {{ english romaji native }}
    synonyms
    format
    episodes
    duration
    status
    season
    seasonYear
    startDate {{ year month day }}
    endDate {{ year month day }}
    source
    averageScore
    favourites
    studios {{
      edges {{
        isMain
        node {{ name isAnimationStudio }}
      }}
    }}
    rankings {{
      rank
      context
      allTime
      year
      season
    }}
    tags {{
      name
      rank
      description
      isMediaSpoiler
      isGeneralSpoiler
    }}
    externalLinks {{
      site
      url
      type
      icon
      color
      language
    }}
    characters(sort: [ROLE, RELEVANCE], perPage: 24) {{
      edges {{
        role
        node {{
          id
          name {{ full }}
          image {{ large medium }}
        }}
        voiceActors(language: JAPANESE, sort: RELEVANCE) {{
          id
          name {{ full }}
          image {{ large medium }}
        }}
        voiceActorsEn: voiceActors(language: ENGLISH, sort: RELEVANCE) {{
          id
          name {{ full }}
          image {{ large medium }}
        }}
      }}
    }}
  }}
}}
"#
        );
        let raw = self.cached_query(&key, &query, vars, TTL_CHARACTERS).await?;
        let resp: RawRichDetailsResp = serde_json::from_value(raw).map_err(|e| format!("decode anime details: {e}"))?;
        let Some(m) = resp.media else { return Ok(AnimeRichDetails::default()) };

        let mut studios = Vec::new();
        let mut producers = Vec::new();
        for edge in m.studios.edges {
            let name = edge.node.name.trim();
            if name.is_empty() {
                continue;
            }
            if edge.node.is_animation_studio {
                if !studios.iter().any(|s: &String| s.eq_ignore_ascii_case(name)) {
                    studios.push(name.to_owned());
                }
            } else if !producers.iter().any(|p: &String| p.eq_ignore_ascii_case(name)) {
                producers.push(name.to_owned());
            }
        }
        producers.truncate(5);

        let mut synonyms = Vec::new();
        for cand in [m.title.romaji, m.title.english, m.title.native].into_iter().flatten().chain(m.synonyms) {
            let t = cand.trim();
            if !t.is_empty() && !synonyms.iter().any(|s: &String| s.eq_ignore_ascii_case(t)) {
                synonyms.push(t.to_owned());
            }
        }
        synonyms.truncate(5);

        let rankings: Vec<AnimeRanking> = m
            .rankings
            .into_iter()
            .filter(|r| r.rank > 0 && r.rank <= 100)
            .take(4)
            .map(|r| AnimeRanking {
                rank: r.rank,
                context: r.context,
                all_time: r.all_time,
                year: r.year,
                season: r.season,
            })
            .collect();

        let tags: Vec<AnimeTag> = m
            .tags
            .into_iter()
            .filter(|t| t.rank >= 40)
            .take(24)
            .map(|t| AnimeTag {
                name: t.name,
                rank: t.rank,
                description: t.description.filter(|s| !s.trim().is_empty()),
                spoiler: t.is_media_spoiler || t.is_general_spoiler,
            })
            .collect();

        let mut seen_sites = HashSet::new();
        let streaming_links: Vec<AnimeExternalLink> = m
            .external_links
            .into_iter()
            .filter(|l| l.ty.as_deref() == Some("STREAMING") && l.url.starts_with("https://"))
            .filter(|l| seen_sites.insert(format!("{}:{}", l.site, l.language.as_deref().unwrap_or(""))))
            .map(|l| AnimeExternalLink {
                site: l.site,
                url: l.url,
                icon: l.icon.filter(|u| u.starts_with("https://")),
                color: l.color,
                language: l.language.filter(|s| !s.trim().is_empty()),
            })
            .collect();

        let mut characters: Vec<AnimeCharacter> = m
            .characters
            .edges
            .into_iter()
            .filter_map(|edge| {
                let node = edge.node?;
                let to_va = |v: &RawVoiceActor| AnimeVoiceActor {
                    id: v.id,
                    name: v.name.full.clone().unwrap_or_default(),
                    image: v.image.large.clone().or_else(|| v.image.medium.clone()),
                };
                let role = match edge.role.as_deref() {
                    Some("MAIN") => "Main",
                    Some("SUPPORTING") => "Supporting",
                    Some("BACKGROUND") => "Background",
                    Some(other) => other,
                    None => "Supporting",
                }
                .to_owned();
                Some(AnimeCharacter {
                    id: node.id,
                    name: node.name.full.unwrap_or_default(),
                    image: node.image.large.or(node.image.medium),
                    role,
                    voice_ja: edge.voice_actors.first().map(to_va),
                    voice_en: edge.voice_actors_en.first().map(to_va),
                })
            })
            .collect();
        characters.sort_by_key(|c| if c.role.eq_ignore_ascii_case("main") { 0 } else { 1 });

        Ok(AnimeRichDetails {
            anilist_id: m.id,
            mal_id: m.id_mal,
            format: m.format,
            episodes: m.episodes,
            duration: m.duration,
            status: m.status,
            season: m.season,
            season_year: m.season_year,
            start_date: format_fuzzy_date(m.start_date.as_ref()),
            end_date: format_fuzzy_date(m.end_date.as_ref()),
            source: m.source,
            average_score: m.average_score,
            favourites: m.favourites,
            studios,
            producers,
            synonyms,
            rankings,
            tags,
            streaming_links,
            characters,
        })
    }

    /// Lazy-loaded character & voice actor list for an anime by MAL id (cached 7 days on disk).
    pub async fn characters(&self, mal_id: u32) -> Result<Vec<AnimeCharacter>, String> {
        let key = format!("chars_{mal_id}");
        let query = r#"
query ($malId: Int) {
  Media(idMal: $malId, type: ANIME) {
    characters(sort: [ROLE, RELEVANCE], perPage: 24) {
      edges {
        role
        node {
          id
          name { full }
          image { large medium }
        }
        voiceActors(language: JAPANESE, sort: RELEVANCE) {
          id
          name { full }
          image { large medium }
        }
        voiceActorsEn: voiceActors(language: ENGLISH, sort: RELEVANCE) {
          id
          name { full }
          image { large medium }
        }
      }
    }
  }
}
"#;
        let raw = self.cached_query(&key, query, json!({ "malId": mal_id }), TTL_CHARACTERS).await?;
        let resp: RawCharactersResp = serde_json::from_value(raw).map_err(|e| format!("decode characters: {e}"))?;
        let Some(media) = resp.media else { return Ok(Vec::new()) };

        let mut out: Vec<AnimeCharacter> = media
            .characters
            .edges
            .into_iter()
            .filter_map(|edge| {
                let node = edge.node?;
                let to_va = |v: &RawVoiceActor| AnimeVoiceActor {
                    id: v.id,
                    name: v.name.full.clone().unwrap_or_default(),
                    image: v.image.large.clone().or_else(|| v.image.medium.clone()),
                };
                let role = match edge.role.as_deref() {
                    Some("MAIN") => "Main",
                    Some("SUPPORTING") => "Supporting",
                    Some("BACKGROUND") => "Background",
                    Some(other) => other,
                    None => "Supporting",
                }
                .to_owned();
                Some(AnimeCharacter {
                    id: node.id,
                    name: node.name.full.unwrap_or_default(),
                    image: node.image.large.or(node.image.medium),
                    role,
                    voice_ja: edge.voice_actors.first().map(to_va),
                    voice_en: edge.voice_actors_en.first().map(to_va),
                })
            })
            .collect();
        out.sort_by_key(|c| if c.role.eq_ignore_ascii_case("main") { 0 } else { 1 });
        Ok(out)
    }

    /// Fallback details + episode list for a brand-new or Kitsu-only anime that isn't on IMDb/TMDB yet.
    pub async fn mal_entry(&self, mal_id: u32, lists: &AnimeLists) -> Result<(AnimeItem, Vec<JikanEpisode>), String> {
        let key = format!("mal_detail_{mal_id}");
        let query = format!(
            r#"
query ($id: Int) {{
  Media(idMal: $id, type: ANIME) {{
    ...Card
    streamingEpisodes {{ title }}
  }}
}}
{CARD_FRAGMENT}
"#
        );
        self.single_entry(&key, &query, mal_id, Some(mal_id), lists).await
    }

    /// Fallback details + episode list by AniList id for brand-new entries without an IMDb/MAL id yet.
    pub async fn anilist_entry(
        &self,
        anilist_id: u32,
        lists: &AnimeLists,
    ) -> Result<(AnimeItem, Vec<JikanEpisode>), String> {
        let key = format!("al_detail_{anilist_id}");
        let query = format!(
            r#"
query ($id: Int) {{
  Media(id: $id, type: ANIME) {{
    ...Card
    streamingEpisodes {{ title }}
  }}
}}
{CARD_FRAGMENT}
"#
        );
        self.single_entry(&key, &query, anilist_id, None, lists).await
    }

    async fn single_entry(
        &self,
        key: &str,
        query: &str,
        id: u32,
        fallback_mal: Option<u32>,
        lists: &AnimeLists,
    ) -> Result<(AnimeItem, Vec<JikanEpisode>), String> {
        let raw = self.cached_query(key, query, json!({ "id": id }), TTL_META).await?;
        let resp: RawSingleMediaResp = serde_json::from_value(raw).map_err(|e| format!("decode anime: {e}"))?;
        let media = resp.media.ok_or_else(|| format!("anime {key} not found"))?;
        let stream_eps = media.streaming_episodes.clone();
        let mapped = lookup_mapping(lists, media.card.id, media.card.id_mal.or(fallback_mal)).await;
        let item = raw_to_item(media.card, mapped.as_ref(), false);

        let episodes: Vec<JikanEpisode> = stream_eps
            .into_iter()
            .enumerate()
            .map(|(idx, e)| {
                let num = (idx + 1) as u32;
                let title = e.title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| format!("Episode {num}"));
                JikanEpisode { number: num, title, aired: None, filler: false, recap: false }
            })
            .collect();
        Ok((item, episodes))
    }

    async fn page_query(
        &self,
        cache_key: &str,
        query: &str,
        variables: serde_json::Value,
        ttl: Duration,
        lists: &AnimeLists,
        seasonal: bool,
    ) -> Result<AnimeBrowsePage, String> {
        let raw = self.cached_query(cache_key, query, variables, ttl).await?;
        let resp: RawPageResp = serde_json::from_value(raw).map_err(|e| format!("decode anime page: {e}"))?;
        let has_next_page = resp.page.page_info.has_next_page;
        let items = map_media_list(resp.page.media, lists, seasonal).await;
        Ok(AnimeBrowsePage { items, has_next_page })
    }

    async fn cached_query(
        &self,
        key: &str,
        query: &str,
        variables: serde_json::Value,
        ttl: Duration,
    ) -> Result<serde_json::Value, String> {
        let now = now_unix();
        // 1. Hot in-memory hit.
        if let Some((fetched, val)) = self.mem.lock().await.get(key).cloned() {
            if now.saturating_sub(fetched) < ttl.as_secs() {
                return Ok(val);
            }
        }
        // 2. Disk cache hit (also keep stale fallback in case upstream fails).
        let disk = self.read_disk(key).await;
        if let Some(blob) = &disk {
            if now.saturating_sub(blob.fetched_at) < ttl.as_secs() {
                self.mem.lock().await.insert(key.to_owned(), (blob.fetched_at, blob.data.clone()));
                return Ok(blob.data.clone());
            }
        }

        // 3. Singleflight coalescing so concurrent callers share one request.
        let cell = {
            let mut map = self.inflight.lock().await;
            map.entry(key.to_owned()).or_insert_with(|| Arc::new(OnceCell::new())).clone()
        };

        let result = cell
            .get_or_try_init(|| async {
                let val = self.post_anilist(query, &variables).await?;
                let ts = now_unix();
                self.mem.lock().await.insert(key.to_owned(), (ts, val.clone()));
                self.write_disk(key, ts, &val).await;
                Ok::<serde_json::Value, String>(val)
            })
            .await
            .cloned();

        // Remove completed cell so future refreshes after TTL can fetch again.
        self.inflight.lock().await.remove(key);

        match result {
            Ok(v) => Ok(v),
            Err(e) => {
                if let Some(stale) = disk {
                    tracing::warn!("anime catalog {key} failed ({e}); serving stale disk cache");
                    self.mem.lock().await.insert(key.to_owned(), (stale.fetched_at, stale.data.clone()));
                    Ok(stale.data)
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn post_anilist(&self, query: &str, variables: &serde_json::Value) -> Result<serde_json::Value, String> {
        let body = json!({ "query": query, "variables": variables });
        let mut attempt = 0u32;
        loop {
            // Polite pacing: space outbound requests so we stay comfortably inside AniList's budget.
            {
                let mut last = self.last_req.lock().await;
                if let Some(prev) = *last {
                    let elapsed = prev.elapsed();
                    if elapsed < self.pace {
                        tokio::time::sleep(self.pace - elapsed).await;
                    }
                }
                *last = Some(Instant::now());
            }
            attempt += 1;
            let res = self
                .http
                .post(&self.endpoint)
                .header("Accept", "application/json")
                .json(&body)
                .timeout(Duration::from_secs(12))
                .send()
                .await
                .map_err(|e| format!("anilist request failed: {e}"))?;
            let status = res.status().as_u16();
            let retry_after =
                res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<u64>().ok());
            if (status == 429 || status >= 500) && attempt < MAX_RETRIES {
                let wait_ms = retry_after.map(|s| s.min(10) * 1000).unwrap_or(1500 * u64::from(attempt));
                tokio::time::sleep(Duration::from_millis(wait_ms)).await;
                continue;
            }
            if !(200..300).contains(&status) {
                return Err(format!("anilist answered {status}"));
            }
            let envelope: serde_json::Value = res.json().await.map_err(|e| format!("anilist json failed: {e}"))?;
            if let Some(data) = envelope.get("data") {
                if !data.is_null() {
                    return Ok(data.clone());
                }
            }
            let msg = envelope
                .get("errors")
                .and_then(|e| e.as_array())
                .and_then(|arr| arr.first())
                .and_then(|err| err.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("empty response");
            return Err(format!("anilist error: {msg}"));
        }
    }

    fn cache_path(&self, key: &str) -> PathBuf {
        let safe: String =
            key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
        self.cache_dir.join(format!("{safe}.json"))
    }

    async fn read_disk(&self, key: &str) -> Option<CachedBlob> {
        let bytes = tokio::fs::read(self.cache_path(key)).await.ok()?;
        let blob: CachedBlob = serde_json::from_slice(&bytes).ok()?;
        (blob.version == CACHE_VERSION).then_some(blob)
    }

    async fn write_disk(&self, key: &str, fetched_at: u64, data: &serde_json::Value) {
        let path = self.cache_path(key);
        if let Some(parent) = path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let blob = CachedBlob { version: CACHE_VERSION, fetched_at, data: data.clone() };
        let Ok(bytes) = serde_json::to_vec(&blob) else { return };
        let tmp = path.with_extension("json.tmp");
        if tokio::fs::write(&tmp, &bytes).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, &path).await;
        }
    }
}

// --- AniList Wire Types & Mapping Helpers ----------------------------------

#[derive(Deserialize)]
struct RawHomeData {
    #[serde(default)]
    season: Option<RawMediaPage>,
    #[serde(default)]
    upcoming: Option<RawMediaPage>,
    #[serde(default)]
    trending: Option<RawMediaPage>,
    #[serde(default)]
    top: Option<RawMediaPage>,
    #[serde(default)]
    popular: Option<RawMediaPage>,
    #[serde(default)]
    movies: Option<RawMediaPage>,
}

#[derive(Deserialize)]
struct RawPageResp {
    #[serde(rename = "Page")]
    page: RawMediaPage,
}

#[derive(Default, Deserialize)]
struct RawMediaPage {
    #[serde(rename = "pageInfo", default)]
    page_info: RawPageInfo,
    #[serde(default)]
    media: Vec<RawMedia>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPageInfo {
    #[serde(default)]
    has_next_page: bool,
}

#[derive(Deserialize)]
struct RawScheduleResp {
    #[serde(rename = "Page")]
    page: RawSchedulePage,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSchedulePage {
    #[serde(default)]
    airing_schedules: Vec<RawAiringSlot>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAiringSlot {
    airing_at: u64,
    episode: u32,
    #[serde(default)]
    media: Option<RawMedia>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMedia {
    id: u32,
    #[serde(default)]
    id_mal: Option<u32>,
    #[serde(default)]
    title: RawTitle,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    episodes: Option<u32>,
    #[serde(default)]
    duration: Option<u32>,
    #[serde(default)]
    season_year: Option<u16>,
    #[serde(default)]
    average_score: Option<u32>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    genres: Vec<String>,
    #[serde(default)]
    is_adult: bool,
    #[serde(default)]
    start_date: Option<RawFuzzyDate>,
    #[serde(default)]
    cover_image: RawCoverImage,
    #[serde(default)]
    banner_image: Option<String>,
    #[serde(default)]
    next_airing_episode: Option<RawNextAiring>,
}

#[derive(Default, Deserialize)]
struct RawTitle {
    #[serde(default)]
    english: Option<String>,
    #[serde(default)]
    romaji: Option<String>,
    #[serde(default)]
    native: Option<String>,
}

#[derive(Default, Deserialize)]
struct RawFuzzyDate {
    #[serde(default)]
    year: Option<u16>,
    #[serde(default)]
    month: Option<u8>,
    #[serde(default)]
    day: Option<u8>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCoverImage {
    #[serde(default)]
    extra_large: Option<String>,
    #[serde(default)]
    large: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawNextAiring {
    airing_at: u64,
    episode: u32,
}

#[derive(Deserialize)]
struct RawCharactersResp {
    #[serde(rename = "Media")]
    media: Option<RawCharactersMedia>,
}

#[derive(Deserialize)]
struct RawRichDetailsResp {
    #[serde(rename = "Media")]
    media: Option<RawRichDetailsMedia>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRichDetailsMedia {
    id: u32,
    #[serde(default)]
    id_mal: Option<u32>,
    #[serde(default)]
    title: RawTitle,
    #[serde(default)]
    synonyms: Vec<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    episodes: Option<u32>,
    #[serde(default)]
    duration: Option<u32>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    season: Option<String>,
    #[serde(default)]
    season_year: Option<u16>,
    #[serde(default)]
    start_date: Option<RawFuzzyDate>,
    #[serde(default)]
    end_date: Option<RawFuzzyDate>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    average_score: Option<u32>,
    #[serde(default)]
    favourites: Option<u32>,
    #[serde(default)]
    studios: RawStudioConnection,
    #[serde(default)]
    rankings: Vec<RawRanking>,
    #[serde(default)]
    tags: Vec<RawTag>,
    #[serde(default)]
    external_links: Vec<RawExternalLink>,
    #[serde(default)]
    characters: RawCharacterConnection,
}

#[derive(Default, Deserialize)]
struct RawStudioConnection {
    #[serde(default)]
    edges: Vec<RawStudioEdge>,
}

#[derive(Deserialize)]
struct RawStudioEdge {
    node: RawStudioNode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawStudioNode {
    name: String,
    #[serde(default)]
    is_animation_studio: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRanking {
    rank: u32,
    #[serde(default)]
    context: String,
    #[serde(default)]
    all_time: bool,
    #[serde(default)]
    year: Option<u16>,
    #[serde(default)]
    season: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTag {
    name: String,
    #[serde(default)]
    rank: u32,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    is_media_spoiler: bool,
    #[serde(default)]
    is_general_spoiler: bool,
}

#[derive(Deserialize)]
struct RawExternalLink {
    site: String,
    url: String,
    #[serde(rename = "type", default)]
    ty: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

fn format_fuzzy_date(d: Option<&RawFuzzyDate>) -> Option<String> {
    let d = d?;
    let y = d.year?;
    match (d.month, d.day) {
        (Some(m), Some(day)) => Some(format!("{y:04}-{m:02}-{day:02}")),
        (Some(m), None) => Some(format!("{y:04}-{m:02}")),
        _ => Some(format!("{y:04}")),
    }
}

#[derive(Deserialize)]
struct RawCharactersMedia {
    #[serde(default)]
    characters: RawCharacterConnection,
}

#[derive(Default, Deserialize)]
struct RawCharacterConnection {
    #[serde(default)]
    edges: Vec<RawCharacterEdge>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCharacterEdge {
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    node: Option<RawCharacterNode>,
    #[serde(default)]
    voice_actors: Vec<RawVoiceActor>,
    #[serde(default)]
    voice_actors_en: Vec<RawVoiceActor>,
}

#[derive(Deserialize)]
struct RawCharacterNode {
    id: u32,
    #[serde(default)]
    name: RawPersonName,
    #[serde(default)]
    image: RawPersonImage,
}

#[derive(Deserialize)]
struct RawVoiceActor {
    id: u32,
    #[serde(default)]
    name: RawPersonName,
    #[serde(default)]
    image: RawPersonImage,
}

#[derive(Default, Deserialize)]
struct RawPersonName {
    #[serde(default)]
    full: Option<String>,
}

#[derive(Default, Deserialize)]
struct RawPersonImage {
    #[serde(default)]
    large: Option<String>,
    #[serde(default)]
    medium: Option<String>,
}

#[derive(Deserialize)]
struct RawSingleMediaResp {
    #[serde(rename = "Media")]
    media: Option<RawSingleMedia>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSingleMedia {
    #[serde(flatten)]
    card: RawMedia,
    #[serde(default)]
    streaming_episodes: Vec<RawStreamingEpisode>,
}

#[derive(Clone, Deserialize)]
struct RawStreamingEpisode {
    #[serde(default)]
    title: Option<String>,
}

async fn lookup_mapping(lists: &AnimeLists, anilist_id: u32, mal_id: Option<u32>) -> Option<AnimeMapping> {
    if let Some(m) = lists.find(&AnimeKey::Anilist(anilist_id)).await {
        return Some(m);
    }
    if let Some(mal) = mal_id {
        return lists.find(&AnimeKey::Mal(mal)).await;
    }
    None
}

async fn map_media_list(list: Vec<RawMedia>, lists: &AnimeLists, seasonal: bool) -> Vec<AnimeItem> {
    let mut items = Vec::with_capacity(list.len());
    let mut seen = HashSet::new();
    for entry in list {
        if entry.is_adult {
            continue;
        }
        let mapped = lookup_mapping(lists, entry.id, entry.id_mal).await;
        let item = raw_to_item(entry, mapped.as_ref(), seasonal);
        if seen.insert(item.id.clone()) {
            items.push(item);
        }
    }
    items
}

fn raw_to_item(a: RawMedia, mapped: Option<&AnimeMapping>, seasonal: bool) -> AnimeItem {
    let is_movie = a.format.as_deref().is_some_and(|f| f.eq_ignore_ascii_case("MOVIE"));
    let ty = if is_movie { "movie" } else { "series" }.to_owned();
    let imdb = mapped.and_then(|m| m.imdb_id.clone()).filter(|s| s.starts_with("tt"));
    let kitsu = mapped.and_then(|m| m.kitsu_id);
    let mal = a.id_mal.or_else(|| mapped.and_then(|m| m.mal_id));
    let tmdb = mapped.and_then(|m| m.themoviedb_id);

    let id = imdb
        .clone()
        .or_else(|| kitsu.map(|k| format!("kitsu:{k}")))
        .or_else(|| mal.map(|m| format!("mal:{m}")))
        .unwrap_or_else(|| format!("anilist:{}", a.id));

    let poster = a.cover_image.extra_large.or(a.cover_image.large);
    // Deterministic metahub fanart & logo when an IMDb id is known; fall back to AniList's
    // widescreen bannerImage for unmapped shows. TMDB hydration upgrades both when a key is set.
    let background =
        imdb.as_deref().map(|tt| format!("https://images.metahub.space/background/large/{tt}/img")).or(a.banner_image);
    let logo = imdb.as_deref().map(|tt| format!("https://images.metahub.space/logo/medium/{tt}/img"));
    let logos = logo.clone().into_iter().collect();

    let start_date = a.start_date.as_ref().and_then(|d| {
        let y = d.year?;
        match (d.month, d.day) {
            (Some(m), Some(day)) => Some(format!("{y:04}-{m:02}-{day:02}")),
            (Some(m), None) => Some(format!("{y:04}-{m:02}-01")),
            _ => Some(format!("{y:04}-01-01")),
        }
    });
    let year = a.season_year.or_else(|| a.start_date.as_ref().and_then(|d| d.year));
    let score = a.average_score.filter(|&s| s > 0).map(|s| (s as f32) / 10.0);

    let mature =
        a.is_adult || a.genres.iter().any(|g| g.eq_ignore_ascii_case("Ecchi") || g.eq_ignore_ascii_case("Hentai"));

    let english = a.title.english.filter(|s| !s.trim().is_empty());
    let romaji = a.title.romaji.filter(|s| !s.trim().is_empty());
    let native = a.title.native.filter(|s| !s.trim().is_empty());
    let name = english.clone().or_else(|| romaji.clone()).or_else(|| native.clone()).unwrap_or_default();

    let mapped_season = mapped.and_then(|m| m.season).and_then(|s| s.tmdb.or(s.tvdb));
    let parsed_season = parse_season_number(english.as_deref()).or_else(|| parse_season_number(romaji.as_deref()));
    let season_num = mapped_season.or(parsed_season);
    // On seasonal/schedule shelves, carry season_hint so clicking opens directly to that airing season.
    let season_hint = if seasonal && !is_movie { season_num.or(Some(1)) } else { None };
    let season_label =
        if seasonal && !is_movie { season_num.filter(|&n| n > 1).map(|n| format!("Season {n}")) } else { None };

    let airing =
        a.next_airing_episode.map(|n| AnimeAiring { airing_at: n.airing_at, label: None, episode: Some(n.episode) });

    let description = a.description.map(|s| strip_html(&s)).filter(|s| !s.is_empty());

    AnimeItem {
        id,
        ty,
        name,
        titles: AnimeTitle { english, romaji, native },
        poster,
        background,
        logo,
        logos,
        description,
        year,
        score,
        genres: a.genres,
        format: a.format,
        status: a.status,
        episodes: a.episodes,
        duration: a.duration,
        certification: None,
        season_hint,
        season_label,
        airing,
        mal_id: mal,
        anilist_id: Some(a.id),
        kitsu_id: kitsu,
        tmdb_id: tmdb,
        start_date,
        mature,
    }
}

/// Strips simple HTML tags & collapses blank lines in AniList descriptions.
fn strip_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#039;", "'")
        .replace("&apos;", "'")
        .trim()
        .to_owned()
}

/// Howard Hinnant's civil-from-days algorithm (UTC) returning `(year, month 1..=12, day 1..=31)`.
fn utc_ymd(unix_secs: u64) -> (i32, u32, u32) {
    let z = (unix_secs / 86_400) as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + i64::from(m <= 2)) as i32;
    (year, m as u32, d as u32)
}

pub fn current_anime_season(unix_secs: u64) -> (&'static str, i32) {
    let (year, month, _) = utc_ymd(unix_secs);
    let season = match month {
        1..=3 => "WINTER",
        4..=6 => "SPRING",
        7..=9 => "SUMMER",
        _ => "FALL",
    };
    (season, year)
}

pub fn next_anime_season(season: &str, year: i32) -> (&'static str, i32) {
    match season {
        "WINTER" => ("SPRING", year),
        "SPRING" => ("SUMMER", year),
        "SUMMER" => ("FALL", year),
        _ => ("WINTER", year + 1),
    }
}

/// Returns `[start_utc, end_utc)` for the current or upcoming occurrence of `target_wd` (`0 = Sun .. 6 = Sat`).
fn weekday_utc_window(now_utc: u64, target_wd: u32) -> (u64, u64) {
    const DAY: u64 = 86_400;
    let today_days = now_utc / DAY;
    // 1970-01-01 was Thursday (4 where 0=Sun..6=Sat).
    let cur_wd = ((today_days + 4) % 7) as u32;
    let delta = u64::from((target_wd + 7 - cur_wd) % 7);
    let start = (today_days + delta) * DAY;
    (start, start + DAY)
}

fn parse_weekday(day: &str) -> Option<u32> {
    match day.trim().to_ascii_lowercase().trim_end_matches('s') {
        "sunday" | "sun" => Some(0),
        "monday" | "mon" => Some(1),
        "tuesday" | "tue" => Some(2),
        "wednesday" | "wed" => Some(3),
        "thursday" | "thu" => Some(4),
        "friday" | "fri" => Some(5),
        "saturday" | "sat" => Some(6),
        _ => None,
    }
}

/// Extracts an explicit season number from a title like `"Re:Zero Season 4"` or `"Black Clover 2nd Season"`.
pub fn parse_season_number(title: Option<&str>) -> Option<u32> {
    let t = title?.to_ascii_lowercase();
    let tokens: Vec<&str> = t.split(|c: char| !c.is_ascii_alphanumeric()).filter(|s| !s.is_empty()).collect();
    for w in tokens.windows(2) {
        if w[0] == "season" {
            if let Ok(n) = w[1].parse::<u32>() {
                if (1..=30).contains(&n) {
                    return Some(n);
                }
            }
        }
        if w[1] == "season" {
            let num = w[0].trim_end_matches("st").trim_end_matches("nd").trim_end_matches("rd").trim_end_matches("th");
            if let Ok(n) = num.parse::<u32>() {
                if (1..=30).contains(&n) {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn anilist_season(s: &str) -> Option<&'static str> {
    Some(match s.trim().to_ascii_uppercase().as_str() {
        "WINTER" => "WINTER",
        "SPRING" => "SPRING",
        "SUMMER" => "SUMMER",
        "FALL" | "AUTUMN" => "FALL",
        _ => return None,
    })
}

fn anilist_format(fmt: &str) -> Option<&'static str> {
    Some(match fmt.trim().to_ascii_uppercase().as_str() {
        "TV" => "TV",
        "TV_SHORT" => "TV_SHORT",
        "MOVIE" => "MOVIE",
        "ONA" => "ONA",
        "OVA" => "OVA",
        "SPECIAL" => "SPECIAL",
        _ => return None,
    })
}

fn anilist_status(st: &str) -> Option<&'static str> {
    Some(match st.trim().to_ascii_uppercase().as_str() {
        "RELEASING" => "RELEASING",
        "FINISHED" => "FINISHED",
        "NOT_YET_RELEASED" => "NOT_YET_RELEASED",
        "HIATUS" => "HIATUS",
        "CANCELLED" => "CANCELLED",
        _ => return None,
    })
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn season_calendar_math() {
        // 2026-11-25 12:00:00 UTC -> Fall 2026, next Winter 2027.
        assert_eq!(current_anime_season(1_795_608_000), ("FALL", 2026));
        assert_eq!(next_anime_season("FALL", 2026), ("WINTER", 2027));
        assert_eq!(next_anime_season("WINTER", 2027), ("SPRING", 2027));
    }

    #[test]
    fn parses_seasons_and_strips_html() {
        assert_eq!(parse_season_number(Some("Re:Zero Season 4")), Some(4));
        assert_eq!(parse_season_number(Some("Black Clover 2nd Season")), Some(2));
        assert_eq!(parse_season_number(Some("Sousou no Frieren")), None);
        assert_eq!(strip_html("<i>Hello</i> &amp; <b>world</b><br>"), "Hello & world");
    }

    #[tokio::test]
    async fn home_batch_dedupes_by_canonical_id_and_caches_on_disk() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let body = r#"{
            "data": {
                "season": {
                    "media": [
                        {
                            "id": 20623,
                            "idMal": 28171,
                            "title": { "english": "Food Wars!", "romaji": "Shokugeki no Souma", "native": "食戟のソーマ" },
                            "format": "TV",
                            "status": "RELEASING",
                            "episodes": 24,
                            "duration": 24,
                            "seasonYear": 2015,
                            "averageScore": 82,
                            "genres": ["Action"],
                            "isAdult": false,
                            "coverImage": { "extraLarge": "https://img.example.com/s1.jpg" },
                            "nextAiringEpisode": { "airingAt": 1795650000, "episode": 4 }
                        },
                        {
                            "id": 21087,
                            "idMal": 31240,
                            "title": { "english": "Food Wars! Season 2", "romaji": "Shokugeki no Souma: Ni no Sara" },
                            "format": "TV",
                            "status": "RELEASING",
                            "episodes": 13,
                            "duration": 24,
                            "seasonYear": 2016,
                            "averageScore": 83,
                            "genres": ["Action"],
                            "isAdult": false,
                            "coverImage": { "extraLarge": "https://img.example.com/s2.jpg" }
                        }
                    ]
                },
                "upcoming": { "media": [] },
                "trending": { "media": [] },
                "top": { "media": [] },
                "popular": { "media": [] },
                "movies": { "media": [] }
            }
        }"#;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut buf = vec![0; 4096];
                let _ = sock.read(&mut buf).await;
                let res = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(res.as_bytes()).await;
            }
        });

        let dir = std::env::temp_dir().join(format!("polar-anime-catalog-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Seed local Fribb file so the test never hits the network and verifies show-level deduplication.
        std::fs::write(
            dir.join("anime-list-mini.json"),
            r#"[
                {"type":"TV","anilist_id":20623,"mal_id":28171,"imdb_id":["tt0000109"],"themoviedb_id":{"tv":65844},"season":{"tmdb":1}},
                {"type":"TV","anilist_id":21087,"mal_id":31240,"imdb_id":["tt0000109"],"themoviedb_id":{"tv":65844},"season":{"tmdb":2}},
                {"type":"TV","anilist_id":99999,"mal_id":55555,"kitsu_id":7777,"season":{"tmdb":3}}
            ]"#,
        )
        .unwrap();
        let http = reqwest::Client::new();
        let lists = AnimeLists::with_client(dir.clone(), http.clone());
        let catalog = AnimeCatalog::with_endpoint(dir.clone(), http.clone(), &endpoint, Duration::ZERO);

        let home1 = catalog.home(&lists, true).await.unwrap();
        // Both AniList entries share tt0000109, so they collapse into a single show-grouped card!
        assert_eq!(home1.season.len(), 1);
        assert_eq!(home1.season[0].id, "tt0000109");
        assert_eq!(home1.season[0].tmdb_id, Some(65844));
        assert_eq!(home1.season[0].season_hint, Some(1));
        assert_eq!(home1.season[0].score, Some(8.2));
        assert!(home1.season[0].background.as_deref().unwrap().contains("tt0000109"));
        assert_eq!(home1.season[0].airing.as_ref().and_then(|a| a.episode), Some(4));
        assert_eq!(hits.load(Ordering::SeqCst), 1);

        // Fresh instance hits disk cache without calling upstream again.
        let catalog2 = AnimeCatalog::with_endpoint(dir.clone(), http, &endpoint, Duration::ZERO);
        let home2 = catalog2.home(&lists, true).await.unwrap();
        assert_eq!(home2.season.len(), 1);
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert!(catalog2.size().await > 0);
        catalog2.clear().await;
        assert_eq!(catalog2.size().await, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
