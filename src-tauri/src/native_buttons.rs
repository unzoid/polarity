//! iOS's own buttons for a few of the web app's (ios/buttons.m; src/components/NativeButtons.tsx on the web side):
//! system buttons laid over the web app's where they stand, Liquid Glass on iOS 26 and later. The featured card's
//! Watch Now and Save on a phone's Home use them. The web app says where its buttons are, what they say and
//! whether they show; they move with the page's scrolling on their own (the native side follows the scroll view
//! under them), and a tap comes back as a `native://button` event carrying the button's id. Elsewhere the web
//! app's own buttons show and this does nothing.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::native_back::Rect;

/// One button: what it says, its SF Symbol, whether it's the main action, and where the web app's is.
#[derive(Debug, Deserialize, Serialize)]
pub struct Button {
    pub id: String,
    pub title: String,
    pub symbol: String,
    /// The name VoiceOver reads, when it isn't the title ("Add to Library" for Save).
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub prominent: bool,
    pub rect: Rect,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Buttons {
    pub shown: bool,
    /// Nothing is drawn above this line (CSS pixels of the web view): the web app's top bar.
    #[serde(default)]
    pub clip_top: f64,
    pub items: Vec<Button>,
}

#[cfg(target_os = "ios")]
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Show, move or hide the buttons.
#[tauri::command]
pub fn native_buttons(app: AppHandle, buttons: Buttons) {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn polar_buttons_set(json: *const std::ffi::c_char);
        }
        APP.get_or_init(|| app);
        let json = serde_json::to_string(&buttons).ok().and_then(|j| std::ffi::CString::new(j).ok());
        match json {
            Some(json) => unsafe { polar_buttons_set(json.as_ptr()) },
            None => tracing::warn!("native buttons: couldn't encode them"),
        }
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, buttons);
}

/// ios/buttons.m calls this on the main thread when a button is tapped.
///
/// # Safety
/// `id` is null or a NUL-terminated string that lives for the call (the button's id, from buttons.m).
#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn polar_button_pressed(id: *const std::ffi::c_char) {
    use tauri::Emitter;
    if id.is_null() {
        return;
    }
    let id = unsafe { std::ffi::CStr::from_ptr(id) }.to_string_lossy().into_owned();
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit("native://button", id) {
            tracing::warn!("native buttons: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_read_as_the_web_app_sends_them() {
        let b: Buttons = serde_json::from_str(
            r#"{"shown":true,"clip_top":92,"items":[{"id":"play","title":"Watch Now","symbol":"play.fill","prominent":true,"rect":{"x":16,"y":600,"width":170,"height":44}}]}"#,
        )
        .unwrap();
        assert!(b.shown);
        assert_eq!(b.items[0].title, "Watch Now");
        assert!(b.items[0].prominent);
        let hidden: Buttons = serde_json::from_str(r#"{"shown":false,"items":[]}"#).unwrap();
        assert_eq!(hidden.clip_top, 0.0);
    }
}
