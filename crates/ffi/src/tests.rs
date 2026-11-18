use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;

fn block<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
}

/// A fresh folder for one test's data file.
fn dir(name: &str) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let n = N.fetch_add(1, Ordering::SeqCst);
    let d = std::env::temp_dir().join(format!("polar-ffi-{}-{name}-{n}", std::process::id()));
    std::fs::remove_dir_all(&d).ok();
    d
}

/// A core with no index: only the add-ons' answers.
fn core(name: &str) -> Arc<Core> {
    Core::open(dir(name), None).unwrap()
}

const MANIFEST: &str = r#"{
  "id": "org.example.films", "version": "1.0.0", "name": "Example Films",
  "resources": ["catalog", "meta", "stream"], "types": ["movie", "series"], "idPrefixes": ["tt", "ex:"],
  "catalogs": [
    {"type": "movie", "id": "fresh", "name": "Fresh"},
    {"type": "movie", "id": "find", "name": "Find", "extra": [{"name": "search", "isRequired": true}]},
    {"type": "series", "id": "empty", "name": "Nothing here"}
  ]
}"#;

const CATALOG: &str = r#"{"metas": [
  {"id": "ex:1", "type": "movie", "name": "The Quiet Harbour", "poster": "https://img.example.com/1.jpg", "releaseInfo": "1931"},
  {"id": "ex:2", "type": "movie", "name": "Lanterns at Dusk"}
]}"#;

const META: &str = r#"{"meta": {"id": "ex:3", "type": "series", "name": "Tidewater", "description": "A made-up show.",
  "genres": ["Drama"], "videos": [
    {"id": "ex:3:0:1", "title": "Special", "season": 0, "episode": 1},
    {"id": "ex:3:1:2", "title": "Second", "season": 1, "episode": 2},
    {"id": "ex:3:1:1", "title": "First", "season": 1, "episode": 1}
  ]}}"#;

const STREAMS: &str = r#"{"streams": [
  {"name": "Example\n720p", "title": "Film 720p", "url": "https://media.example.com/film-720.mkv"},
  {"name": "Example\n1080p", "title": "Film 1080p", "url": "https://media.example.com/film.mkv",
   "behaviorHints": {"proxyHeaders": {"request": {"Referer": "https://media.example.com/", "Cookie": "session=xxx"}}}},
  {"name": "Example\n2160p", "infoHash": "0000000000000000000000000000000000000000", "fileIdx": 0},
  {"name": "Trailer", "ytId": "aaaaaaaaaaa"},
  {"name": "Example\n1080p", "title": "Local file", "url": "file:///var/film.mkv"}
]}"#;

/// Serves the add-on above at `<base>/manifest.json`; `/broken/...` answers 500.
async fn addon() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]);
                let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let body = match path.as_str() {
                    "/manifest.json" => Some(MANIFEST),
                    "/catalog/movie/fresh.json" => Some(CATALOG),
                    "/catalog/series/empty.json" => Some(r#"{"metas": []}"#),
                    "/meta/series/ex:3.json" | "/meta/series/ex%3A3.json" => Some(META),
                    p if p.starts_with("/stream/movie/") => Some(STREAMS),
                    _ => None,
                };
                let reply = match body {
                    Some(b) => format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{b}",
                        b.len()
                    ),
                    None => "HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".into(),
                };
                let _ = sock.write_all(reply.as_bytes()).await;
            });
        }
    });
    base
}

#[test]
fn addons_that_answer_are_listed_and_the_rest_left_out() {
    block(async {
        let base = addon().await;
        let core = core("addons");
        let listed =
            core.set_addons(vec![format!("{base}/manifest.json"), format!("{base}/broken/manifest.json")]).await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Example Films");
        assert!(listed[0].streams);
        // The search-only catalog isn't a Home row.
        assert_eq!(listed[0].rows, 2);
    });
}

#[test]
fn home_shows_addon_rows_that_have_titles() {
    block(async {
        let base = addon().await;
        let core = core("home");
        core.set_addons(vec![format!("{base}/manifest.json")]).await;
        let rows = core.home().await;
        assert_eq!(rows.len(), 1, "{rows:?}");
        assert_eq!(rows[0].key, "addon/0/movie/fresh");
        assert_eq!(rows[0].title, "Fresh · Example Films");
        assert_eq!(rows[0].cards[0].name, "The Quiet Harbour");
        assert_eq!(rows[0].cards[0].release_info.as_deref(), Some("1931"));
        assert_eq!(rows[0].cards[1].poster, None);
    });
}

#[test]
fn a_title_from_an_addon_lists_episodes_in_order_specials_last() {
    block(async {
        let base = addon().await;
        let core = core("title");
        core.set_addons(vec![format!("{base}/manifest.json")]).await;
        let title = core.title("series".into(), "ex:3".into()).await.unwrap();
        assert_eq!(title.card.name, "Tidewater");
        assert_eq!(title.genres, ["Drama"]);
        let order: Vec<&str> = title.episodes.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(order, ["ex:3:1:1", "ex:3:1:2", "ex:3:0:1"]);
    });
}

