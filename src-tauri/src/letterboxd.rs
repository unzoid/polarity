//! A public Letterboxd list, read for Import Playlist: its name and its films' titles and years, in the
//! list's order. Letterboxd's API is by invitation only, so this reads the list's own page (the owner's
//! decision in docs/data-sources.md): only when the user pastes a link and asks, one page after another,
//! and nothing else from the site (no posters, no film pages). Films are then found in Polarity's catalog
//! by title and year, as the export import does (src/lib/library/letterboxdImport.ts).

use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;

use crate::commands::{CmdError, Result};

/// A playlist holds 500 titles (MAX_PLAYLIST_ITEMS); Letterboxd shows 100 a page.
const MAX_FILMS: usize = 500;
const MAX_PAGES: u32 = 5;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilm {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LetterboxdList {
    pub name: String,
    pub films: Vec<ListFilm>,
    /// The list is longer than a playlist holds; only the first [`MAX_FILMS`] were read.
    pub truncated: bool,
}

/// The list's owner and slug from a pasted link (`letterboxd.com/<user>/list/<slug>/…`, with or without
/// `https://` or `www.`), or `None` when it isn't a list's link.
pub fn list_address(input: &str) -> Option<(String, String)> {
    let s = input.trim();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let s = s.strip_prefix("www.").unwrap_or(s);
    let path = s.strip_prefix("letterboxd.com/")?;
    let path = path.split(['?', '#']).next()?;
    let mut parts = path.split('/').filter(|p| !p.is_empty());
    let (user, kind, slug) = (parts.next()?, parts.next()?, parts.next()?);
    let ok = |p: &str| {
        !p.is_empty() && p.len() <= 100 && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    (kind == "list" && ok(user) && ok(slug)).then(|| (user.to_owned(), slug.to_owned()))
}

/// A `boxd.it` short link, which Letterboxd's share button gives.
fn is_short_link(input: &str) -> bool {
    let s = input.trim();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    s.strip_prefix("boxd.it/").is_some_and(|code| !code.is_empty() && code.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// Reads the list a pasted link points to.
pub async fn read_list(link: &str) -> Result<LetterboxdList> {
    let http = client().ok_or_else(|| CmdError::Other("couldn't start a secure connection".into()))?;
    let not_a_list = || CmdError::Unsupported("That isn't a link to a Letterboxd list.".into());
    let (user, slug) = match list_address(link) {
        Some(found) => found,
        None if is_short_link(link) => {
            let short = format!("https://{}", link.trim().trim_start_matches("https://").trim_start_matches("http://"));
            let resp = http.get(short).send().await.map_err(unreachable)?;
            list_address(resp.url().as_str()).ok_or_else(not_a_list)?
        }
        None => return Err(not_a_list()),
    };
    let base = format!("https://letterboxd.com/{user}/list/{slug}/");
    let mut name = String::new();
    let mut films = Vec::new();
    let mut truncated = false;
    for page in 1..=MAX_PAGES {
        let url = if page == 1 { base.clone() } else { format!("{base}page/{page}/") };
        let resp = http.get(&url).send().await.map_err(unreachable)?;
        match resp.status().as_u16() {
            200 => {}
            404 => return Err(CmdError::NotFound("That Letterboxd list wasn't found. Is it public?".into())),
            code => {
                tracing::warn!("Letterboxd list answered {code}");
                return Err(CmdError::Upstream(
                    "Letterboxd didn't share the list just now. Try again in a while.".into(),
                ));
            }
        }
        let html = resp.text().await.map_err(unreachable)?;
        let read = parse_list_page(&html);
        if page == 1 {
            if read.name.is_none() && read.films.is_empty() {
                return Err(not_a_list());
            }
            name = read.name.unwrap_or_else(|| slug.replace('-', " "));
        }
        films.extend(read.films);
        if films.len() > MAX_FILMS {
            films.truncate(MAX_FILMS);
            truncated = true;
            break;
        }
        if !html.contains(&format!("/page/{}/", page + 1)) {
            break;
        }
        if page == MAX_PAGES {
            truncated = true;
        }
    }
    Ok(LetterboxdList { name, films, truncated })
}

fn unreachable(e: reqwest::Error) -> CmdError {
    tracing::warn!("Letterboxd list read failed: {}", e.without_url());
    CmdError::Upstream("Couldn't reach Letterboxd. Check your connection and try again.".into())
}

/// One client for every read; `None` if TLS couldn't start.
fn client() -> Option<&'static reqwest::Client> {
    static HTTP: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(3))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .build()
            .ok()
    })
    .as_ref()
}

#[derive(Debug, Default, PartialEq)]
pub struct ListPage {
    pub name: Option<String>,
    pub films: Vec<ListFilm>,
}

