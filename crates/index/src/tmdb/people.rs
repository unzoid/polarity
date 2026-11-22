//! People and extras from TMDB: a person's page (`/person/{id}` with `combined_credits`), the crew of a
//! title's details named by id, and a title's other videos.

use std::collections::{HashMap, HashSet};

use futures::stream::{self, StreamExt, TryStreamExt};
use polar_addon::{Extra, MetaPreview, Person};
use serde::Deserialize;
use serde_json::Value;

use super::{str_of, Item, Lookup, Tmdb, IMG};
use crate::person::{PersonHit, PersonPage};
use crate::Result;

/// Titles a person acts in that their page keeps.
const ACTING: usize = 30;
/// Titles a person directed or created that their page keeps.
const DIRECTING: usize = 15;
/// Titles a person wrote that their page keeps.
const WRITING: usize = 15;
/// People returned by a search query.
const MAX_PEOPLE_HITS: usize = 12;
/// IMDb-id lookups for a person's titles in flight at once: fewer than a catalog's, so a page of
/// 45 titles never arrives at TMDB as one burst.
const LOOKUPS_AT_ONCE: usize = 6;
/// A title's extras kept.
const MAX_EXTRAS: usize = 20;
/// Crew kept per title (directors, creators, writers).
const MAX_CREW: usize = 12;
/// TMDB's TV genres News, Reality and Talk: appearances as oneself, not roles.
const NOT_ROLES: [u32; 3] = [10763, 10764, 10767];

#[derive(Deserialize, Default)]
struct Credits {
    #[serde(default)]
    cast: Vec<Credit>,
    #[serde(default)]
    crew: Vec<Credit>,
}

#[derive(Clone, Deserialize)]
struct Credit {
    #[serde(default)]
    media_type: String,
    #[serde(default)]
    vote_count: Option<f64>,
    #[serde(default)]
    character: Option<String>,
    #[serde(default)]
    job: Option<String>,
    #[serde(flatten)]
    item: Item,
}

impl Credit {
    /// The app's type for it; anything not a show is a film.
    fn ty(&self) -> &'static str {
        if self.media_type == "tv" {
            "series"
        } else {
            "movie"
        }
    }

    /// (is a show, TMDB id): one title, whichever list it's in.
    fn key(&self) -> (bool, u64) {
        (self.media_type == "tv", self.item.id)
    }

    /// A role, not an appearance as oneself (a talk show's guest, a documentary's "Self").
    fn is_role(&self) -> bool {
        if self.ty() == "series" && self.item.genre_ids.iter().any(|g| NOT_ROLES.contains(g)) {
            return false;
        }
        let character = self.character.as_deref().unwrap_or("").trim().to_ascii_lowercase();
        !(character == "self"
            || character == "himself"
            || character == "herself"
            || character == "themselves"
            || character.starts_with("self ")
            || character.starts_with("self-")
            || character.starts_with("himself ")
            || character.starts_with("herself "))
    }

    fn directs(&self) -> bool {
        matches!(self.job.as_deref(), Some("Director" | "Creator"))
    }

    fn writes(&self) -> bool {
        matches!(self.job.as_deref(), Some("Screenplay" | "Writer" | "Story" | "Novel" | "Teleplay"))
    }
}

#[derive(Deserialize)]
struct PeoplePaged {
    #[serde(default)]
    results: Vec<Value>,
}

impl Tmdb {
    /// People matching `query`, most popular first (adult entries skipped).
    pub async fn search_people(&self, query: &str) -> Result<Vec<PersonHit>> {
        let list: PeoplePaged = self.get("/search/person", &[("query", query), ("include_adult", "false")]).await?;
        let mut hits: Vec<(f64, PersonHit)> = list
            .results
            .into_iter()
            .filter(|p| !p["adult"].as_bool().unwrap_or(false))
            .filter_map(|p| {
                let id = p["id"].as_u64()?;
                let name = str_of(&p["name"])?;
                let pop = p["popularity"].as_f64().unwrap_or(0.0);
                Some((
                    pop,
                    PersonHit {
                        id,
                        name,
                        photo: str_of(&p["profile_path"]).map(|path| format!("{IMG}/w185{path}")),
                        known_for: str_of(&p["known_for_department"]),
                    },
                ))
            })
            .collect();
        hits.sort_by(|a, b| b.0.total_cmp(&a.0));
        Ok(hits.into_iter().take(MAX_PEOPLE_HITS).map(|(_, h)| h).collect())
    }

