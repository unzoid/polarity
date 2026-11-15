//! TMDB's episode groups: other orders a show can be watched in (DVD, absolute, story arcs…),
//! read from `/tv/{id}/episode_groups` and `/tv/episode_group/{id}`.

use serde::Deserialize;

use super::Tmdb;
use crate::episode_order::{EpisodeOrderInfo, OrderEntry, RawOrder};
use crate::{IndexError, Result};

#[derive(Deserialize)]
struct Listed {
    #[serde(default)]
    results: Vec<ListedOrder>,
}

#[derive(Deserialize)]
struct ListedOrder {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "type", default)]
    kind: u8,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    episode_count: u32,
    #[serde(default)]
    group_count: u32,
}

#[derive(Deserialize)]
struct Group {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "type", default)]
    kind: u8,
    #[serde(default)]
    groups: Vec<Part>,
}

#[derive(Deserialize)]
struct Part {
    #[serde(default)]
    name: String,
    #[serde(default)]
    order: u32,
    #[serde(default)]
    episodes: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    season_number: Option<u32>,
    episode_number: Option<u32>,
    #[serde(default)]
    air_date: Option<String>,
    #[serde(default)]
    order: u32,
}

/// TMDB's episode group types, as the app names them.
pub(crate) fn kind_name(kind: u8) -> &'static str {
    match kind {
        1 => "original",
        2 => "absolute",
        3 => "dvd",
        4 => "digital",
        5 => "storyArc",
        6 => "production",
        7 => "tv",
        _ => "other",
    }
}

/// TMDB's episode group ids are short hex strings; anything else never reaches a URL.
pub(crate) fn valid_group_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

impl Tmdb {
    /// The orders TMDB lists for the show with IMDb id `imdb_id`; empty groups are left out.
    pub async fn episode_groups(&self, imdb_id: &str) -> Result<Vec<EpisodeOrderInfo>> {
        let tmdb_id = self.find("series", imdb_id).await?;
        let listed: Listed = self.get(&format!("/tv/{tmdb_id}/episode_groups"), &[]).await?;
        Ok(listed
            .results
            .into_iter()
            .filter(|o| o.episode_count > 0 && valid_group_id(&o.id))
            .map(|o| EpisodeOrderInfo {
                id: o.id,
                name: o.name,
                kind: kind_name(o.kind).into(),
                description: o.description.filter(|d| !d.trim().is_empty()),
                episode_count: o.episode_count,
                group_count: o.group_count,
            })
            .collect())
    }

    /// One order: its groups in their order, each group's episodes in theirs, under TMDB's
    /// aired season and episode numbers.
    pub async fn episode_group(&self, group_id: &str) -> Result<RawOrder> {
        if !valid_group_id(group_id) {
            return Err(IndexError::NotFound);
        }
        let g: Group = self.get(&format!("/tv/episode_group/{group_id}"), &[]).await?;
        let mut parts = g.groups;
        parts.sort_by_key(|p| p.order);
        let groups = parts
            .into_iter()
            .map(|mut p| {
                p.episodes.sort_by_key(|e| e.order);
                let entries = p
                    .episodes
                    .into_iter()
                    .filter_map(|e| {
                        Some(OrderEntry {
                            season: e.season_number?,
                            episode: e.episode_number?,
                            released: e.air_date.filter(|d| !d.is_empty()),
                        })
                    })
                    .collect();
                (p.name, entries)
            })
            .collect();
        Ok(RawOrder { id: g.id, name: g.name, kind: kind_name(g.kind).into(), groups })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A stand-in for TMDB: show tt0000001 is TMDB's 1, with a DVD order of two discs (listed out of
    /// order) and an empty order.
    async fn fake_tmdb() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = vec![0; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]);
                    let target = head.split_whitespace().nth(1).unwrap_or("").to_owned();
                    let path = target.split_once('?').map_or(target.as_str(), |(p, _)| p);
                    let (status, body) = match path {
                        "/find/tt0000001" => ("200 OK", json!({ "tv_results": [{ "id": 1 }] })),
                        "/tv/1/episode_groups" => (
                            "200 OK",
                            json!({ "results": [
                                { "id": "aa01", "name": "DVD Order", "type": 3, "description": "", "episode_count": 3, "group_count": 2 },
                                { "id": "aa02", "name": "Empty", "type": 5, "episode_count": 0, "group_count": 0 },
                            ] }),
                        ),
                        "/tv/episode_group/aa01" => (
                            "200 OK",
                            json!({ "id": "aa01", "name": "DVD Order", "type": 3, "groups": [
                                { "name": "Disc 2", "order": 2, "episodes": [
                                    { "season_number": 1, "episode_number": 1, "air_date": "2020-01-01", "order": 0 },
                                ] },
                                { "name": "Disc 1", "order": 1, "episodes": [
                                    { "season_number": 1, "episode_number": 3, "air_date": "2020-01-15", "order": 1 },
                                    { "season_number": 0, "episode_number": 1, "air_date": "", "order": 0 },
                                ] },
                            ] }),
                        ),
                        _ => ("404 Not Found", json!({})),
                    };
                    let body = body.to_string();
                    let answer = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(answer.as_bytes()).await;
                });
            }
        });
        base
    }

    fn local(api: String) -> Tmdb {
        Tmdb { api, ..Tmdb::new("0123456789abcdef0123456789abcdef".into(), None) }
    }

    #[tokio::test]
    async fn lists_a_shows_orders_and_reads_one_in_order() {
        let tmdb = local(fake_tmdb().await);
        let listed = tmdb.episode_groups("tt0000001").await.unwrap();
        assert_eq!(listed.len(), 1, "an order with no episodes is left out");
        assert_eq!((listed[0].name.as_str(), listed[0].kind.as_str()), ("DVD Order", "dvd"));
        assert_eq!((listed[0].episode_count, listed[0].group_count, listed[0].description.clone()), (3, 2, None));

        let order = tmdb.episode_group("aa01").await.unwrap();
        // Each group's name and its episodes as (season, episode, released).
        type Episodes<'a> = Vec<(u32, u32, Option<&'a str>)>;
        let shape: Vec<(&str, Episodes)> = order
            .groups
            .iter()
            .map(|(name, e)| (name.as_str(), e.iter().map(|e| (e.season, e.episode, e.released.as_deref())).collect()))
            .collect();
        assert_eq!(
            shape,
            [("Disc 1", vec![(0, 1, None), (1, 3, Some("2020-01-15"))]), ("Disc 2", vec![(1, 1, Some("2020-01-01"))])]
        );
        assert!(matches!(tmdb.episode_group("../movie/1").await, Err(IndexError::NotFound)));
    }

    #[test]
    fn group_ids_are_checked_before_a_url() {
        assert!(valid_group_id("5acf93e60e0a26346d0000ce"));
        assert!(!valid_group_id("../movie/1"));
        assert!(!valid_group_id(""));
        assert_eq!(kind_name(5), "storyArc");
        assert_eq!(kind_name(42), "other");
    }
}
