//! "More like this": ranking the candidates gathered for a seed title.
//!
//! Candidates come from several lists (the source's own "people also liked", titles sharing the
//! seed's more specific keywords, its creator's other work, its franchise). Each is scored against
//! the seed on what makes two titles alike: shared keywords weighted by how specific they are,
//! shared creators and cast, how high the source's own list put it, genre, and a little rating.
//! The franchise then leads the row, and a diversity pass keeps the rest from being one title in
//! ten versions. Pure functions: the lists are fetched elsewhere (`tmdb/recs.rs`).

use std::collections::{HashMap, HashSet};

/// What's known about a title for comparing it with others.
#[derive(Clone, Debug, Default)]
pub struct Features {
    pub name: String,
    pub genres: Vec<u32>,
    pub keywords: Vec<u64>,
    /// Creators (series) or directors (films).
    pub creators: Vec<u64>,
    /// Leading cast, in billing order.
    pub cast: Vec<u64>,
    pub language: Option<String>,
    pub year: Option<i32>,
    pub votes: u64,
    pub rating: f64,
    /// The film collection it belongs to.
    pub collection: Option<u64>,
    /// Whether the details were read: list results know no keywords, creators or cast.
    pub full: bool,
}

/// How a candidate was found.
#[derive(Clone, Debug, Default)]
pub struct Evidence {
    /// Its place in the source's own recommendations for the seed, 0 first.
    pub rec_rank: Option<usize>,
    /// The seed keywords whose lists it was in.
    pub keyword_hits: Vec<u64>,
    /// Found through the seed's creator: 1 when they created or directed it, less when they
    /// only produced it.
    pub creator: f64,
    /// In the seed's film collection.
    pub collection: bool,
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub id: u64,
    pub features: Features,
    pub evidence: Evidence,
}

/// A candidate's place in the row and why.
#[derive(Clone, Debug)]
pub struct Scored {
    pub id: u64,
    pub score: f64,
    pub franchise: bool,
    pub parts: Parts,
}

/// The terms of a score, kept for tests and for tuning by eye.
#[derive(Clone, Debug, Default)]
pub struct Parts {
    pub keywords: f64,
    pub listed: f64,
    pub people: f64,
    pub genre: f64,
    pub quality: f64,
    pub era: f64,
    pub penalty: f64,
}

/// TMDB's genres Documentary, News, Reality, Soap and Talk: not like a drama or a comedy whatever
/// they share.
const UNLIKE: [u32; 5] = [99, 10763, 10764, 10766, 10767];
const DRAMA: u32 = 18;
const COMEDY: u32 = 35;

/// How much sharing a genre says: Drama and Comedy are on most titles, so less than the rest.
fn genre_weight(genre: u32) -> f64 {
    match genre {
        DRAMA => 0.4,
        COMEDY => 0.6,
        _ => 1.0,
    }
}

/// The genres two titles share, weighted, over all the genres either has.
fn genre_overlap(a: &[u32], b: &[u32]) -> f64 {
    let a: HashSet<u32> = a.iter().copied().collect();
    let b: HashSet<u32> = b.iter().copied().collect();
    let union: f64 = a.union(&b).map(|g| genre_weight(*g)).sum();
    if union == 0.0 {
        0.0
    } else {
        a.intersection(&b).map(|g| genre_weight(*g)).sum::<f64>() / union
    }
}
const ANIMATION: u32 = 16;
/// TMDB's TV genre Kids and film genre Family.
const KIDS: [u32; 2] = [10762, 10751];
/// Fewer votes than this and a title is too little known to recommend, unless it's the franchise.
const MIN_VOTES: u64 = 15;
const MIN_FRANCHISE_VOTES: u64 = 5;
/// The franchise titles that lead the row; the rest take their place among the others.
const MAX_FRANCHISE: usize = 5;
/// How much a candidate is held back for being like one already in the row (0: not at all).
const DIVERSITY: f64 = 0.5;

