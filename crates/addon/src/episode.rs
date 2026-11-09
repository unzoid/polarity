//! Which episode a stream's file is, read from its name, checked against the
//! episode that was asked for. Add-ons sometimes answer with a neighbouring
//! episode's file, and a show asked for by two ids (IMDb's season and episode,
//! an anime's Kitsu number) can bring back another episode under one of them.
//! A file that names another episode goes to the bottom of the list and is
//! never picked by itself; one that says nothing about its episode (a season
//! pack's name, a film-style title) is left as it is.
//!
//! An anime season after the first is the hard case: its Kitsu entry counts
//! from 1 again, so a file named with a bare number and no season ("Show -
//! 06") is as likely the first series' episode 6. A bare number within the
//! earlier seasons is read as theirs, unless the name says this season ("S2",
//! "2nd Season", the season's own title); the number counted from the start
//! of the show is this episode whatever the name.

use std::sync::LazyLock;

use regex::Regex;

use crate::types::Stream;

/// The episode a request was for, in every numbering it's known by.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WantedEpisode {
    /// Season and episode from an IMDb-style id (`tt…:2:5`).
    pub season: Option<u32>,
    pub episode: Option<u32>,
    /// The episode's number in its anime entry: a Kitsu id's (`kitsu:N:5`), counted from 1 in every season.
    pub entry: Option<u32>,
    /// Counted from the start of the show: the absolute number the app knows for an anime episode.
    pub absolute: Vec<u32>,
    /// The season's own titles (a later anime season's, "Made Up Show: The Second Arc"), lower-case words.
    pub names: Vec<Vec<String>>,
}

impl WantedEpisode {
    /// From the ids a stream request asked by, plus absolute numbers the app knows.
    /// `None` for a film (or anything without an episode): nothing to check.
    pub fn from_ids<'a>(ids: impl IntoIterator<Item = &'a str>, absolute: &[u32]) -> Option<Self> {
        let mut want = WantedEpisode { absolute: absolute.to_vec(), ..Default::default() };
        for id in ids {
            let parts: Vec<&str> = id.split(':').collect();
            let num = |i: usize| parts.get(i).and_then(|p| p.parse::<u32>().ok());
            match (parts.first(), parts.len()) {
                (Some(&"kitsu"), 3) => {
                    if let Some(n) = num(2) {
                        want.entry.get_or_insert(n);
                    }
                }
                (_, n) if n >= 3 => {
                    if let (Some(s), Some(e)) = (num(n - 2), num(n - 1)) {
                        want.season.get_or_insert(s);
                        want.episode.get_or_insert(e);
                    }
                }
                _ => {}
            }
        }
        want.absolute.sort_unstable();
        want.absolute.dedup();
        (want.episode.is_some() || want.entry.is_some() || !want.absolute.is_empty()).then_some(want)
    }

    /// The season's own titles, which a file may name it by instead of a number. Titles of a word
    /// or two shorter than 5 letters say too little to count.
    pub fn with_names<'a>(mut self, names: impl IntoIterator<Item = &'a str>) -> Self {
        self.names = names.into_iter().map(words).filter(|w| w.len() >= 2 || w.iter().any(|w| w.len() >= 5)).collect();
        self
    }

    /// How many episodes the seasons before this one have, when this is a later season: the
    /// absolute number less the episode's number in its entry (or its IMDb season).
    pub fn earlier(&self) -> Option<u32> {
        let n = self.entry.or(self.episode)?;
        self.absolute.iter().filter(|&&a| a > n).map(|a| a - n).max()
    }
}

/// A text's words, lower-case, without punctuation.
fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}

/// What a file's name says it is: one episode or a run of them, with or
/// without a season.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FileEpisode {
    pub season: Option<u32>,
    pub from: u32,
    pub to: u32,
    /// Without a season number, the name gives the season's own title: it's that season's episode.
    pub titled: bool,
}

impl FileEpisode {
    fn has(&self, n: u32) -> bool {
        (self.from..=self.to).contains(&n)
    }

    /// A bare number a later season's file can't mean: one within the seasons before it.
    fn earlier_season(&self, want: &WantedEpisode) -> bool {
        self.season.is_none() && !self.titled && want.earlier().is_some_and(|k| self.to <= k)
    }

