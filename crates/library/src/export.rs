//! A profile's own data as a file the person keeps: one versioned JSON document that
//! "Import a Polarity export" reads back (through [`Space::import_links`] and
//! [`Space::import_exported`], so newer entries already here win), and the watch history as
//! CSV for a spreadsheet.
//!
//! Only what the person made is written: library items, every progress entry, anime links and
//! the playlists the front end hands in. The source last played (`Progress::stream`) is never
//! written, and a picture is kept only as a plain web address (no query, fragment or sign-in
//! part), so neither file carries add-on links, stream links or tokens.

use serde::{Deserialize, Serialize};

use crate::{AnimeLink, LibraryItem, Progress, Space};

/// What the `app` field says.
pub const EXPORT_APP: &str = "polarity";
/// The document's shape. A reader refuses a newer one.
pub const EXPORT_VERSION: u32 = 1;

/// The JSON document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    pub app: String,
    pub version: u32,
    /// ms.
    pub exported_at: u64,
    pub library: Vec<LibraryItem>,
    pub progress: Vec<ExportProgress>,
    pub anime_links: Vec<AnimeLink>,
    #[serde(default)]
    pub playlists: Vec<ExportPlaylist>,
}

/// A progress entry as exported: [`Progress`] without the source it played from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub meta_id: String,
    pub video_id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_title: Option<String>,
    /// Seconds.
    pub position: f64,
    pub duration: f64,
    pub updated_at: u64,
}

/// A playlist, as the front end keeps it (src/lib/library/playlists.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlaylist {
    pub id: String,
    pub name: String,
    pub updated_at: u64,
    pub items: Vec<ExportPlaylistItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportPlaylistItem {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
}

/// A picture's address only when it is a plain web address: one with a query, a fragment or a
/// sign-in part may carry a token, and the picture is looked up again without it.
pub fn clean_image(url: Option<String>) -> Option<String> {
    let url = url?;
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split('/').next().unwrap_or_default();
    (!host.is_empty() && !host.contains('@') && !url.contains(['?', '#', ' '])).then_some(url)
}

impl From<&Progress> for ExportProgress {
    fn from(p: &Progress) -> Self {
        ExportProgress {
            meta_id: p.meta_id.clone(),
            video_id: p.video_id.clone(),
            ty: p.ty.clone(),
            name: p.name.clone(),
            poster: clean_image(p.poster.clone()),
            background: clean_image(p.background.clone()),
            season: p.season,
            episode: p.episode,
            episode_title: p.episode_title.clone(),
            position: p.position,
            duration: p.duration,
            updated_at: p.updated_at,
        }
    }
}

impl From<ExportProgress> for Progress {
    fn from(p: ExportProgress) -> Self {
        Progress {
            meta_id: p.meta_id,
            video_id: p.video_id,
            ty: p.ty,
            name: p.name,
            background: p.background,
            poster: p.poster,
            season: p.season,
            episode: p.episode,
            episode_title: p.episode_title,
            stream: None,
            position: p.position,
            duration: p.duration,
            updated_at: p.updated_at,
        }
    }
}

/// Every progress entry, newest first.
fn progress_newest_first(space: &Space) -> Vec<&Progress> {
    let mut all: Vec<&Progress> = space.progress.values().collect();
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.video_id.cmp(&b.video_id)));
    all
}

impl Export {
    /// The document for `space` at `at` (ms), with the playlists the front end keeps.
    pub fn of(space: &Space, playlists: Vec<ExportPlaylist>, at: u64) -> Export {
        let library = space
            .library_list()
            .into_iter()
            .map(|item| LibraryItem { poster: clean_image(item.poster), ..item })
            .collect();
        let playlists = playlists
            .into_iter()
            .map(|p| ExportPlaylist {
                items: p.items.into_iter().map(|i| ExportPlaylistItem { poster: clean_image(i.poster), ..i }).collect(),
                ..p
            })
            .collect();
        Export {
            app: EXPORT_APP.into(),
            version: EXPORT_VERSION,
            exported_at: at,
            library,
            progress: progress_newest_first(space).into_iter().map(ExportProgress::from).collect(),
            anime_links: space.links.values().filter(|l| !l.removed).cloned().collect(),
            playlists,
        }
    }

    /// Reads a document back; fails on another app's file or a newer version.
    pub fn read(json: &str) -> Result<Export, String> {
        let value: serde_json::Value = serde_json::from_str(json).map_err(|_| "This isn't a JSON file.".to_owned())?;
        if value.get("app").and_then(|a| a.as_str()) != Some(EXPORT_APP) {
            return Err("This isn't a Polarity export.".into());
        }
        match value.get("version").and_then(|v| v.as_u64()) {
            Some(v) if v > EXPORT_VERSION as u64 => {
                return Err("This export is from a newer version of Polarity.".into());
            }
            Some(_) => {}
            None => return Err("This export has no version.".into()),
        }
        serde_json::from_value(value).map_err(|e| format!("This export can't be read: {e}"))
    }

