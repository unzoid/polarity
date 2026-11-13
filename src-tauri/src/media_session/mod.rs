//! The system's "now playing" while the player plays: the title, artwork and timeline in Windows' media
//! overlay, macOS's Now Playing and the iPhone's Lock Screen and Control Center, and the media keys,
//! headset buttons and those controls answered. The page sends what plays (`media_session`) and hears
//! what was pressed as `media://key` events (src/components/player/useMediaSession.ts).
//!
//! Windows: the window's SystemMediaTransportControls ([`smtc`]). macOS and iOS: MPNowPlayingInfoCenter
//! and MPRemoteCommandCenter (apple/now_playing.m, [`apple`]). Elsewhere nothing: the built-in player's
//! `<video>` has the web view's own media session there.

#[cfg(mpv_apple)]
mod apple;
#[cfg(windows)]
mod smtc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, WebviewWindow};

/// What plays, as the page has it.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    /// The show, for an episode.
    #[serde(default)]
    pub subtitle: String,
    /// A poster or still, http(s) only (anything else is dropped).
    pub artwork: Option<String>,
    pub playing: bool,
    /// Seconds.
    pub position: f64,
    pub duration: f64,
    #[serde(default = "one")]
    pub rate: f64,
    /// Next and Previous do something (another episode).
    #[serde(default)]
    pub can_next: bool,
    #[serde(default)]
    pub can_previous: bool,
}

fn one() -> f64 {
    1.0
}

/// The most of a title or subtitle the system is given.
const TEXT_MAX: usize = 200;

impl NowPlaying {
    /// What the system is given: text cut short, artwork only from the web, numbers that make sense.
    fn checked(mut self) -> Self {
        let cut = |s: &str| s.chars().filter(|c| !c.is_control()).take(TEXT_MAX).collect::<String>();
        self.title = cut(&self.title);
        self.subtitle = cut(&self.subtitle);
        self.artwork = self.artwork.filter(|a| polar_player::allow::is_web_url(a) && a.len() < 2048);
        let finite = |n: f64| if n.is_finite() && n > 0.0 { n } else { 0.0 };
        self.duration = finite(self.duration);
        self.position = finite(self.position).min(if self.duration > 0.0 { self.duration } else { f64::MAX });
        self.rate = if self.rate.is_finite() && self.rate > 0.0 { self.rate } else { 1.0 };
        self
    }
}

/// A media key, headset button or the system's controls, to the page: "play", "pause", "toggle",
/// "next", "previous", or "seek" with a position in seconds.
#[cfg_attr(not(any(windows, mpv_apple)), allow(dead_code))]
fn pressed(app: &AppHandle, action: &str, position: Option<f64>) {
    let _ = app.emit("media://key", json!({ "action": action, "position": position }));
}

/// Show what plays (or nothing, with `None`). Not async: Tauri runs it on the main thread, where the
/// window's media controls are made.
#[tauri::command]
pub fn media_session(app: AppHandle, window: WebviewWindow, now: Option<NowPlaying>) -> Result<(), String> {
    let now = now.map(NowPlaying::checked);
    #[cfg(windows)]
    return smtc::update(&app, &window, now);
    #[cfg(mpv_apple)]
    {
        let _ = window;
        apple::update(&app, now);
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, window, now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_system_gets_only_what_it_should() {
        let now = NowPlaying {
            title: format!("A\u{0}{}", "x".repeat(500)),
            subtitle: "Show".into(),
            artwork: Some("file:///C:/secret.png".into()),
            playing: true,
            position: 900.0,
            duration: 600.0,
            rate: f64::NAN,
            can_next: true,
            can_previous: false,
        }
        .checked();
        assert_eq!(now.title.chars().count(), TEXT_MAX);
        assert!(!now.title.contains('\u{0}'));
        assert_eq!(now.artwork, None);
        assert_eq!((now.position, now.rate), (600.0, 1.0));
        let web = NowPlaying { artwork: Some("https://image.example.com/p.jpg".into()), ..now }.checked();
        assert!(web.artwork.is_some());
    }
}
