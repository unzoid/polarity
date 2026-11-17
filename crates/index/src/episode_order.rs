//! Other orders to watch a show in (DVD, absolute, story arcs…), from TMDB's episode groups.
//!
//! An order names episodes by TMDB's aired season and episode. The index lists a show's
//! episodes under IMDb's numbering ([`polar_addon::numbering`]), and sources, progress and
//! downloads go by those ids, so each episode of an order is found in that list by the same
//! rules (air date first, then numbers) and handed over as its id there. Episodes an order
//! names that the list doesn't have are left out; the app adds the ones an order leaves out
//! (src/lib/library/episodeOrder.ts), so none becomes unreachable.

use std::collections::HashMap;
use std::time::Duration;

use polar_addon::{numbering, Video};
use serde::Serialize;

use crate::cache::TtlCache;
use crate::{Backend, IndexError, Indexer, Result};

/// One order TMDB lists for a show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeOrderInfo {
    /// TMDB's episode group id.
    pub id: String,
    pub name: String,
    /// original, absolute, dvd, digital, storyArc, production, tv or other.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub episode_count: u32,
    pub group_count: u32,
}

/// An order with its episodes as ids of the show's episode list (`tt…:season:episode`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeOrder {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub groups: Vec<EpisodeOrderGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeOrderGroup {
    pub name: String,
    /// In the order's order; an id may repeat when the order repeats an episode.
    pub episodes: Vec<String>,
}

/// One episode of an order, by TMDB's aired numbers.
#[derive(Debug, Clone)]
pub struct OrderEntry {
    pub season: u32,
    pub episode: u32,
    pub released: Option<String>,
}

/// An order as TMDB has it: groups (name, entries) in order.
#[derive(Debug, Clone)]
pub struct RawOrder {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub groups: Vec<(String, Vec<OrderEntry>)>,
}

/// Orders listed and read, kept as long as the episode lists they map onto.
pub(crate) struct Cache {
    lists: TtlCache<String, Vec<EpisodeOrderInfo>>,
    orders: TtlCache<String, EpisodeOrder>,
}

impl Cache {
    pub(crate) fn new() -> Self {
        Self {
            lists: TtlCache::new(Duration::from_secs(6 * 60 * 60), 512),
            orders: TtlCache::new(Duration::from_secs(6 * 60 * 60), 256),
        }
    }
}

impl Indexer {
    /// The orders TMDB lists for a show besides its aired one. Empty without a TMDB key.
    pub async fn episode_orders(&self, imdb_id: &str) -> Result<Vec<EpisodeOrderInfo>> {
        if !imdb_id.starts_with("tt") {
            return Err(IndexError::UnsupportedId(imdb_id.into()));
        }
        let Backend::Tmdb(t) = &self.backend else { return Ok(Vec::new()) };
        if let Some(hit) = self.orders.lists.get(&imdb_id.to_owned()) {
            return Ok(hit);
        }
        let list = match t.episode_groups(imdb_id).await {
            Err(IndexError::NotFound) => Vec::new(),
            found => found?,
        };
        self.orders.lists.insert(imdb_id.to_owned(), list.clone());
        Ok(list)
    }

    /// Order `group_id` of the show `imdb_id`, its episodes as ids of the show's episode list.
    pub async fn episode_order(&self, imdb_id: &str, group_id: &str) -> Result<EpisodeOrder> {
        if !imdb_id.starts_with("tt") {
            return Err(IndexError::UnsupportedId(imdb_id.into()));
        }
        let Backend::Tmdb(t) = &self.backend else { return Err(IndexError::NotFound) };
        let key = format!("{imdb_id}/{group_id}");
        if let Some(hit) = self.orders.orders.get(&key) {
            return Ok(hit);
        }
        let (raw, meta) = futures::join!(t.episode_group(group_id), self.meta("series", imdb_id));
        let order = map_order(raw?, &meta?.videos);
        self.orders.orders.insert(key, order.clone());
        Ok(order)
    }
}

