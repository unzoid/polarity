//! Autocrop: zooming past the black bars, frame by frame (the rules are
//! `polar_player::crop`; this is the mpv side). Bars are read by cropdetect
//! inside mpv and by our own detector (`polar_player::bars`) from
//! screenshots, as `polar_player::sampler` decides: around cropdetect's
//! changes by default, every frame on macOS and with the setting.
//! `polar_player::frames` says which bars the frame on screen gets.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use polar_player::bars::{levels_for, Levels, Measured};
use polar_player::crop::{cropdetect_for, cropdetect_reading, zoom_for, CropZoom, Rect, CROPDETECT};
use polar_player::frames::{Ask, Frames};
use polar_player::sampler::Sampler;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

use super::preroll::{ahead, Opening};
use super::Mpv;
use crate::locks::Locked;
use crate::AppState;

/// Property-change ids from here up are autocrop's own observations: the
/// reader hands them to the running [`autocrop`] task instead of the UI.
pub(super) const CROP_OBSERVE_BASE: u64 = 1 << 32;

/// What [`autocrop`] needs to know about the video and the window.
#[derive(Debug, Clone, Copy)]
struct CropGeometry {
    /// Frame size in video pixels, and as displayed (non-square pixels).
    size: (i64, i64),
    display: (i64, i64),
    window: (i64, i64),
    /// The player's Fill is on (mpv's `panscan`, #183): the picture covers the window.
    fill: bool,
    /// The cropdetect filter this video needs ([`cropdetect_for`]), and our
    /// detector's levels.
    filter: &'static str,
    levels: Levels,
    /// How long a frame lasts, in seconds (1/24 when mpv doesn't say).
    frame: f64,
}

/// Whether the player's Fill is on: the UI sets `panscan` to 1 for Fill and 0 for Fit.
pub(super) async fn panscan_fills(mpv: &Mpv) -> bool {
    mpv.request(json!(["get_property", "panscan"])).await.ok().and_then(|p| p.as_f64()).is_some_and(|p| p > 0.5)
}

async fn crop_geometry(mpv: &Mpv) -> Option<CropGeometry> {
    let params = mpv.request(json!(["get_property", "video-params"])).await.ok()?;
    let osd = mpv.request(json!(["get_property", "osd-dimensions"])).await.ok()?;
    let fps = mpv.request(json!(["get_property", "container-fps"])).await.ok().and_then(|f| f.as_f64());
    let fill = panscan_fills(mpv).await;
    let int = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
    Some(CropGeometry {
        size: (int(&params, "w")?, int(&params, "h")?),
        display: (int(&params, "dw")?, int(&params, "dh")?),
        window: (int(&osd, "w")?, int(&osd, "h")?),
        fill,
        filter: cropdetect_for(params.get("gamma").and_then(Value::as_str)),
        levels: levels_for(params.get("gamma").and_then(Value::as_str)),
        frame: 1.0 / fps.filter(|f| (1.0..=300.0).contains(f)).unwrap_or(24.0),
    })
}

/// A screenshot read by our detector, for the load and frame size it was taken in.
struct Shot {
    load: u64,
    size: (i64, i64),
    /// The [`Ask`] it answers (the frame on screen while paused), if any.
    still: Option<u64>,
    /// The reading (`Some(None)`: a black frame), `None` if no frame came.
    measured: Option<Option<Measured>>,
    /// Bytes mpv wrote for it (none on macOS, where it comes in memory).
    written: u64,
    /// Time spent reading it here (the file and our detector).
    ours: Duration,
}

/// Take a screenshot of the frame shown now and read it with our detector:
/// an uncompressed PNG mpv writes to this app's folder, read and deleted.
#[cfg(not(mpv_apple))]
async fn take_shot(app: AppHandle, load: u64, g: CropGeometry, still: Option<u64>) -> Shot {
    use std::sync::atomic::AtomicU64;

    use polar_player::bars::detect;
    use polar_player::png::decode_stored;

    static NEXT: AtomicU64 = AtomicU64::new(0);
    let mut shot = Shot { load, size: g.size, still, measured: None, written: 0, ours: Duration::ZERO };
    let path = super::shots_dir().join(format!("autocrop-{}.png", NEXT.fetch_add(1, Ordering::Relaxed)));
    let mpv = &app.state::<AppState>().mpv;
    let taken = mpv.request(json!(["screenshot-to-file", path.to_string_lossy(), "video"])).await;
    let started = Instant::now();
    let bytes = tokio::fs::read(&path).await.ok();
    let _ = tokio::fs::remove_file(&path).await;
    let Some(bytes) = bytes.filter(|_| taken.is_ok()) else { return shot };
    shot.written = bytes.len() as u64;
    shot.measured = tokio::task::spawn_blocking(move || {
        let img = decode_stored(&bytes)?;
        Some(detect(&img.frame(), g.levels).map(|m| m.scaled((img.w as i64, img.h as i64), g.size)))
    })
    .await
    .ok()
    .flatten();
    shot.ours = started.elapsed();
    shot
}

