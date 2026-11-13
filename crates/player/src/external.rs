//! Other players a video can be handed to (the player's More → Play in…): which ones there are, and the
//! command line each one takes for a link, a start time, a title and request headers.
//!
//! Only players the app found itself, at their usual places, run; the page picks one by its id and never
//! names a program. The link is one argument of its own (no shell), and must already have passed the
//! same rule as mpv's own loads (src-tauri's external_player.rs).

/// A player Polarity knows how to hand a video to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Vlc,
    Mpv,
    MpcHc,
    MpcBe,
    PotPlayer,
    Iina,
}

impl Kind {
    pub const ALL: [Kind; 6] = [Kind::Vlc, Kind::Mpv, Kind::MpcHc, Kind::MpcBe, Kind::PotPlayer, Kind::Iina];

    pub fn name(self) -> &'static str {
        match self {
            Kind::Vlc => "VLC",
            Kind::Mpv => "mpv",
            Kind::MpcHc => "MPC-HC",
            Kind::MpcBe => "MPC-BE",
            Kind::PotPlayer => "PotPlayer",
            Kind::Iina => "IINA",
        }
    }
}

/// What to play and how.
pub struct Handoff<'a> {
    pub url: &'a str,
    pub title: &'a str,
    /// Seconds in; 0 from the start.
    pub start: f64,
    /// "Name: value" request headers (polar_player::headers::mpv_fields), for the players that take them.
    pub headers: &'a [String],
}

/// A title as one plain argument: no control characters (a newline would start another mpv option).
fn plain(title: &str) -> String {
    title.chars().filter(|c| !c.is_control()).take(200).collect()
}

/// "HH:MM:SS".
fn clock(secs: u64) -> String {
    format!("{:02}:{:02}:{:02}", secs / 3600, secs / 60 % 60, secs % 60)
}

/// The arguments after the program's own name.
pub fn args(kind: Kind, h: &Handoff) -> Vec<String> {
    let start = if h.start.is_finite() && h.start > 1.0 { h.start as u64 } else { 0 };
    let title = plain(h.title);
    let mut out = Vec::new();
    match kind {
        Kind::Vlc => {
            if start > 0 {
                out.push(format!("--start-time={start}"));
            }
            if !title.is_empty() {
                out.push(format!("--meta-title={title}"));
            }
            for field in h.headers {
                // VLC takes these two of an add-on's headers; others it has no option for.
                if let Some((name, value)) = field.split_once(": ") {
                    match name.to_ascii_lowercase().as_str() {
                        "user-agent" => out.push(format!("--http-user-agent={value}")),
                        "referer" => out.push(format!("--http-referrer={value}")),
                        _ => {}
                    }
                }
            }
            // Everything after `--` is a file, whatever it looks like.
            out.push("--".into());
            out.push(h.url.into());
        }
        Kind::Mpv | Kind::Iina => {
            // IINA's command line hands --mpv-* options to its mpv.
            let opt = if kind == Kind::Iina { "--mpv-" } else { "--" };
            if start > 0 {
                out.push(format!("{opt}start={start}"));
            }
            if !title.is_empty() {
                out.push(format!("{opt}force-media-title={title}"));
            }
            if !h.headers.is_empty() {
                // mpv's list option: fields separated by commas, so a comma inside one is escaped as mpv reads it.
                let fields: Vec<String> = h.headers.iter().map(|f| plain(f).replace(',', "\\,")).collect();
                out.push(format!("{opt}http-header-fields={}", fields.join(",")));
            }
            out.push("--".into());
            out.push(h.url.into());
        }
        Kind::MpcHc | Kind::MpcBe => {
            out.push(h.url.into());
            if start > 0 {
                out.push("/start".into());
                out.push((start * 1000).to_string());
            }
        }
        Kind::PotPlayer => {
            out.push(h.url.into());
            if start > 0 {
                out.push(format!("/seek={}", clock(start)));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://media.example.com/film.mkv";

    #[test]
    fn each_player_gets_its_own_command_line() {
        let h = Handoff { url: URL, title: "A Film", start: 754.6, headers: &[] };
        assert_eq!(args(Kind::Vlc, &h), ["--start-time=754", "--meta-title=A Film", "--", URL]);
        assert_eq!(args(Kind::Mpv, &h), ["--start=754", "--force-media-title=A Film", "--", URL]);
        assert_eq!(args(Kind::Iina, &h), ["--mpv-start=754", "--mpv-force-media-title=A Film", "--", URL]);
        assert_eq!(args(Kind::MpcHc, &h), [URL, "/start", "754000"]);
        assert_eq!(args(Kind::PotPlayer, &h), [URL, "/seek=00:12:34"]);
        let from_start = Handoff { start: 0.0, title: "", ..h };
        assert_eq!(args(Kind::Mpv, &from_start), ["--", URL]);
    }

    #[test]
    fn headers_go_where_a_player_takes_them() {
        let headers = ["User-Agent: Agent/1".to_string(), "Referer: https://example.com/".into(), "Cookie: a=b, c=d".into()];
        let h = Handoff { url: URL, title: "", start: 0.0, headers: &headers };
        assert_eq!(args(Kind::Vlc, &h), ["--http-user-agent=Agent/1", "--http-referrer=https://example.com/", "--", URL]);
        assert_eq!(
            args(Kind::Mpv, &h),
            ["--http-header-fields=User-Agent: Agent/1,Referer: https://example.com/,Cookie: a=b\\, c=d", "--", URL]
        );
    }

    #[test]
    fn a_title_never_becomes_another_option() {
        let h = Handoff { url: URL, title: "x\n--script=evil.lua", start: 0.0, headers: &[] };
        let a = args(Kind::Mpv, &h);
        assert_eq!(a[0], "--force-media-title=x--script=evil.lua");
        assert_eq!(a.len(), 3);
    }

    #[test]
    fn ids_are_the_pages() {
        assert_eq!(serde_json::to_string(&Kind::PotPlayer).unwrap(), "\"pot-player\"");
        assert_eq!(serde_json::from_str::<Kind>("\"mpc-hc\"").unwrap(), Kind::MpcHc);
        assert!(serde_json::from_str::<Kind>("\"C:/Windows/cmd.exe\"").is_err());
    }
}
