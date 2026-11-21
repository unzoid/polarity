//! The engine: one BitTorrent session for the app, playing one stream at a
//! time. The chosen file is fetched in the order it's read (the player's
//! position first) and handed to the player through [`crate::serve`].
//!
//! Everything is kept in one cache folder, emptied when the engine starts.
//! When playback ends the torrent is removed with its files, unless the user
//! chose to keep sharing it; kept ones are removed oldest first whenever a new
//! stream needs the room under the cache limit.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use bytes::Bytes;
use librqbit::api::TorrentIdOrHash;
use librqbit::dht::{DhtPersistenceConfig, Id20};
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ConnectionOptions, DhtSessionConfig, ListOnlyResponse,
    ListenerOptions, ManagedTorrent, PeerConnectionOptions, Session, SessionOptions,
};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::magnet;
use crate::serve::{Files, OpenFuture, Opened as Served, Server};

/// How long to wait for peers to send the torrent's file list.
const METADATA_TIMEOUT: Duration = Duration::from_secs(60);
/// An open overtaken by a close or another open.
const CLOSED: &str = "Playback closed before the torrent was ready.";
/// A torrent whose file names would leave the cache folder.
const UNSAFE_NAMES: &str = "This torrent's file names can't be saved safely. Choose another source.";
/// File types a player can open, for picking a file when the add-on names none.
const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "m4v", "webm", "avi", "mov", "ts", "m2ts", "wmv", "mpg", "mpeg"];

/// The user's limits (Settings → Sources), sent with every stream.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Limits {
    /// Most bytes the cache may hold; 0 = no limit.
    pub cache_bytes: u64,
    /// Download speed cap in bytes per second; `None` = none.
    pub download_bps: Option<NonZeroU32>,
    /// Upload speed cap in bytes per second; `None` = none. It stays in force
    /// while a torrent is kept for sharing after its playback.
    pub upload_bps: Option<NonZeroU32>,
    /// Keep sharing a torrent after its playback ends (until the app quits
    /// or the room is needed). Off: it stops and its files are deleted.
    pub keep_sharing: bool,
}

/// A torrent stream as an add-on describes it.
#[derive(Debug, Clone, Default)]
pub struct Request {
    pub info_hash: String,
    pub file_idx: Option<usize>,
    /// The stream's `sources` (`tracker:<url>`, `dht:<hash>`).
    pub sources: Vec<String>,
}

/// A step of opening a stream, for the player's loading screen. Says nothing
/// about what the torrent is (no names, no hash).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum Step {
    /// Asking the DHT (and this many trackers) for peers.
    Searching { trackers: usize, dht: bool },
    /// The file list arrived: file `chosen` (1-based) of `files`.
    Metadata { files: usize, chosen: usize, ext: Option<String>, size: u64, ms: u64 },
    /// Every second while it plays.
    Peers { connected: u32, connecting: u32, down_bps: u64, have: u64, size: u64 },
}

pub type OnStep = Arc<dyn Fn(Step) + Send + Sync>;

/// A stream ready to play.
#[derive(Debug, Clone, Serialize)]
pub struct Opened {
    pub url: String,
    pub size: u64,
}

/// Knobs tests turn; the app uses [`Engine::start`].
#[doc(hidden)]
#[derive(Debug, Clone)]
pub struct Options {
    pub dht: bool,
    /// Where to persist the DHT routing table across engine restarts (avoids 2–8 s cold DHT bootstraps).
    pub dht_file: Option<PathBuf>,
    /// Accept incoming connections here. The app doesn't listen (no firewall
    /// prompt); it connects out to the peers it finds.
    pub listen: Option<SocketAddr>,
    pub initial_peers: Vec<SocketAddr>,
    pub metadata_timeout: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            dht: true,
            dht_file: None,
            listen: None,
            initial_peers: Vec::new(),
            metadata_timeout: METADATA_TIMEOUT,
        }
    }
}