/// One page of a list: its name (`og:title`) and each poster's `data-item-name` ("Title (Year)"), in order.
pub fn parse_list_page(html: &str) -> ListPage {
    let name =
        attr_after(html, r#"<meta property="og:title" content=""#).map(|t| decode(&t)).filter(|t| !t.trim().is_empty());
    let mut films = Vec::new();
    let mut rest = html;
    const ITEM: &str = r#"<li class="posteritem"#;
    while let Some(at) = rest.find(ITEM) {
        rest = &rest[at + ITEM.len()..];
        let end = [rest.find(ITEM), rest.find("</li>")].into_iter().flatten().min().unwrap_or(rest.len());
        let item = &rest[..end];
        if let Some(full) = attr_after(item, r#"data-item-name=""#) {
            let (name, year) = split_year(&decode(&full));
            if !name.is_empty() {
                films.push(ListFilm { name, year });
            }
        }
    }
    ListPage { name, films }
}

/// The text from just after `prefix` to the next `"`.
fn attr_after(html: &str, prefix: &str) -> Option<String> {
    let start = html.find(prefix)? + prefix.len();
    let len = html[start..].find('"')?;
    Some(html[start..start + len].to_owned())
}

/// "Title (1999)" → ("Title", Some(1999)); a name without a year in brackets stays whole.
fn split_year(full: &str) -> (String, Option<u16>) {
    let t = full.trim();
    if let Some(open) = t.strip_suffix(')').and_then(|s| s.rfind(" (").map(|i| (i, s))) {
        let (i, s) = open;
        let digits = &s[i + 2..];
        if digits.len() == 4 && digits.bytes().all(|b| b.is_ascii_digit()) {
            return (s[..i].trim().to_owned(), digits.parse().ok());
        }
    }
    (t.to_owned(), None)
}

/// HTML's entities in an attribute: the named ones Letterboxd uses and numeric ones.
fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let end = rest.find(';').filter(|&end| end <= 12);
        let ch = end.and_then(|end| {
            let ent = &rest[1..end];
            let c = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => ent
                    .strip_prefix("#x")
                    .or_else(|| ent.strip_prefix("#X"))
                    .and_then(|h| u32::from_str_radix(h, 16).ok())
                    .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                    .and_then(char::from_u32),
            };
            c.map(|c| (c, end))
        });
        match ch {
            Some((c, end)) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_links_with_or_without_scheme_and_extra_path() {
        let want = Some(("someone".to_owned(), "a-made-up-list".to_owned()));
        assert_eq!(list_address("https://letterboxd.com/someone/list/a-made-up-list/"), want);
        assert_eq!(list_address("letterboxd.com/someone/list/a-made-up-list"), want);
        assert_eq!(list_address(" http://www.letterboxd.com/someone/list/a-made-up-list/page/2/?x=1 "), want);
        assert_eq!(list_address("https://letterboxd.com/someone/list/a-made-up-list/detail/#top"), want);
    }

    #[test]
    fn other_links_are_not_lists() {
        for s in [
            "https://letterboxd.com/film/an-open-film/",
            "https://letterboxd.com/someone/",
            "https://letterboxd.com/someone/watchlist/",
            "https://example.com/someone/list/x/",
            "https://letterboxd.com.example.com/someone/list/x/",
            "https://letterboxd.com/some one/list/x/",
            "",
        ] {
            assert_eq!(list_address(s), None, "{s}");
        }
        assert!(is_short_link("https://boxd.it/abC1"));
        assert!(!is_short_link("https://boxd.it/"));
        assert!(!is_short_link("https://boxd.it/a/b"));
    }

    #[test]
    fn a_page_gives_its_name_and_films_in_order() {
        let html = r#"<html><head><meta property="og:title" content="Silent &amp; Early" /></head><body>
            <ul><li class="posteritem" data-object-name="list"><div data-item-name="Nosferatu (1922)" data-item-slug="x"></div></li>
            <li class="posteritem"><div data-item-name="The Cabinet of Dr. Caligari (1920)"></div></li>
            <li class="posteritem"><div data-item-name="Two Friends&#039; Made-Up Reunion (1997)"></div></li>
            <li class="posteritem"><div data-item-name="A Film (Director&#x27;s Cut)"></div></li>
            <li class="posteritem"><div class="no-name"></div></li></ul>
            <div data-item-name="Not In The List (2001)"></div></body></html>"#;
        let page = parse_list_page(html);
        assert_eq!(page.name.as_deref(), Some("Silent & Early"));
        let got: Vec<_> = page.films.iter().map(|f| (f.name.as_str(), f.year)).collect();
        assert_eq!(
            got,
            [
                ("Nosferatu", Some(1922)),
                ("The Cabinet of Dr. Caligari", Some(1920)),
                ("Two Friends' Made-Up Reunion", Some(1997)),
                ("A Film (Director's Cut)", None),
            ]
        );
    }

    #[test]
    fn a_page_that_isnt_a_list_reads_as_nothing() {
        assert_eq!(parse_list_page("<html><body>Not here</body></html>"), ListPage::default());
    }

    #[test]
    fn stray_ampersands_stay() {
        assert_eq!(decode("Fast & Loose &bogus; &#9999999999;"), "Fast & Loose &bogus; &#9999999999;");
    }
}