/// Read the frame shown now with our detector, in memory: libmpv runs in
/// the app here ([`super::apple::Frames`]).
#[cfg(mpv_apple)]
async fn take_shot(app: AppHandle, load: u64, g: CropGeometry, still: Option<u64>) -> Shot {
    use std::sync::{Arc, Mutex as StdMutex};

    use polar_player::bars::detect;

    use super::{apple::Frames, Conn, Engine};

    /// The reader of the running player's frames, by the player it reads.
    static FRAMES: StdMutex<Option<(usize, Arc<Frames>)>> = StdMutex::new(None);

    let mut shot = Shot { load, size: g.size, still, measured: None, written: 0, ours: Duration::ZERO };
    let frames = {
        let state = app.state::<AppState>();
        let guard = state.mpv.conn.lock().await;
        let Some(Conn { engine: Engine::InApp(player), .. }) = guard.as_ref() else { return shot };
        let key = player as *const _ as usize;
        let mut cached = FRAMES.locked();
        match cached.as_ref() {
            Some((k, f)) if *k == key => f.clone(),
            _ => {
                let Some(f) = player.frames().map(Arc::new) else { return shot };
                *cached = Some((key, f.clone()));
                f
            }
        }
    };
    let started = Instant::now();
    let read = tokio::task::spawn_blocking(move || {
        frames.read(|frame| detect(&frame, g.levels).map(|m| m.scaled((frame.w as i64, frame.h as i64), g.size)))
    })
    .await
    .ok()
    .flatten();
    if read.is_none() {
        // The player may have gone: open a reader of the next one.
        *FRAMES.locked() = None;
    }
    shot.measured = read;
    shot.ours = started.elapsed();
    shot
}

/// A screenshot that hasn't come back after this long no longer holds up the next.
const SHOT_GIVE_UP: Duration = Duration::from_secs(2);
/// How often the screenshots' cost goes to the log.
const COST_EVERY: Duration = Duration::from_secs(10);

/// What our detector's screenshots cost, logged every [`COST_EVERY`] while
/// they're taken (docs/autocrop.md §2, measured on the desktop build).
#[derive(Default)]
struct Cost {
    since: Option<Instant>,
    shots: u64,
    written: u64,
    ours: Duration,
}

impl Cost {
    fn add(&mut self, shot: &Shot) {
        self.since.get_or_insert_with(Instant::now);
        self.shots += 1;
        self.written += shot.written;
        self.ours += shot.ours;
        let Some(since) = self.since.filter(|s| s.elapsed() >= COST_EVERY) else { return };
        let secs = since.elapsed().as_secs_f64();
        tracing::info!(
            "autocrop: {:.1} screenshots/s, {:.1} MB/s written, {:.1} ms each reading them here",
            self.shots as f64 / secs,
            self.written as f64 / secs / 1e6,
            self.ours.as_secs_f64() * 1000.0 / self.shots as f64,
        );
        *self = Cost::default();
    }
}

