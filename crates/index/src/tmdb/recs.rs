//! "More like this" from TMDB. TMDB's own recommendations are good at the top and noisy below,
//! and miss what shares a subject but isn't watched by the same people, so candidates come from
//! several lists at once, all cached:
//!
//! - the seed's recommendations (two pages),
//! - the most voted-on titles carrying each of the seed's keywords (whose totals also say how
//!   specific each keyword is),
//! - its creators' (directors') other work,
//! - its franchise: its film collection, and titles named after it ("Some Show: Origins").
//!
//! The best of them by what the lists told are looked at closer (one details request each, which
//! also gives the IMDb id and logos a card needs), then ranked by [`crate::similar`].

use std::collections::HashMap;
use std::sync::Arc;

use futures::stream::{self, StreamExt, TryStreamExt};
use polar_addon::MetaPreview;
use serde::Deserialize;
use serde_json::Value;

use super::{lookup_append, pick_certification, str_of, tmdb_kind, Item, Lookup, Paged, Tmdb, IN_FLIGHT};
use crate::similar::{self, Candidate, Evidence, Features, KeywordWeights, Scored};
use crate::{IndexError, Result};

/// Pages of TMDB's recommendations read.
const REC_PAGES: [u32; 2] = [1, 2];
/// Seed keywords whose lists are read; the rest still count when comparing.
const MAX_KEYWORDS: usize = 24;
/// A keyword carried by more titles than this is too broad to find candidates by.
const BROAD: u32 = 800;
/// Creators (a film's directors and writers) whose other work is read.
const MAX_CREATORS: usize = 3;
/// Titles a creator produced but didn't create that are kept, most voted on first.
const PRODUCED: usize = 6;
/// Candidates looked at closer, plus those named like the seed.
const SHORTLIST: usize = 40;
const NAMED: usize = 6;
/// Titles in the row.
const KEEP: usize = 30;
/// About how many titles of each kind TMDB has worth counting; sets how a keyword carried by
/// `n` of them weighs (`KeywordWeights`).
const TV_TITLES: f64 = 3_000.0;
const FILM_TITLES: f64 = 15_000.0;
/// Titles with fewer votes don't count towards a keyword's total, nor come from its list.
const KEYWORD_MIN_VOTES: &str = "20";
/// Titles from the seed's genres' list have at least this many votes.
const GENRE_MIN_VOTES: &str = "100";

/// Keywords not used to find candidates: so broad their lists are just the most watched titles,
/// or TMDB's words for a tone ("suspenseful", "witty") rather than a subject. They still count
/// when two titles are compared.
const NOT_SEARCHED: [&str; 40] = [
    "based on novel or book",
    "based on comic",
    "based on true story",
    "sequel",
    "prequel",
    "remake",
    "spin off",
    "murder",
    "police",
    "new york city",
    "los angeles, california",
    "london, england",
    "woman director",
    "duringcreditsstinger",
    "aftercreditsstinger",
    "drama",
    "comedy",
    "friendship",
    "love",
    "family",
    "dramatic",
    "adoring",
    "admiring",
    "amused",
    "compassionate",
    "excited",
    "candid",
    "blunt",
    "hopeful",
    "suspenseful",
    "intense",
    "tense",
    "inspirational",
    "cautionary",
    "playful",
    "witty",
    "sympathetic",
    "thoughtful",
    "romantic",
    "earnest",
];

/// A title's details as far as recommending goes: what a card needs and what comparing needs.
#[derive(Clone)]
pub(super) struct Detail {
    lookup: Lookup,
    features: Features,
    keyword_names: Vec<(u64, String)>,
}

/// A keyword's list: how many titles carry it, and the most voted on of them.
#[derive(Clone)]
pub(super) struct KeywordList {
    titles: u32,
    items: Vec<Item>,
}

/// A person's titles as creator, director or producer, with how much each says about them.
pub(super) type Work = Vec<(Item, f64)>;

#[derive(Deserialize)]
struct Credit {
    #[serde(flatten)]
    item: Item,
    job: Option<String>,
}

