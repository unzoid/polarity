//! Going back to a kept dev build (docs/dev-channel.md). Dev builds update from the "Dev build"
//! pre-release like any update; Settings → About can also install one of the kept builds there,
//! older ones included, which the updater plugin's own check never offers. Each kept build has a
//! feed of its own (`latest-dev.<N>.json`, scripts/devChannel.ts) signed with the same dev key the
//! running build trusts, so nothing else can be installed this way.

use serde::Serialize;

use crate::commands::{CmdError, Result};

/// dev-build.yml sets it to `dev`; in any other build the command refuses.
const CHANNEL: Option<&str> = option_env!("VITE_POLAR_CHANNEL");
/// Where the "Dev build" pre-release keeps its files (scripts/devChannel.ts, `download`).
const RELEASE_FILES: &str = "https://github.com/unzoid/polarity/releases/download/dev/";

/// The channel's feed (every kept build listed in it), or build `n`'s own.
fn feed_url(build: Option<u32>) -> String {
    match build {
        Some(n) => format!("{RELEASE_FILES}latest-dev.{n}.json"),
        None => format!("{RELEASE_FILES}latest.json"),
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
        let url = tauri::Url::parse(&feed_url(build)).map_err(|e| CmdError::Other(e.to_string()))?;
        let update = webview
            .updater_builder()
            .endpoints(vec![url])
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
        assert_eq!(feed_url(None), "https://github.com/unzoid/polarity/releases/download/dev/latest.json");
        assert_eq!(feed_url(Some(57)), "https://github.com/unzoid/polarity/releases/download/dev/latest-dev.57.json");
    }
}