/// How specific each keyword is, by how many titles carry it.
#[derive(Clone, Debug, Default)]
pub struct KeywordWeights {
    counts: HashMap<u64, u32>,
    /// Keywords that say little about what a title is like however few carry them (a place).
    damped: HashSet<u64>,
    /// Roughly how many titles of the kind there are worth counting.
    total: f64,
}

/// The weight of a keyword whose count isn't known.
const UNKNOWN_WEIGHT: f64 = 1.5;

impl KeywordWeights {
    pub fn new(total: f64) -> Self {
        Self { total, ..Self::default() }
    }

    pub fn insert(&mut self, keyword: u64, titles: u32) {
        self.counts.insert(keyword, titles);
    }

    /// Counts `keyword` for little whatever its count: a setting ("some city, some state") is
    /// rarely why two titles are alike.
    pub fn damp(&mut self, keyword: u64) {
        self.damped.insert(keyword);
    }

    /// The weight of sharing `keyword`: high for one a few dozen titles carry ("medical
    /// procedural"), low for one thousands do ("based on novel or book"), and little for one
    /// hardly any do, as that's an oddity of the seed's tagging more than a subject.
    pub fn weight(&self, keyword: u64) -> f64 {
        let w = match self.counts.get(&keyword) {
            None => UNKNOWN_WEIGHT,
            Some(n) if *n <= 1 => 0.0,
            Some(n) => {
                let n = f64::from(*n);
                let oddity = ((n - 1.0) / 6.0).min(1.0);
                (1.0 + self.total / n).ln().clamp(0.3, 5.0) * oddity
            }
        };
        if self.damped.contains(&keyword) {
            w.min(1.0)
        } else {
            w
        }
    }

    /// How alike two keyword sets are: the cosine of their weighted vectors.
    fn cosine(&self, a: &[u64], b: &[u64]) -> f64 {
        let norm = |ks: &[u64]| ks.iter().map(|k| self.weight(*k).powi(2)).sum::<f64>().sqrt();
        let (na, nb) = (norm(a), norm(b));
        if na == 0.0 || nb == 0.0 {
            return 0.0;
        }
        let b: HashSet<u64> = b.iter().copied().collect();
        let shared: f64 = a
            .iter()
            .collect::<HashSet<_>>()
            .into_iter()
            .filter(|k| b.contains(k))
            .map(|k| self.weight(*k).powi(2))
            .sum();
        shared / (na * nb)
    }
}

/// The part of a title its sequels and spin-offs share: what comes before a colon or dash
/// ("Some Show: Second Shift" → "some show"), else the whole name, lowercased.
pub fn name_root(name: &str) -> String {
    let cut = name.find([':', '–', '—']).or_else(|| name.find(" - "));
    cut.map_or(name, |i| &name[..i]).trim().to_lowercase()
}

/// Whether `name` is `root` or a sequel's or spin-off's name for it: followed by a colon or
/// dash ("Some Show: Origins"), or a number ("Some Film 2", "Some Film II"). Not "Some Show's
/// Friends", "Some Shows" or "Some Show Mysteries", which are usually other titles. A root
/// under four letters matches nothing.
pub fn same_root(root: &str, name: &str) -> bool {
    if root.chars().count() < 4 {
        return false;
    }
    let name = name.to_lowercase();
    let Some(rest) = name.strip_prefix(root) else { return false };
    let rest = rest.trim_start();
    let numbered = rest.split_whitespace().next().is_some_and(|w| {
        w.chars().all(|c| c.is_ascii_digit())
            || matches!(w, "ii" | "iii" | "iv" | "v" | "vi" | "vii" | "viii" | "ix" | "x")
    });
    rest.is_empty() || rest.starts_with([':', '-', '–', '—', '(']) || numbered
}

fn shared<T: Eq + std::hash::Hash + Copy>(a: &[T], b: &[T]) -> usize {
    let a: HashSet<T> = a.iter().copied().collect();
    b.iter().collect::<HashSet<_>>().into_iter().filter(|x| a.contains(x)).count()
}