struct Active {
    torrent: Arc<ManagedTorrent>,
    file: usize,
    size: u64,
    ext: Option<String>,
    /// Ends this stream's stats loop.
    done: Arc<AtomicBool>,
}

#[derive(Default)]
struct State {
    next: u64,
    /// What the player has open, by link id.
    playing: Option<(u64, Active)>,
    /// Kept for sharing after playback, oldest first.
    kept: VecDeque<Active>,
}

#[derive(Default)]
struct Registry(Mutex<HashMap<u64, (Arc<ManagedTorrent>, usize)>>);

impl Files for Registry {
    fn open(&self, id: u64) -> OpenFuture {
        let found = self.0.lock().unwrap_or_else(PoisonError::into_inner).get(&id).cloned();
        Box::pin(async move {
            let (torrent, file) = found?;
            let stream = torrent.stream(file).await.map_err(|e| tracing::warn!("stream failed to open: {e:#}")).ok()?;
            Some(Served { len: stream.len(), body: Box::new(stream) })
        })
    }
}

pub struct Engine {
    session: Arc<Session>,
    server: Server,
    files: Arc<Registry>,
    state: Mutex<State>,
    /// Bumped by every open and close: an open still waiting for peers when
    /// the player closes (or another open starts) sees it and gives up.
    generation: AtomicU64,
    dir: PathBuf,
    options: Options,
}

impl Engine {
    /// Start the engine with its cache in `dir` (emptied first: nothing is
    /// kept from an earlier run). Persists the DHT routing table beside `dir`
    /// so restarts skip cold DHT bootstrap.
    pub async fn start(dir: PathBuf) -> Result<Engine, String> {
        let dht_file = dir.parent().map(|p| p.join("torrent-dht.json"));
        Self::start_with(dir, Options { dht_file, ..Options::default() }).await
    }