#[derive(Deserialize)]
struct PersonCredits {
    #[serde(default)]
    crew: Vec<Credit>,
}

impl Tmdb {
    /// Titles like the IMDb title `imdb_id`, best first: its franchise, then the rest.
    pub async fn recommendations(&self, ty: &str, imdb_id: &str) -> Result<Vec<MetaPreview>> {
        Ok(self.recommendations_scored(ty, imdb_id).await?.into_iter().map(|(m, _)| m).collect())
    }

    /// [`Tmdb::recommendations`] with each title's score.
    pub(crate) async fn recommendations_scored(&self, ty: &str, imdb_id: &str) -> Result<Vec<(MetaPreview, Scored)>> {
        let seed_id = self.find(ty, imdb_id).await?;
        let seed = self.detail(ty, seed_id).await?;
        let kind = tmdb_kind(ty);
        let root = similar::name_root(&seed.features.name);

        let searched: Vec<u64> = seed
            .keyword_names
            .iter()
            .filter(|(_, name)| !NOT_SEARCHED.contains(&name.to_lowercase().as_str()) && !is_place(name))
            .map(|(id, _)| *id)
            .take(MAX_KEYWORDS)
            .collect();
        let recs = futures::future::join_all(REC_PAGES.map(|page| async move {
            let page = page.to_string();
            self.get::<Paged>(&format!("/{kind}/{seed_id}/recommendations"), &[("page", &page)]).await
        }));
        let keywords = futures::future::join_all(searched.iter().map(|k| self.keyword_list(ty, *k)));
        let creators =
            futures::future::join_all(seed.features.creators.iter().take(MAX_CREATORS).map(|p| self.work(ty, *p)));
        let franchise = self.franchise(ty, &seed.features, &root);
        let genre = self.genre_list(ty, &seed.features.genres);
        let (recs, keywords, creators, franchise, genre) = futures::join!(recs, keywords, creators, franchise, genre);

        // Every list failing (offline, a bad key) is an error, so an empty row isn't kept.
        let mut first_error = None;
        let mut note = |e: IndexError| {
            if first_error.is_none() {
                first_error = Some(e);
            }
        };
        let mut found: HashMap<u64, (Item, Evidence)> = HashMap::new();
        let mut add = |item: Item, f: &dyn Fn(&mut Evidence)| {
            if item.id == seed_id {
                return;
            }
            let entry = found.entry(item.id).or_insert_with(|| (item, Evidence::default()));
            f(&mut entry.1);
        };

        let mut rank = 0;
        for page in recs {
            match page {
                Ok(page) => {
                    for item in page.results {
                        let r = rank;
                        rank += 1;
                        add(item, &|e| e.rec_rank = Some(e.rec_rank.map_or(r, |old| old.min(r))));
                    }
                }
                Err(e) => note(e),
            }
        }
        let mut weights = KeywordWeights::new(if ty == "series" { TV_TITLES } else { FILM_TITLES });
        for (id, name) in &seed.keyword_names {
            if is_place(name) {
                weights.damp(*id);
            }
        }
        for (keyword, list) in searched.iter().zip(keywords) {
            match list {
                Ok(list) => {
                    weights.insert(*keyword, list.titles);
                    if list.titles > 1 && list.titles <= BROAD {
                        for item in list.items.iter().cloned() {
                            add(item, &|e| e.keyword_hits.push(*keyword));
                        }
                    }
                }
                Err(e) => note(e),
            }
        }
        for work in creators {
            match work {
                Ok(work) => {
                    for (item, w) in work.iter().cloned() {
                        add(item, &|e| e.creator = e.creator.max(w));
                    }
                }
                Err(e) => note(e),
            }
        }
        match genre {
            Ok(list) => {
                for item in list.iter().cloned() {
                    add(item, &|_| {});
                }
            }
            Err(e) => note(e),
        }
        match franchise {
            Ok((collection, named)) => {
                for item in collection {
                    add(item, &|e| e.collection = true);
                }
                for item in named {
                    add(item, &|_| {});
                }
            }
            Err(e) => note(e),
        }
        if found.is_empty() {
            return match first_error {
                Some(e) => Err(e),
                None => Ok(Vec::new()),
            };
        }

        let listed: Vec<Candidate> = found
            .iter()
            .map(|(id, (item, e))| Candidate { id: *id, features: item_features(item), evidence: e.clone() })
            .collect();
        let picked = similar::shortlist(&seed.features, &listed, &weights, SHORTLIST, NAMED);
        let details: Vec<(u64, Arc<Detail>)> = stream::iter(picked)
            .map(|id| async move { self.detail(ty, id).await.map(|d| (id, d)) })
            .buffered(IN_FLIGHT)
            .try_collect()
            .await?;

        let mut candidates = Vec::new();
        let mut cards = HashMap::new();
        for (id, detail) in details {
            let Some(imdb) = detail.lookup.imdb_id.clone() else { continue };
            let (item, evidence) = found[&id].clone();
            candidates.push(Candidate { id, features: detail.features.clone(), evidence });
            let mut card = item.into_preview(ty, imdb, detail.lookup.logos.clone());
            card.certification = detail.lookup.certification.clone();
            cards.insert(id, card);
        }
        let row = similar::rank(&seed.features, &candidates, &weights, KEEP);
        Ok(row.into_iter().filter_map(|s| Some((cards.remove(&s.id)?, s))).collect())
    }

