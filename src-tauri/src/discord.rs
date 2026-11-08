//! Discord Rich Presence (#31): what plays, on the user's Discord profile, as Settings → Playback
//! has it (by default only that Polarity is in use, #150; the title only when the user picks it). Talks to the Discord app on this machine over its local
//! IPC socket (a named pipe on Windows): a handshake with the app's client id, then `SET_ACTIVITY`.
//! The client id is Polarity's Discord application ([`APP_ID`]); a build can use another with
//! `POLAR_DISCORD_CLIENT_ID`, or none by setting it empty. Without an id, or on a machine where
//! Discord isn't running, nothing is shown. One thread owns the connection, so a
//! slow or missing Discord never holds up the player; it sends the latest activity only, at most
//! once every few seconds (Discord's own limit), and logs no titles.
//!
//! Joining a watch party from Discord (#357): in a party that can be joined from Discord, the
//! activity carries the party and a join secret (the desk's join token, never the party code)
//! instead of link buttons, so Discord shows its own Join ("Anyone who sees it") or Ask to Join
//! ("Ask me"). Every connection subscribes to Discord's join events:
//! - `ACTIVITY_JOIN` (on the joiner's side): the secret becomes a `polarity://party/<token>` link,
//!   which the webview takes like the website's (deep_link.rs): the same question and desk as #154.
//! - `ACTIVITY_JOIN_REQUEST` (on the host's side, "Ask me"): Discord's own request is accepted at
//!   once while the activity carries a secret, so the friend's Polarity opens; the host then allows
//!   or declines in Polarity, as with any join request.
//!
//! When Polarity isn't running, Discord starts it through the launch command registered for the
//! application ([`register`], the way Discord's own library does on each system): it opens
//! `polarity://discord-join`, and Polarity connects to Discord ([`listen`]) to take the join that
//! Discord holds for it.
// The phone apps have no Discord IPC: there the commands do nothing.
#![cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]

use serde::{Deserialize, Serialize};

/// What the webview asks for; `None` clears it.
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    /// The first line (the title, or "Watching").
    pub details: String,
    /// The second line ("S1 E5 · Episode", "Paused").
    pub state: Option<String>,
    /// Unix milliseconds: when it would have started at this speed, and when it ends ("12:04 left").
    pub start: Option<i64>,
    pub end: Option<i64>,
    /// An https picture (the poster), and its hover text.
    pub image: Option<String>,
    pub image_text: Option<String>,
    /// Up to two link buttons others see on the profile (#153): only to the website's hand-over pages.
    #[serde(default)]
    pub buttons: Vec<Button>,
    /// In a party joinable from Discord (#357): Discord's own Join instead of the buttons.
    #[serde(default)]
    pub join: Option<Join>,
}

/// The party an activity offers to join through Discord.
#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct Join {
    /// A random id for this party on Discord (not the party code).
    pub party: String,
    /// The join token Discord hands to whoever joins.
    pub secret: String,
    /// Members now, and the most Discord shows room for.
    pub size: [u32; 2],
    /// "Ask me": Discord shows Ask to Join instead of Join.
    pub ask: bool,
}