    #[doc(hidden)]
    pub async fn start_with(dir: PathBuf, options: Options) -> Result<Engine, String> {
        let dir_clean = dir.clone();
        tokio::task::spawn_blocking(move || empty_dir(&dir_clean))
            .await
            .map_err(|e| format!("couldn't prepare the cache folder: {e}"))?
            .map_err(|e| format!("couldn't prepare the cache folder: {e}"))?;
        let dht = options.dht.then(|| DhtSessionConfig {
            bootstrap_addrs: None,
            port: None,
            persistence: options.dht_file.clone().map(|path| DhtPersistenceConfig {
                config_filename: Some(path),
                dump_interval: Some(Duration::from_secs(30)),
            }),
        });
        let session = Session::new_with_opts(
            dir.clone(),
            SessionOptions {
                dht,
                disable_trackers: false,
                fastresume: false,
                persistence: None,
                listen: options.listen.map(|addr| ListenerOptions { listen_addr: addr, ..Default::default() }),
                connect: Some(ConnectionOptions {
                    enable_tcp: true,
                    proxy_url: None,
                    peer_opts: Some(PeerConnectionOptions {
                        connect_timeout: Some(Duration::from_secs(4)),
                        read_write_timeout: Some(Duration::from_secs(10)),
                        keep_alive_interval: None,
                        // Smaller outstanding request window lets librqbit pivot to newly seeked pieces 4x faster.
                        max_request_window: Some(32),
                    }),
                }),
                disable_local_service_discovery: true,
                client_name_and_version: Some(format!("Polarity/{}", env!("CARGO_PKG_VERSION"))),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("couldn't start: {e:#}"))?;
        let files = Arc::new(Registry::default());
        let server = Server::start(files.clone()).await.map_err(|e| format!("couldn't serve the stream: {e}"))?;
        Ok(Engine { session, server, files, state: Mutex::default(), generation: AtomicU64::new(0), dir, options })
    }

    /// Whether `url` is a link this engine handed out.
    pub fn owns(&self, url: &str) -> bool {
        self.server.owns(url)
    }

    #[doc(hidden)]
    pub fn listen_addr(&self) -> Option<SocketAddr> {
        self.session.listen_addr()
    }

    /// Open `request` for playback, replacing whatever was playing. Reports
    /// its steps to `on_step` (also every second afterwards, until closed).
    pub async fn open(&self, request: &Request, limits: Limits, on_step: OnStep) -> Result<Opened, String> {
        let hash = magnet::info_hash(&request.info_hash).ok_or("This source's torrent id isn't valid.")?;
        self.close(limits).await;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let stale = || self.generation.load(Ordering::SeqCst) != generation;
        self.session.ratelimits.set_download_bps(limits.download_bps);
        self.session.ratelimits.set_upload_bps(limits.upload_bps);

        let trackers = magnet::trackers(&request.sources);
        let started = Instant::now();
        on_step(Step::Searching { trackers: trackers.len(), dht: self.options.dht });
        let (torrent, file, size, ext) = match self.take_kept(&hash) {
            Some(kept) => {
                // Season-pack reuse: keep existing peers and switch `only_files` if another file in the same torrent is requested.
                let target_file = request.file_idx.unwrap_or(kept.file);
                if target_file == kept.file {
                    let ext = kept.ext.clone();
                    let files = kept.torrent.metadata.load().as_ref().map_or(1, |m| m.file_infos.len());
                    on_step(Step::Metadata { files, chosen: kept.file + 1, ext: ext.clone(), size: kept.size, ms: 0 });
                    (kept.torrent, kept.file, kept.size, ext)
                } else if let Some((files_len, size, ext)) = {
                    let meta = kept.torrent.metadata.load();
                    meta.as_ref().and_then(|m| {
                        let fi = m.file_infos.get(target_file)?;
                        Some((m.file_infos.len(), fi.len, extension(&fi.relative_filename)))
                    })
                } {
                    if limits.cache_bytes > 0 && size > limits.cache_bytes {
                        self.remove(&kept.torrent).await;
                        return Err(format!(
                            "This file ({}) is larger than the torrent cache limit ({}) in Settings → Sources.",
                            gb(size),
                            gb(limits.cache_bytes)
                        ));
                    }
                    self.make_room(size, limits.cache_bytes).await;
                    let selected = HashSet::from([target_file]);
                    self.session
                        .update_only_files(&kept.torrent, &selected)
                        .await
                        .map_err(|e| format!("The torrent couldn't switch files: {e:#}"))?;
                    on_step(Step::Metadata {
                        files: files_len,
                        chosen: target_file + 1,
                        ext: ext.clone(),
                        size,
                        ms: 0,
                    });
                    (kept.torrent, target_file, size, ext)
                } else {
                    self.remove(&kept.torrent).await;
                    return Err(format!("The add-on asked for file {} which isn't in this torrent.", target_file + 1));
                }
            }
            None => {
                // The file list first, so only the chosen file is ever fetched.
                let listed = self.list(&hash, &trackers).await?;
                if stale() {
                    return Err(CLOSED.into());
                }
                let files: Vec<(PathBuf, u64)> =
                    listed.info.iter_file_details().map(|f| (f.filename.to_pathbuf(), f.len)).collect();
                // Every file of the torrent is created in the cache folder, not only the one played.
                if !files.iter().all(|(p, _)| stays_inside(p)) {
                    return Err(UNSAFE_NAMES.into());
                }
                let file = match request.file_idx {
                    Some(i) if i < files.len() => i,
                    Some(i) => {
                        return Err(format!(
                            "The add-on asked for file {} but this torrent has {}.",
                            i + 1,
                            files.len()
                        ))
                    }
                    None => pick_file(files.iter().map(|(p, len)| (p.as_path(), *len))),
                };
                let (size, ext) = (files[file].1, extension(&files[file].0));
                on_step(Step::Metadata {
                    files: files.len(),
                    chosen: file + 1,
                    ext: ext.clone(),
                    size,
                    ms: started.elapsed().as_millis() as u64,
                });
                if limits.cache_bytes > 0 && size > limits.cache_bytes {
                    return Err(format!(
                        "This file ({}) is larger than the torrent cache limit ({}) in Settings → Sources.",
                        gb(size),
                        gb(limits.cache_bytes)
                    ));
                }
                self.make_room(size, limits.cache_bytes).await;
                let torrent = self.add(&hash, listed.torrent_bytes, file, listed.seen_peers, &trackers).await?;
                (torrent, file, size, ext)
            }
        };

        if stale() {
            self.remove(&torrent).await;
            return Err(CLOSED.into());
        }
        let done = Arc::new(AtomicBool::new(false));
        let id = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            state.next += 1;
            let id = state.next;
            state.playing =
                Some((id, Active { torrent: torrent.clone(), file, size, ext: ext.clone(), done: done.clone() }));
            id
        };
        self.files.0.lock().unwrap_or_else(PoisonError::into_inner).insert(id, (torrent.clone(), file));
        // Proactively warm header & container trailer (MP4 moov / MKV Cues) pieces while mpv connects.
        tokio::spawn(prefetch_edges(torrent.clone(), file, size, done.clone()));
        tokio::spawn(report(torrent, file, size, done, on_step));
        Ok(Opened { url: self.server.url(id, ext.as_deref()), size })
    }