    /// A title's details with its keywords and credits, for a card and for comparing. Cached for
    /// a day, and its card part shared with list results.
    async fn detail(&self, ty: &str, tmdb_id: u64) -> Result<Arc<Detail>> {
        let key = (ty.chars().next().unwrap_or('m'), tmdb_id);
        if let Some(hit) = self.details.get(&key) {
            return Ok(hit);
        }
        let append = format!("{},keywords,credits", lookup_append(ty));
        let d: Value = self
            .get(
                &format!("/{}/{tmdb_id}", tmdb_kind(ty)),
                &[("append_to_response", &append), ("include_image_language", "en,null")],
            )
            .await?;
        let lookup = Lookup {
            imdb_id: str_of(&d["external_ids"]["imdb_id"]).filter(|i| i.starts_with("tt")),
            logos: self.logos(tmdb_kind(ty), tmdb_id, &d).await,
            certification: pick_certification(ty, &d, &self.region()),
            poster: str_of(&d["poster_path"]).map(|p| format!("{}/w342{p}", super::IMG)),
            background: str_of(&d["backdrop_path"]).map(|p| format!("{}/w1280{p}", super::IMG)),
        };
        if let Some(imdb) = &lookup.imdb_id {
            self.imdb_ids.insert((key.0, imdb.clone()), tmdb_id);
        }
        self.lookups.insert(key, lookup.clone());
        let (features, keyword_names) = detail_features(ty, &d);
        let detail = Arc::new(Detail { lookup, features, keyword_names });
        self.details.insert(key, detail.clone());
        Ok(detail)
    }

    /// The most voted-on titles carrying `keyword`, and how many carry it.
    async fn keyword_list(&self, ty: &str, keyword: u64) -> Result<Arc<KeywordList>> {
        let key = (ty.chars().next().unwrap_or('m'), keyword);
        if let Some(hit) = self.keyword_lists.get(&key) {
            return Ok(hit);
        }
        let keyword_id = keyword.to_string();
        let page: Paged = self
            .get(
                &format!("/discover/{}", tmdb_kind(ty)),
                &[
                    ("with_keywords", &keyword_id),
                    ("sort_by", "vote_count.desc"),
                    ("vote_count.gte", KEYWORD_MIN_VOTES),
                ],
            )
            .await?;
        let list = Arc::new(KeywordList { titles: page.total_results, items: page.results });
        self.keyword_lists.insert(key, list.clone());
        Ok(list)
    }