/// The keywords a candidate is known to carry: all of them once its details were read, else
/// those whose lists it was found in.
fn known_keywords(c: &Candidate) -> Vec<u64> {
    if c.features.full {
        c.features.keywords.clone()
    } else {
        c.evidence.keyword_hits.clone()
    }
}

/// Whether a candidate is in the seed's franchise: in its film collection, or named after it
/// ("Some Show: Origins") and sharing a creator, cast or subject with it, so a namesake isn't.
fn in_franchise(seed: &Features, c: &Candidate, weights: &KeywordWeights) -> bool {
    if c.evidence.collection || (seed.collection.is_some() && seed.collection == c.features.collection) {
        return true;
    }
    let root = name_root(&seed.name);
    if !same_root(&root, &c.features.name) && !same_root(&name_root(&c.features.name), &seed.name) {
        return false;
    }
    let f = &c.features;
    f.full
        && (shared(&seed.creators, &f.creators) > 0
            || shared(&seed.cast, &f.cast) > 0
            || weights.cosine(&seed.keywords, &f.keywords) >= 0.1)
}

/// Why a candidate shouldn't be in the row at all.
fn excluded(seed: &Features, c: &Candidate, franchise: bool) -> bool {
    let f = &c.features;
    let unlike = f.genres.iter().any(|g| UNLIKE.contains(g) && !seed.genres.contains(g));
    // The franchise may be little known, but not unreleased (no votes yet).
    unlike || f.votes < if franchise { MIN_FRANCHISE_VOTES } else { MIN_VOTES }
}

/// How well `c` matches `seed`. Before a candidate's details are read only what its lists told
/// (keywords it was found by, genres, votes) counts; afterwards everything does.
pub fn score(seed: &Features, c: &Candidate, weights: &KeywordWeights) -> Parts {
    let f = &c.features;
    let e = &c.evidence;
    let keywords = weights.cosine(&seed.keywords, &known_keywords(c));
    let mut listed = e.rec_rank.map_or(0.0, |r| 1.0 / (1.0 + r as f64 / 6.0));
    if f.full {
        // The source's list is noisy below its first few: a title on it that shares no subject
        // with the seed counts for less.
        listed *= 0.4 + 0.6 * (keywords / 0.2).min(1.0);
    }
    let genre = genre_overlap(&seed.genres, &f.genres);
    let people = if f.full {
        let creators = shared(&seed.creators, &f.creators) as f64;
        let cast = shared(&seed.cast[..seed.cast.len().min(10)], &f.cast[..f.cast.len().min(10)]) as f64;
        (0.7 * creators + 0.2 * cast).max(e.creator).min(1.0)
    } else {
        e.creator
    };
    // The same director's film in another genre is less alike than one in the same.
    let people = people * (0.35 + 0.65 * genre);
    // Bayesian average: a 9.0 from 12 votes counts for little more than a middling title.
    let rated = (f.votes as f64 * f.rating + 150.0 * 6.5) / (f.votes as f64 + 150.0);
    let quality = ((rated - 6.0) / 2.5).clamp(0.0, 1.0);
    let era = match (seed.year, f.year) {
        (Some(a), Some(b)) => (-f64::from((a - b).abs()) / 15.0).exp(),
        _ => 0.3,
    };
    let mut penalty = 0.0;
    // A comedy that shares a subject with a thriller ("an office") is still not like it.
    if genre == 0.0 && !seed.genres.is_empty() && !f.genres.is_empty() {
        penalty += 0.5;
    }
    let has = |fs: &Features, g: u32| fs.genres.contains(&g);
    if has(f, ANIMATION) != has(seed, ANIMATION) {
        penalty += if has(seed, ANIMATION) { 0.4 } else { 0.9 };
    }
    if KIDS.iter().any(|g| has(f, *g)) && !KIDS.iter().any(|g| has(seed, *g)) {
        penalty += 0.5;
    }
    if f.language.is_some() && seed.language.is_some() && f.language != seed.language {
        penalty += 0.15;
    }
    Parts { keywords, listed, people, genre, quality, era, penalty }
}