    /// End playback: the torrent stops and its files go, unless
    /// `limits.keep_sharing`. Nothing happens when nothing plays.
    pub async fn close(&self, limits: Limits) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let Some((id, active)) = self.state.lock().unwrap_or_else(PoisonError::into_inner).playing.take() else {
            return;
        };
        active.done.store(true, Ordering::SeqCst);
        self.files.0.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
        if limits.keep_sharing {
            self.state.lock().unwrap_or_else(PoisonError::into_inner).kept.push_back(active);
        } else {
            self.remove(&active.torrent).await;
        }
    }

    /// Stop everything and empty the cache (app exit).
    pub async fn shutdown(&self) {
        let (playing, kept) = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            (state.playing.take(), std::mem::take(&mut state.kept))
        };
        for active in playing.map(|(_, a)| a).into_iter().chain(kept) {
            active.done.store(true, Ordering::SeqCst);
            self.remove(&active.torrent).await;
        }
        self.session.stop().await;
        let dir = self.dir.clone();
        let _ = tokio::task::spawn_blocking(move || empty_dir(&dir)).await;
    }

    /// Ask peers for the torrent's file list (and who has it).
    async fn list(&self, hash: &str, trackers: &[String]) -> Result<ListOnlyResponse, String> {
        let options = AddTorrentOptions {
            list_only: true,
            initial_peers: (!self.options.initial_peers.is_empty()).then(|| self.options.initial_peers.clone()),
            ..Default::default()
        };
        let timeout = self.options.metadata_timeout;
        let listed = tokio::time::timeout(
            timeout,
            self.session.add_torrent(AddTorrent::from_url(magnet::magnet(hash, trackers)), Some(options)),
        )
        .await
        .map_err(|_| format!("No peers sent this torrent's file list within {} s.", timeout.as_secs()))?
        .map_err(|e| format!("The torrent couldn't be opened: {e:#}"))?;
        match listed {
            AddTorrentResponse::ListOnly(l) => Ok(l),
            _ => Err("The torrent couldn't be opened.".into()),
        }
    }

    /// Start fetching `file` of the listed torrent, from the peers that sent the list (and any trackers / DHT peers).
    async fn add(
        &self,
        hash: &str,
        torrent: Bytes,
        file: usize,
        peers: Vec<SocketAddr>,
        trackers: &[String],
    ) -> Result<Arc<ManagedTorrent>, String> {
        let peers: Vec<SocketAddr> = self.options.initial_peers.iter().copied().chain(peers).collect();
        let options = AddTorrentOptions {
            only_files: Some(vec![file]),
            overwrite: true,
            sub_folder: Some(hash.to_owned()),
            initial_peers: (!peers.is_empty()).then_some(peers),
            trackers: (!trackers.is_empty()).then(|| trackers.to_vec()),
            ..Default::default()
        };
        let added = self
            .session
            .add_torrent(AddTorrent::from_bytes(torrent), Some(options))
            .await
            .map_err(|e| format!("The torrent couldn't be opened: {e:#}"))?;
        match added {
            AddTorrentResponse::Added(_, t) | AddTorrentResponse::AlreadyManaged(_, t) => Ok(t),
            AddTorrentResponse::ListOnly(_) => Err("The torrent couldn't be opened.".into()),
        }
    }

    /// A torrent kept for sharing, taken back to play the same file or another episode in the same torrent.
    fn take_kept(&self, hash: &str) -> Option<Active> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let at = state.kept.iter().position(|a| hex(&a.torrent.info_hash()) == hash)?;
        state.kept.remove(at)
    }

    /// Drop kept torrents, oldest first, until `incoming` more bytes fit under `cap`.
    async fn make_room(&self, incoming: u64, cap: u64) {
        if cap == 0 {
            return;
        }
        loop {
            let oldest = {
                let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
                let used: u64 = state.kept.iter().map(|a| a.size).sum();
                if used + incoming <= cap {
                    return;
                }
                state.kept.pop_front()
            };
            match oldest {
                Some(active) => self.remove(&active.torrent).await,
                None => return,
            }
        }
    }

    async fn remove(&self, torrent: &ManagedTorrent) {
        let hash = hex(&torrent.info_hash());
        if let Err(e) = self.session.delete(TorrentIdOrHash::Id(torrent.id()), true).await {
            tracing::warn!("couldn't remove a torrent: {e:#}");
        }
        let target = self.dir.join(&hash);
        // Move aside with an O(1) rename and delete off the Tokio worker so the next open starts immediately.
        let trash = self.dir.join(format!(".trash-{hash}-{}", self.generation.load(Ordering::Relaxed)));
        tokio::task::spawn_blocking(move || {
            let path = if std::fs::rename(&target, &trash).is_ok() { trash } else { target };
            let _ = std::fs::remove_dir_all(path);
        });
    }
}

