//! Autocrop's pre-roll probe (docs/autocrop.md §3): while the player
//! buffers, a second mpv with no picture or sound measures keyframes over
//! the film's opening, so the crop is right on the first frame. Then the
//! lookahead (§4): another such probe reads keyframes ahead of the
//! playhead, so a change of bars lands on the cut.
//!
//! mpv's JSON IPC can't carry `screenshot-raw`'s bytes, so each keyframe is
//! written as an uncompressed PNG ([`polar_player::png`]) to this app's
//! screenshot folder, read and deleted.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::Mpv;
use crate::locks::Locked;
use crate::AppState;

/// Whether the lookahead reads ahead in the video playing now, or why it
/// can't: logged, and shown under its setting (Settings → Advanced).
/// With mpv inside the app only [`Lookahead::ThisDevice`] is ever said.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(mpv_in_app, allow(dead_code))]
pub enum Lookahead {
    /// Reading keyframes ahead of the playhead.
    Reading,
    /// mpv runs inside the app here, with no second instance to read with.
    #[cfg_attr(not(mpv_in_app), allow(dead_code))]
    ThisDevice,
    /// The second mpv didn't start.
    NoReader,
    /// The source didn't open a second time (one connection per link, or the link expired).
    NotOpened,
    /// A live stream: nothing ahead to read.
    Live,
    /// The source can't be sought keyframe by keyframe (no index, or no range requests).
    NoSeeking,
    /// The source stopped answering the second reader, and kept failing when opened again.
    Stopped,
}

impl Lookahead {
    fn describe(self) -> &'static str {
        match self {
            Lookahead::Reading => "reading keyframes ahead",
            Lookahead::ThisDevice => "not on this device (no second player)",
            Lookahead::NoReader => "off: the second mpv didn't start",
            Lookahead::NotOpened => "off: the source didn't open a second time",
            Lookahead::Live => "off: a live stream, nothing ahead to read",
            Lookahead::NoSeeking => "off: the source can't be sought by keyframe",
            Lookahead::Stopped => "off: the source stopped answering the second reader",
        }
    }
}

/// Note the lookahead's state for `load`, if that's still the load playing
/// and `reader` the newest reader.
fn report(app: &AppHandle, reader: u64, load: u64, state: Option<Lookahead>) {
    use std::sync::atomic::Ordering;
    let mpv = &app.state::<AppState>().mpv;
    let mut slot = mpv.lookahead.locked();
    if mpv.loads.load(Ordering::SeqCst) != load || mpv.ahead_reader.load(Ordering::SeqCst) != reader {
        return;
    }
    if let Some(s) = state.filter(|s| slot.is_none_or(|(l, was)| l != load || was != *s)) {
        tracing::info!("autocrop lookahead: {}", s.describe());
    }
    *slot = state.map(|s| (load, s));
}

/// A load's opening crop, handed from `mpv_load` to the autocrop loop.

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Opening {
    /// The probe of this load is still running: hold the tracker back.
    Probing(u64),
    /// This load starts with `bars` removed from frames of size `full`.
    Ready { load: u64, full: (i64, i64), bars: (i64, i64) },
}

/// What the probe found: the frame size, its display size and the bars at
/// least 5 of 8 keyframes agree on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Found {
    pub full: (i64, i64),
    pub display: (i64, i64),
    pub bars: (i64, i64),
}

/// The opening bars of `url` (sent with header `fields`, played from
/// `start` s), or `None` when the probe can't run here or finds none clear
/// within 1.5 s.
pub(super) async fn opening(url: String, fields: Vec<String>, start: f64) -> Option<Found> {
    imp::opening(url, fields, start).await
}

/// Read keyframes of `load` (`url` with header `fields`, opened with
/// `bars` removed) ahead of the playhead into `Mpv::ahead`, while autocrop
/// run `run` lasts on this load and [`stop_ahead`] isn't called (the
/// setting turned off, or a newer reader).
pub(super) fn ahead(
    app: AppHandle,
    run: u64,
    load: u64,
    url: String,
    fields: Vec<String>,
    bars: (i64, i64),
) -> impl std::future::Future<Output = ()> + Send + 'static {
    let reader = stop_ahead(&app.state::<AppState>().mpv);
    async move {
        let ended = imp::ahead(&app, run, reader, load, url, fields, bars).await;
        report(&app, reader, load, ended.err());
    }
}