impl Parts {
    pub fn total(&self) -> f64 {
        // A shared subject counts fully only between titles of the same genres.
        let keywords = self.keywords * (0.6 + 0.4 * self.genre);
        2.2 * keywords + 1.0 * self.listed + 0.9 * self.people + 0.7 * self.genre + 0.6 * self.quality + 0.15 * self.era
            - self.penalty
    }
}

/// Which candidates are worth reading the details of: the `keep` best by what their lists told,
/// plus up to `franchise` named like the seed (whether they're its franchise needs their details).
pub fn shortlist(
    seed: &Features,
    candidates: &[Candidate],
    weights: &KeywordWeights,
    keep: usize,
    franchise: usize,
) -> Vec<u64> {
    let root = name_root(&seed.name);
    let mut scored: Vec<(f64, &Candidate)> = candidates
        .iter()
        .filter(|c| !excluded(seed, c, c.evidence.collection || same_root(&root, &c.features.name)))
        .map(|c| (score(seed, c, weights).total(), c))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    let named: Vec<u64> = scored
        .iter()
        .filter(|(_, c)| c.evidence.collection || same_root(&root, &c.features.name))
        .take(franchise)
        .map(|(_, c)| c.id)
        .collect();
    let mut ids = named.clone();
    ids.extend(scored.iter().map(|(_, c)| c.id).filter(|id| !named.contains(id)).take(keep));
    ids
}

