//! A show's IMDb rating for each episode, for the Episode Ratings chart. TMDB's per-episode scores are
//! few and run low, so the chart asks IMDb (the keyless GraphQL API in `imdb.rs`) and keeps TMDB's only for a
//! show IMDb has nothing for. "Nothing known" is an empty list, never an error.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::locks::Locked;

/// Episode ratings move slowly; half a day keeps reopening a show free.
const TTL: Duration = Duration::from_secs(12 * 60 * 60);
/// Episodes per request: IMDb's largest page.
const PAGE: u32 = 250;
/// Pages at most (1,250 episodes): enough for all but a handful of daily shows.
const MAX_PAGES: usize = 5;

const QUERY: &str = "query($id: ID!, $first: Int!, $after: ID) {
  title(id: $id) {
    episodes {
      episodes(first: $first, after: $after) {
        edges { node { series { episodeNumber { seasonNumber episodeNumber } } ratingsSummary { aggregateRating voteCount } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EpisodeRating {
    pub season: u32,
    pub episode: u32,
    /// Out of 10.
    pub rating: f64,
    /// How many people rated it, when IMDb says.
    pub votes: Option<u64>,
}

#[derive(Deserialize)]
struct Title {
    episodes: Option<Episodes>,
}
#[derive(Deserialize)]
struct Episodes {
    episodes: Connection,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    edges: Vec<Edge>,
    page_info: PageInfo,
}
#[derive(Deserialize)]
struct Edge {
    node: Node,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    series: Option<Series>,
    ratings_summary: Option<Summary>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Series {
    episode_number: Option<Number>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Number {
    season_number: Option<u32>,
    episode_number: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    aggregate_rating: Option<f64>,
    vote_count: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

/// Every rated episode of the show `imdb_id`, specials (season 0) left out. Cached for [`TTL`]; a failed
/// lookup isn't cached, so the next visit asks again.
pub async fn get(imdb_id: &str) -> Vec<EpisodeRating> {
    /// Each show's episodes, and when they were fetched.
    type Cache = Mutex<HashMap<String, (Instant, Vec<EpisodeRating>)>>;
    static CACHE: OnceLock<Cache> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some((at, hit)) = cache.locked().get(imdb_id) {
        if at.elapsed() < TTL {
            return hit.clone();
        }
    }
    let mut out = Vec::new();
    let mut after: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut vars = serde_json::Map::new();
        vars.insert("first".into(), json!(PAGE));
        vars.insert("after".into(), json!(after));
        let Some(title) = crate::imdb::title_with::<Title>(QUERY, imdb_id, vars).await else {
            // The first page failing is "don't know"; a later one keeps what came in.
            if out.is_empty() {
                return out;
            }
            break;
        };
        let Some(Episodes { episodes: page }) = title.episodes else { break };
        out.extend(page.edges.into_iter().filter_map(|e| rated(e.node)));
        match page.page_info.end_cursor {
            Some(cursor) if page.page_info.has_next_page => after = Some(cursor),
            _ => break,
        }
    }
    let mut map = cache.locked();
    if map.len() >= 512 {
        map.retain(|_, (at, _)| at.elapsed() < TTL);
        if map.len() >= 512 {
            if let Some(oldest) = map.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone()) {
                map.remove(&oldest);
            }
        }
    }
    map.insert(imdb_id.to_owned(), (Instant::now(), out.clone()));
    out
}

fn rated(node: Node) -> Option<EpisodeRating> {
    let n = node.series?.episode_number?;
    let summary = node.ratings_summary?;
    let rating = summary.aggregate_rating.filter(|r| *r > 0.0 && *r <= 10.0)?;
    Some(EpisodeRating {
        season: n.season_number.filter(|s| *s > 0)?,
        episode: n.episode_number?,
        rating,
        votes: summary.vote_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(v: serde_json::Value) -> Node {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn keeps_rated_numbered_episodes_only() {
        let ep = |s: u32, e: u32, r: serde_json::Value| {
            node(
                json!({ "series": { "episodeNumber": { "seasonNumber": s, "episodeNumber": e } }, "ratingsSummary": { "aggregateRating": r, "voteCount": 12 } }),
            )
        };
        assert_eq!(
            rated(ep(1, 2, json!(8.6))),
            Some(EpisodeRating { season: 1, episode: 2, rating: 8.6, votes: Some(12) })
        );
        assert_eq!(rated(ep(1, 3, json!(null))), None, "unrated");
        assert_eq!(rated(ep(0, 1, json!(7.0))), None, "a special");
        assert_eq!(rated(node(json!({ "series": null, "ratingsSummary": { "aggregateRating": 7.0 } }))), None);
    }
}