    /// Whether this file is the episode asked for. A season the request
    /// doesn't share still matches by an absolute number, or by the entry's
    /// number when the file isn't the first season's: anime releases count
    /// seasons their own way.
    pub fn fits(&self, want: &WantedEpisode) -> bool {
        if want.absolute.iter().any(|&n| self.has(n)) {
            return true;
        }
        let later = want.earlier().is_some();
        match self.season {
            Some(s) if want.season == Some(s) => want.episode.is_some_and(|e| self.has(e)),
            Some(s) => want.entry.is_some_and(|e| self.has(e)) && !(later && s == 1),
            None if self.earlier_season(want) => false,
            None => want.entry.is_some_and(|e| self.has(e)) || want.episode.is_some_and(|e| self.has(e)),
        }
    }

    /// How a source list shows it: "Season 1, Episode 5", "Season 1, Episodes 5–6", "Episode 5",
    /// "Episodes 1–12". A bare number read as an earlier season's says so: "Season 1, Episode 6"
    /// when the request was for season 2, else "Episode 6 of an earlier season".
    pub fn label(&self, want: Option<&WantedEpisode>) -> String {
        let episodes = if self.from == self.to {
            format!("Episode {}", self.from)
        } else {
            format!("Episodes {}–{}", self.from, self.to)
        };
        match self.season {
            Some(s) => format!("Season {s}, {episodes}"),
            None => match want.filter(|w| self.earlier_season(w)) {
                Some(w) if w.season == Some(2) => format!("Season 1, {episodes}"),
                Some(_) => format!("{episodes} of an earlier season"),
                None => episodes,
            },
        }
    }
}

// Season and episode: "S01E05", "s1 e5", "S01E05E06", "S01E05-E06", "S01E05-06".
static SEASON_EP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,4})(?:(?:-e?|e)(\d{1,4})\b)?").unwrap());
// "1x05", but not "1920x1080".
static CROSS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?:[^a-z0-9]|$)").unwrap());
static WORDS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bseason[ ._]?(\d{1,2})[ ._-]*(?:episode|ep)[ ._]?(\d{1,4})\b").unwrap());
// Without a season: "E05", "Ep 5", "Episode 05".
static EP_ONLY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^a-z0-9])(?:episode|ep|e)[ ._]?(\d{1,4})(?:v\d)?(?:[^a-z0-9]|$)").unwrap());
// Anime style: "[Group] Show - 05 (1080p).mkv", "Show - 05v2 [x]", batches "Show - 01-12", "01 ~ 12".
static DASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s-\s(\d{1,4})(?:v\d)?(?:\s?[~-]\s?(\d{1,4})(?:v\d)?)?(?:[\s\[(]|\.[a-z0-9]{2,4}$|$)").unwrap()
});

// A season named next to a bare number: "Show S2 - 05", "Show Season 2 - 05", "Show 2nd Season - 05".
static SEASON_MARK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:^|[^a-z0-9])(?:s(\d{1,2})|season[ ._-]?(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)[ ._-]season)(?:[^a-z0-9]|$)",
    )
    .unwrap()
});

/// What one line of text says about its episode, if anything.
fn read_season(text: &str) -> Option<FileEpisode> {
    let n = |m: Option<regex::Match>| m.and_then(|m| m.as_str().parse::<u32>().ok());
    if let Some(c) = SEASON_EP.captures(text) {
        let (from, to) = (n(c.get(2))?, n(c.get(3)));
        return Some(FileEpisode {
            season: n(c.get(1)),
            from,
            to: to.filter(|&t| t > from).unwrap_or(from),
            titled: false,
        });
    }
    [&*CROSS, &*WORDS].iter().find_map(|re| {
        let c = re.captures(text)?;
        let e = n(c.get(2))?;
        Some(FileEpisode { season: n(c.get(1)), from: e, to: e, titled: false })
    })
}

fn read_number(text: &str) -> Option<FileEpisode> {
    let n = |m: Option<regex::Match>| m.and_then(|m| m.as_str().parse::<u32>().ok());
    // A year after the dash is a title's, not an episode.
    let year = |v: &u32| (1900..2100).contains(v);
    let (from, to) = if let Some(c) = DASH.captures(text) {
        let from = n(c.get(1)).filter(|v| !year(v))?;
        (from, n(c.get(2)).filter(|&t| t > from).unwrap_or(from))
    } else {
        let e = n(EP_ONLY.captures(text)?.get(1))?;
        (e, e)
    };
    let season = SEASON_MARK.captures(text).and_then(|c| n(c.get(1).or(c.get(2)).or(c.get(3))));
    Some(FileEpisode { season, from, to, titled: false })
}

