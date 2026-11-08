//! Going back to a kept dev build (docs/dev-channel.md). Dev builds update from the "Dev build"
//! pre-release like any update; Settings → About can also install one of the kept builds there,
//! older ones included, which the updater plugin's own check never offers. Each kept build has a
//! feed of its own (`Updates-Dev-<NNNN>.json`, or `latest-dev.<N>.json` for builds made before the
//! files were named platform first; scripts/devChannel.ts) signed with the same dev key the running
//! build trusts, so nothing else can be installed this way.
//!
//! A dev build is also an app of its own next to the released one, "Polarity Dev": its own
//! identifier (so its own install folder, app data, keychain entries and single-instance lock),
//! link scheme and window title. `devConf` in scripts/devChannel.ts sets the bundle's side; the
//! names the code needs at build time are here.

use serde::Serialize;

use crate::commands::{CmdError, Result};

/// dev-build.yml sets it to `dev`; in any other build the command refuses.
const CHANNEL: Option<&str> = option_env!("VITE_POLAR_CHANNEL");
/// Whether this is a dev build (`VITE_POLAR_CHANNEL=dev`).
pub const DEV: bool = match CHANNEL {
    Some(c) => matches!(c.as_bytes(), b"dev"),
    None => false,
};
/// The app's identifier, as tauri.conf.json (or a dev build's overlay) gives it to the bundle.
#[cfg_attr(mobile, allow(dead_code))]
pub const IDENTIFIER: &str = if DEV { "app.getpolar.desktop.dev" } else { "app.getpolar.desktop" };
/// The scheme of links into the app: `polarity://`, or `polarity-dev://` for a dev build.
#[cfg_attr(mobile, allow(dead_code))]
pub const LINK_SCHEME: &str = if DEV { "polarity-dev" } else { "polarity" };
/// The main window's title, for the taskbar and window lists.
#[cfg_attr(mobile, allow(dead_code))]
pub const TITLE: &str = if DEV { "Polarity Dev" } else { "Polarity" };
/// Where the "Dev build" pre-release keeps its files (scripts/devChannel.ts, `download`).
#[cfg_attr(mobile, allow(dead_code))]
const RELEASE_FILES: &str = "https://github.com/unzoid/polarity/releases/download/dev/";

/// The channel's feed (every kept build listed in it), or build `n`'s own: its name now, then the
/// one builds had before their files were named platform first. The plugin tries them in order.
#[cfg_attr(mobile, allow(dead_code))]
fn feed_urls(build: Option<u32>) -> Vec<String> {
    match build {
        Some(n) => {
            vec![format!("{RELEASE_FILES}Updates-Dev-{n:04}.json"), format!("{RELEASE_FILES}latest-dev.{n}.json")]
        }
        None => vec![format!("{RELEASE_FILES}latest.json")],
    }
}

/// What the plugin's `Update` class in the web view is made from (its `UpdateMetadata`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundBuild {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// The build a dev feed offers, whether it is newer than this one or not; the web view downloads
/// and installs it through the plugin as usual.
#[tauri::command]
pub async fn dev_build_feed<R: tauri::Runtime>(webview: tauri::Webview<R>, build: Option<u32>) -> Result<FoundBuild> {
    if CHANNEL != Some("dev") {
        return Err(CmdError::Unsupported("Only dev builds can install other dev builds".into()));
    }
    #[cfg(desktop)]
    {
        use tauri::Manager;
        use tauri_plugin_updater::UpdaterExt;
        let urls = feed_urls(build)
            .iter()
            .map(|u| tauri::Url::parse(u))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| CmdError::Other(e.to_string()))?;
        let update = webview
            .updater_builder()
            .endpoints(urls)
            .map_err(|e| CmdError::Other(e.to_string()))?
            .version_comparator(|_, _| true)
            .build()
            .map_err(|e| CmdError::Other(e.to_string()))?
            .check()
            .await
            .map_err(|e| CmdError::Upstream(e.to_string()))?
            .ok_or_else(|| CmdError::NotFound("That build isn't kept any more".into()))?;
        Ok(FoundBuild {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: None,
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
            rid: webview.resources_table().add(update),
        })
    }
    #[cfg(not(desktop))]
    {
        let _ = (webview, build);
        Err(CmdError::Unsupported("App stores update this build".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feeds_are_the_dev_release_files() {
        assert_eq!(feed_urls(None), ["https://github.com/unzoid/polarity/releases/download/dev/latest.json"]);
        assert_eq!(
            feed_urls(Some(57)),
            [
                "https://github.com/unzoid/polarity/releases/download/dev/Updates-Dev-0057.json",
                "https://github.com/unzoid/polarity/releases/download/dev/latest-dev.57.json",
            ]
        );
        assert_eq!(
            feed_urls(Some(12345))[0],
            "https://github.com/unzoid/polarity/releases/download/dev/Updates-Dev-12345.json"
        );
    }
}