/// The row: the franchise first (most voted on first), then the rest best first, each held back
/// a little for being like those already in.
pub fn rank(seed: &Features, candidates: &[Candidate], weights: &KeywordWeights, take: usize) -> Vec<Scored> {
    let mut franchise = Vec::new();
    let mut rest = Vec::new();
    for c in candidates {
        let parts = score(seed, c, weights);
        // A spin-off in another form (a cartoon of a live-action show) doesn't lead the row.
        let fr = in_franchise(seed, c, weights) && parts.penalty < 0.5;
        if excluded(seed, c, fr) {
            continue;
        }
        let scored = Scored { id: c.id, score: parts.total(), franchise: fr, parts };
        if fr {
            franchise.push((c, scored));
        } else {
            rest.push((c, scored));
        }
    }
    franchise.sort_by_key(|(c, _)| std::cmp::Reverse(c.features.votes));
    let overflow = franchise.split_off(franchise.len().min(MAX_FRANCHISE));
    rest.extend(overflow.into_iter().map(|(c, mut s)| {
        s.franchise = false;
        (c, s)
    }));

    let mut row: Vec<(&Candidate, Scored)> = franchise;
    while row.len() < take && !rest.is_empty() {
        let best = rest
            .iter()
            .enumerate()
            .map(|(i, (c, s))| {
                let alike = row
                    .iter()
                    .filter(|(r, _)| !r.features.keywords.is_empty())
                    .map(|(r, _)| weights.cosine(&r.features.keywords, &c.features.keywords))
                    .fold(0.0, f64::max);
                (i, s.score - DIVERSITY * alike)
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(i, _)| i);
        let Some(i) = best else { break };
        row.push(rest.swap_remove(i));
    }
    row.truncate(take);
    row.into_iter().map(|(_, s)| s).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DRAMA: u32 = 18;
    const COMEDY: u32 = 35;
    const CRIME: u32 = 80;

    /// Keyword ids of the made-up titles below: two specific subjects, a broad one and a common one.
    const WARD: u64 = 1;
    const NIGHT_SHIFT: u64 = 2;
    const CITY: u64 = 3;
    const BASED_ON_BOOK: u64 = 4;
    const HEIST: u64 = 5;

    fn weights() -> KeywordWeights {
        let mut w = KeywordWeights::new(3000.0);
        w.insert(WARD, 40);
        w.insert(NIGHT_SHIFT, 12);
        w.insert(CITY, 400);
        w.insert(BASED_ON_BOOK, 3500);
        w.insert(HEIST, 60);
        w
    }

    fn title(name: &str, genres: &[u32], keywords: &[u64], votes: u64, rating: f64) -> Features {
        Features {
            name: name.into(),
            genres: genres.to_vec(),
            keywords: keywords.to_vec(),
            votes,
            rating,
            year: Some(2020),
            language: Some("en".into()),
            full: true,
            ..Features::default()
        }
    }

    fn candidate(id: u64, features: Features) -> Candidate {
        Candidate { id, features, evidence: Evidence::default() }
    }

    fn ids(row: &[Scored]) -> Vec<u64> {
        row.iter().map(|s| s.id).collect()
    }

    #[test]
    fn a_shared_subject_beats_a_better_rated_title_of_the_same_genre() {
        let seed = title("Ward Nine", &[DRAMA], &[WARD, NIGHT_SHIFT, CITY], 500, 8.5);
        let alike = candidate(1, title("Night Ward", &[DRAMA], &[WARD, NIGHT_SHIFT], 900, 7.4));
        let acclaimed = candidate(2, title("The Long Con", &[DRAMA, COMEDY], &[HEIST, CITY], 20_000, 8.9));
        assert_eq!(ids(&rank(&seed, &[acclaimed, alike], &weights(), 10)), [1, 2]);
    }

    #[test]
    fn common_keywords_count_for_little() {
        let w = weights();
        assert!(w.weight(NIGHT_SHIFT) > 3.0 * w.weight(BASED_ON_BOOK));
        let seed = title("Ward Nine", &[DRAMA], &[WARD, BASED_ON_BOOK], 500, 8.0);
        let bookish = candidate(1, title("Paper Kings", &[DRAMA], &[BASED_ON_BOOK], 5000, 8.0));
        let ward = candidate(2, title("Ward Ten", &[DRAMA], &[WARD], 500, 7.0));
        assert_eq!(ids(&rank(&seed, &[bookish, ward], &w, 10)), [2, 1]);
    }

    #[test]
    fn a_keyword_only_the_seed_has_weighs_nothing() {
        let mut w = weights();
        w.insert(99, 1);
        assert_eq!(w.weight(99), 0.0);
    }

    #[test]
    fn the_franchise_leads_most_voted_first_and_a_namesake_does_not_join_it() {
        let mut seed = title("Night Ward: Rounds", &[CRIME, DRAMA], &[WARD, NIGHT_SHIFT], 300, 8.0);
        seed.cast = vec![7, 8];
        let mut original = title("Night Ward", &[CRIME, DRAMA], &[WARD, CITY], 4000, 8.2);
        original.cast = vec![7];
        let mut sequel = title("Night Ward: Second Shift", &[DRAMA], &[NIGHT_SHIFT], 900, 7.0);
        sequel.cast = vec![7, 9];
        // Same words, nothing else shared: not the franchise.
        let namesake = title("Night Ward", &[COMEDY], &[HEIST], 100, 6.0);
        let other = title("Ward Ten", &[CRIME, DRAMA], &[WARD, NIGHT_SHIFT], 5000, 8.9);
        let row = rank(
            &seed,
            &[candidate(1, other), candidate(2, sequel), candidate(3, namesake), candidate(4, original)],
            &weights(),
            10,
        );
        assert_eq!(ids(&row)[..3], [4, 2, 1]);
        assert!(row[0].franchise && row[1].franchise && !row[2].franchise);
        assert!(!row.iter().any(|s| s.id == 3 && s.franchise));
    }

    #[test]
    fn film_collections_are_franchise_whatever_their_names() {
        let mut seed = title("First Contact", &[DRAMA], &[WARD], 300, 7.0);
        seed.collection = Some(42);
        let mut sequel = title("Second Wave", &[DRAMA], &[HEIST], 300, 6.5);
        sequel.collection = Some(42);
        let row = rank(
            &seed,
            &[candidate(1, title("Ward", &[DRAMA], &[WARD], 900, 8.0)), candidate(2, sequel)],
            &weights(),
            10,
        );
        assert_eq!(ids(&row), [2, 1]);
        assert!(row[0].franchise);
    }

    #[test]
    fn animation_and_kids_titles_sink_below_live_action_for_a_live_action_seed() {
        let seed = title("Ward Nine", &[DRAMA], &[WARD, NIGHT_SHIFT], 500, 8.0);
        let cartoon = candidate(1, title("Ward Toons", &[ANIMATION, DRAMA], &[WARD, NIGHT_SHIFT], 5000, 8.5));
        let weaker = candidate(2, title("Ward Ten", &[DRAMA], &[WARD], 300, 7.0));
        assert_eq!(ids(&rank(&seed, &[cartoon, weaker], &weights(), 10)), [2, 1]);
    }

    #[test]
    fn talk_and_reality_and_barely_known_titles_are_left_out() {
        let seed = title("Ward Nine", &[DRAMA], &[WARD], 500, 8.0);
        let talk = candidate(1, title("Ward Talk", &[10767], &[WARD], 500, 8.0));
        let unknown = candidate(2, title("Ward Ten", &[DRAMA], &[WARD], 3, 9.0));
        let fine = candidate(3, title("Ward Eleven", &[DRAMA], &[WARD], 300, 7.0));
        assert_eq!(ids(&rank(&seed, &[talk, unknown, fine], &weights(), 10)), [3]);
    }

    #[test]
    fn the_sources_own_recommendations_count() {
        let seed = title("Ward Nine", &[DRAMA], &[WARD], 500, 8.0);
        let mut listed = candidate(1, title("Quiet Hours", &[DRAMA], &[], 500, 7.5));
        listed.evidence.rec_rank = Some(0);
        let unlisted = candidate(2, title("Loud Hours", &[DRAMA], &[], 500, 7.5));
        assert_eq!(ids(&rank(&seed, &[unlisted, listed], &weights(), 10)), [1, 2]);
    }

    #[test]
    fn near_copies_are_spread_out() {
        let seed = title("Ward Nine", &[DRAMA], &[WARD, NIGHT_SHIFT, HEIST], 500, 8.0);
        // Two titles alike in every way, and one that matches the seed a little less but differently.
        let a = candidate(1, title("Ward A", &[DRAMA], &[WARD, NIGHT_SHIFT], 500, 7.6));
        let b = candidate(2, title("Ward B", &[DRAMA], &[WARD, NIGHT_SHIFT], 500, 7.5));
        let c = candidate(3, title("Heist Ward", &[DRAMA], &[HEIST, WARD], 500, 7.4));
        assert_eq!(ids(&rank(&seed, &[a, b, c], &weights(), 10)), [1, 3, 2]);
    }

    #[test]
    fn the_shortlist_keeps_titles_named_like_the_seed_for_a_closer_look() {
        let seed = title("Night Ward", &[DRAMA], &[WARD], 500, 8.0);
        let mut spin = candidate(1, title("Night Ward: Origins", &[DRAMA], &[], 30, 6.0));
        spin.features.full = false;
        let mut strong = candidate(2, title("Ward Ten", &[DRAMA], &[], 900, 8.0));
        strong.features.full = false;
        strong.evidence.keyword_hits = vec![WARD];
        assert_eq!(shortlist(&seed, &[strong, spin], &weights(), 0, 3), [1]);
    }

    #[test]
    fn name_roots() {
        assert_eq!(name_root("Night Ward: Second Shift"), "night ward");
        assert_eq!(name_root("Night Ward – Origins"), "night ward");
        assert_eq!(name_root("Night Ward"), "night ward");
        assert!(same_root("night ward", "Night Ward: Origins"));
        assert!(same_root("night ward", "Night Ward"));
        assert!(!same_root("night ward", "Night Wards"));
        assert!(!same_root("night ward", "Night Ward's Lab"));
        assert!(!same_root("night ward", "Night Ward Mysteries"));
        assert!(same_root("night ward", "Night Ward 2"));
        assert!(same_root("night ward", "Night Ward III"));
        assert!(same_root("night ward", "Night Ward - The Movie"));
        assert!(!same_root("the", "The Anything"));
    }
}
