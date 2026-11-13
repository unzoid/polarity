//! The player's More → Play in…: hand the video to another player installed here (desktop). Which
//! players there are is found here, at their usual places; the page only picks one by id
//! (polar_player::external::Kind), so nothing it sends names a program to run.

use std::path::PathBuf;
use std::sync::Arc;

use polar_player::allow::is_web_url;
use polar_player::external::{args, Handoff, Kind};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::commands::CmdError;

#[derive(Serialize)]
pub struct ExternalPlayer {
    id: Kind,
    name: &'static str,
}

/// Where each player is usually installed.
#[allow(unused_mut)]
fn candidates(kind: Kind) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        let bases: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
            .iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .collect();
        let under = |rel: &[&str]| bases.iter().flat_map(|b| rel.iter().map(move |r| b.join(r))).collect::<Vec<_>>();
        out.extend(match kind {
            Kind::Vlc => under(&["VideoLAN\\VLC\\vlc.exe"]),
            Kind::MpcHc => {
                under(&["MPC-HC\\mpc-hc64.exe", "MPC-HC\\mpc-hc.exe", "K-Lite Codec Pack\\MPC-HC64\\mpc-hc64.exe"])
            }
            Kind::MpcBe => under(&["MPC-BE x64\\mpc-be64.exe", "MPC-BE\\mpc-be.exe"]),
            Kind::PotPlayer => under(&["DAUM\\PotPlayer\\PotPlayerMini64.exe", "DAUM\\PotPlayer\\PotPlayerMini.exe"]),
            Kind::Mpv => under(&["mpv\\mpv.exe", "MPV Player\\mpv.exe", "Programs\\mpv\\mpv.exe"]),
            Kind::Iina => Vec::new(),
        });
        if kind == Kind::Mpv {
            if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
                out.push(home.join("scoop\\apps\\mpv\\current\\mpv.exe"));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let app = |rel: &str| {
            let mut v = vec![PathBuf::from("/Applications").join(rel)];
            v.extend(home.iter().map(|h| h.join("Applications").join(rel)));
            v
        };
        out.extend(match kind {
            Kind::Vlc => app("VLC.app/Contents/MacOS/VLC"),
            Kind::Iina => app("IINA.app/Contents/MacOS/iina-cli"),
            Kind::Mpv => {
                let mut v = app("mpv.app/Contents/MacOS/mpv");
                v.extend(["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "/opt/local/bin/mpv"].map(PathBuf::from));
                v
            }
            _ => Vec::new(),
        });
    }
    #[cfg(target_os = "linux")]
    {
        let name = match kind {
            Kind::Vlc => Some("vlc"),
            Kind::Mpv => Some("mpv"),
            _ => None,
        };
        if let (Some(name), Some(path)) = (name, std::env::var_os("PATH")) {
            out.extend(std::env::split_paths(&path).map(|p| p.join(name)));
        }
    }
    let _ = kind;
    out
}

fn find(kind: Kind) -> Option<PathBuf> {
    candidates(kind).into_iter().find(|p| p.is_file())
}

/// The players installed here, in the order the menu lists them.
#[tauri::command]
pub fn external_players() -> Vec<ExternalPlayer> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Vec::new();
    }
    Kind::ALL.into_iter().filter(|k| find(*k).is_some()).map(|id| ExternalPlayer { id, name: id.name() }).collect()
}

/// Play `url` in that player, from `start` seconds. The same links as the app's own player: from the
/// web, a finished download, a file the user opened, or the torrent engine's link on this machine.
#[tauri::command]
pub fn external_play(
    app: AppHandle,
    player: Kind,
    url: String,
    title: String,
    start: f64,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), CmdError> {
    let downloaded = app.state::<Arc<crate::downloads::Downloads>>().owns(&url);
    let opened = app.state::<Arc<crate::local_files::LocalFiles>>().owns(&url);
    if !is_web_url(&url) && !downloaded && !opened {
        return Err(CmdError::Unsupported("only http(s) streams, downloads and files you opened can be played".into()));
    }
    let program = find(player).ok_or_else(|| CmdError::NotFound(format!("{} isn't installed", player.name())))?;
    let local = downloaded || opened || crate::torrent::owns(&app, &url);
    let fields = if local {
        Vec::new()
    } else {
        polar_player::headers::mpv_fields(&polar_player::headers::playback_headers(&headers.unwrap_or_default()))
    };
    let line = args(player, &Handoff { url: &url, title: &title, start, headers: &fields });
    std::process::Command::new(program)
        .args(line)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| CmdError::Other(format!("{} didn't start: {e}", player.name())))
}