    /// What person `person` created or directed (1) and, for series, the best known of what they
    /// produced (0.5).
    async fn work(&self, ty: &str, person: u64) -> Result<Arc<Work>> {
        let key = (ty.chars().next().unwrap_or('m'), person);
        if let Some(hit) = self.work.get(&key) {
            return Ok(hit);
        }
        let path = if ty == "series" {
            format!("/person/{person}/tv_credits")
        } else {
            format!("/person/{person}/movie_credits")
        };
        let credits: PersonCredits = self.get(&path, &[]).await?;
        let series = ty == "series";
        let mut made: Work = Vec::new();
        let mut produced: Vec<Item> = Vec::new();
        for c in credits.crew {
            match c.job.as_deref() {
                Some("Creator") if series => made.push((c.item, 1.0)),
                Some("Director") if !series => made.push((c.item, 1.0)),
                Some("Screenplay" | "Writer") if !series => made.push((c.item, 0.7)),
                Some("Executive Producer") if series => produced.push(c.item),
                _ => {}
            }
        }
        // Best first, so a title credited twice (written and directed) keeps its higher weight.
        made.sort_by(|a, b| b.1.total_cmp(&a.1));
        produced.sort_by_key(|i| std::cmp::Reverse(i.vote_count.unwrap_or(0)));
        made.extend(produced.into_iter().take(PRODUCED).map(|i| (i, 0.5)));
        let mut seen = std::collections::HashSet::new();
        made.retain(|(i, _)| seen.insert(i.id));
        let work = Arc::new(made);
        self.work.insert(key, work.clone());
        Ok(work)
    }

    /// The most voted-on titles with all of the seed's genres but Drama (which nearly everything
    /// is): a fallback for a seed whose keywords and recommendations say little.
    async fn genre_list(&self, ty: &str, genres: &[u32]) -> Result<Arc<Vec<Item>>> {
        let mut wanted: Vec<u32> = genres.iter().copied().filter(|g| *g != 18).collect();
        if wanted.is_empty() {
            return Ok(Arc::default());
        }
        wanted.sort_unstable();
        let with = wanted.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let key = format!("{}/{with}", tmdb_kind(ty));
        if let Some(hit) = self.genre_lists.get(&key) {
            return Ok(hit);
        }
        let page: Paged = self
            .get(
                &format!("/discover/{}", tmdb_kind(ty)),
                &[("with_genres", &with), ("sort_by", "vote_count.desc"), ("vote_count.gte", GENRE_MIN_VOTES)],
            )
            .await?;
        let list = Arc::new(page.results);
        self.genre_lists.insert(key, list.clone());
        Ok(list)
    }

    /// The seed's film collection, and titles named after it (by a search for its name's root).
    async fn franchise(&self, ty: &str, seed: &Features, root: &str) -> Result<(Vec<Item>, Vec<Item>)> {
        #[derive(Deserialize)]
        struct Collection {
            #[serde(default)]
            parts: Vec<Item>,
        }
        let collection = async {
            match seed.collection {
                Some(id) if ty != "series" => {
                    self.get::<Collection>(&format!("/collection/{id}"), &[]).await.map(|c| c.parts)
                }
                _ => Ok(Vec::new()),
            }
        };
        let named = async {
            if root.chars().count() < 4 {
                return Ok::<Vec<Item>, IndexError>(Vec::new());
            }
            let found: Paged = self.get(&format!("/search/{}", tmdb_kind(ty)), &[("query", root)]).await?;
            Ok(found
                .results
                .into_iter()
                .filter(|i| similar::same_root(root, i.title.as_deref().or(i.name.as_deref()).unwrap_or("")))
                .collect())
        };
        let (collection, named) = futures::join!(collection, named);
        Ok((collection?, named?))
    }
}

/// Whether a keyword names a place: TMDB writes them "city, state" or "city, country".
fn is_place(name: &str) -> bool {
    name.contains(", ")
}