/// Stop the lookahead reader running, if any, and forget what it said;
/// the number the next reader takes.
pub(super) fn stop_ahead(mpv: &Mpv) -> u64 {
    let mut slot = mpv.lookahead.locked();
    *slot = None;
    mpv.ahead_reader.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

/// Kill any probe still running (the app is closing).
pub(super) fn kill_all() {
    imp::kill_all();
}

#[cfg(mpv_in_app)]
mod imp {
    use tauri::AppHandle;

    use super::{Found, Lookahead};

    pub(super) async fn ahead(
        _app: &AppHandle,
        _run: u64,
        _reader: u64,
        _load: u64,
        _url: String,
        _fields: Vec<String>,
        _bars: (i64, i64),
    ) -> Result<(), Lookahead> {
        Err(Lookahead::ThisDevice)
    }

    /// libmpv runs inside the app on macOS, iOS and Android, with no second instance to probe with yet.
    pub(super) async fn opening(_url: String, _fields: Vec<String>, _start: f64) -> Option<Found> {
        None
    }

    pub(super) fn kill_all() {}
}

#[cfg(not(mpv_in_app))]
mod imp {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;

    use polar_player::bars::{detect, levels_for, Levels, Measured};
    use polar_player::crop::{opening_bars, opening_points};
    use polar_player::lookahead::{CutSearch, Schedule, PTS_SLACK};
    use polar_player::png::decode_stored;
    use serde_json::{json, Value};
    use tauri::{AppHandle, Manager};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
    use tokio::sync::mpsc;

    use super::{report, Found, Lookahead};
    use crate::locks::Locked;
    use crate::player::ipc::{self, Stream};
    use crate::player::{kill_process, launch, mpv_binary, shots_dir, Process};
    use crate::AppState;

    /// How long a load waits for the probe, at most; it uses what came by then.
    const BUDGET: Duration = Duration::from_millis(1500);

    /// One keyframe's reading, with the sizes it belongs to.
    type Reading = ((i64, i64), (i64, i64), Option<Measured>);

    /// The probes running now, by number, so the app never leaves one behind.
    static RUNNING: StdMutex<Vec<(u64, Process)>> = StdMutex::new(Vec::new());

    pub(super) fn kill_all() {
        for (_, child) in RUNNING.locked().drain(..) {
            kill_process(&child);
        }
    }

    pub(super) async fn opening(url: String, fields: Vec<String>, start: f64) -> Option<Found> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        tokio::spawn(probe(url, fields, start, tx));
        let deadline = tokio::time::Instant::now() + BUDGET;
        let mut sizes = None;
        let mut readings = Vec::new();
        while let Ok(Some((full, display, m))) = tokio::time::timeout_at(deadline, rx.recv()).await {
            sizes = Some((full, display));
            readings.push(m);
        }
        // The probe sees the channel close and stops: its mpv is killed, its files removed.
        drop(rx);
        let (full, display) = sizes?;
        let bars = opening_bars(full, &readings);
        tracing::debug!("autocrop pre-roll: {} readings, bars {bars:?}", readings.len());
        (bars != (0, 0)).then_some(Found { full, display, bars })
    }

    /// The probe's mpv and its screenshot folder, gone when this is dropped.
    struct Probe {
        n: u64,
        child: Process,
        dir: PathBuf,
        reader: BufReader<ReadHalf<Stream>>,
        writer: WriteHalf<Stream>,
        next: u64,
        /// Screenshots taken, to name the next one.
        shots: u64,
        /// Events seen since the last [`Probe::forget`].
        events: Vec<String>,
    }

    impl Drop for Probe {
        fn drop(&mut self) {
            kill_process(&self.child);
            RUNNING.locked().retain(|(n, _)| *n != self.n);
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    impl Probe {
        async fn command(&mut self, command: Value) -> Option<Value> {
            self.next += 1;
            let mut line = serde_json::to_vec(&json!({ "command": command, "request_id": self.next })).ok()?;
            line.push(b'\n');
            self.writer.write_all(&line).await.ok()?;
            loop {
                let msg = self.message().await?;
                if msg.get("request_id").and_then(Value::as_u64) == Some(self.next) {
                    return (msg.get("error").and_then(Value::as_str) == Some("success"))
                        .then(|| msg.get("data").cloned().unwrap_or(Value::Null));
                }
            }
        }

        /// The next of `names` to happen (or to have happened since [`Probe::forget`]).
        async fn event(&mut self, names: &[&str]) -> Option<String> {
            loop {
                if let Some(e) = self.events.iter().find(|e| names.contains(&e.as_str())) {
                    return Some(e.clone());
                }
                self.message().await?;
            }
        }

        fn forget(&mut self) {
            self.events.clear();
        }

        /// Read one line, noting it if it's an event.
        async fn message(&mut self) -> Option<Value> {
            let mut line = String::new();
            loop {
                line.clear();
                if self.reader.read_line(&mut line).await.ok()? == 0 {
                    return None;
                }
                if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                    if let Some(e) = msg.get("event").and_then(Value::as_str) {
                        self.events.push(e.to_owned());
                    }
                    return Some(msg);
                }
            }
        }
    }

    /// A probe's mpv, started with the IPC endpoint and folder named `tag`:
    /// reading only keyframes, or (`exact`) any frame, sought exactly.
    async fn start(tag: &str, exact: bool) -> Option<Probe> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let bin = mpv_binary()?;
        let pipe = ipc::endpoint(&format!("{tag}-{n}"));
        let dir = shots_dir().join(format!("{tag}-{n}"));
        std::fs::create_dir_all(&dir).ok()?;
        let mut args: Vec<String> = vec![
            format!("--input-ipc-server={pipe}"),
            "--config=no".into(),
            "--idle=yes".into(),
            "--pause=yes".into(),
            "--terminal=no".into(),
            // No picture, sound or subtitles: frames come out as screenshots.
            "--vo=null".into(),
            "--ao=null".into(),
            "--aid=no".into(),
            "--sid=no".into(),
            // Every seek lands on a keyframe, and only keyframes are decoded, in software.
            "--hr-seek=no".into(),
            "--vd-lavc-skipframe=nonkey".into(),
            "--hwdec=no".into(),
            "--cache=no".into(),
            "--demuxer-max-bytes=8MiB".into(),
            "--demuxer-readahead-secs=1".into(),
            "--network-timeout=10".into(),
            "--tls-verify=yes".into(),
            "--ytdl=no".into(),
            "--sub-auto=no".into(),
            "--audio-file-auto=no".into(),
            "--screenshot-sw=yes".into(),
            "--screenshot-format=png".into(),
            "--screenshot-png-compression=0".into(),
            "--screenshot-png-filter=0".into(),
            "--screenshot-high-bit-depth=no".into(),
            "--screenshot-tag-colorspace=no".into(),
        ];
        if exact {
            // Every frame decoded, and seeks land on the frame asked for.
            args.retain(|a| a != "--vd-lavc-skipframe=nonkey");
            args.retain(|a| a != "--hr-seek=no");
            args.push("--hr-seek=yes".into());
        }
        let (child, client) = match launch(&bin, &args, true, &pipe).await.ok()? {
            Some(ok) => ok,
            None => launch(&bin, &args, false, &pipe).await.ok()??,
        };
        let (reader, writer) = tokio::io::split(client);
        let child: Process = Arc::new(StdMutex::new(child));
        RUNNING.locked().push((n, child.clone()));
        Some(Probe { n, child, dir, reader: BufReader::new(reader), writer, next: 0, shots: 0, events: Vec::new() })
    }

    /// The video's frame size, display size and black levels, once `url` is open.
    struct Video {
        full: (i64, i64),
        display: (i64, i64),
        levels: Levels,
        duration: Option<f64>,
        /// How long a frame lasts, in seconds (1/24 when mpv doesn't say).
        frame: f64,
    }

    impl Probe {
        /// Open `url` (sent with header `fields`), paused on its first frame.
        async fn open(&mut self, url: &str, fields: &[String]) -> Option<Video> {
            self.command(json!(["set_property", "http-header-fields", fields])).await?;
            self.forget();
            self.command(json!(["loadfile", url, "replace"])).await?;
            // Paused, mpv still shows the first frame: then the video's size is known.
            if self.event(&["playback-restart", "end-file"]).await? != "playback-restart" {
                return None;
            }
            let duration = self.command(json!(["get_property", "duration"])).await.and_then(|d| d.as_f64());
            let params = self.command(json!(["get_property", "video-params"])).await?;
            let int = |k: &str| params.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
            let (full, display) = ((int("w")?, int("h")?), (int("dw")?, int("dh")?));
            let levels = levels_for(params.get("gamma").and_then(Value::as_str));
            let fps = self.command(json!(["get_property", "container-fps"])).await.and_then(|f| f.as_f64());
            let frame = 1.0 / fps.filter(|f| (1.0..=300.0).contains(f)).unwrap_or(24.0);
            Some(Video { full, display, levels, duration, frame })
        }

        /// Seek (`how`: mpv's seek flags) and wait for the frame: `Ok(true)`
        /// once it's there, `Ok(false)` if mpv refused the seek, `Err` once
        /// the file has ended or mpv is gone.
        async fn seek(&mut self, to: f64, how: &str) -> Result<bool, ()> {
            self.forget();
            if self.command(json!(["seek", to, how])).await.is_none() {
                return Ok(false);
            }
            match self.event(&["playback-restart", "end-file"]).await.as_deref() {
                Some("playback-restart") => Ok(true),
                _ => Err(()),
            }
        }

        /// Our detector's reading of the frame shown now, scaled to the
        /// video's pixels: `Some(None)` for a black frame, `None` if no
        /// screenshot came.
        async fn reading(&mut self, video: &Video) -> Option<Option<Measured>> {
            self.shots += 1;
            let path = self.dir.join(format!("{}.png", self.shots));
            self.command(json!(["screenshot-to-file", path.to_string_lossy(), "video"])).await?;
            let bytes = tokio::fs::read(&path).await.ok();
            let _ = tokio::fs::remove_file(&path).await;
            let img = bytes.as_deref().and_then(decode_stored)?;
            let shot = (img.w as i64, img.h as i64);
            Some(detect(&img.frame(), video.levels).map(|m| m.scaled(shot, video.full)))
        }

        /// Seek exactly to `at` (an `exact` probe) and read the frame it
        /// lands on: its pts and our detector's reading.
        async fn frame_at(&mut self, video: &Video, at: f64) -> Option<(f64, Option<Measured>)> {
            if self.seek(at, "absolute+exact").await != Ok(true) {
                return None;
            }
            let pts = self.command(json!(["get_property", "time-pos"])).await.and_then(|t| t.as_f64())?;
            Some((pts, self.reading(video).await?))
        }
    }

    /// What the exact probe reads for the lookahead: a frame the engine
    /// wants read before it's shown, or the cut between two keyframes.
    enum Job {
        Frame(f64),
        Search(CutSearch),
    }

    /// The lookahead's exact probe, opened when there's first something
    /// for it to read; `None` once it couldn't be (then nothing is read
    /// exactly, and changes between keyframes are left to the live readings).
    struct Exact {
        probe: Option<Option<(Probe, Video)>>,
    }

    impl Exact {
        /// Do `job` for `load`, reading frames of `url`; the result goes to the schedule.
        async fn run(&mut self, app: &AppHandle, load: u64, url: &str, fields: &[String], job: Job) {
            if self.probe.is_none() {
                let mut opened = None;
                if let Some(mut p) = self::start("exact", true).await {
                    if let Some(video) = p.open(url, fields).await {
                        opened = Some((p, video));
                    }
                }
                if opened.is_none() {
                    tracing::info!("autocrop lookahead: frames between keyframes can't be read exactly here");
                }
                self.probe = Some(opened);
            }
            let Some(Some((p, video))) = self.probe.as_mut() else { return };
            let mpv = &app.state::<AppState>().mpv;
            match job {
                Job::Frame(at) => {
                    let Some((pts, measured)) = p.frame_at(video, at).await else { return };
                    if let Some(s) = mpv.ahead.locked().as_mut() {
                        s.frame(load, pts, measured);
                    }
                }
                Job::Search(mut search) => {
                    let frame = video.frame;
                    if search.to < f64::from_bits(mpv.playhead.load(Ordering::SeqCst)) {
                        return; // shown already
                    }
                    while let Some(at) = search.next(frame) {
                        let Some((pts, measured)) = p.frame_at(video, at).await else { return };
                        let mut slot = mpv.ahead.locked();
                        let Some(s) = slot.as_mut() else { return };
                        if let Some(rest) = search.read(at, pts, s.frame_bars(measured)) {
                            s.push_search(load, rest);
                        }
                    }
                    if let Some(s) = mpv.ahead.locked().as_mut() {
                        s.searched(load, &search, frame);
                    }
                }
            }
        }
    }

    /// Open `url` in a probe and send a reading of each keyframe at
    /// [`opening_points`], until done or `tx`'s receiver is gone. Starting
    /// mpv isn't cut short (a process mid-start would be left running), so
    /// the probe may outlast the load's wait by that much.
    async fn probe(url: String, fields: Vec<String>, start: f64, tx: mpsc::UnboundedSender<Reading>) -> Option<()> {
        let mut p = self::start("probe", false).await?;
        tokio::select! {
            done = measure(&mut p, url, fields, start, &tx) => done,
            () = tx.closed() => None,
        }
    }

    async fn measure(
        p: &mut Probe,
        url: String,
        fields: Vec<String>,
        start: f64,
        tx: &mpsc::UnboundedSender<Reading>,
    ) -> Option<()> {
        let video = p.open(&url, &fields).await?;
        for t in opening_points(video.duration, start) {
            if !p.seek(t, "absolute+keyframes").await.ok()? {
                continue;
            }
            let Some(measured) = p.reading(&video).await else { continue };
            tx.send((video.full, video.display, measured)).ok()?;
        }
        Some(())
    }

    /// The lookahead's first step forward from a keyframe, in seconds:
    /// small, so it doesn't jump past the next keyframe, and doubled up to
    /// [`MAX_STEP`] while mpv lands on the same one again.
    const STEP: f64 = 0.1;
    const MAX_STEP: f64 = 12.8;

    /// Whether lookahead `reader` of autocrop run `run` and `load` should go on.
    fn wanted(app: &AppHandle, run: u64, reader: u64, load: u64) -> bool {
        let mpv = &app.state::<AppState>().mpv;
        let tune = *mpv.tuned.locked();
        tune.autocrop
            && mpv.loads.load(Ordering::SeqCst) == load
            && mpv.ahead_reader.load(Ordering::SeqCst) == reader
            && mpv.crop_events.locked().as_ref().is_some_and(|(r, _)| *r == run)
    }

    /// `Ok` once no longer wanted (the next load, autocrop or the setting
    /// off), else why it stopped.
    pub(super) async fn ahead(
        app: &AppHandle,
        run: u64,
        reader: u64,
        load: u64,
        url: String,
        fields: Vec<String>,
        bars: (i64, i64),
    ) -> Result<(), Lookahead> {
        let ended = read_ahead(app, run, reader, load, &url, &fields, bars).await;
        let mpv = &app.state::<AppState>().mpv;
        let mut slot = mpv.ahead.locked();
        if mpv.loads.load(Ordering::SeqCst) == load && mpv.ahead_reader.load(Ordering::SeqCst) == reader {
            *slot = None;
        }
        ended
    }

    /// Times the lookahead opens the source again after it stopped
    /// answering (a dropped connection, a source slow to deliver what's
    /// ahead), and seeks refused in a row before it gives up.
    const REOPENS: u32 = 3;
    const REFUSALS: u32 = 5;

    /// The probe follows the playhead: from the keyframe at or before it,
    /// keyframe by keyframe up to [`AHEAD_SECS`](polar_player::lookahead::AHEAD_SECS)
    /// ahead, and from the new place after a seek (back, or past what it
    /// read). Live streams (no duration) have nothing ahead to read.
    async fn read_ahead(
        app: &AppHandle,
        run: u64,
        reader: u64,
        load: u64,
        url: &str,
        fields: &[String],
        bars: (i64, i64),
    ) -> Result<(), Lookahead> {
        let mut p = self::start("ahead", false).await.ok_or(Lookahead::NoReader)?;
        let video = p.open(url, fields).await.ok_or(Lookahead::NotOpened)?;
        let duration = video.duration.ok_or(Lookahead::Live)?;
        let mpv = &app.state::<AppState>().mpv;
        // Opening took a while: it may have been stopped meanwhile.
        if !wanted(app, run, reader, load) {
            return Ok(());
        }
        *mpv.ahead.locked() = Some(Schedule::new(load, video.full, bars));
        report(app, reader, load, Some(Lookahead::Reading));
        let mut last_head = f64::NAN;
        let mut step = STEP;
        let mut led = false;
        let (mut reopens, mut refused) = (0, 0);
        // Read to the file's end: nothing more until a seek.
        let mut at_end = false;
        let mut exact = Exact { probe: None };
        while wanted(app, run, reader, load) {
            // Frames a step would show first (the viewer waits on them), then cuts between keyframes.
            let job = mpv
                .ahead
                .locked()
                .as_mut()
                .and_then(|s| s.take_wanted(load).map(Job::Frame).or_else(|| s.take_search(load).map(Job::Search)));
            if let Some(job) = job {
                exact.run(app, load, url, fields, job).await;
                continue;
            }
            let head = f64::from_bits(mpv.playhead.load(Ordering::SeqCst));
            if !head.is_finite() {
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            }
            let Some((read, more)) = mpv.ahead.locked().as_ref().map(|s| (s.read_to(), s.wants_more(head))) else {
                return Ok(());
            };
            // A seek moves the playhead back, or on by more than playing
            // would; and once the reading led, the playhead passing it means
            // the same (or reading too slowly): start again from there.
            let jumped = head < last_head - 1.0 || head > last_head + 10.0;
            let seeked = jumped || (led && read.is_some_and(|r| head > r + 1.0));
            last_head = head;
            let fresh = read.is_none() || seeked;
            if fresh {
                (led, at_end) = (false, false);
            }
            let sought = if fresh {
                if seeked {
                    mpv.ahead.locked().as_mut().ok_or(Lookahead::Stopped)?.restart();
                }
                p.seek(head, "absolute+keyframes").await
            } else if more && !at_end {
                p.seek(step, "relative+keyframes").await
            } else {
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            };
            let landed = match sought {
                Ok(landed) => landed,
                Err(()) => {
                    // Past the last keyframe the file ends: open it again and wait there.
                    let end = !fresh && read.is_some_and(|r| r + 2.0 * MAX_STEP >= duration);
                    if !end {
                        reopens += 1;
                        if reopens > REOPENS {
                            return Err(Lookahead::Stopped);
                        }
                        tracing::info!("autocrop lookahead: the source stopped answering, opening it again ({reopens} of {REOPENS})");
                        tokio::time::sleep(Duration::from_secs(2 * u64::from(reopens))).await;
                    }
                    if p.open(url, fields).await.is_none() {
                        // mpv itself is gone: another one.
                        p = self::start("ahead", false).await.ok_or(Lookahead::NoReader)?;
                        p.open(url, fields).await.ok_or(Lookahead::Stopped)?;
                    }
                    at_end = end;
                    if !end {
                        mpv.ahead.locked().as_mut().ok_or(Lookahead::Stopped)?.restart();
                    }
                    continue;
                }
            };
            if !landed {
                refused += 1;
                if refused >= REFUSALS {
                    return Err(Lookahead::NoSeeking);
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
            refused = 0;
            let Some(pts) = p.command(json!(["get_property", "time-pos"])).await.and_then(|t| t.as_f64()) else {
                continue;
            };
            if !fresh && read.is_some_and(|r| pts <= r + PTS_SLACK) {
                // The same keyframe again: step further, or wait at the end of the index.
                if step >= MAX_STEP {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                step = (step * 2.0).min(MAX_STEP);
                continue;
            }
            step = STEP;
            led |= pts >= head;
            let Some(measured) = p.reading(&video).await else { continue };
            let mut slot = mpv.ahead.locked();
            let Some(s) = slot.as_mut() else { return Ok(()) };
            s.keyframe(load, pts, measured);
            if fresh && pts < head {
                // Shown before the playhead got here: what it changed is the live tracker's.
                s.take(load, head);
            }
        }
        Ok(())
    }
}
