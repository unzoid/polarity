//! Playing on in the background on phones and tablets (#461).
//!
//! The page says what plays ([`now_playing`]: title, a line under it, a small JPEG of the art);
//! the reader tells this module how mpv's playback goes ([`observe`]), and the system's Now
//! Playing controls (iOS's lock screen and Control Center, Android's media notification and
//! headphone buttons) hear it when their own count would go wrong
//! ([`polar_player::now_playing::Tracker`]). What those controls ask goes straight to mpv
//! ([`remote`]), not through the page: on iOS the web view sleeps in the background.
//!
//! What keeps the app running there: on iOS the audio background mode (`Info.ios.plist`), with
//! the video track off while the app can't draw ([`set_background`]); on Android a foreground
//! service while a title is shown (`PlaybackService.kt`), mpv's picture already off with its
//! surface (`android.rs`). Elsewhere nothing is shown and this does nothing.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use polar_player::now_playing::{Playback, Tracker};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::locks::Locked;
use crate::AppState;

/// What the page says plays.
#[derive(Clone, Debug, Deserialize)]
pub struct Info {
    title: String,
    #[serde(default)]
    subtitle: Option<String>,
    /// A JPEG, base64.
    #[serde(default)]
    art: Option<String>,
}

/// Longer text is cut: the system shows a line or two.
const MAX_TEXT: usize = 300;
/// Art bigger than this (base64 characters) is left out; the page sends ~512 px wide.
const MAX_ART: usize = 2_000_000;

impl Info {
    fn clipped(mut self) -> Self {
        let clip = |s: &mut String| {
            s.retain(|c| !c.is_control());
            if let Some((i, _)) = s.char_indices().nth(MAX_TEXT) {
                s.truncate(i);
            }
        };
        clip(&mut self.title);
        if let Some(s) = self.subtitle.as_mut() {
            clip(s);
        }
        self.art = self
            .art
            .filter(|a| a.len() <= MAX_ART && a.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b)));
        self
    }
}

struct Shown {
    info: Option<Info>,
    tracker: Tracker,
}

static SHOWN: Mutex<Shown> = Mutex::new(Shown { info: None, tracker: Tracker::new() });
static APP: OnceLock<AppHandle> = OnceLock::new();
static CLOCK: OnceLock<Instant> = OnceLock::new();

fn now() -> f64 {
    CLOCK.get_or_init(Instant::now).elapsed().as_secs_f64()
}

/// Where the controls' requests go; set once at start.
pub fn set_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Show what plays on the system's controls (`info`), or take them away (`None`: the player
/// closed). Only iOS and Android show them.
#[tauri::command]
pub fn now_playing(info: Option<Info>) {
    let mut shown = SHOWN.locked();
    match info.map(Info::clipped) {
        Some(info) => {
            shown.tracker.forget();
            let playback = shown.tracker.current();
            system::show(&info, playback);
            shown.info = Some(info);
        }
        None => {
            if shown.info.take().is_some() {
                system::hide();
            }
        }
    }
}

/// An observed mpv property changed (the reader, every change, held pauses left out).
pub(super) fn observe(name: &str, data: &Value) {
    let mut shown = SHOWN.locked();
    if let Some(playback) = shown.tracker.observe(name, data, now()) {
        if shown.info.is_some() {
            system::update(playback);
        }
    }
}

/// mpv went away: nothing plays any more.
pub(super) fn stopped() {
    let mut shown = SHOWN.locked();
    shown.tracker.reset();
    if shown.info.take().is_some() {
        system::hide();
    }
}

/// What the system's controls ask; the numbers are the ones `ios/now_playing.m` and
/// `PlaybackService.kt` send.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Remote {
    Play,
    Pause,
    Toggle,
    /// To this many seconds.
    SeekTo(f64),
    /// By this many seconds, back when negative.
    SkipBy(f64),
    /// The app was closed from the recent apps (Android): mpv mustn't play on with no app.
    Closed,
}

