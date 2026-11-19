//! macOS and iOS: Now Playing through apple/now_playing.m.

use std::ffi::{c_char, c_int, CString};
use std::sync::OnceLock;

use tauri::AppHandle;

use super::{pressed, NowPlaying};

extern "C" {
    #[allow(clippy::too_many_arguments)]
    fn polar_now_playing_set(
        title: *const c_char,
        subtitle: *const c_char,
        artwork: *const c_char,
        playing: c_int,
        position: f64,
        duration: f64,
        rate: f64,
        can_next: c_int,
        can_previous: c_int,
    );
    fn polar_now_playing_clear();
}

/// Where the remote commands go: set the first time something plays.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// A remote command from now_playing.m, on the main thread.
#[no_mangle]
pub extern "C" fn polar_media_command(action: c_int, position: f64) {
    let Some(app) = APP.get() else { return };
    let action = match action {
        0 => "play",
        1 => "pause",
        2 => "toggle",
        3 => "next",
        4 => "previous",
        5 => return pressed(app, "seek", Some(position)),
        _ => return,
    };
    pressed(app, action, None);
}

/// Text for C: no NUL inside it (NowPlaying::checked already drops control characters).
fn c_text(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap_or_default()
}

pub fn update(app: &AppHandle, now: Option<NowPlaying>) {
    let _ = APP.set(app.clone());
    let Some(now) = now else {
        unsafe { polar_now_playing_clear() };
        return;
    };
    let title = c_text(&now.title);
    let subtitle = c_text(&now.subtitle);
    let artwork = now.artwork.as_deref().map(c_text);
    unsafe {
        polar_now_playing_set(
            title.as_ptr(),
            subtitle.as_ptr(),
            artwork.as_ref().map_or(std::ptr::null(), |a| a.as_ptr()),
            now.playing.into(),
            now.position,
            now.duration,
            now.rate,
            now.can_next.into(),
            now.can_previous.into(),
        )
    }
}
