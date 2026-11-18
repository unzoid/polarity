//! Settings → "Export library and history": the active profile's data written where the person
//! picks in the system's save dialog (`polar_library::export` builds both files), and the anime
//! links half of "Import a Polarity export" (the library and progress go through
//! `library_import`). The web view has no file access, so the file is written here.

use polar_library::export::{history_csv, utc_day, Export, ExportPlaylist};
use polar_library::AnimeLink;
use tauri::{AppHandle, State};

use crate::commands::{CmdError, Result};
use crate::locks::Locked;
use crate::store::now;
use crate::AppState;

/// Writes the export as `format` ("json": the document Polarity imports again; "csv": the
/// watch history) with `playlists` (kept by the front end) in the JSON. Answers with the file's
/// name, or nothing when the dialog was cancelled.
#[tauri::command]
pub async fn library_export(
    app: AppHandle,
    state: State<'_, AppState>,
    format: String,
    playlists: Vec<ExportPlaylist>,
) -> Result<Option<String>> {
    let at = now();
    let (content, name, filter, ext) = {
        let store = state.store.locked();
        let empty = Default::default();
        let space = store.data.space().unwrap_or(&empty);
        match format.as_str() {
            "json" => {
                let doc = Export::of(space, playlists, at);
                let json = serde_json::to_string_pretty(&doc).map_err(|e| CmdError::Save(e.to_string()))?;
                (json, format!("polarity-library-{}.json", utc_day(at)), "Polarity export", "json")
            }
            "csv" => (history_csv(space), format!("polarity-history-{}.csv", utc_day(at)), "CSV", "csv"),
            other => return Err(CmdError::Unsupported(format!("not an export format: {other}"))),
        }
    };
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_title("Export library and history")
            .set_file_name(&name)
            .add_filter(filter, &[ext])
            .save_file(move |picked| {
                let _ = tx.send(picked);
            });
        let Some(path) = rx.await.ok().flatten().and_then(|p| p.into_path().ok()) else { return Ok(None) };
        let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(name);
        if let Err(e) = std::fs::write(&path, content) {
            // The file's name only: the folder stays out of the log.
            tracing::warn!("export: couldn't write {file}: {}", e.kind());
            return Err(CmdError::Save(format!("Couldn't write {file}.")));
        }
        tracing::info!("export: wrote {file}");
        Ok(Some(file))
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, content, name, filter, ext);
        Err(CmdError::Unsupported("Exporting isn't available on this device yet.".into()))
    }
}

/// The anime links of a Polarity export, with their times (`Space::import_links`): a newer
/// decision here stays. Imported before the library and progress, so titles land under the ids
/// the links lead to. Answers how many were added.
#[tauri::command(async)]
pub fn anime_links_import(state: State<'_, AppState>, links: Vec<AnimeLink>) -> Result<usize> {
    let mut added = 0;
    state.persist_now(|d| added = d.space_mut().import_links(links))?;
    Ok(added)
}