    /// A person's page: who they are, then the titles they act in, directed, and wrote, each most
    /// notable first (by TMDB's vote count) and kept to those with an IMDb id. The titles' ids come from
    /// the same cached lookup as list results; any lookup that fails fails the page, so a thinned page is
    /// never cached.
    pub async fn person(&self, id: u64) -> Result<PersonPage> {
        let d: Value = self.get(&format!("/person/{id}"), &[("append_to_response", "combined_credits")]).await?;
        let credits: Credits = serde_json::from_value(d["combined_credits"].clone()).unwrap_or_default();
        let acting = notable(credits.cast, ACTING, Credit::is_role);
        let directing = notable(credits.crew.clone(), DIRECTING, Credit::directs);
        let writing = notable(credits.crew, WRITING, Credit::writes);

        // A title in multiple lists is looked up once. Keyed by (is a show, id), owned values only: a closure
        // over a borrow makes the future not `Send` enough for a command (rust-lang/rust#64552).
        let mut seen = HashSet::new();
        let wanted: Vec<(bool, u64)> =
            acting.iter().chain(&directing).chain(&writing).map(|c| c.key()).filter(|k| seen.insert(*k)).collect();
        let found: Vec<Lookup> = stream::iter(wanted.clone())
            .map(|(series, tmdb_id)| self.lookup(if series { "series" } else { "movie" }, tmdb_id))
            .buffered(LOOKUPS_AT_ONCE)
            .try_collect()
            .await?;
        let found: HashMap<(bool, u64), Lookup> = wanted.into_iter().zip(found).collect();
        let acting = previews(acting, &found);
        let directing = previews(directing, &found);
        let writing = previews(writing, &found);
        Ok(person_page(id, &d, acting, directing, writing))
    }
}

/// The credits as the app's titles, those without an IMDb id left out.
fn previews(list: Vec<Credit>, found: &HashMap<(bool, u64), Lookup>) -> Vec<MetaPreview> {
    list.into_iter()
        .filter_map(|c| {
            let l = found.get(&c.key())?;
            let ty = c.ty();
            Some(c.item.into_preview(ty, l.imdb_id.clone()?, l.logos.clone()))
        })
        .collect()
}

/// The credits `keep` lets through, each title once, most voted on first (TMDB's order among equals), at
/// most `take`.
fn notable(list: Vec<Credit>, take: usize, keep: fn(&Credit) -> bool) -> Vec<Credit> {
    let mut seen = HashSet::new();
    let mut kept: Vec<Credit> = list.into_iter().filter(|c| keep(c) && seen.insert(c.key())).collect();
    // Stable, so equals keep TMDB's order.
    kept.sort_by(|a, b| b.vote_count.unwrap_or(0.0).total_cmp(&a.vote_count.unwrap_or(0.0)));
    kept.truncate(take);
    kept
}

fn person_page(
    id: u64,
    d: &Value,
    acting: Vec<MetaPreview>,
    directing: Vec<MetaPreview>,
    writing: Vec<MetaPreview>,
) -> PersonPage {
    PersonPage {
        id,
        name: str_of(&d["name"]).unwrap_or_default(),
        photo: str_of(&d["profile_path"]).map(|p| format!("{IMG}/w342{p}")),
        biography: str_of(&d["biography"]).map(|b| b.trim().to_owned()).filter(|b| !b.is_empty()),
        born: str_of(&d["birthday"]),
        died: str_of(&d["deathday"]),
        birthplace: str_of(&d["place_of_birth"]),
        known_for: str_of(&d["known_for_department"]),
        acting,
        directing,
        writing,
    }
}

/// A title's directors (a show's creators) and writers from its details, each once with their TMDB id and
/// job (in `character`), for their names to open their pages. Those without an id are left out: the
/// names alone are already in `director` and `writers`.
pub(super) fn crew(d: &Value, is_series: bool) -> Vec<Person> {
    let mut out: Vec<Person> = Vec::new();
    let mut add = |p: &Value, job: &str| {
        let (Some(id), Some(name)) = (p["id"].as_u64(), str_of(&p["name"])) else { return };
        if out.iter().any(|o| o.tmdb_id == Some(id)) {
            return;
        }
        out.push(Person {
            name,
            character: Some(job.to_owned()),
            photo: str_of(&p["profile_path"]).map(|path| format!("{IMG}/w185{path}")),
            tmdb_id: Some(id),
        });
    };
    if is_series {
        for p in d["created_by"].as_array().into_iter().flatten() {
            add(p, "Creator");
        }
    }
    let crew = d["credits"]["crew"].as_array().map(Vec::as_slice).unwrap_or_default();
    for c in crew.iter().filter(|c| c["job"] == "Director") {
        add(c, "Director");
    }
    for c in crew.iter().filter(|c| matches!(c["job"].as_str(), Some("Screenplay" | "Writer" | "Story" | "Novel"))) {
        add(c, "Writer");
    }
    out.truncate(MAX_CREW);
    out
}