#[test]
fn a_title_no_addon_describes_is_unsupported() {
    block(async {
        let core = core("unsupported");
        let err = core.title("movie".into(), "other:1".into()).await.unwrap_err();
        assert!(matches!(err, CoreError::Unsupported { .. }), "{err:?}");
    });
}

#[test]
fn sources_keep_playable_links_best_first_with_safe_headers() {
    block(async {
        let base = addon().await;
        let core = core("sources");
        core.set_addons(vec![format!("{base}/manifest.json")]).await;
        let got = core.sources("movie".into(), "tt0000001".into()).await;
        assert_eq!(got.asked, ["Example Films"]);
        assert!(got.failed.is_empty());
        // No torrent, YouTube id or local file: the TV opens http(s) links only.
        let urls: Vec<&str> = got.sources.iter().map(|s| s.url.as_str()).collect();
        assert_eq!(urls, ["https://media.example.com/film.mkv", "https://media.example.com/film-720.mkv"]);
        let best = &got.sources[0];
        assert_eq!(best.text, "Example\n1080p\nFilm 1080p");
        assert_eq!(best.headers, [Header { name: "Referer".into(), value: "https://media.example.com/".into() }]);
        assert!(!best.stream_json.contains("ytId"));
        assert_eq!(header_fields(best.headers.clone()), ["Referer: https://media.example.com/"]);
    });
}

#[test]
fn sources_nobody_serves_ask_no_one() {
    block(async {
        let base = addon().await;
        let core = core("nobody");
        core.set_addons(vec![format!("{base}/manifest.json")]).await;
        let got = core.sources("movie".into(), "other:1".into()).await;
        assert!(got.asked.is_empty() && got.sources.is_empty());
    });
}

fn resume(video: &str, position: f64) -> Resume {
    Resume {
        meta_id: "tt0000002".into(),
        video_id: video.into(),
        kind: "series".into(),
        name: "Tidewater".into(),
        poster: None,
        background: None,
        season: Some(1),
        episode: Some(1),
        episode_title: None,
        position,
        duration: 1500.0,
        stream_json: r#"{"url":"https://media.example.com/film.mkv"}"#.into(),
        updated_at: 0,
    }
}

#[test]
fn progress_is_kept_across_starts() {
    let d = dir("progress");
    let core = Core::open(d.clone(), None).unwrap();
    core.save_progress(resume("tt0000002:1:1", 600.0)).unwrap();
    core.save_progress(resume("tt0000002:1:2", 10.0)).unwrap();
    drop(core);

    let core = Core::open(d, None).unwrap();
    assert_eq!(core.storage_problem(), None);
    let cw = core.continue_watching();
    // Opening the next episode for a few seconds doesn't take the show out.
    assert_eq!(cw.len(), 1);
    assert_eq!(cw[0].video_id, "tt0000002:1:1");
    assert!(cw[0].updated_at > 0);
    assert_eq!(cw[0].stream_json, r#"{"url":"https://media.example.com/film.mkv"}"#);
    assert_eq!(core.progress_for("tt0000002".into()).len(), 2);
}

#[test]
fn a_finished_video_leaves_continue_watching() {
    let core = core("finished");
    core.save_progress(resume("tt0000002:1:1", 1490.0)).unwrap();
    assert!(core.continue_watching().is_empty());
}

#[test]
fn a_file_that_does_not_parse_is_kept_aside() {
    let d = dir("corrupt");
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("polar-tv.json"), b"{\"progress\": ").unwrap();
    let core = Core::open(d.clone(), None).unwrap();
    assert!(core.continue_watching().is_empty());
    let aside = std::fs::read_dir(&d).unwrap().flatten().any(|e| e.file_name().to_string_lossy().contains(".corrupt-"));
    assert!(aside);
}

#[test]
fn a_file_that_cannot_be_read_is_never_written_over() {
    let d = dir("unreadable");
    // A folder where the file should be: reading it fails, and not as "missing".
    std::fs::create_dir_all(d.join("polar-tv.json")).unwrap();
    let core = Core::open(d.clone(), None).unwrap();
    assert!(core.storage_problem().is_some());
    core.save_progress(resume("tt0000002:1:1", 600.0)).unwrap();
    assert!(d.join("polar-tv.json").is_dir());
    // Still kept for this run.
    assert_eq!(core.continue_watching().len(), 1);
}

#[test]
fn player_options_are_the_iphones_and_fetch_nothing_by_themselves() {
    let opts = player_options();
    let get = |n: &str| opts.iter().find(|o| o.name == n).map(|o| o.value.as_str());
    assert_eq!(get("hwdec"), Some("videotoolbox-copy"));
    assert_eq!(get("ao"), Some("audiounit"));
    assert_eq!(get("ytdl"), Some("no"));
    assert_eq!(get("sub-auto"), Some("no"));
    assert_eq!(get("vo"), Some("libmpv"));
    assert_eq!(get("cache"), Some("yes"));
    assert!(opts.iter().all(|o| !o.name.starts_with('-') && !o.value.is_empty()));
}