/// Hint librqbit to fetch the start (container header) and end (MP4 `moov` / MKV `Cues`) right away so
/// FFmpeg probing finishes in fewer round-trips when mpv connects.
async fn prefetch_edges(torrent: Arc<ManagedTorrent>, file: usize, size: u64, done: Arc<AtomicBool>) {
    if size == 0 || done.load(Ordering::Relaxed) {
        return;
    }
    let Ok(mut stream) = torrent.stream(file).await else { return };
    let mut buf = vec![0u8; 64 * 1024];
    // Touch first piece(s) and last piece(s) quickly; exit as soon as playback closes.
    let mut read_head = 0usize;
    while read_head < 256 * 1024 && !done.load(Ordering::Relaxed) {
        match tokio::time::timeout(Duration::from_secs(6), stream.read(&mut buf)).await {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Ok(n)) => read_head += n,
            Ok(Err(_)) => return,
        }
    }
    if size > 512 * 1024 && !done.load(Ordering::Relaxed) {
        let tail_start = size.saturating_sub(256 * 1024);
        if stream.seek(std::io::SeekFrom::Start(tail_start)).await.is_ok() {
            let mut read_tail = 0usize;
            while read_tail < 256 * 1024 && !done.load(Ordering::Relaxed) {
                match tokio::time::timeout(Duration::from_secs(6), stream.read(&mut buf)).await {
                    Ok(Ok(0)) | Err(_) => break,
                    Ok(Ok(n)) => read_tail += n,
                    Ok(Err(_)) => break,
                }
            }
        }
    }
}