/// A join token as the webview makes them (src/lib/party/discordJoin.ts): 43 base64url characters.
pub fn is_join_token(text: &str) -> bool {
    text.len() == 43 && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The join Discord takes: a party id of 1-128 letters, digits and dashes, a join token, a size it
/// can show (at least one member, room for one more).
fn join(j: &Join) -> Option<serde_json::Value> {
    let id_ok = (1..=128).contains(&j.party.len()) && j.party.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    let [now, max] = j.size;
    (id_ok && is_join_token(&j.secret) && now >= 1 && max > now).then(|| {
        serde_json::json!({
            // Privacy: 0 private (Ask to Join), 1 public (Join).
            "party": { "id": j.party, "size": [now, max], "privacy": if j.ask { 0 } else { 1 } },
            "secrets": { "join": j.secret },
        })
    })
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
pub struct Button {
    pub label: String,
    pub url: String,
}

/// Where a button may point: the website's pages that hand over to the app, nothing else.
const BUTTON_SITE: &str = "https://getpolar.app/";

/// The buttons Discord takes: two at most, a 1-32 character label, a link to [`BUTTON_SITE`] of
/// 512 characters at most.
fn buttons(all: &[Button]) -> Vec<Button> {
    all.iter()
        .filter(|b| b.url.starts_with(BUTTON_SITE) && b.url.len() <= 512 && b.url.bytes().all(|c| c.is_ascii_graphic()))
        .filter_map(|b| {
            let label: String = b.label.trim().chars().take(32).collect();
            (!label.is_empty()).then(|| Button { label, url: b.url.clone() })
        })
        .take(2)
        .collect()
}

/// Polarity's application in Discord's Developer Portal, named "Polarity", which is what profiles
/// show ("Watching Polarity"). An application id isn't a secret: Discord shows it to anyone who
/// sees the activity.
const APP_ID: &str = "1568225292877701221";

/// The build's Discord application: `POLAR_DISCORD_CLIENT_ID` when the build sets it (empty for
/// none), else [`APP_ID`].
fn client_id() -> Option<&'static str> {
    pick_client_id(option_env!("POLAR_DISCORD_CLIENT_ID"))
}

fn pick_client_id(from_build: Option<&'static str>) -> Option<&'static str> {
    Some(from_build.unwrap_or(APP_ID)).filter(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

/// Discord wants 2-128 characters on each line.
fn line(text: &str) -> Option<String> {
    let t: String = text.trim().chars().take(128).collect();
    match t.chars().count() {
        0 => None,
        1 => Some(format!("{t} ")),
        _ => Some(t),
    }
}

/// The `activity` of a `SET_ACTIVITY` (type 3: "Watching").
fn payload(a: &Activity) -> serde_json::Value {
    #[derive(Serialize)]
    struct Timestamps {
        #[serde(skip_serializing_if = "Option::is_none")]
        start: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        end: Option<i64>,
    }
    let mut out = serde_json::json!({ "type": 3, "details": line(&a.details).unwrap_or_else(|| "Watching".into()) });
    if let Some(state) = a.state.as_deref().and_then(line) {
        out["state"] = state.into();
    }
    if a.start.is_some() || a.end.is_some() {
        out["timestamps"] = serde_json::to_value(Timestamps { start: a.start, end: a.end }).unwrap();
    }
    if let Some(image) = a.image.as_deref().filter(|u| u.starts_with("https://") && u.len() <= 256) {
        let mut assets = serde_json::json!({ "large_image": image });
        if let Some(text) = a.image_text.as_deref().and_then(line) {
            assets["large_text"] = text.into();
        }
        out["assets"] = assets;
    }
    // Discord refuses an activity with both buttons and a join secret: a join leaves the buttons out.
    if let Some(serde_json::Value::Object(join)) = a.join.as_ref().and_then(join) {
        for (k, v) in join {
            out[k] = v;
        }
        return out;
    }
    let buttons = buttons(&a.buttons);
    if !buttons.is_empty() {
        out["buttons"] = serde_json::to_value(buttons).unwrap();
    }
    out
}

/// Whether Discord shows this activity with a Join: only then is a request to join accepted.
fn offers_join(a: Option<&Activity>) -> bool {
    a.and_then(|a| a.join.as_ref()).and_then(join).is_some()
}

/// One IPC frame: opcode, length, JSON (little-endian).
fn frame(op: u32, body: &serde_json::Value) -> Vec<u8> {
    let json = body.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + json.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod ipc {
    use std::io::{Read, Write};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    use super::{client_id, frame, is_join_token, offers_join, payload, Activity};
    use crate::locks::Locked;

    #[cfg(unix)]
    type Conn = std::os::unix::net::UnixStream;
    #[cfg(windows)]
    type Conn = std::fs::File;

    /// Discord allows about five updates in twenty seconds.
    const MIN_GAP: Duration = Duration::from_secs(4);
    /// After Discord wasn't there, how long before looking again.
    const RETRY: Duration = Duration::from_secs(20);
    /// While connected, how often to look for Discord's events (a join, a request to join).
    const POLL: Duration = Duration::from_millis(250);
    /// How long Discord holds a join for an app it started (Discord's own figure): Polarity keeps
    /// looking for Discord that long after it was started for one.
    const LISTEN: Duration = Duration::from_secs(180);
    /// Frames read while waiting for one answer (events can come first) before giving up on it.
    const MAX_FRAMES: usize = 32;

    /// What the thread hears from the app.
    pub(super) enum Msg {
        /// Show this activity (`None`: nothing).
        Show(Option<Box<Activity>>),
        /// Polarity was started by Discord for a join: connect, even with nothing to show.
        Listen,
    }

    /// Whether a frame waits to be read, without blocking.
    pub(super) trait Waiting {
        fn waiting(&mut self) -> std::io::Result<bool>;
    }

    #[cfg(unix)]
    impl Waiting for std::os::unix::net::UnixStream {
        fn waiting(&mut self) -> std::io::Result<bool> {
            use std::os::fd::AsRawFd;
            let mut fd = libc::pollfd { fd: self.as_raw_fd(), events: libc::POLLIN, revents: 0 };
            // SAFETY: one pollfd for this socket, looked at without waiting.
            match unsafe { libc::poll(&mut fd, 1, 0) } {
                n if n < 0 => Err(std::io::Error::last_os_error()),
                // Closed counts as waiting too: the read that follows finds it closed.
                n => Ok(n > 0),
            }
        }
    }

    #[cfg(windows)]
    impl Waiting for std::fs::File {
        fn waiting(&mut self) -> std::io::Result<bool> {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::System::Pipes::PeekNamedPipe;
            let mut available = 0u32;
            // SAFETY: the handle is this pipe's, open for the call; only the count is written.
            let ok = unsafe {
                PeekNamedPipe(
                    self.as_raw_handle() as _,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    &mut available,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(available > 0)
        }
    }

    #[cfg(unix)]
    fn open() -> Option<Conn> {
        let mut dirs: Vec<std::path::PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
            .iter()
            .filter_map(|k| std::env::var_os(k).map(Into::into))
            .collect();
        dirs.push("/tmp".into());
        // Flatpak and Snap builds of Discord put theirs one level down.
        let dirs: Vec<_> = dirs
            .iter()
            .flat_map(|d| [d.clone(), d.join("app/com.discordapp.Discord"), d.join("snap.discord")])
            .collect();
        for dir in dirs {
            for n in 0..10 {
                if let Ok(c) = Conn::connect(dir.join(format!("discord-ipc-{n}"))) {
                    let _ = c.set_read_timeout(Some(Duration::from_secs(5)));
                    let _ = c.set_write_timeout(Some(Duration::from_secs(5)));
                    return Some(c);
                }
            }
        }
        None
    }

    #[cfg(windows)]
    fn open() -> Option<Conn> {
        (0..10).find_map(|n| {
            std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\?\pipe\discord-ipc-{n}")).ok()
        })
    }

    /// Reads one frame: its opcode and body.
    fn read_frame(c: &mut impl Read) -> std::io::Result<(u32, serde_json::Value)> {
        let mut head = [0u8; 8];
        c.read_exact(&mut head)?;
        let op = u32::from_le_bytes(head[..4].try_into().unwrap());
        let len = u32::from_le_bytes(head[4..].try_into().unwrap()) as usize;
        if len > 1 << 20 {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut body = vec![0u8; len];
        c.read_exact(&mut body)?;
        Ok((op, serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null)))
    }

    /// The connection to Discord, and what came of the events it brought.
    pub(super) struct Link<C> {
        c: C,
        nonce: u64,
    }

    /// What the thread passes on: joins, and whether a request to join may be accepted.
    pub(super) struct Events<'a> {
        pub on_join: &'a mut dyn FnMut(String),
        pub offers_join: bool,
    }

    impl<C: Read + Write> Link<C> {
        /// Sends a command; its nonce, to find Discord's answer by.
        fn command(&mut self, cmd: &str, args: serde_json::Value, evt: Option<&str>) -> std::io::Result<String> {
            self.nonce += 1;
            let nonce = self.nonce.to_string();
            let mut body = serde_json::json!({ "cmd": cmd, "args": args, "nonce": nonce });
            if let Some(evt) = evt {
                body["evt"] = evt.into();
            }
            self.c.write_all(&frame(1, &body))?;
            Ok(nonce)
        }

        /// Reads one frame and acts on it if it's an event; returns its nonce, if it answers a command.
        fn hear(&mut self, ev: &mut Events) -> std::io::Result<Option<String>> {
            let (op, body) = read_frame(&mut self.c)?;
            match op {
                // CLOSE.
                2 => return Err(std::io::Error::other("closed by Discord")),
                // PING: answered with PONG.
                3 => {
                    self.c.write_all(&frame(4, &body))?;
                    return Ok(None);
                }
                _ => {}
            }
            if body["cmd"] != "DISPATCH" {
                return Ok(body["nonce"].as_str().map(String::from));
            }
            match body["evt"].as_str() {
                Some("ACTIVITY_JOIN") => {
                    if let Some(secret) = body["data"]["secret"].as_str().filter(|s| is_join_token(s)) {
                        tracing::info!("discord: join arrived");
                        (ev.on_join)(secret.to_string());
                    }
                }
                Some("ACTIVITY_JOIN_REQUEST") if ev.offers_join => {
                    let user = body["data"]["user"]["id"]
                        .as_str()
                        .filter(|id| (1..=24).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()));
                    if let Some(user) = user {
                        // Discord's own Ask to Join only opens the friend's Polarity: the host decides there.
                        self.command("SEND_ACTIVITY_JOIN_INVITE", serde_json::json!({ "user_id": user }), None)?;
                    }
                }
                _ => {}
            }
            Ok(None)
        }

        /// Reads until Discord answers `nonce`, acting on the events that come first.
        fn answer(&mut self, nonce: &str, ev: &mut Events) -> std::io::Result<()> {
            for _ in 0..MAX_FRAMES {
                if self.hear(ev)?.as_deref() == Some(nonce) {
                    return Ok(());
                }
            }
            Err(std::io::Error::other("no answer"))
        }

        fn show(&mut self, activity: Option<&Activity>, ev: &mut Events) -> std::io::Result<()> {
            let args = serde_json::json!({ "pid": std::process::id(), "activity": activity.map(payload) });
            let nonce = self.command("SET_ACTIVITY", args, None)?;
            self.answer(&nonce, ev)
        }
    }

    impl<C: Read + Write + Waiting> Link<C> {
        /// Acts on every frame waiting, without blocking for more.
        fn hear_waiting(&mut self, ev: &mut Events) -> std::io::Result<()> {
            while self.c.waiting()? {
                self.hear(ev)?;
            }
            Ok(())
        }
    }

    /// The handshake on a fresh connection, then the join events.
    pub(super) fn handshake<C: Read + Write>(mut c: C, id: &str) -> Option<Link<C>> {
        c.write_all(&frame(0, &serde_json::json!({ "v": 1, "client_id": id }))).ok()?;
        // 1 = READY; 2 = Discord closed it (a client id it doesn't know).
        if read_frame(&mut c).ok()?.0 != 1 {
            return None;
        }
        let mut link = Link { c, nonce: 0 };
        // Nothing to accept yet; a join arriving this early is passed on later, from the thread.
        let mut early: Vec<String> = Vec::new();
        {
            let mut keep = |s: String| early.push(s);
            let mut ev = Events { on_join: &mut keep, offers_join: false };
            for evt in ["ACTIVITY_JOIN", "ACTIVITY_JOIN_REQUEST"] {
                // An error answer (an event Discord doesn't offer) leaves the presence working.
                let nonce = link.command("SUBSCRIBE", serde_json::json!({}), Some(evt)).ok()?;
                link.answer(&nonce, &mut ev).ok()?;
            }
        }
        if !early.is_empty() {
            tracing::info!("discord: join arrived during the handshake");
            EARLY.locked().extend(early);
        }
        Some(link)
    }

    /// Joins heard during a handshake, for the thread to pass on.
    static EARLY: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

    /// The thread: keeps Discord showing the latest of what `rx` brings and passes on the joins
    /// Discord sends; `connect` opens and greets it.
    pub(super) fn run<C: Read + Write + Waiting>(
        rx: Receiver<Msg>,
        mut connect: impl FnMut() -> Option<Link<C>>,
        mut on_join: impl FnMut(String),
    ) {
        let mut conn: Option<Link<C>> = None;
        let mut wanted: Option<Activity> = None;
        let mut shown: Option<Option<Activity>> = None;
        let mut last_send: Option<Instant> = None;
        let mut last_try: Option<Instant> = None;
        let mut listen_until: Option<Instant> = None;
        loop {
            let listening = listen_until.is_some_and(|t| Instant::now() < t);
            // Wait for a change, or for the gap (or the retry, or the next look for events) to pass.
            let pending = shown.as_ref() != Some(&wanted);
            let wait = if conn.is_none() && (pending || listening) {
                Some(last_try.map_or(Duration::ZERO, |t| RETRY.saturating_sub(t.elapsed())))
            } else if conn.is_none() {
                None
            } else if pending {
                Some(last_send.map_or(Duration::ZERO, |t| MIN_GAP.saturating_sub(t.elapsed())).min(POLL))
            } else {
                Some(POLL)
            };
            let got = match wait {
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
                Some(d) => rx.recv_timeout(d),
            };
            let mut take = |m: Msg| match m {
                Msg::Show(a) => wanted = a.map(|a| *a),
                Msg::Listen => listen_until = Some(Instant::now() + LISTEN),
            };
            match got {
                Ok(m) => {
                    take(m);
                    // Take everything queued: only the latest activity counts.
                    while let Ok(m) = rx.try_recv() {
                        take(m);
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => return,
                Err(RecvTimeoutError::Timeout) => {}
            }
            if conn.is_none() {
                // Nothing shown, nothing to show, no join to wait for: no need to look for Discord.
                if !listening && wanted.is_none() && shown.is_none() {
                    shown = Some(None);
                    continue;
                }
                if !pending && !listening {
                    continue;
                }
                last_try = Some(Instant::now());
                conn = connect();
                if conn.is_none() {
                    // Discord isn't running: whatever it showed went with it.
                    shown = None;
                    continue;
                }
                tracing::info!("discord: connected");
                listen_until = None;
                // A fresh connection shows nothing: with nothing to show, nothing to send.
                if wanted.is_none() {
                    shown = Some(None);
                }
                for secret in std::mem::take(&mut *EARLY.locked()) {
                    on_join(secret);
                }
            }
            let link = conn.as_mut().unwrap();
            let mut ev =
                Events { on_join: &mut on_join, offers_join: offers_join(shown.as_ref().and_then(|s| s.as_ref())) };
            let mut done = link.hear_waiting(&mut ev);
            if done.is_ok() && shown.as_ref() != Some(&wanted) && last_send.is_none_or(|t| t.elapsed() >= MIN_GAP) {
                last_send = Some(Instant::now());
                done = link.show(wanted.as_ref(), &mut ev);
                if done.is_ok() {
                    shown = Some(wanted.clone());
                }
            }
            if done.is_err() {
                tracing::info!("discord: connection closed");
                conn = None;
                shown = None;
                last_try = Some(Instant::now());
            }
        }
    }

    static TX: OnceLock<Option<std::sync::Mutex<Sender<Msg>>>> = OnceLock::new();
    /// Where a join goes: set once at start (deep_link.rs takes it like a party link).
    pub(super) static ON_JOIN: OnceLock<Box<dyn Fn(String) + Send + Sync>> = OnceLock::new();

    pub fn available() -> bool {
        client_id().is_some()
    }

    fn send(msg: Msg) {
        let tx = TX.get_or_init(|| {
            let id = client_id()?;
            let (tx, rx) = mpsc::channel();
            std::thread::Builder::new()
                .name("discord".into())
                .spawn(move || {
                    let on_join = |secret: String| {
                        if let Some(f) = ON_JOIN.get() {
                            f(secret);
                        }
                    };
                    run(rx, || open().and_then(|c| handshake(c, id)), on_join)
                })
                .ok()?;
            Some(std::sync::Mutex::new(tx))
        });
        if let Some(tx) = tx {
            let _ = tx.locked().send(msg);
        }
    }

    pub fn set(activity: Option<Activity>) {
        send(Msg::Show(activity.map(Box::new)));
    }

    pub fn listen() {
        send(Msg::Listen);
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod ipc {
    pub fn available() -> bool {
        false
    }
    pub fn set(_: Option<super::Activity>) {}
    pub fn listen() {}
}

/// Whether this build can show Rich Presence (desktop, with a Discord application).
#[tauri::command]
pub fn discord_available() -> bool {
    ipc::available()
}

/// Shows `activity` on the user's Discord profile, or clears it. Never fails: without Discord, nothing happens.
#[tauri::command]
pub fn discord_presence(activity: Option<Activity>) {
    ipc::set(activity);
}

/// Polarity was started (or reached) by Discord for a join (`polarity://discord-join`): connect
/// to Discord, even with nothing to show, to take the join it holds.
pub fn listen() {
    ipc::listen();
}

/// The link Discord opens to start Polarity for a join.
pub fn launch_link() -> String {
    format!("{}://{LAUNCH_PATH}", crate::deep_link::SCHEME)
}

/// What follows the scheme in [`launch_link`].
pub const LAUNCH_PATH: &str = "discord-join";

/// At start: where joins from Discord go, and Polarity registered as the app Discord starts for
/// them (in the background: it writes a file or a registry key at most).
#[cfg(desktop)]
pub fn init(on_join: impl Fn(String) + Send + Sync + 'static) {
    let _ = ipc::ON_JOIN.set(Box::new(on_join));
    if let Some(id) = client_id() {
        let _ = std::thread::Builder::new().name("discord-register".into()).spawn(move || {
            if let Err(e) = register::register(id) {
                tracing::warn!("discord: launch command not registered: {e}");
            }
        });
    }
}

/// Polarity as the app Discord starts for a join, as Discord's own library registers a game
/// (`Discord_Register`): the `discord-<application id>` scheme per user on Windows and Linux, a
/// command file in Discord's folder on macOS. Each opens [`launch_link`]. Written only when it
/// differs from what's there.
#[cfg(desktop)]
mod register {
    /// The desktop entry Linux opens `discord-<id>://` with (quoted as the desktop entry spec has it).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub(super) fn desktop_entry(id: &str, exe: &str, link: &str) -> String {
        let quote = |a: &str| {
            let escaped: String = a
                .chars()
                .flat_map(|c| match c {
                    '"' | '`' | '$' | '\\' => vec!['\\', c],
                    '%' => vec!['%', '%'],
                    c => vec![c],
                })
                .collect();
            // Then the escapes every desktop entry string has: each backslash doubled.
            format!("\"{}\"", escaped.replace('\\', "\\\\"))
        };
        format!(
            "[Desktop Entry]\nName={}\nExec={} {}\nType=Application\nNoDisplay=true\nCategories=Discord;Games;\nMimeType=x-scheme-handler/discord-{id};\n",
            crate::dev_channel::TITLE,
            quote(exe),
            quote(link)
        )
    }

    /// The command file Discord reads on macOS: a link it opens.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(super) fn command_file(link: &str) -> String {
        serde_json::json!({ "command": link }).to_string()
    }

    #[cfg(target_os = "linux")]
    pub fn register(id: &str) -> Result<(), String> {
        let data = std::env::var_os("XDG_DATA_HOME")
            .filter(|d| !d.is_empty())
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share")))
            .ok_or("no home folder")?;
        // An AppImage runs from a mount that changes each time: the AppImage itself is what to start.
        let exe = match std::env::var_os("APPIMAGE") {
            Some(a) => std::path::PathBuf::from(a),
            None => std::env::current_exe().map_err(|e| e.to_string())?,
        };
        let name = format!("discord-{id}.desktop");
        let path = data.join("applications").join(&name);
        let entry = desktop_entry(id, &exe.to_string_lossy(), &super::launch_link());
        if std::fs::read_to_string(&path).is_ok_and(|e| e == entry) {
            return Ok(());
        }
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&path, entry).map_err(|e| e.to_string())?;
        let status = std::process::Command::new("xdg-mime")
            .args(["default", &name, &format!("x-scheme-handler/discord-{id}")])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("xdg-mime: {status}"))
        }
    }

    #[cfg(target_os = "macos")]
    pub fn register(id: &str) -> Result<(), String> {
        let home = std::env::var_os("HOME").ok_or("no home folder")?;
        let path =
            std::path::PathBuf::from(home).join("Library/Application Support/discord/games").join(format!("{id}.json"));
        let file = command_file(&super::launch_link());
        if std::fs::read_to_string(&path).is_ok_and(|f| f == file) {
            return Ok(());
        }
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&path, file).map_err(|e| e.to_string())
    }

    #[cfg(windows)]
    pub fn register(id: &str) -> Result<(), String> {
        use windows_registry::CURRENT_USER;

        let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.display().to_string();
        let exe = exe.strip_prefix(r"\\?\").unwrap_or(&exe);
        let key = format!(r"Software\Classes\discord-{id}");
        let command = format!("\"{exe}\" \"{}\"", super::launch_link());
        let command_key = format!(r"{key}\shell\open\command");
        if CURRENT_USER.open(&command_key).and_then(|k| k.get_string("")).is_ok_and(|c| c == command) {
            return Ok(());
        }
        fn e(e: impl std::fmt::Display) -> String {
            e.to_string()
        }
        let k = CURRENT_USER.create(&key).map_err(e)?;
        k.set_string("", format!("URL:Run game {id} protocol")).map_err(e)?;
        k.set_string("URL Protocol", "").map_err(e)?;
        CURRENT_USER
            .create(format!(r"{key}\DefaultIcon"))
            .and_then(|k| k.set_string("", format!("{exe},0")))
            .map_err(e)?;
        CURRENT_USER.create(&command_key).and_then(|k| k.set_string("", &command)).map_err(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_build_uses_polaritys_application_unless_it_names_another_or_none() {
        assert_eq!(pick_client_id(None), Some(APP_ID));
        assert_eq!(pick_client_id(Some("123456789012345678")), Some("123456789012345678"));
        assert_eq!(pick_client_id(Some("")), None);
        assert_eq!(pick_client_id(Some("not-an-id")), None);
    }

    fn activity() -> Activity {
        Activity {
            details: "The Lantern Keepers".into(),
            state: Some("S1 E5 · The Long Night".into()),
            start: Some(1_000),
            end: Some(2_000),
            image: Some("https://media.example.com/poster.jpg".into()),
            image_text: Some("The Lantern Keepers".into()),
            buttons: vec![],
            join: None,
        }
    }

    const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn joinable(ask: bool) -> Activity {
        Activity {
            buttons: vec![Button {
                label: "Watch in Polarity".into(),
                url: "https://getpolar.app/watch?type=movie&id=tt0000000".into(),
            }],
            join: Some(Join {
                party: "0f8e2c4a-1b2c-4d5e-8f90-123456789abc".into(),
                secret: TOKEN.into(),
                size: [2, 10],
                ask,
            }),
            ..activity()
        }
    }

    #[test]
    fn payload_is_a_watching_activity() {
        assert_eq!(
            payload(&activity()),
            serde_json::json!({
                "type": 3,
                "details": "The Lantern Keepers",
                "state": "S1 E5 · The Long Night",
                "timestamps": { "start": 1000, "end": 2000 },
                "assets": { "large_image": "https://media.example.com/poster.jpg", "large_text": "The Lantern Keepers" },
            })
        );
    }

    #[test]
    fn payload_keeps_to_discords_limits() {
        let a = Activity {
            details: "x".into(),
            state: Some("  ".into()),
            start: None,
            end: None,
            image: Some("http://media.example.com/poster.jpg".into()),
            image_text: None,
            buttons: vec![],
            join: None,
        };
        assert_eq!(payload(&a), serde_json::json!({ "type": 3, "details": "x " }));
        let long = Activity { details: "y".repeat(300), ..a };
        assert_eq!(payload(&long)["details"].as_str().unwrap().chars().count(), 128);
    }

    #[test]
    fn buttons_only_link_to_the_website_and_keep_to_discords_limits() {
        let b = |label: &str, url: &str| Button { label: label.into(), url: url.into() };
        let a = Activity {
            buttons: vec![
                b("Watch in Polarity", "https://getpolar.app/watch?type=movie&id=tt0000000"),
                b("Elsewhere", "https://media.example.com/film.mkv"),
                b("Look-alike", "https://getpolar.app.example.com/party"),
                b("   ", "https://getpolar.app/party?t=xxx"),
                b(&"J".repeat(40), "https://getpolar.app/party?t=xxx"),
                b("Third", "https://getpolar.app/party?t=yyy"),
            ],
            ..activity()
        };
        assert_eq!(
            payload(&a)["buttons"],
            serde_json::json!([
                { "label": "Watch in Polarity", "url": "https://getpolar.app/watch?type=movie&id=tt0000000" },
                { "label": "J".repeat(32), "url": "https://getpolar.app/party?t=xxx" },
            ])
        );
        assert!(payload(&activity()).get("buttons").is_none());
        let none_left = Activity { buttons: vec![b("Elsewhere", "http://getpolar.app/watch")], ..activity() };
        assert!(payload(&none_left).get("buttons").is_none());
    }

    #[test]
    fn a_joinable_party_carries_the_party_and_secret_instead_of_buttons() {
        let p = payload(&joinable(false));
        assert_eq!(
            p["party"],
            serde_json::json!({ "id": "0f8e2c4a-1b2c-4d5e-8f90-123456789abc", "size": [2, 10], "privacy": 1 })
        );
        assert_eq!(p["secrets"], serde_json::json!({ "join": TOKEN }));
        assert!(p.get("buttons").is_none(), "Discord refuses buttons next to a join secret");
        // "Ask me": Ask to Join.
        assert_eq!(payload(&joinable(true))["party"]["privacy"], 0);
        assert!(offers_join(Some(&joinable(true))));
        assert!(!offers_join(Some(&activity())));
        assert!(!offers_join(None));
    }

    #[test]
    fn a_join_discord_wouldnt_take_falls_back_to_the_buttons() {
        let with = |f: &dyn Fn(&mut Join)| {
            let mut a = joinable(false);
            f(a.join.as_mut().unwrap());
            a
        };
        for bad in [
            with(&|j| j.secret = "123456".into()),
            with(&|j| j.secret = format!("{}=", &TOKEN[..42])),
            with(&|j| j.party = String::new()),
            with(&|j| j.party = "a b".into()),
            with(&|j| j.party = "p".repeat(129)),
            with(&|j| j.size = [0, 10]),
            with(&|j| j.size = [10, 10]),
        ] {
            let p = payload(&bad);
            assert!(p.get("secrets").is_none() && p.get("party").is_none(), "{bad:?}");
            assert_eq!(p["buttons"][0]["label"], "Watch in Polarity");
            assert!(!offers_join(Some(&bad)));
        }
    }

    #[test]
    fn join_tokens_are_43_base64url_characters() {
        assert!(is_join_token(TOKEN));
        assert!(is_join_token("abcdefghijklmnopqrstuvwxyz-_ABCDEFGHIJ01234"));
        assert!(!is_join_token(&TOKEN[..42]));
        assert!(!is_join_token(&format!("{TOKEN}A")));
        assert!(!is_join_token("abcdefghijklmnopqrstuvwxyz+/ABCDEFGHIJ01234"));
    }

    #[test]
    fn the_launch_command_opens_polaritys_discord_link() {
        assert_eq!(launch_link(), format!("{}://discord-join", crate::deep_link::SCHEME));
        let entry = register::desktop_entry("123", "/opt/My \"Apps\"/50%/polarity", "polarity://discord-join");
        assert!(entry.contains("\nMimeType=x-scheme-handler/discord-123;\n"), "{entry}");
        assert!(entry.contains("\nNoDisplay=true\n"));
        assert!(entry.contains(r#"Exec="/opt/My \\"Apps\\"/50%%/polarity" "polarity://discord-join""#), "{entry}");
        assert_eq!(register::command_file("polarity://discord-join"), r#"{"command":"polarity://discord-join"}"#);
    }

    #[test]
    fn frames_are_opcode_length_json() {
        let f = frame(1, &serde_json::json!({ "a": 1 }));
        assert_eq!(&f[..4], &1u32.to_le_bytes());
        assert_eq!(&f[4..8], &7u32.to_le_bytes());
        assert_eq!(&f[8..], br#"{"a":1}"#);
    }

    /// A stand-in for Discord on the other end of a socket pair.
    #[cfg(all(unix, not(any(target_os = "android", target_os = "ios"))))]
    mod stand_in {
        use super::*;
        use std::io::{Read, Write};
        use std::os::unix::net::UnixStream;
        use std::sync::mpsc::{Receiver, Sender};

        pub struct Discord(pub UnixStream);

        impl Discord {
            pub fn read(&mut self) -> (u32, serde_json::Value) {
                let mut h = [0u8; 8];
                self.0.read_exact(&mut h).unwrap();
                let mut b = vec![0; u32::from_le_bytes(h[4..].try_into().unwrap()) as usize];
                self.0.read_exact(&mut b).unwrap();
                (u32::from_le_bytes(h[..4].try_into().unwrap()), serde_json::from_slice(&b).unwrap())
            }
            pub fn write(&mut self, op: u32, body: serde_json::Value) {
                self.0.write_all(&frame(op, &body)).unwrap();
            }
            /// Answers a command the way Discord does: the same nonce back.
            pub fn answer(&mut self, msg: &serde_json::Value) {
                self.write(1, serde_json::json!({ "cmd": msg["cmd"], "nonce": msg["nonce"], "data": {} }));
            }
            /// The handshake and the two subscriptions.
            pub fn greet(&mut self) {
                let (op, hello) = self.read();
                assert_eq!((op, hello["client_id"].as_str()), (0, Some("123")));
                self.write(1, serde_json::json!({ "cmd": "DISPATCH", "evt": "READY" }));
                for evt in ["ACTIVITY_JOIN", "ACTIVITY_JOIN_REQUEST"] {
                    let (op, msg) = self.read();
                    assert_eq!((op, msg["cmd"].as_str(), msg["evt"].as_str()), (1, Some("SUBSCRIBE"), Some(evt)));
                    self.answer(&msg);
                }
            }
            pub fn dispatch(&mut self, evt: &str, data: serde_json::Value) {
                self.write(1, serde_json::json!({ "cmd": "DISPATCH", "evt": evt, "data": data, "nonce": null }));
            }
        }

        /// Runs the thread against a stand-in; joins it passes on come out of the receiver.
        pub fn start() -> (Sender<ipc::Msg>, Discord, Receiver<String>) {
            let (ours, discord) = UnixStream::pair().unwrap();
            ours.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut ours = Some(ours);
            let (tx, rx) = std::sync::mpsc::channel();
            let (joins_tx, joins) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                ipc::run(rx, || ours.take().and_then(|c| ipc::handshake(c, "123")), move |s| joins_tx.send(s).unwrap())
            });
            (tx, Discord(discord), joins)
        }
    }

    #[cfg(all(unix, not(any(target_os = "android", target_os = "ios"))))]
    #[test]
    fn sends_the_latest_activity_and_keeps_to_the_rate() {
        let (tx, mut discord, _) = stand_in::start();
        tx.send(ipc::Msg::Show(Some(Box::new(Activity { state: Some("Paused".into()), ..activity() })))).unwrap();
        tx.send(ipc::Msg::Show(Some(Box::new(activity())))).unwrap();
        discord.greet();
        let (op, msg) = discord.read();
        assert_eq!((op, msg["cmd"].as_str()), (1, Some("SET_ACTIVITY")));
        // Only the latest of the two.
        assert_eq!(msg["args"]["activity"]["state"], "S1 E5 · The Long Night");
        discord.answer(&msg);

        let asked = std::time::Instant::now();
        tx.send(ipc::Msg::Show(None)).unwrap();
        let (_, msg) = discord.read();
        assert!(msg["args"]["activity"].is_null());
        assert!(asked.elapsed() >= std::time::Duration::from_secs(3), "Discord's rate limit kept");
    }

    #[cfg(all(unix, not(any(target_os = "android", target_os = "ios"))))]
    #[test]
    fn a_join_from_discord_is_passed_on_also_with_nothing_shown() {
        let (tx, mut discord, joins) = stand_in::start();
        // Started by Discord for a join: it connects without an activity.
        tx.send(ipc::Msg::Listen).unwrap();
        discord.greet();
        discord.dispatch("ACTIVITY_JOIN", serde_json::json!({ "secret": "not a token" }));
        discord.dispatch("ACTIVITY_JOIN", serde_json::json!({ "secret": TOKEN }));
        assert_eq!(joins.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), TOKEN);
        assert!(
            joins.recv_timeout(std::time::Duration::from_millis(600)).is_err(),
            "the one that isn't a token is dropped"
        );
        // Discord's PING is answered.
        discord.write(3, serde_json::json!({ "x": 1 }));
        assert_eq!(discord.read(), (4, serde_json::json!({ "x": 1 })));
    }

    #[cfg(all(unix, not(any(target_os = "android", target_os = "ios"))))]
    #[test]
    fn a_request_to_join_is_accepted_only_while_the_activity_offers_a_join() {
        let (tx, mut discord, _) = stand_in::start();
        tx.send(ipc::Msg::Show(Some(Box::new(activity())))).unwrap();
        discord.greet();
        let (_, msg) = discord.read();
        discord.answer(&msg);
        // No join offered: nothing is sent back.
        discord.dispatch(
            "ACTIVITY_JOIN_REQUEST",
            serde_json::json!({ "user": { "id": "1000000000000001", "username": "x" } }),
        );
        discord.0.set_read_timeout(Some(std::time::Duration::from_millis(800))).unwrap();
        let mut h = [0u8; 1];
        assert!(std::io::Read::read(&mut discord.0, &mut h).is_err(), "nothing answered");
        discord.0.set_read_timeout(None).unwrap();

        tx.send(ipc::Msg::Show(Some(Box::new(joinable(true))))).unwrap();
        let (_, msg) = discord.read();
        assert_eq!(msg["args"]["activity"]["secrets"]["join"], TOKEN);
        // An event before the answer is taken on the way.
        discord.dispatch("ACTIVITY_JOIN_REQUEST", serde_json::json!({ "user": { "id": "not-an-id" } }));
        discord.answer(&msg);
        discord.dispatch("ACTIVITY_JOIN_REQUEST", serde_json::json!({ "user": { "id": "1000000000000002" } }));
        let (op, msg) = discord.read();
        assert_eq!((op, msg["cmd"].as_str()), (1, Some("SEND_ACTIVITY_JOIN_INVITE")));
        assert_eq!(msg["args"], serde_json::json!({ "user_id": "1000000000000002" }));
    }

    #[test]
    fn webview_shape_parses() {
        let a: Activity =
            serde_json::from_value(serde_json::json!({ "details": "Watching", "state": null, "imageText": "x" }))
                .unwrap();
        assert_eq!(a.image_text.as_deref(), Some("x"));
        assert!(a.start.is_none());
    }
}
