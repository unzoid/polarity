//! Where a picture's subject is, asked of the system (ios/focus.m: Vision's face and saliency requests), for a
//! phone's title page to place its art by (src/components/DetailArt.tsx). The web app sends the picture it
//! already has, small; elsewhere there is nothing to ask and it uses its own estimate.

/// The subject's place across the picture, 0 (left) to 1 (right), from a base64 JPEG; `None` when the system
/// finds nothing, can't read it, or isn't iOS.
#[tauri::command(async)]
pub fn art_focus(picture: String) -> Option<f64> {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn polar_art_focus(base64: *const std::ffi::c_char) -> f64;
        }
        let picture = std::ffi::CString::new(picture).ok()?;
        // SAFETY: a NUL-terminated string that lives for the call; focus.m copies what it needs.
        let x = unsafe { polar_art_focus(picture.as_ptr()) };
        (0.0..=1.0).contains(&x).then_some(x)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = picture;
        None
    }
}