/// Every second until `done`: peers and progress of the playing file.
async fn report(torrent: Arc<ManagedTorrent>, file: usize, size: u64, done: Arc<AtomicBool>, on_step: OnStep) {
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        if done.load(Ordering::SeqCst) {
            return;
        }
        let stats = torrent.stats();
        let have = stats.file_progress.get(file).copied().unwrap_or(0);
        let (connected, connecting, down_bps) = stats.live.as_ref().map_or((0, 0, 0), |l| {
            let p = &l.snapshot.peer_stats;
            (p.live, p.connecting, (l.download_speed.mbps * 1024.0 * 1024.0) as u64)
        });
        on_step(Step::Peers { connected, connecting, down_bps, have, size });
    }
}

/// The file to play when the add-on names none: the largest video, else the largest file.
fn pick_file<'a>(files: impl Iterator<Item = (&'a Path, u64)>) -> usize {
    let files: Vec<_> = files.collect();
    let largest = |video: bool| {
        files
            .iter()
            .enumerate()
            .filter(|(_, (p, _))| !video || extension(p).is_some_and(|e| VIDEO_EXTS.contains(&e.as_str())))
            .max_by_key(|(_, (_, len))| *len)
            .map(|(i, _)| i)
    };
    largest(true).or_else(|| largest(false)).unwrap_or(0)
}

/// Whether a file of the torrent, at `path` under its folder, is written inside that folder: plain names only
/// (no drive such as `C:name` on Windows, no root, no `..`), and on Windows none it reads as a device.
fn stays_inside(path: &Path) -> bool {
    use std::path::Component;
    path.components().count() > 0
        && path.components().all(|c| match c {
            Component::Normal(name) => !(cfg!(windows) && windows_device(&name.to_string_lossy())),
            _ => false,
        })
}

/// Names Windows opens as a device whatever follows the first dot ("nul.mkv", "COM1 .txt").
fn windows_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

fn extension(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
}

fn hex(id: &Id20) -> String {
    id.0.iter().map(|b| format!("{b:02x}")).collect()
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1e9)
}

fn empty_dir(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    std::fs::create_dir_all(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_reach_the_app_in_camel_case() {
        let step = Step::Peers { connected: 0, connecting: 2, down_bps: 0, have: 0, size: 619_000_000 };
        let json = serde_json::to_value(step).unwrap();
        assert_eq!(json["kind"], "peers");
        assert_eq!(json["downBps"], 0);
        assert!(json.get("down_bps").is_none());
    }

    #[test]
    fn picks_the_largest_video() {
        let files = [("a/sample.mkv", 10), ("a/extras.txt", 900), ("a/main.mp4", 500), ("a/other.MKV", 400)];
        assert_eq!(pick_file(files.iter().map(|(p, l)| (Path::new(*p), *l))), 2);
        let none = [("notes.txt", 5), ("big.bin", 50)];
        assert_eq!(pick_file(none.iter().map(|(p, l)| (Path::new(*p), *l))), 1);
    }

    #[test]
    fn file_names_stay_in_the_cache_folder() {
        assert!(stays_inside(Path::new("Show/Season 1/episode.mkv")));
        assert!(stays_inside(Path::new("film.mkv")));
        assert!(!stays_inside(Path::new("")));
        assert!(!stays_inside(Path::new("a/../../b.mkv")));
        assert!(!stays_inside(Path::new("/etc/x")));
        #[cfg(windows)]
        {
            assert!(!stays_inside(Path::new("C:evil.exe")));
            assert!(!stays_inside(Path::new("D:")));
            assert!(!stays_inside(Path::new("Show/nul.mkv")));
            assert!(!stays_inside(Path::new("COM1 .txt")));
        }
        assert!(windows_device("nul.mkv") && windows_device("COM1 .txt") && windows_device("conout$"));
        assert!(!windows_device("console.mkv") && !windows_device("COM.mkv") && !windows_device("film.mkv"));
    }
}
