//! Chromecast from the desktop app (#443, phase 1): the receivers on the network as `cast://devices`, a link
//! played on one, its controls, and what it does as `cast://status` (src/components/player/chromecast.ts).
//! The protocol is polar_cast's. Desktop only: phones and TVs have their own casting.
//!
//! Phase 1 casts links from the web only: the TV fetches the link itself, so it can't reach a link on this
//! computer (the torrent engine's, a download, a file) or one that needs the add-on's request headers.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;

use polar_cast::discovery::{self, Device};
use polar_cast::{Command, Event, Load, Session, Status};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

use crate::commands::CmdError;
use crate::locks::Locked;

#[derive(Default)]
pub struct Cast {
    /// Looking for receivers since the player first asked; kept for the app's life.
    daemon: StdMutex<Option<discovery::ServiceDaemon>>,
    /// The receivers found, by their service's full name.
    devices: StdMutex<HashMap<String, Device>>,
    /// The cast running, and its number.
    session: Mutex<Option<(u64, Session)>>,
    casts: AtomicU64,
}

/// What the page hears about a cast.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Update {
    Status {
        cast: u64,
        #[serde(flatten)]
        status: Status,
    },
    Failed {
        cast: u64,
        reason: String,
    },
    Ended {
        cast: u64,
        reason: &'static str,
    },
}

/// The receivers by name, each once (a TV can answer under more than one service name).
fn list(cast: &Cast) -> Vec<Device> {
    let mut seen = std::collections::HashSet::new();
    let mut v: Vec<Device> = cast.devices.locked().values().filter(|d| seen.insert(d.id.clone())).cloned().collect();
    v.sort_by_key(|d| d.name.to_lowercase());
    v
}

/// The receivers found so far; the first call starts looking, and changes come as `cast://devices`.
#[tauri::command]
pub fn cast_devices(app: AppHandle, cast: State<'_, Cast>) -> Vec<Device> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Vec::new();
    }
    let mut daemon = cast.daemon.locked();
    if daemon.is_none() {
        match discovery::browse() {
            Ok((d, events)) => {
                *daemon = Some(d);
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    use discovery::ServiceEvent;
                    while let Ok(event) = events.recv_async().await {
                        let cast = app.state::<Cast>();
                        let changed = match event {
                            ServiceEvent::ServiceResolved(s) => match discovery::device(&s) {
                                Some(d) => cast.devices.locked().insert(s.fullname.clone(), d.clone()) != Some(d),
                                None => false,
                            },
                            ServiceEvent::ServiceRemoved(_, name) => cast.devices.locked().remove(&name).is_some(),
                            _ => false,
                        };
                        if changed {
                            let _ = app.emit("cast://devices", list(&cast));
                        }
                    }
                });
            }
            Err(e) => tracing::info!("cast: can't look for receivers: {e}"),
        }
    }
    drop(daemon);
    list(&cast)
}

/// A link the TV could fetch itself: http(s), not this computer's own address.
fn reachable(url: &str) -> bool {
    if !polar_player::allow::is_web_url(url) {
        return false;
    }
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or("");
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit_once('@').map(|(_, h)| h).unwrap_or(authority);
    let host = if let Some(v6) = host.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    let host = host.to_ascii_lowercase();
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
        return false;
    }
    !host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
}

/// Play `url` on the receiver `device` (its id), from `start` seconds. Any cast already running stops.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cast_play(
    app: AppHandle,
    cast: State<'_, Cast>,
    device: String,
    url: String,
    title: String,
    subtitle: Option<String>,
    artwork: Option<String>,
    start: f64,
) -> Result<u64, CmdError> {
    if !reachable(&url) {
        return Err(CmdError::Unsupported("the TV can only play links from the web".into()));
    }
    let to = list(&cast)
        .into_iter()
        .find(|d| d.id == device)
        .ok_or_else(|| CmdError::NotFound("that TV isn't on the network any more".into()))?;
    let cut = |s: &str| s.chars().filter(|c| !c.is_control()).take(200).collect::<String>();
    let load = Load {
        url,
        title: cut(&title),
        subtitle: cut(subtitle.as_deref().unwrap_or("")),
        image: artwork.filter(|a| polar_player::allow::is_web_url(a)),
        start: if start.is_finite() { start.max(0.0) } else { 0.0 },
    };
    let mut slot = cast.session.lock().await;
    // The one before stops (dropping it closes the app on its TV).
    slot.take();
    let id = cast.casts.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, mut rx) = mpsc::unbounded_channel();
    let session = Session::start(to.addr, load, tx).await.map_err(CmdError::Player)?;
    *slot = Some((id, session));
    drop(slot);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let (update, over) = match event {
                Event::Status(status) => (Update::Status { cast: id, status }, false),
                Event::Failed(reason) => (Update::Failed { cast: id, reason }, true),
                Event::Ended(reason) => (Update::Ended { cast: id, reason }, true),
            };
            let _ = app.emit("cast://status", update);
            if over {
                let cast = app.state::<Cast>();
                let mut slot = cast.session.lock().await;
                if slot.as_ref().is_some_and(|(n, _)| *n == id) {
                    slot.take();
                }
                break;
            }
        }
    });
    Ok(id)
}

/// play, pause, seek (to `value` seconds), volume (`value` 0–1), mute / unmute.
#[tauri::command]
pub async fn cast_control(cast: State<'_, Cast>, action: String, value: Option<f64>) -> Result<(), CmdError> {
    let v = value.filter(|v| v.is_finite()).unwrap_or(0.0);
    let command = match action.as_str() {
        "play" => Command::Play,
        "pause" => Command::Pause,
        "seek" => Command::Seek(v.max(0.0)),
        "volume" => Command::Volume(v.clamp(0.0, 1.0)),
        "mute" => Command::Mute(true),
        "unmute" => Command::Mute(false),
        _ => return Err(CmdError::Unsupported(format!("no cast control `{action}`"))),
    };
    let slot = cast.session.lock().await;
    match slot.as_ref() {
        Some((_, s)) if s.send(command) => Ok(()),
        _ => Err(CmdError::NotFound("nothing is casting".into())),
    }
}

/// Stop casting: the app on the TV closes.
#[tauri::command]
pub async fn cast_stop(cast: State<'_, Cast>) -> Result<(), CmdError> {
    cast.session.lock().await.take();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::reachable;

    #[test]
    fn only_links_the_tv_can_fetch_itself() {
        assert!(reachable("https://media.example.com/film.mp4"));
        assert!(reachable("http://192.168.1.20:8096/film.mkv"));
        for local in [
            "http://127.0.0.1:47630/torrent/0",
            "http://localhost/film.mp4",
            "http://[::1]:8000/a",
            "http://0.0.0.0/a",
            "http://user@127.0.0.1/a",
            "file:///C:/film.mkv",
            "C:\\film.mkv",
        ] {
            assert!(!reachable(local), "{local}");
        }
    }
}