/// The text a stream's episode is read from: `behaviorHints.filename` when it says, else the rows the add-on wrote.
fn file_name(stream: &Stream) -> Option<&str> {
    stream.behavior_hints.as_ref().and_then(|h| h.get("filename")).and_then(|f| f.as_str())
}

/// The episode a stream's file names: `behaviorHints.filename` first, else the
/// rows the add-on wrote. A season and episode anywhere in them counts; a bare
/// number only in the file's name or the first line (the release), where it
/// can't be a size or a count.
pub fn file_episode(stream: &Stream) -> Option<FileEpisode> {
    if let Some(found) = file_name(stream).and_then(|f| read_season(f).or_else(|| read_number(f))) {
        return Some(found);
    }
    let rows: Vec<&str> =
        [stream.title.as_deref(), stream.description.as_deref()].into_iter().flatten().flat_map(str::lines).collect();
    rows.iter().find_map(|l| read_season(l)).or_else(|| rows.first().and_then(|l| read_number(l)))
}

/// [`file_episode`], with the season's own titles (`want.names`) looked for in a name that gives no season number.
pub fn file_episode_for(stream: &Stream, want: &WantedEpisode) -> Option<FileEpisode> {
    let mut found = file_episode(stream)?;
    if found.season.is_none() && !want.names.is_empty() {
        let text = file_name(stream).or(stream.title.as_deref().and_then(|t| t.lines().next())).unwrap_or_default();
        let have = words(text);
        found.titled = want.names.iter().any(|name| have.windows(name.len()).any(|w| w == name.as_slice()));
    }
    Some(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn named(title: &str) -> Stream {
        Stream { title: Some(title.into()), ..Default::default() }
    }

    fn file(name: &str) -> Stream {
        Stream {
            title: Some("Addon row".into()),
            behavior_hints: Some(json!({ "filename": name })),
            ..Default::default()
        }
    }

    fn read(title: &str) -> Option<(Option<u32>, u32, u32)> {
        file_episode(&named(title)).map(|f| (f.season, f.from, f.to))
    }

    #[test]
    fn reads_season_and_episode_in_the_usual_spellings() {
        assert_eq!(read("Made.Up.Show.S01E05.1080p.WEB.x264"), Some((Some(1), 5, 5)));
        assert_eq!(read("Made Up Show s2 e7 720p"), Some((Some(2), 7, 7)));
        assert_eq!(read("Made.Up.Show.S01E05E06.1080p"), Some((Some(1), 5, 6)));
        assert_eq!(read("Made.Up.Show.S01E05-E06.mkv"), Some((Some(1), 5, 6)));
        assert_eq!(read("Made.Up.Show.S01E05-06.mkv"), Some((Some(1), 5, 6)));
        assert_eq!(read("Made Up Show 1x05 HDTV"), Some((Some(1), 5, 5)));
        assert_eq!(read("Made Up Show Season 2 Episode 3"), Some((Some(2), 3, 3)));
        // A resolution after the number isn't the end of a run.
        assert_eq!(read("Made.Up.Show.S01E05-1080p"), Some((Some(1), 5, 5)));
    }

    #[test]
    fn reads_numbers_without_a_season() {
        assert_eq!(read("[Group] Made Up Show - 05 (1080p) [ABCD1234].mkv"), Some((None, 5, 5)));
        assert_eq!(read("[Group] Made Up Show - 05v2 [1080p]"), Some((None, 5, 5)));
        assert_eq!(read("[Group] Made Up Show - 01-12 [Batch]"), Some((None, 1, 12)));
        assert_eq!(read("Made Up Show E05 1080p"), Some((None, 5, 5)));
        assert_eq!(read("Made Up Show Ep 112"), Some((None, 112, 112)));
        assert_eq!(read("Made Up Show - 05.mkv"), Some((None, 5, 5)));
    }

    #[test]
    fn says_nothing_for_packs_films_and_noise() {
        assert_eq!(read("Made.Up.Show.S01.1080p.WEB.x264"), None);
        assert_eq!(read("Made Up Show Season 1 Complete 1080p"), None);
        assert_eq!(read("Public Domain Film (1927) 1920x1080 H.264 5.1"), None);
        assert_eq!(read("Made Up Film - 2024 [1080p]"), None);
        assert_eq!(read("Made.Up.Film.2010.2160p.WEB-DL.DDP5.1.HEVC"), None);
    }

    #[test]
    fn the_file_name_comes_before_the_rows_and_a_bare_number_only_from_the_first_line() {
        let mut s = file("Made.Up.Show.S01E06.mkv");
        s.title = Some("Made.Up.Show.S01E05.1080p".into());
        assert_eq!(file_episode(&s).map(|f| f.from), Some(6));
        // A pack's name, then the file inside it on the next line.
        assert_eq!(read("Made.Up.Show.S01.1080p\nMade.Up.Show.S01E04.mkv"), Some((Some(1), 4, 4)));
        // " - 12 " further down is a count, not an episode.
        assert_eq!(read("Made Up Show 1080p\nsize 1.2 GB - 12 files"), None);
    }

    fn want(ids: &[&str], absolute: &[u32]) -> WantedEpisode {
        WantedEpisode::from_ids(ids.iter().copied(), absolute).unwrap()
    }

    fn fits(title: &str, w: &WantedEpisode) -> Option<bool> {
        file_episode_for(&named(title), w).map(|f| f.fits(w))
    }

    #[test]
    fn wanted_episode_from_the_ids_asked() {
        assert_eq!(WantedEpisode::from_ids(["tt0000001"], &[]), None);
        assert_eq!(WantedEpisode::from_ids(["kitsu:12"], &[]), None);
        let w = want(&["tt0000001:2:5", "kitsu:12:17"], &[29]);
        assert_eq!((w.season, w.episode, w.entry, w.absolute), (Some(2), Some(5), Some(17), vec![29]));
        assert_eq!(want(&["kitsu:12:3"], &[]).entry, Some(3));
        // A later season: its episode 6 is the show's 176th, after 170 episodes before it.
        assert_eq!(want(&["tt0000001:2:6", "kitsu:12:6"], &[176]).earlier(), Some(170));
        assert_eq!(want(&["tt0000001:1:6", "kitsu:12:6"], &[6]).earlier(), None);
        assert_eq!(want(&["kitsu:12:6"], &[]).earlier(), None);
    }

    #[test]
    fn season_numbering_against_the_request() {
        let w = want(&["tt0000001:1:5"], &[]);
        assert_eq!(fits("Made.Up.Show.S01E05.1080p", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S01E06.1080p", &w), Some(false));
        assert_eq!(fits("Made.Up.Show.S02E05.1080p", &w), Some(false));
        assert_eq!(fits("Made.Up.Show.S01E04E05.1080p", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 05 [1080p]", &w), Some(true));
        assert_eq!(fits("Made Up Show E05", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 06 [1080p]", &w), Some(false));
        assert_eq!(fits("[Group] Made Up Show - 01-12 [Batch]", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S01.1080p", &w), None);
    }

    #[test]
    fn absolute_numbering_against_season_numbering() {
        // IMDb's season 2 episode 5 is the anime's episode 17 overall, and its Kitsu entry's episode 5.
        let w = want(&["tt0000001:2:5", "kitsu:12:5"], &[17]);
        assert_eq!(fits("[Group] Made Up Show - 17 (1080p)", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show S2 - 05 (1080p)", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S02E05.1080p", &w), Some(true));
        // The release counts the second cour as its own season.
        assert_eq!(fits("Made.Up.Show.S03E05.1080p", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 18 (1080p)", &w), Some(false));
        assert_eq!(fits("Made.Up.Show.S02E06.1080p", &w), Some(false));
    }

    #[test]
    fn a_kitsu_request_matches_by_its_number_whatever_the_season() {
        let w = want(&["kitsu:12:5"], &[]);
        assert_eq!(fits("Made.Up.Show.S02E05", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 05", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 06", &w), Some(false));
    }

    #[test]
    fn reads_a_season_named_next_to_a_bare_number() {
        assert_eq!(read("[Group] Made Up Show S2 - 06 (1080p)"), Some((Some(2), 6, 6)));
        assert_eq!(read("[Group] Made Up Show Season 2 - 06 [1080p]"), Some((Some(2), 6, 6)));
        assert_eq!(read("[Group] Made Up Show 2nd Season - 06 [1080p]"), Some((Some(2), 6, 6)));
        assert_eq!(read("Made Up Show 3rd Season Ep 06"), Some((Some(3), 6, 6)));
        // Not a season: a codec's, a size's or a title's letters.
        assert_eq!(read("[Group] Made Up Show - 06 [x265 10bit]"), Some((None, 6, 6)));
        assert_eq!(read("[Group] Made Up Shows - 06"), Some((None, 6, 6)));
    }

    /// A second season airing now, after a first series of 170 episodes: its episode 6 is the show's 176th.
    fn later_season() -> WantedEpisode {
        want(&["tt0000001:2:6", "kitsu:12:6"], &[176])
    }

    #[test]
    fn a_later_seasons_bare_number_within_the_earlier_seasons_is_theirs() {
        let w = later_season();
        assert_eq!(fits("[Group] Made Up Show - Ep006 [BDRip 1080p HEVC FLAC].mkv", &w), Some(false));
        assert_eq!(fits("[Group] Made Up Show - 06 (1080p)", &w), Some(false));
        assert_eq!(fits("[Group] Made Up Show - 01-12 [Batch]", &w), Some(false));
        // Named with the first season: another season's.
        assert_eq!(fits("Made.Up.Show.S01E06.1080p", &w), Some(false));
        assert_eq!(fits("[Group] Made Up Show Season 1 - 06", &w), Some(false));
        let label = |t: &str| file_episode_for(&named(t), &w).map(|f| f.label(Some(&w)));
        assert_eq!(label("[Group] Made Up Show - Ep006 [BDRip 1080p].mkv").as_deref(), Some("Season 1, Episode 6"));
        // Asked by the Kitsu entry alone, the season isn't known: only that it's an earlier one.
        let kitsu = want(&["kitsu:12:6"], &[176]);
        let label = file_episode_for(&named("[Group] Made Up Show - 06"), &kitsu).map(|f| f.label(Some(&kitsu)));
        assert_eq!(label.as_deref(), Some("Episode 6 of an earlier season"));
    }

    #[test]
    fn a_later_seasons_file_named_with_its_season_or_absolute_number_is_kept() {
        let w = later_season();
        assert_eq!(fits("Made.Up.Show.S02E06.1080p.WEB", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show S2 - 06 (1080p)", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show 2nd Season - 06 [1080p]", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 176 (1080p)", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 171-182 [Batch]", &w), Some(true));
        // A release that counts the seasons its own way still has the entry's number.
        assert_eq!(fits("Made.Up.Show.S05E06.1080p", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S02E07.1080p", &w), Some(false));
        assert_eq!(fits("[Group] Made Up Show - 177 (1080p)", &w), Some(false));
        // Asked by the Kitsu entry alone: the same.
        let kitsu = want(&["kitsu:12:6"], &[176]);
        assert_eq!(fits("[Group] Made Up Show - 06", &kitsu), Some(false));
        assert_eq!(fits("[Group] Made Up Show S2 - 06", &kitsu), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 176", &kitsu), Some(true));
    }

    #[test]
    fn a_later_season_named_by_its_own_title() {
        let w = later_season().with_names(["Made Up Show: The Second Arc", "Arc", "Made Up Show Second Arc"]);
        assert_eq!(w.names.len(), 2, "a one-word title shorter than 5 letters says too little");
        assert_eq!(fits("[Group] Made Up Show - The Second Arc - 06 (1080p)", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show Second Arc - 06 [1080p]", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 06 (1080p)", &w), Some(false));
        let s = file("[Group] Made Up Show The Second Arc - 06.mkv");
        assert_eq!(file_episode_for(&s, &w).map(|f| f.fits(&w)), Some(true));
    }

    #[test]
    fn a_first_season_or_unknown_numbering_is_as_before() {
        // The first season: no earlier episodes, a bare number is the episode.
        let w = want(&["tt0000001:1:6", "kitsu:12:6"], &[6]);
        assert_eq!(fits("[Group] Made Up Show - 06", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S01E06", &w), Some(true));
        // No absolute number known: nothing to tell the seasons apart by.
        let w = want(&["tt0000001:2:6", "kitsu:12:6"], &[]);
        assert_eq!(fits("[Group] Made Up Show - 06", &w), Some(true));
    }

    #[test]
    fn labels() {
        let f = |season, from, to| FileEpisode { season, from, to, titled: false }.label(None);
        assert_eq!(f(Some(1), 5, 5), "Season 1, Episode 5");
        assert_eq!(f(Some(1), 5, 6), "Season 1, Episodes 5–6");
        assert_eq!(f(None, 5, 5), "Episode 5");
        assert_eq!(f(None, 1, 12), "Episodes 1–12");
    }
}