/// A title's other videos from TMDB's `videos`: YouTube ones with a name, leaving out `trailer` (the one the
/// title's Trailer button plays), official ones first, then trailers, teasers, featurettes, behind the
/// scenes, clips and bloopers, otherwise in TMDB's order.
pub(super) fn extras(videos: &Value, trailer: Option<&str>) -> Vec<Extra> {
    let rank = |kind: &str| match kind {
        "Trailer" => 0,
        "Teaser" => 1,
        "Featurette" => 2,
        "Behind the Scenes" => 3,
        "Clip" => 4,
        "Bloopers" => 5,
        _ => 6,
    };
    let mut found: Vec<(bool, u8, Extra)> = videos
        .as_array()
        .into_iter()
        .flatten()
        .filter(|v| v["site"] == "YouTube")
        .filter_map(|v| {
            let key = str_of(&v["key"]).filter(|k| Some(k.as_str()) != trailer)?;
            let kind = str_of(&v["type"]).unwrap_or_else(|| "Video".into());
            let official = v["official"].as_bool().unwrap_or(false);
            Some((
                !official,
                rank(&kind),
                Extra { name: str_of(&v["name"]).unwrap_or_else(|| kind.clone()), kind, key },
            ))
        })
        .collect();
    found.sort_by_key(|(unofficial, rank, _)| (*unofficial, *rank));
    let mut seen = HashSet::new();
    found.into_iter().map(|(_, _, e)| e).filter(|e| seen.insert(e.key.clone())).take(MAX_EXTRAS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extras_are_youtube_official_first_without_the_trailer() {
        let v = |key: &str, ty: &str, official: bool| json!({ "site": "YouTube", "key": key, "type": ty, "official": official, "name": format!("{ty} {key}") });
        let videos = json!([
            v("fanclip", "Clip", false),
            v("main", "Trailer", true),
            v("making", "Behind the Scenes", true),
            v("clip", "Clip", true),
            v("feat", "Featurette", true),
            v("second", "Trailer", true),
            { "site": "Vimeo", "key": "elsewhere", "type": "Featurette", "official": true },
            v("main", "Trailer", true),
        ]);
        let keys: Vec<String> = extras(&videos, Some("main")).into_iter().map(|e| e.key).collect();
        assert_eq!(keys, ["second", "feat", "making", "clip", "fanclip"]);
        let first = &extras(&videos, Some("main"))[0];
        assert_eq!((first.name.as_str(), first.kind.as_str()), ("Trailer second", "Trailer"));
        assert!(extras(&json!(null), None).is_empty());
    }

    #[test]
    fn writing_credits_match_writer_jobs() {
        let mk = |job: &str| Credit {
            media_type: "movie".into(),
            vote_count: Some(100.0),
            character: None,
            job: Some(job.into()),
            item: Item {
                id: 1,
                title: Some("Example".into()),
                name: None,
                poster_path: None,
                backdrop_path: None,
                overview: None,
                release_date: None,
                first_air_date: None,
                vote_average: None,
                vote_count: None,
                original_language: None,
                genre_ids: vec![],
            },
        };
        assert!(mk("Screenplay").writes());
        assert!(mk("Writer").writes());
        assert!(mk("Story").writes());
        assert!(mk("Teleplay").writes());
        assert!(!mk("Director").writes());
    }

    #[test]
    fn crew_names_directors_and_writers_by_id_once() {
        let d = json!({
            "created_by": [{ "id": 7, "name": "Ines Marchetti", "profile_path": "/im.jpg" }],
            "credits": { "crew": [
                { "id": 7, "name": "Ines Marchetti", "job": "Director" },
                { "id": 8, "name": "Paul Achebe", "job": "Screenplay" },
                { "name": "No Id", "job": "Director" },
                { "id": 9, "name": "Grip Person", "job": "Key Grip" },
            ]},
        });
        let series = crew(&d, true);
        let named: Vec<(u64, &str)> =
            series.iter().map(|p| (p.tmdb_id.unwrap(), p.character.as_deref().unwrap())).collect();
        assert_eq!(named, [(7, "Creator"), (8, "Writer")]);
        assert_eq!(series[0].photo.as_deref(), Some("https://image.tmdb.org/t/p/w185/im.jpg"));
        // A film's director comes from the credits.
        assert_eq!(crew(&d, false)[0].character.as_deref(), Some("Director"));
    }

    #[test]
    fn roles_leave_out_appearances_as_oneself() {
        let credit = |v: Value| serde_json::from_value::<Credit>(v).unwrap();
        assert!(credit(json!({ "id": 1, "media_type": "movie", "character": "Nora" })).is_role());
        assert!(!credit(json!({ "id": 1, "media_type": "movie", "character": "Self - Host" })).is_role());
        assert!(!credit(json!({ "id": 1, "media_type": "movie", "character": "Herself" })).is_role());
        assert!(!credit(json!({ "id": 1, "media_type": "tv", "character": "Guest", "genre_ids": [10767] })).is_role());
        assert!(credit(json!({ "id": 1, "media_type": "tv", "character": "Elias", "genre_ids": [18] })).is_role());
    }
}
