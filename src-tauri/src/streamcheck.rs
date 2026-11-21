//! A look at a stream before the player gets it (`polar_addon::probe`: follow
//! redirects, retry a link that isn't ready, spot placeholder clips). Each step
//! goes to the player's loading screen as a `player://probe` event; the events
//! name hosts only, never the rest of a link.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use polar_addon::probe::{self, ProbeEvent, Readiness};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::CmdError;
use crate::locks::Locked;

/// How long a `stream_ready` / `prepare` probe stays reusable so pressing Play right after opening Sources
/// skips a redundant `GET bytes=0-1023` round-trip.
const READY_CACHE_TTL: Duration = Duration::from_secs(60);
const READY_CACHE_MAX: usize = 64;

#[derive(Clone)]
struct CachedReady {
    at: Instant,
    final_url: String,
    ms: u64,
}

type ReadyCacheKey = (String, Vec<(String, String)>);
type ReadyCacheMap = HashMap<ReadyCacheKey, CachedReady>;

static READY_CACHE: OnceLock<Mutex<ReadyCacheMap>> = OnceLock::new();

fn ready_cache() -> &'static Mutex<ReadyCacheMap> {
    READY_CACHE.get_or_init(Default::default)
}

fn cache_get(url: &str, headers: &[(String, String)]) -> Option<CachedReady> {
    let cache = ready_cache().locked();
    let hit = cache.get(&(url.to_owned(), headers.to_vec()))?;
    (hit.at.elapsed() < READY_CACHE_TTL).then(|| hit.clone())
}

fn cache_put(url: &str, headers: Vec<(String, String)>, final_url: String, ms: u64) {
    let mut cache = ready_cache().locked();
    if cache.len() >= READY_CACHE_MAX {
        cache.retain(|_, v| v.at.elapsed() < READY_CACHE_TTL);
        if cache.len() >= READY_CACHE_MAX {
            if let Some(oldest) = cache.iter().min_by_key(|(_, v)| v.at).map(|(k, _)| k.clone()) {
                cache.remove(&oldest);
            }
        }
    }
    cache.insert((url.to_owned(), headers), CachedReady { at: Instant::now(), final_url, ms });
}

#[derive(Serialize, Clone)]
struct Step<'a> {
    /// The player's id for this check, so it can ignore a previous one's late steps.
    id: u32,
    event: &'a ProbeEvent,
}

/// The URL the player should open, or why this source won't play.
/// With `id`, every step is reported to the webview. `headers` are the ones
/// the player sends (`polar_player::headers::playback_headers`). `link`: a link the user chose
/// (Watch a Link), not an add-on's stream, so a short video isn't taken for a placeholder (#474).
pub async fn prepare(
    app: &AppHandle,
    url: &str,
    headers: Vec<(String, String)>,
    id: Option<u32>,
    link: bool,
) -> Result<String, CmdError> {
    if !link {
        if let Some(hit) = cache_get(url, &headers) {
            if let Some(id) = id {
                let host = reqwest::Url::parse(&hit.final_url)
                    .ok()
                    .and_then(|u| u.host_str().map(str::to_owned))
                    .unwrap_or_default();
                let event = ProbeEvent::Response {
                    host,
                    status: 206,
                    reason: None,
                    content_type: None,
                    size: None,
                    ms: hit.ms,
                };
                let _ = app.emit("player://probe", Step { id, event: &event });
            }
            return Ok(hit.final_url);
        }
    }
    let started = Instant::now();
    let final_url = probe::prepare(url, headers.clone(), !link, |event| {
        if let Some(id) = id {
            let _ = app.emit("player://probe", Step { id, event: &event });
        }
    })
    .await
    .map_err(CmdError::Source)?;
    if !link {
        cache_put(url, headers, final_url.clone(), started.elapsed().as_millis() as u64);
    }
    Ok(final_url)
}

/// The same check for the built-in (WebView) player; `mpv_load` runs it itself.
#[tauri::command]
/// `<video>` can't send the add-on's headers itself, so a source that needs them
/// passes here and may still be refused when the page opens it.
pub async fn stream_probe(
    app: AppHandle,
    url: String,
    probe_id: Option<u32>,
    headers: Option<HashMap<String, String>>,
    link: Option<bool>,
) -> Result<String, CmdError> {
    // The torrent engine's own link needs no check.
    if !polar_player::allow::is_web_url(&url) || crate::torrent::owns(&app, &url) {
        return Ok(url);
    }
    let headers = polar_player::headers::playback_headers(&headers.unwrap_or_default());
    prepare(&app, &url, headers, probe_id, link.unwrap_or(false)).await
}

/// Whether a source's link would start now (#21): one look ahead of time, for the source lists.
/// The same first request pressing Play makes; no retries, a short deadline.
#[tauri::command]
pub async fn stream_ready(url: String, headers: Option<HashMap<String, String>>) -> Readiness {
    if !polar_player::allow::is_web_url(&url) {
        return Readiness::Unchecked;
    }
    let headers = polar_player::headers::playback_headers(&headers.unwrap_or_default());
    if let Some(hit) = cache_get(&url, &headers) {
        return Readiness::Ready { ms: hit.ms };
    }
    let started = Instant::now();
    // Run the single-shot probe once and keep the final resolved URL on success so Play reuses it directly.
    let probe_cfg = probe::Probe {
        retry_after: Vec::new(),
        connect_timeout: probe::READY_DEADLINE,
        timeout: probe::READY_DEADLINE,
        deadline: probe::READY_DEADLINE,
        headers: headers.clone(),
        placeholders: true,
    };
    let res = probe_cfg.run(&url, |_| {}).await;
    let ms = started.elapsed().as_millis() as u64;
    match res {
        Ok(final_url) => {
            cache_put(&url, headers, final_url, ms);
            Readiness::Ready { ms }
        }
        Err(_reason) if ms >= probe::READY_DEADLINE.as_millis() as u64 => Readiness::Slow { ms },
        Err(reason) => Readiness::NotReady { reason },
    }
}