    /// Adds the document to `space`: links first, so titles land under the ids they lead to.
    /// Newer entries already in `space` stay. Returns library items, progress entries and links added.
    pub fn import_into(self, space: &mut Space, at: u64) -> (usize, usize, usize) {
        let links = space.import_links(self.anime_links);
        let (library, progress) =
            space.import_exported(self.library, self.progress.into_iter().map(Progress::from).collect(), at);
        (library, progress, links)
    }
}

/// The watch history as CSV: one row per progress entry, newest first. "Watched on" is UTC.
pub fn history_csv(space: &Space) -> String {
    let mut out = String::from("Title,Type,Season,Episode,Episode title,Watched on (UTC),Progress\r\n");
    for p in progress_newest_first(space) {
        let ty = match p.ty.as_str() {
            "movie" => "Movie",
            "series" => "Series",
            other => other,
        };
        let number = |n: Option<u32>| n.map(|n| n.to_string()).unwrap_or_default();
        let percent = format!("{}%", (p.fraction() * 100.0).round() as u32);
        let row = [
            p.name.as_str(),
            ty,
            &number(p.season),
            &number(p.episode),
            p.episode_title.as_deref().unwrap_or_default(),
            &utc_minute(p.updated_at),
            &percent,
        ];
        out.push_str(&row.iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

/// One CSV cell: quoted when it holds a comma, quote or line break, and a leading `=`, `+`,
/// `-`, `@`, tab or carriage return made plain text (a `'` before it) so a spreadsheet
/// doesn't read it as a formula.
pub fn csv_cell(text: &str) -> String {
    let text = if text.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{text}") } else { text.to_owned() };
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

/// `2026-11-14 09:05` for a time in ms since 1970, UTC.
pub fn utc_minute(ms: u64) -> String {
    let (y, m, d) = civil_date(ms / 86_400_000);
    let minutes = (ms / 60_000) % 1440;
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}", minutes / 60, minutes % 60)
}

/// `2026-11-14` for a time in ms since 1970, UTC: what export file names carry.
pub fn utc_day(ms: u64) -> String {
    let (y, m, d) = civil_date(ms / 86_400_000);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Year, month and day of a day count since 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil_date(days: u64) -> (i64, u32, u32) {
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::space::tests::{item, link, progress};

    fn watched(meta: &str, video: &str, at: u64) -> Progress {
        Progress {
            stream: Some(polar_addon::Stream {
                url: Some("https://media.example.com/film.mkv?token=TOKEN".into()),
                ..Default::default()
            }),
            poster: Some("https://images.example.com/p/poster.jpg".into()),
            background: Some("https://images.example.com/b.jpg?key=xxx".into()),
            ..progress(meta, video, at, 600.0)
        }
    }

    fn space() -> Space {
        let mut s = Space::default();
        s.library_toggle(item("tt0000001", 0), 100);
        s.library_toggle(
            LibraryItem { poster: Some("https://user:xxx@images.example.com/a.jpg".into()), ..item("tt0000002", 0) },
            200,
        );
        s.progress_save(vec![watched("tt0000001", "tt0000001:1:1", 0), watched("tt0000001", "tt0000001:1:2", 0)], 300);
        s.progress_save(vec![watched("tt0000003", "tt0000003", 0)], 400);
        s.link_anime(link(7, "tt0000001", Some(70), 50));
        s.link_anime(link(8, "kitsu:80", None, 60));
        s.unlink_anime(8, 70);
        s
    }

    #[test]
    fn a_round_trip_keeps_every_entry_and_its_time_and_no_stream() {
        let original = space();
        let playlists = vec![ExportPlaylist {
            id: "p1".into(),
            name: "Weekend".into(),
            updated_at: 5,
            items: vec![ExportPlaylistItem {
                id: "tt0000001".into(),
                ty: "series".into(),
                name: Some("Show".into()),
                poster: Some("https://images.example.com/x.jpg?t=TOKEN".into()),
            }],
        }];
        let json = serde_json::to_string(&Export::of(&original, playlists, 1_000)).unwrap();
        assert!(!json.contains("stream") && !json.contains("media.example.com") && !json.contains("TOKEN"));
        assert!(!json.contains("xxx"), "pictures with a key or sign-in part are left out");
        assert!(json.contains("https://images.example.com/p/poster.jpg"));

        let doc = Export::read(&json).unwrap();
        assert_eq!((doc.app.as_str(), doc.version, doc.exported_at), ("polarity", 1, 1_000));
        assert_eq!(doc.progress.len(), 3, "every entry, not only the latest per title");
        assert_eq!(doc.anime_links.len(), 1, "a removed link isn't exported");
        assert_eq!(doc.playlists[0].items[0].poster, None);

        let mut copy = Space::default();
        assert_eq!(doc.clone().import_into(&mut copy, 9_999), (2, 3, 1));
        for (id, p) in &original.progress {
            let q = &copy.progress[id];
            assert_eq!((q.updated_at, q.position, &q.meta_id), (p.updated_at, p.position, &p.meta_id));
            assert!(q.stream.is_none());
        }
        for (id, i) in &original.library {
            assert_eq!(copy.library[id].added_at, i.added_at);
        }
        assert_eq!(copy.links[&7].updated_at, 50);

        // Again: nothing new. Into the original: nothing there is older, so nothing changes.
        assert_eq!(doc.clone().import_into(&mut copy, 9_999), (0, 0, 0));
        let mut same = original.clone();
        assert_eq!(doc.import_into(&mut same, 9_999), (0, 0, 0));
        assert!(same.progress["tt0000001:1:1"].stream.is_some(), "what's here keeps its source");
    }

    #[test]
    fn newer_entries_here_win_over_the_export() {
        let doc = Export::of(&space(), vec![], 1_000);
        let mut here = Space::default();
        here.progress_save(vec![progress("tt0000003", "tt0000003", 0, 5.0)], 900);
        assert_eq!(doc.import_into(&mut here, 9_999).1, 2);
        assert_eq!(here.progress["tt0000003"].position, 5.0);
    }

    #[test]
    fn another_apps_file_or_a_newer_version_is_refused() {
        assert!(Export::read("not json").is_err());
        assert!(Export::read(r#"{"app":"other","version":1}"#).unwrap_err().contains("isn't a Polarity export"));
        assert!(Export::read(r#"{"app":"polarity","version":2}"#).unwrap_err().contains("newer version"));
        assert!(Export::read(r#"{"app":"polarity"}"#).is_err());
        assert!(Export::read(r#"{"app":"polarity","version":1,"exportedAt":1}"#).is_err());
        let empty = r#"{"app":"polarity","version":1,"exportedAt":1,"library":[],"progress":[],"animeLinks":[]}"#;
        assert_eq!(Export::read(empty).unwrap().playlists, vec![]);
    }

    #[test]
    fn csv_cells_are_quoted_and_formulas_neutralised() {
        assert_eq!(csv_cell("Plain"), "Plain");
        assert_eq!(csv_cell("One, Two"), "\"One, Two\"");
        assert_eq!(csv_cell("Say \"hi\""), "\"Say \"\"hi\"\"\"");
        assert_eq!(csv_cell("Line\nbreak"), "\"Line\nbreak\"");
        assert_eq!(csv_cell("=1+1"), "'=1+1");
        assert_eq!(csv_cell("+cmd"), "'+cmd");
        assert_eq!(csv_cell("-2"), "'-2");
        assert_eq!(csv_cell("@sum"), "'@sum");
        assert_eq!(csv_cell("=A1,\"x\""), "\"'=A1,\"\"x\"\"\"");
        assert_eq!(csv_cell("A = B"), "A = B");
    }

    #[test]
    fn the_history_csv_has_a_row_per_entry_newest_first() {
        let mut s = Space::default();
        let mut ep = progress("tt0000001", "tt0000001:1:2", 0, 500.0);
        ep.name = "=Show, the \"Series\"".into();
        ep.season = Some(1);
        ep.episode = Some(2);
        ep.episode_title = Some("Two\nLines".into());
        s.progress_save(vec![ep], 1_763_111_100_000);
        let mut film = progress("tt0000002", "tt0000002", 0, 1000.0);
        film.ty = "movie".into();
        film.name = "Film".into();
        s.progress_save(vec![film], 1_763_111_160_000);
        let csv = history_csv(&s);
        assert_eq!(
            csv,
            "Title,Type,Season,Episode,Episode title,Watched on (UTC),Progress\r\n\
             Film,Movie,,,,2025-11-14 09:06,100%\r\n\
             \"'=Show, the \"\"Series\"\"\",Series,1,2,\"Two\nLines\",2025-11-14 09:05,50%\r\n"
        );
    }

    #[test]
    fn dates_are_utc_calendar_days() {
        assert_eq!(utc_minute(0), "1970-01-01 00:00");
        assert_eq!(utc_day(951_782_400_000), "2000-02-29");
        assert_eq!(utc_minute(1_763_111_100_000), "2025-11-14 09:05");
    }

    #[test]
    fn only_plain_picture_addresses_are_kept() {
        let keep = |u: &str| clean_image(Some(u.into()));
        assert!(keep("https://images.example.com/a.jpg").is_some());
        assert!(keep("http://images.example.com/a.jpg").is_some());
        assert!(keep("https://images.example.com/a.jpg?api_key=xxx").is_none());
        assert!(keep("https://u:p@images.example.com/a.jpg").is_none());
        assert!(keep("file:///a.jpg").is_none());
        assert!(keep("data:image/png;base64,xxx").is_none());
    }
}
