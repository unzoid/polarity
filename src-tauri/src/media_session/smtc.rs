//! Windows: the window's SystemMediaTransportControls. The keyboard's media keys, a headset's buttons
//! and the media overlay (volume flyout, lock screen, Quick Settings) all reach the app through them.

use std::sync::Mutex;

use tauri::{AppHandle, WebviewWindow};
use windows::core::{Ref, HSTRING};
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

use super::{pressed, NowPlaying};

struct Session {
    controls: SystemMediaTransportControls,
    /// The title, subtitle and artwork shown, so they're only sent again when they change.
    shown: Option<(String, String, Option<String>)>,
}

/// Made the first time something plays, kept for the window's life (its button handlers with it).
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

fn span(secs: f64) -> TimeSpan {
    TimeSpan { Duration: (secs.max(0.0) * 10_000_000.0) as i64 }
}

fn open(app: &AppHandle, hwnd: HWND) -> windows::core::Result<SystemMediaTransportControls> {
    let interop = windows::core::factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
    let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
    controls.SetIsPlayEnabled(true)?;
    controls.SetIsPauseEnabled(true)?;
    let to_page = app.clone();
    controls.ButtonPressed(&TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>, args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
            let action = match args.ok()?.Button()? {
                SystemMediaTransportControlsButton::Play => "play",
                SystemMediaTransportControlsButton::Pause => "pause",
                SystemMediaTransportControlsButton::Stop => "pause",
                SystemMediaTransportControlsButton::Next => "next",
                SystemMediaTransportControlsButton::Previous => "previous",
                _ => return Ok(()),
            };
            pressed(&to_page, action, None);
            Ok(())
        },
    ))?;
    let to_page = app.clone();
    controls.PlaybackPositionChangeRequested(&TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>, args: Ref<PlaybackPositionChangeRequestedEventArgs>| {
            let at = args.ok()?.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0;
            pressed(&to_page, "seek", Some(at));
            Ok(())
        },
    ))?;
    Ok(controls)
}

pub fn update(app: &AppHandle, window: &WebviewWindow, now: Option<NowPlaying>) -> Result<(), String> {
    let mut guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        // Nothing has played yet: nothing to clear.
        if now.is_none() {
            return Ok(());
        }
        let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
        *guard = Some(Session { controls: open(app, hwnd).map_err(|e| e.to_string())?, shown: None });
    }
    let session = guard.as_mut().expect("made above");
    show(session, now).map_err(|e| e.to_string())
}

fn show(s: &mut Session, now: Option<NowPlaying>) -> windows::core::Result<()> {
    let c = &s.controls;
    let Some(now) = now else {
        // The player closed: off the overlay, and the media keys go back to other apps.
        s.shown = None;
        c.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
        c.DisplayUpdater()?.ClearAll()?;
        return c.SetIsEnabled(false);
    };
    c.SetIsEnabled(true)?;
    c.SetIsNextEnabled(now.can_next)?;
    c.SetIsPreviousEnabled(now.can_previous)?;
    c.SetPlaybackStatus(if now.playing { MediaPlaybackStatus::Playing } else { MediaPlaybackStatus::Paused })?;
    c.SetPlaybackRate(now.rate)?;
    let shown = (now.title.clone(), now.subtitle.clone(), now.artwork.clone());
    if s.shown.as_ref() != Some(&shown) {
        let d = c.DisplayUpdater()?;
        d.ClearAll()?;
        d.SetType(MediaPlaybackType::Video)?;
        let v = d.VideoProperties()?;
        v.SetTitle(&HSTRING::from(&now.title))?;
        v.SetSubtitle(&HSTRING::from(&now.subtitle))?;
        // Windows fetches the picture itself. A link it can't read just leaves the overlay without one.
        if let Some(art) = &now.artwork {
            if let Ok(stream) = Uri::CreateUri(&HSTRING::from(art)).and_then(|u| RandomAccessStreamReference::CreateFromUri(&u)) {
                d.SetThumbnail(&stream)?;
            }
        }
        d.Update()?;
        s.shown = Some(shown);
    }
    let t = SystemMediaTransportControlsTimelineProperties::new()?;
    t.SetStartTime(span(0.0))?;
    t.SetMinSeekTime(span(0.0))?;
    t.SetEndTime(span(now.duration))?;
    t.SetMaxSeekTime(span(now.duration))?;
    t.SetPosition(span(now.position))?;
    c.UpdateTimelineProperties(&t)
}