impl Remote {
    fn from_code(code: i32, value: f64) -> Option<Self> {
        let value = Some(value).filter(|v| v.is_finite());
        Some(match code {
            1 => Remote::Play,
            2 => Remote::Pause,
            3 => Remote::Toggle,
            4 => Remote::SeekTo(value?.max(0.0)),
            5 => Remote::SkipBy(value?.clamp(-600.0, 600.0)),
            6 => Remote::Closed,
            _ => return None,
        })
    }

    fn command(self) -> Value {
        match self {
            Remote::Play => json!(["set_property", "pause", false]),
            Remote::Pause | Remote::Closed => json!(["set_property", "pause", true]),
            Remote::Toggle => json!(["cycle", "pause"]),
            Remote::SeekTo(t) => json!(["seek", t, "absolute"]),
            Remote::SkipBy(d) => json!(["seek", d, "relative"]),
        }
    }
}

/// A request from the system's controls, to mpv. Any thread.
#[cfg_attr(not(any(target_os = "ios", target_os = "android")), allow(dead_code))]
fn remote(code: i32, value: f64) {
    let (Some(remote), Some(app)) = (Remote::from_code(code, value), APP.get()) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = app.state::<AppState>().mpv.request(remote.command()).await {
            tracing::info!("now playing controls: {e}");
        }
    });
}

/// iOS stops the drawing in the background (ios/mpv_view.m): with nothing drawn, mpv would
/// still decode every frame and wait on each, so the video track is off until the app is back.
#[cfg(target_os = "ios")]
fn set_background(background: bool) {
    /// The video track to give back, while it's off.
    static SAVED: OnceLock<tokio::sync::Mutex<Option<Value>>> = OnceLock::new();
    let Some(app) = APP.get().cloned() else { return };
    tauri::async_runtime::spawn(async move {
        let mpv = &app.state::<AppState>().mpv;
        let mut saved = SAVED.get_or_init(Default::default).lock().await;
        if background {
            if saved.is_some() {
                return;
            }
            let Ok(vid) = mpv.request(json!(["get_property", "vid"])).await else { return };
            if vid == json!(false) || mpv.request(json!(["set_property", "vid", "no"])).await.is_err() {
                return;
            }
            *saved = Some(vid);
        } else if let Some(vid) = saved.take() {
            let _ = mpv.request(json!(["set_property", "vid", vid])).await;
        }
    });
}

#[cfg(target_os = "ios")]
mod system {
    use super::{Info, Playback};
    use std::ffi::{c_char, c_int, CString};

    extern "C" {
        fn polar_now_playing_show(title: *const c_char, subtitle: *const c_char, art: *const c_char);
        fn polar_now_playing_update(playing: c_int, position: f64, duration: f64, rate: f64);
        fn polar_now_playing_hide();
    }

    fn c(s: &str) -> CString {
        CString::new(s.replace('\0', "")).unwrap_or_default()
    }

    pub fn show(info: &Info, playback: Playback) {
        let title = c(&info.title);
        let subtitle = info.subtitle.as_deref().map(c);
        let art = info.art.as_deref().map(c);
        let ptr = |s: &Option<CString>| s.as_ref().map_or(std::ptr::null(), |s| s.as_ptr());
        // SAFETY: NUL-terminated strings that live for the call; now_playing.m copies them.
        unsafe { polar_now_playing_show(title.as_ptr(), ptr(&subtitle), ptr(&art)) };
        update(playback);
    }

    pub fn update(p: Playback) {
        unsafe { polar_now_playing_update(p.playing.into(), p.position, p.duration, p.rate) }
    }

    pub fn hide() {
        unsafe { polar_now_playing_hide() }
    }

    /// now_playing.m's controls.
    #[no_mangle]
    pub extern "C" fn polar_now_playing_command(code: c_int, value: f64) {
        super::remote(code, value);
    }

    /// mpv_view.m: the app went to the background (1) or came back (0).
    #[no_mangle]
    pub extern "C" fn polar_mpv_background(background: c_int) {
        super::set_background(background != 0);
    }
}

#[cfg(target_os = "android")]
mod system {
    use super::{Info, Playback};
    use jni::objects::{JClass, JObject, JValue};
    use jni::sys::{jdouble, jint};
    use jni::JNIEnv;