/// What a list result tells about a title.
fn item_features(item: &Item) -> Features {
    Features {
        name: item.title.clone().or_else(|| item.name.clone()).unwrap_or_default(),
        genres: item.genre_ids.clone(),
        language: item.original_language.clone(),
        year: item.release_date.as_deref().or(item.first_air_date.as_deref()).and_then(|d| d.get(..4)?.parse().ok()),
        votes: item.vote_count.unwrap_or(0),
        rating: item.vote_average.unwrap_or(0.0),
        full: false,
        ..Features::default()
    }
}

/// What a details answer (with `keywords` and `credits` appended) tells about a title, and its
/// keywords' names.
fn detail_features(ty: &str, d: &Value) -> (Features, Vec<(u64, String)>) {
    let ids = |v: &Value| -> Vec<u64> {
        v.as_array().map(|a| a.iter().filter_map(|x| x["id"].as_u64()).collect()).unwrap_or_default()
    };
    let keywords_field = if ty == "series" { &d["keywords"]["results"] } else { &d["keywords"]["keywords"] };
    let keyword_names: Vec<(u64, String)> = keywords_field
        .as_array()
        .map(|a| a.iter().filter_map(|k| Some((k["id"].as_u64()?, str_of(&k["name"])?))).collect())
        .unwrap_or_default();
    let creators = if ty == "series" {
        ids(&d["created_by"])
    } else {
        // Directors, then writers.
        let crew = d["credits"]["crew"].as_array().map(Vec::as_slice).unwrap_or_default();
        let with = |jobs: &[&str]| {
            crew.iter()
                .filter(|c| jobs.iter().any(|j| c["job"] == *j))
                .filter_map(|c| c["id"].as_u64())
                .collect::<Vec<_>>()
        };
        let mut people = with(&["Director"]);
        for id in with(&["Screenplay", "Writer"]) {
            if !people.contains(&id) {
                people.push(id);
            }
        }
        people.truncate(4);
        people
    };
    let cast: Vec<u64> = ids(&d["credits"]["cast"]).into_iter().take(12).collect();
    let date = str_of(&d["first_air_date"]).or_else(|| str_of(&d["release_date"]));
    let features = Features {
        name: str_of(&d["name"]).or_else(|| str_of(&d["title"])).unwrap_or_default(),
        genres: ids(&d["genres"]).into_iter().map(|g| g as u32).collect(),
        keywords: keyword_names.iter().map(|(id, _)| *id).collect(),
        creators,
        cast,
        language: str_of(&d["original_language"]),
        year: date.and_then(|d| d.get(..4)?.parse().ok()),
        votes: d["vote_count"].as_u64().unwrap_or(0),
        rating: d["vote_average"].as_f64().unwrap_or(0.0),
        collection: d["belongs_to_collection"]["id"].as_u64(),
        full: true,
    };
    (features, keyword_names)
}

#[cfg(test)]
mod live {
    use super::*;

    /// Prints the row for each seed, with its scores, for tuning by eye against the real TMDB:
    /// `TMDB_API_KEY=… POLAR_RECS_SEEDS=series:tt…,movie:tt… cargo test -p polar-index live_rows -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "needs TMDB_API_KEY and POLAR_RECS_SEEDS"]
    async fn live_rows() {
        let (Ok(key), Ok(seeds)) = (std::env::var("TMDB_API_KEY"), std::env::var("POLAR_RECS_SEEDS")) else { return };
        let tmdb = Tmdb::new(key, None);
        for seed in seeds.split(',') {
            let (ty, id) = seed.split_once(':').unwrap_or(("series", seed));
            let started = std::time::Instant::now();
            let row = tmdb.recommendations_scored(ty, id).await.unwrap();
            println!("\n== {id} ({ty}) {} titles in {:?}", row.len(), started.elapsed());
            for (m, s) in row {
                let p = &s.parts;
                println!(
                    "{:5.2} {} {:<40} kw {:.2} list {:.2} ppl {:.2} gen {:.2} q {:.2} era {:.2} -{:.2}",
                    s.score,
                    if s.franchise { "F" } else { " " },
                    m.name,
                    p.keywords,
                    p.listed,
                    p.people,
                    p.genre,
                    p.quality,
                    p.era,
                    p.penalty
                );
            }
        }
    }
}