/// `raw`'s episodes found in `aired` (the show's episode list), by the rules the list itself
/// was renumbered by. An entry nothing matches is left out, and so is a group left empty.
pub fn map_order(raw: RawOrder, aired: &[Video]) -> EpisodeOrder {
    // Each distinct episode once, in aired order, so episodes sharing a day pair up in order.
    let mut distinct: Vec<&OrderEntry> = Vec::new();
    for (_, entries) in &raw.groups {
        for e in entries {
            if !distinct.iter().any(|d| (d.season, d.episode) == (e.season, e.episode)) {
                distinct.push(e);
            }
        }
    }
    distinct.sort_by_key(|e| (e.season, e.episode));
    let probes: Vec<Video> = distinct
        .iter()
        .map(|e| Video {
            id: format!("order:{}:{}", e.season, e.episode),
            title: String::new(),
            season: e.season,
            episode: e.episode,
            released: e.released.clone(),
            thumbnail: None,
            overview: None,
            rating: None,
        })
        .collect();
    let found: HashMap<(u32, u32), &str> = distinct
        .iter()
        .zip(numbering::matches(&probes, aired))
        .filter_map(|(e, i)| Some(((e.season, e.episode), aired[i?].id.as_str())))
        .collect();

    let groups = raw
        .groups
        .into_iter()
        .map(|(name, entries)| EpisodeOrderGroup {
            name,
            episodes: entries
                .iter()
                .filter_map(|e| found.get(&(e.season, e.episode)).map(|id| (*id).to_owned()))
                .collect(),
        })
        .filter(|g| !g.episodes.is_empty())
        .collect();
    EpisodeOrder { id: raw.id, name: raw.name, kind: raw.kind, groups }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aired(season: u32, episode: u32, released: &str) -> Video {
        Video {
            id: format!("tt0000001:{season}:{episode}"),
            title: format!("E{season}x{episode}"),
            season,
            episode,
            released: Some(released.into()),
            thumbnail: None,
            overview: None,
            rating: None,
        }
    }

    fn entry(season: u32, episode: u32, released: Option<&str>) -> OrderEntry {
        OrderEntry { season, episode, released: released.map(Into::into) }
    }

    fn raw(groups: Vec<(&str, Vec<OrderEntry>)>) -> RawOrder {
        RawOrder {
            id: "0000000000000000000000aa".into(),
            name: "DVD Order".into(),
            kind: "dvd".into(),
            groups: groups.into_iter().map(|(n, e)| (n.into(), e)).collect(),
        }
    }

    fn ids(order: &EpisodeOrder) -> Vec<(&str, Vec<&str>)> {
        order.groups.iter().map(|g| (g.name.as_str(), g.episodes.iter().map(String::as_str).collect())).collect()
    }

    #[test]
    fn maps_entries_to_aired_ids_in_the_orders_order() {
        let list = vec![
            aired(0, 1, "2019-12-01"),
            aired(1, 1, "2020-01-01"),
            aired(1, 2, "2020-01-08"),
            aired(1, 3, "2020-01-15"),
        ];
        let order = map_order(
            raw(vec![
                ("Disc 1", vec![entry(1, 2, Some("2020-01-08")), entry(1, 1, Some("2020-01-01"))]),
                // A special placed between episodes, a repeat, and one the list doesn't have.
                ("Disc 2", vec![entry(0, 1, Some("2019-12-01")), entry(1, 1, None), entry(5, 9, Some("2031-01-01"))]),
                ("Disc 3", vec![entry(7, 7, Some("2032-01-01"))]),
            ]),
            &list,
        );
        assert_eq!(
            ids(&order),
            [("Disc 1", vec!["tt0000001:1:2", "tt0000001:1:1"]), ("Disc 2", vec!["tt0000001:0:1", "tt0000001:1:1"]),]
        );
        // 1x3 isn't in the order: the app lists it after the order's groups.
    }

    #[test]
    fn follows_the_lists_imdb_numbering_by_air_date() {
        // TMDB: two seasons of one; the list (IMDb's numbering): one season of two.
        let list = vec![aired(1, 1, "2020-01-01"), aired(1, 2, "2020-07-02")];
        let order = map_order(
            raw(vec![("Story", vec![entry(2, 1, Some("2020-07-01")), entry(1, 1, Some("2020-01-01"))])]),
            &list,
        );
        assert_eq!(ids(&order), [("Story", vec!["tt0000001:1:2", "tt0000001:1:1"])]);
    }

    #[tokio::test]
    async fn without_tmdb_there_are_no_orders() {
        let ix = Indexer::new(crate::IndexConfig::default());
        assert!(ix.episode_orders("tt0000001").await.unwrap().is_empty());
        assert!(matches!(ix.episode_order("tt0000001", "aa").await, Err(IndexError::NotFound)));
        assert!(matches!(ix.episode_orders("kitsu:1").await, Err(IndexError::UnsupportedId(_))));
    }
}
