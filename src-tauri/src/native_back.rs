//! iOS's own back button (ios/back.m; src/lib/platform/nativeBack.ts on the web side): a system
//! button laid over the web app's Back where it stands, Liquid Glass on iOS 26 and later. The web
//! app says where its Back is, whether it shows and the pages behind it; a tap comes back as a
//! `native://back` event carrying 1, a page picked from its long-press menu as how many steps back
//! that is. The swipe in from the left edge, while the web app says it's Back (`swipe`), comes as
//! `native://back-swipe` events, one for each step of it (src/lib/platform/backSwipe.ts). Elsewhere
//! the web app's own Back shows and this does nothing.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Where the web app's Back is, in CSS pixels of the web view.
#[derive(Debug, Deserialize, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Back {
    pub shown: bool,
    pub rect: Option<Rect>,
    /// The pages behind, nearest first, for the long-press menu.
    pub history: Vec<String>,
    /// Whether the swipe in from the left edge is Back now.
    #[serde(default)]
    pub swipe: bool,
}

/// One step of the swipe in from the left edge, in CSS pixels of the web view.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Swipe {
    pub phase: &'static str,
    pub x: f64,
    pub width: f64,
    /// CSS pixels a second, rightwards positive.
    pub velocity: f64,
}

#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
impl Swipe {
    /// ios/back.m's step: 0 began, 1 moved, 2 lifted, anything else cancelled. A number that isn't one
    /// (NaN, infinite) is 0.
    pub fn new(phase: u32, x: f64, width: f64, velocity: f64) -> Self {
        let finite = |v: f64| if v.is_finite() { v } else { 0.0 };
        let phase = match phase {
            0 => "begin",
            1 => "move",
            2 => "end",
            _ => "cancel",
        };
        Swipe { phase, x: finite(x), width: finite(width), velocity: finite(velocity) }
    }
}

#[cfg(target_os = "ios")]
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Show, move or hide the back button.
#[tauri::command]
pub fn native_back(app: AppHandle, back: Back) {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn polar_back_set(json: *const std::ffi::c_char);
        }
        APP.get_or_init(|| app);
        let json = serde_json::to_string(&back).ok().and_then(|j| std::ffi::CString::new(j).ok());
        match json {
            Some(json) => unsafe { polar_back_set(json.as_ptr()) },
            None => tracing::warn!("back button: couldn't encode it"),
        }
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, back);
}

/// ios/back.m calls this on the main thread when the button is tapped (1) or a page is picked
/// from its menu (how many steps back).
#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn polar_back_pressed(steps: u32) {
    use tauri::Emitter;
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit("native://back", steps.max(1)) {
            tracing::warn!("back button: {e}");
        }
    }
}

/// ios/back.m calls this on the main thread for each step of the swipe in from the left edge.
#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn polar_back_swipe(phase: u32, x: f64, width: f64, velocity: f64) {
    use tauri::Emitter;
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit("native://back-swipe", Swipe::new(phase, x, width, velocity)) {
            tracing::warn!("back swipe: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swipe_steps_name_their_phase_and_drop_numbers_that_arent() {
        assert_eq!(Swipe::new(0, 3.0, 390.0, 120.0).phase, "begin");
        assert_eq!(Swipe::new(1, 80.0, 390.0, 600.0).phase, "move");
        assert_eq!(Swipe::new(2, 220.0, 390.0, 0.0).phase, "end");
        assert_eq!(Swipe::new(3, 0.0, 390.0, 0.0).phase, "cancel");
        assert_eq!(Swipe::new(9, 0.0, 390.0, 0.0).phase, "cancel");
        let odd = Swipe::new(1, f64::NAN, f64::INFINITY, f64::NEG_INFINITY);
        assert_eq!((odd.x, odd.width, odd.velocity), (0.0, 0.0, 0.0));
    }

    #[test]
    fn back_state_without_swipe_is_no_swipe() {
        let back: Back = serde_json::from_str(r#"{"shown":false,"rect":null,"history":[]}"#).unwrap();
        assert!(!back.swipe);
    }
}