/// While autocrop is on: mpv reports cropdetect's reading whenever it
/// changes, the playback position once per displayed frame and whether
/// it's paused, observed in that order so each frame's reading arrives
/// before its tick. [`Frames`] says which bars each frame gets: playing
/// on, the next frame's, from cropdetect's reading or our detector's from a
/// screenshot ([`take_shot`], one at a time, as [`Sampler`] says) and the
/// changes the lookahead ([`preroll::ahead`](super::preroll::ahead))
/// scheduled on it; after a seek or a frame step, the bars the lookahead
/// read for that frame, checked (paused) by a screenshot of it, or
/// playback held until that screenshot is read. [`CropZoom`] sends the
/// zoom, always as a jump. Each change is logged with the rule that made
/// it. While paused no frames come and nothing changes, except keeping the
/// zoom right for the window.
pub(super) async fn autocrop(app: AppHandle, run: u64) {
    let meta_id = CROP_OBSERVE_BASE + run * 4;
    let frame_id = meta_id + 1;
    let pause_id = meta_id + 2;
    let (tx, mut rx) = mpsc::unbounded_channel();
    {
        let state = app.state::<AppState>();
        *state.mpv.crop_events.locked() = Some((run, tx));
        let _ = state.mpv.request(json!(["observe_property", meta_id, "vf-metadata/autocrop"])).await;
        let _ = state.mpv.request(json!(["observe_property", frame_id, "time-pos"])).await;
        let _ = state.mpv.request(json!(["observe_property", pause_id, "pause"])).await;
    }
    let mut frames = Frames::new(app.state::<AppState>().mpv.tuned.locked().sampling());
    let mut reading: Option<Rect> = None;
    let mut paused = false;
    let mut geometry: Option<(CropGeometry, Instant)> = None;
    let mut zoom = CropZoom::default();
    // Fit and Fill switch at once (panscan does): the zoom follows at once too.
    let mut filled: Option<bool> = None;
    let mut filter = CROPDETECT; // what mpv_tune added
    let mut opened = 0; // the last load checked for opening bars
    let (shot_tx, mut shot_rx) = mpsc::unbounded_channel::<Shot>();
    let mut in_flight: Option<Instant> = None; // the screenshot on its way, since when
    let mut cost = Cost::default();
    loop {
        let event = tokio::select! {
            e = tokio::time::timeout(Duration::from_millis(500), rx.recv()) => e,
            Some(shot) = shot_rx.recv() => {
                in_flight = None;
                cost.add(&shot);
                let state = app.state::<AppState>();
                let mpv = &state.mpv;
                let load = mpv.loads.load(Ordering::SeqCst);
                let Some((g, _)) = geometry.filter(|(g, _)| shot.load == load && g.size == shot.size) else {
                    if frames.give_up() {
                        paused = false;
                        let _ = mpv.request(json!(["set_property", "pause", false])).await;
                    }
                    continue;
                };
                let play_on = match shot.measured {
                    Some(m) => {
                        let mut ahead = mpv.ahead.locked();
                        frames.shot(load, (g.size, g.display), shot.still, m, ahead.as_mut())
                    }
                    None => shot.still.is_some() && frames.give_up(),
                };
                if shot.still.is_some() {
                    send_zoom(mpv, &frames, &mut zoom, load, g).await;
                }
                if play_on {
                    paused = false;
                    let _ = mpv.request(json!(["set_property", "pause", false])).await;
                }
                continue;
            }
        };
        let state = app.state::<AppState>();
        let mpv = &state.mpv;
        let tune = *mpv.tuned.locked();
        if !tune.autocrop || mpv.autocrop_run.load(Ordering::SeqCst) != run {
            break;
        }
        // The setting changed: mpv_tune has added or removed cropdetect.
        if tune.sampling() != frames.sampler.sampling() {
            frames.sampler = Sampler::new(tune.sampling());
            (filter, reading) = (CROPDETECT, None);
        }
        // mpv was shut down (idle, or it exited): the next start turns autocrop on afresh.
        if mpv.conn.lock().await.is_none() {
            break;
        }
        let frame = match event {
            Ok(None) => break, // a newer run took over
            Ok(Some((id, data))) if id == meta_id => {
                reading = cropdetect_reading(&data);
                continue;
            }
            Ok(Some((id, data))) if id == pause_id => {
                paused = data.as_bool().unwrap_or(false);
                continue;
            }
            Ok(Some((id, data))) if id == frame_id => data.as_f64(),
            Ok(Some(_)) => continue,
            Err(_) => None, // nothing for 500 ms: paused
        };
        let load = mpv.loads.load(Ordering::SeqCst);
        // The window changes size (fullscreen) and the video rarely does:
        // re-read them 4 times a second, and on every idle tick.
        if let Some(t) = frame {
            mpv.playhead.store(t.to_bits(), Ordering::SeqCst);
        }
        if frame.is_none() || geometry.is_none_or(|(_, at)| at.elapsed() >= Duration::from_millis(250)) {
            geometry = crop_geometry(mpv).await.map(|g| (g, Instant::now()));
        }
        let Some((g, _)) = geometry else {
            continue; // between files: nothing to measure
        };
        // HDR and SDR need different thresholds: swap the filter when the video's changes.
        if tune.cropdetect() && g.filter != filter {
            if !mpv.tuned.locked().cropdetect() {
                continue;
            }
            mpv.request(json!(["vf", "remove", "@autocrop"])).await.ok();
            if mpv.request(json!(["vf", "add", g.filter])).await.is_ok() {
                filter = g.filter;
                reading = None;
            }
            continue;
        }
        // The pre-roll probe's opening bars: wait for them (the load is
        // paused meanwhile), then start this load's tracker with them.
        // Then the lookahead starts from those bars.
        if opened != load {
            let bars = {
                let mut slot = mpv.opening.locked();
                match *slot {
                    Some(Opening::Probing(l)) if l == load => continue,
                    Some(Opening::Ready { load: l, full, bars }) if l == load => {
                        frames.tracker.open(load, full, bars);
                        *slot = None;
                        bars
                    }
                    _ => (0, 0),
                }
            };
            opened = load;
            frames.reset();
            let source = mpv.source.locked().clone().filter(|(l, ..)| *l == load);
            if let Some((_, url, fields)) = source.filter(|_| mpv.tuned.locked().lookahead) {
                tauri::async_runtime::spawn(ahead(app.clone(), run, load, url, fields, bars));
            }
        }
        // A screenshot held playback for too long: play on without it.
        if frames.holding() && in_flight.is_none_or(|t| t.elapsed() >= SHOT_GIVE_UP) && frames.give_up() {
            paused = false;
            let _ = mpv.request(json!(["set_property", "pause", false])).await;
        }
        if let Some(t) = frame {
            let live = reading.filter(|_| tune.cropdetect());
            let ask = {
                let mut ahead = mpv.ahead.locked();
                frames.frame(load, (g.size, g.display), t, paused, g.frame, live, ahead.as_mut(), tune.lookahead)
            };
            if let Some(why) = frames.tracker.changed() {
                let (v, h) = frames.tracker.bars(load);
                let on = if paused { t } else { t + g.frame };
                tracing::info!("autocrop: bars {v}/{h} px from {on:.3} s, {}", why.describe());
            }
            let still = match ask {
                Ask::Nothing => None,
                Ask::Still(n) => Some(n),
                Ask::Hold(n) => {
                    // Paused first, so the frame after this one waits for its crop.
                    paused = true;
                    let _ = mpv.request(json!(["set_property", "pause", true])).await;
                    Some(n)
                }
            };
            let wanted = still.is_some() || frames.sampler.wants_shot();
            if wanted && (still.is_some() || in_flight.is_none_or(|t| t.elapsed() >= SHOT_GIVE_UP)) {
                in_flight = Some(Instant::now());
                let (app, tx) = (app.clone(), shot_tx.clone());
                tauri::async_runtime::spawn(async move {
                    let _ = tx.send(take_shot(app, load, g, still).await);
                });
            }
        }
        let switched = filled.is_some_and(|f| f != g.fill);
        filled = Some(g.fill);
        if switched {
            zoom.unsent();
        }
        send_zoom(mpv, &frames, &mut zoom, load, g).await;
    }
    let state = app.state::<AppState>();
    {
        let mut slot = state.mpv.crop_events.locked();
        if slot.as_ref().is_some_and(|(r, _)| *r == run) {
            *slot = None;
        }
    }
    let _ = state.mpv.request(json!(["unobserve_property", meta_id])).await;
    let _ = state.mpv.request(json!(["unobserve_property", frame_id])).await;
    let _ = state.mpv.request(json!(["unobserve_property", pause_id])).await;
}

/// Send the zoom for the tracker's bars, if it differs from what mpv has.
async fn send_zoom(mpv: &Mpv, frames: &Frames, zoom: &mut CropZoom, load: u64, g: CropGeometry) {
    let target = zoom_for(frames.tracker.bars(load), g.size, g.display, g.window, g.fill);
    if let Some(z) = zoom.next(load, g.window, target, frames.tracker.changed().is_some()) {
        if mpv.request(json!(["set_property", "video-zoom", z])).await.is_err() {
            zoom.unsent();
        }
    }
}