    /// Calls a static method of `NowPlaying` (PlaybackService.kt) with the app's context first. The
    /// class comes from the app's class loader: a thread Rust started can't find it by name.
    fn call(f: impl for<'l> FnOnce(&mut JNIEnv<'l>, &JClass<'l>, &JObject<'l>) -> jni::errors::Result<()>) {
        let ctx = ndk_context::android_context();
        // SAFETY: the VM and the activity Tauri recorded in ndk_context live as long as the app.
        let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }) else { return };
        let Ok(mut env) = vm.attach_current_thread() else { return };
        let done = env.with_local_frame(16, |env| {
            let context = unsafe { JObject::from_raw(ctx.context().cast()) };
            let loader = env.call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
            let name = env.new_string("app.getpolar.desktop.NowPlaying")?;
            let class = env.call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&name)],
            )?;
            f(env, &JClass::from(class.l()?), &context)
        });
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        if let Err(e) = done {
            tracing::warn!("now playing: {e}");
        }
    }

    pub fn show(info: &Info, p: Playback) {
        call(|env, class, context| {
            let title = env.new_string(&info.title)?;
            let subtitle = env.new_string(info.subtitle.as_deref().unwrap_or_default())?;
            let art = match info.art.as_deref() {
                Some(a) => env.new_string(a)?,
                None => JObject::null().into(),
            };
            let sig = "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;ZJJF)V";
            let args = [
                JValue::Object(context),
                JValue::Object(&title),
                JValue::Object(&subtitle),
                JValue::Object(&art),
                JValue::Bool(p.playing.into()),
                JValue::Long(millis(p.position)),
                JValue::Long(millis(p.duration)),
                JValue::Float(p.rate as f32),
            ];
            env.call_static_method(class, "show", sig, &args).map(drop)
        })
    }

    pub fn update(p: Playback) {
        call(|env, class, _| {
            let args = [
                JValue::Bool(p.playing.into()),
                JValue::Long(millis(p.position)),
                JValue::Long(millis(p.duration)),
                JValue::Float(p.rate as f32),
            ];
            env.call_static_method(class, "update", "(ZJJF)V", &args).map(drop)
        })
    }

    pub fn hide() {
        call(|env, class, context| {
            env.call_static_method(class, "hide", "(Landroid/content/Context;)V", &[JValue::Object(context)]).map(drop)
        })
    }

    fn millis(seconds: f64) -> i64 {
        (seconds * 1000.0).round() as i64
    }

    /// `NowPlaying.command` (PlaybackService.kt): the media session's and the notification's buttons.
    #[no_mangle]
    pub extern "system" fn Java_app_getpolar_desktop_NowPlaying_command<'a>(
        _env: JNIEnv<'a>,
        _this: JObject<'a>,
        code: jint,
        value: jdouble,
    ) {
        super::remote(code, value);
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod system {
    use super::{Info, Playback};

    pub fn show(_: &Info, _: Playback) {}
    pub fn update(_: Playback) {}
    pub fn hide() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_read_as_the_natives_send_them() {
        assert_eq!(Remote::from_code(1, 0.0), Some(Remote::Play));
        assert_eq!(Remote::from_code(4, -3.0), Some(Remote::SeekTo(0.0)));
        assert_eq!(Remote::from_code(5, -10.0), Some(Remote::SkipBy(-10.0)));
        assert_eq!(Remote::from_code(4, f64::NAN), None);
        assert_eq!(Remote::from_code(9, 0.0), None);
        assert_eq!(Remote::Closed.command(), json!(["set_property", "pause", true]));
    }

    #[test]
    fn text_is_clipped_and_odd_art_left_out() {
        let info =
            Info { title: format!("a\u{7}{}", "é".repeat(400)), subtitle: None, art: Some("<svg>".into()) }.clipped();
        assert_eq!(info.title.chars().count(), MAX_TEXT);
        assert!(info.title.starts_with("aé"));
        assert_eq!(info.art, None);
    }
}
