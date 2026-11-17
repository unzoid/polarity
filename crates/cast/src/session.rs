//! One cast: a TLS connection to the TV, Google's Default Media Receiver launched on it, a link loaded,
//! and the controls and status that go back and forth until it's stopped.
//!
//! The TV's certificate is its own, self-signed: there's no one to check it against, so any is taken.
//! Its handshake signature isn't checked either: against a certificate nobody vouches for that proves
//! nothing, and many TVs send an X.509 v1 certificate the usual parser refuses. What's sent is only the link to play and its
//! title; the TV fetches the link itself.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, WriteHalf};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use tokio_rustls::rustls::crypto::{ring, CryptoProvider};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use tokio_rustls::TlsConnector;

use crate::frame::{CastMessage, MAX_FRAME};
use crate::messages::{self as m, App, Incoming, Load, MediaState};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// How often we ping; the TV drops a sender it hasn't heard from in about 10 s.
const HEARTBEAT: Duration = Duration::from_secs(5);
/// Nothing from the TV for this long: it's gone.
const SILENCE: Duration = Duration::from_secs(20);
/// How often the position is asked for while playing (the TV only says when the state changes).
const POLL: Duration = Duration::from_secs(1);
/// The receiver app has this long to start and take the link.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(25);

/// What the TV is doing.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayState {
    /// The receiver app is starting or the link is loading.
    Loading,
    Playing,
    Paused,
    Buffering,
    Idle,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: PlayState,
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: Option<f64>,
    pub muted: Option<bool>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Status(Status),
    /// It didn't start, or stopped with an error: why, in words for the viewer.
    Failed(String),
    /// It's over: the video finished ("finished"), or the TV or someone else stopped it ("stopped").
    Ended(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Command {
    Play,
    Pause,
    Seek(f64),
    /// 0–1.
    Volume(f64),
    Mute(bool),
    /// Stop and close the app on the TV.
    Stop,
}

/// A running cast. Dropping it stops the cast.
pub struct Session {
    commands: mpsc::UnboundedSender<Command>,
}

impl Session {
    /// Connect to the TV at `addr` and play `load` there; what happens comes on `events`.
    pub async fn start(addr: SocketAddr, load: Load, events: mpsc::UnboundedSender<Event>) -> Result<Session, String> {
        Ok(Self::over(connect(addr).await?, load, events))
    }

    /// The same over any connection (a test's in-memory pipe).
    fn over<S: AsyncRead + AsyncWrite + Send + 'static>(
        stream: S,
        load: Load,
        events: mpsc::UnboundedSender<Event>,
    ) -> Session {
        let (commands, rx) = mpsc::unbounded_channel();
        tokio::spawn(run(stream, load, rx, events));
        Session { commands }
    }

    /// False once the cast has ended.
    pub fn send(&self, c: Command) -> bool {
        self.commands.send(c).is_ok()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Stop);
    }
}

/// Takes the TV's own certificate as it is (see the module docs).
#[derive(Debug)]
struct TvCertificate(Arc<CryptoProvider>);

impl ServerCertVerifier for TvCertificate {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, tokio_rustls::rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

async fn connect(addr: SocketAddr) -> Result<TlsStream<TcpStream>, String> {
    let provider = Arc::new(ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(TvCertificate(provider)))
        .with_no_client_auth();
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .map_err(|_| "the TV didn't answer".to_string())?
        .map_err(|e| format!("couldn't reach the TV: {e}"))?;
    let _ = tcp.set_nodelay(true);
    TlsConnector::from(Arc::new(config))
        .connect(ServerName::IpAddress(addr.ip().into()), tcp)
        .await
        .map_err(|e| format!("couldn't connect to the TV: {e}"))
}

async fn read_frames<R: AsyncRead + Unpin>(mut r: R, to: mpsc::UnboundedSender<CastMessage>) {
    let mut len = [0u8; 4];
    loop {
        if r.read_exact(&mut len).await.is_err() {
            return;
        }
        let n = u32::from_be_bytes(len) as usize;
        if n > MAX_FRAME {
            return;
        }
        let mut body = vec![0u8; n];
        if r.read_exact(&mut body).await.is_err() {
            return;
        }
        match CastMessage::decode(&body) {
            Ok(msg) => {
                if to.send(msg).is_err() {
                    return;
                }
            }
            Err(e) => tracing::debug!("cast: unreadable frame: {e}"),
        }
    }
}

struct Writer<S> {
    w: WriteHalf<S>,
    request: u64,
}

impl<S: AsyncWrite> Writer<S> {
    fn next(&mut self) -> u64 {
        self.request += 1;
        self.request
    }
    async fn send(&mut self, to: &str, namespace: &str, payload: Value) -> Result<(), String> {
        let msg = CastMessage {
            source: m::SENDER_ID.into(),
            destination: to.into(),
            namespace: namespace.into(),
            payload: payload.to_string(),
        };
        self.w.write_all(&msg.encode()).await.map_err(|e| e.to_string())
    }
}

fn play_state(media: &MediaState) -> PlayState {
    match media.player.as_str() {
        "PLAYING" => PlayState::Playing,
        "PAUSED" => PlayState::Paused,
        "BUFFERING" => PlayState::Buffering,
        _ => PlayState::Idle,
    }
}

async fn run<S: AsyncRead + AsyncWrite + Send + 'static>(
    stream: S,
    load: Load,
    mut commands: mpsc::UnboundedReceiver<Command>,
    events: mpsc::UnboundedSender<Event>,
) {
    let (r, w) = tokio::io::split(stream);
    let (frames_tx, mut frames) = mpsc::unbounded_channel();
    let reader = tokio::spawn(read_frames(r, frames_tx));
    let mut out = Writer { w, request: 0 };
    let ended = drive(&mut out, &load, &mut commands, &mut frames, &events).await;
    if let Some(e) = ended {
        let _ = events.send(e);
    }
    reader.abort();
}

/// The cast from start to end; what ended it, if the viewer didn't.
async fn drive<S: AsyncWrite>(
    out: &mut Writer<S>,
    load: &Load,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    frames: &mut mpsc::UnboundedReceiver<CastMessage>,
    events: &mpsc::UnboundedSender<Event>,
) -> Option<Event> {
    let failed = |why: String| Some(Event::Failed(why));
    let setup = async {
        out.send(m::RECEIVER_ID, m::NS_CONNECTION, m::connect()).await?;
        let r = out.next();
        out.send(m::RECEIVER_ID, m::NS_RECEIVER, m::launch(r)).await
    };
    if let Err(e) = setup.await {
        return failed(format!("lost the TV: {e}"));
    }
    let mut status =
        Status { state: PlayState::Loading, position: load.start, duration: None, volume: None, muted: None };
    let _ = events.send(Event::Status(status.clone()));
    let mut app: Option<App> = None;
    let mut media: Option<i64> = None;
    let mut heartbeat = tokio::time::interval(HEARTBEAT);
    let mut poll = tokio::time::interval(POLL);
    let launch_deadline = tokio::time::sleep(LAUNCH_TIMEOUT);
    tokio::pin!(launch_deadline);
    let mut heard = tokio::time::Instant::now();

    loop {
        tokio::select! {
            msg = frames.recv() => {
                let Some(msg) = msg else { return failed("lost the TV".into()) };
                heard = tokio::time::Instant::now();
                match m::parse(&msg.namespace, &msg.payload) {
                    Incoming::Ping => {
                        let _ = out.send(&msg.source, m::NS_HEARTBEAT, m::pong()).await;
                    }
                    Incoming::Receiver { app: running, volume, muted } => {
                        status.volume = volume.or(status.volume);
                        status.muted = muted.or(status.muted);
                        match (&app, running) {
                            // Our app has started: talk to it and hand it the link.
                            (None, Some(a)) => {
                                let r = out.next();
                                let sent = async {
                                    out.send(&a.transport, m::NS_CONNECTION, m::connect()).await?;
                                    out.send(&a.transport, m::NS_MEDIA, m::load(r, load)).await
                                };
                                if let Err(e) = sent.await {
                                    return failed(format!("lost the TV: {e}"));
                                }
                                app = Some(a);
                            }
                            // Something else took over the TV.
                            (Some(_), None) => return Some(Event::Ended("stopped")),
                            _ => {}
                        }
                        let _ = events.send(Event::Status(status.clone()));
                    }
                    Incoming::Media(Some(ms)) => {
                        media = Some(ms.session);
                        status.state = play_state(&ms);
                        status.position = ms.position;
                        status.duration = ms.duration.or(status.duration);
                        let _ = events.send(Event::Status(status.clone()));
                        if status.state == PlayState::Idle {
                            match ms.idle_reason.as_deref() {
                                Some("FINISHED") => return Some(Event::Ended("finished")),
                                Some("ERROR") => return failed("The TV couldn't play this file.".into()),
                                Some(_) => return Some(Event::Ended("stopped")),
                                None => {}
                            }
                        }
                    }
                    Incoming::Media(None) => {}
                    Incoming::LoadFailed => return failed("The TV couldn't play this file.".into()),
                    Incoming::Refused(why) if media.is_none() => return failed(format!("The TV said no: {why}")),
                    Incoming::Refused(why) => tracing::debug!("cast: refused: {why}"),
                    Incoming::Closed if app.as_ref().is_some_and(|a| a.transport == msg.source) || msg.source == m::RECEIVER_ID => {
                        return Some(Event::Ended("stopped"));
                    }
                    Incoming::Closed | Incoming::Other => {}
                }
            }
            command = commands.recv() => {
                let command = command.unwrap_or(Command::Stop);
                let r = out.next();
                let sent = match (command, &app, media) {
                    (Command::Stop, _, _) => {
                        if let Some(a) = &app {
                            let _ = out.send(m::RECEIVER_ID, m::NS_RECEIVER, m::stop_app(r, &a.session)).await;
                        }
                        let _ = out.send(m::RECEIVER_ID, m::NS_CONNECTION, m::close()).await;
                        return None;
                    }
                    (Command::Volume(level), _, _) => out.send(m::RECEIVER_ID, m::NS_RECEIVER, m::set_volume(r, level)).await,
                    (Command::Mute(on), _, _) => out.send(m::RECEIVER_ID, m::NS_RECEIVER, m::set_muted(r, on)).await,
                    (Command::Play, Some(a), Some(s)) => out.send(&a.transport, m::NS_MEDIA, m::media(r, "PLAY", s)).await,
                    (Command::Pause, Some(a), Some(s)) => out.send(&a.transport, m::NS_MEDIA, m::media(r, "PAUSE", s)).await,
                    (Command::Seek(at), Some(a), Some(s)) => out.send(&a.transport, m::NS_MEDIA, m::seek(r, s, at)).await,
                    // Not loaded yet: nothing to play, pause or seek.
                    _ => Ok(()),
                };
                if let Err(e) = sent {
                    return failed(format!("lost the TV: {e}"));
                }
            }
            _ = heartbeat.tick() => {
                if heard.elapsed() > SILENCE {
                    return failed("lost the TV".into());
                }
                if out.send(m::RECEIVER_ID, m::NS_HEARTBEAT, m::ping()).await.is_err() {
                    return failed("lost the TV".into());
                }
            }
            _ = poll.tick(), if status.state == PlayState::Playing => {
                if let Some(a) = &app {
                    let r = out.next();
                    let transport = a.transport.clone();
                    let _ = out.send(&transport, m::NS_MEDIA, m::media_status(r)).await;
                }
            }
            _ = &mut launch_deadline, if media.is_none() => {
                return failed("The TV didn't start playing.".into());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::DuplexStream;

    /// A TV that does what a Chromecast does with the Default Media Receiver, over an in-memory pipe.
    struct FakeTv {
        r: tokio::io::ReadHalf<DuplexStream>,
        w: WriteHalf<DuplexStream>,
    }

    impl FakeTv {
        async fn next(&mut self) -> CastMessage {
            let mut len = [0u8; 4];
            self.r.read_exact(&mut len).await.unwrap();
            let mut body = vec![0u8; u32::from_be_bytes(len) as usize];
            self.r.read_exact(&mut body).await.unwrap();
            CastMessage::decode(&body).unwrap()
        }
        /// The next message that isn't a heartbeat or a status poll: both come on timers (a poll at once when
        /// playing starts), so a slow machine can see one land before the message a test waits for.
        async fn expect(&mut self, kind: &str) -> (CastMessage, Value) {
            loop {
                let msg = self.next().await;
                let v: Value = serde_json::from_str(&msg.payload).unwrap();
                if v["type"] == "PING" || v["type"] == "GET_STATUS" {
                    continue;
                }
                assert_eq!(v["type"], kind, "{v}");
                return (msg, v);
            }
        }
        async fn say(&mut self, from: &str, namespace: &str, payload: Value) {
            let msg = CastMessage {
                source: from.into(),
                destination: m::SENDER_ID.into(),
                namespace: namespace.into(),
                payload: payload.to_string(),
            };
            self.w.write_all(&msg.encode()).await.unwrap();
        }
        async fn media(&mut self, state: &str, at: f64, idle: Option<&str>) {
            let mut s =
                json!({ "mediaSessionId": 7, "playerState": state, "currentTime": at, "media": { "duration": 600.0 } });
            if let Some(reason) = idle {
                s["idleReason"] = json!(reason);
            }
            self.say("T", m::NS_MEDIA, json!({ "type": "MEDIA_STATUS", "status": [s] })).await;
        }
    }

    fn cast() -> (Session, FakeTv, mpsc::UnboundedReceiver<Event>) {
        let (ours, theirs) = tokio::io::duplex(1 << 16);
        let (tx, rx) = mpsc::unbounded_channel();
        let load = Load {
            url: "https://media.example.com/film.mp4".into(),
            title: "A Film".into(),
            subtitle: String::new(),
            image: None,
            start: 30.0,
        };
        let session = Session::over(ours, load, tx);
        let (r, w) = tokio::io::split(theirs);
        (session, FakeTv { r, w }, rx)
    }

    /// The next event, which must be a status.
    async fn status(events: &mut mpsc::UnboundedReceiver<Event>) -> Status {
        match events.recv().await.unwrap() {
            Event::Status(s) => s,
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn launches_loads_controls_and_stops() {
        let (session, mut tv, mut events) = cast();
        let (to, _) = tv.expect("CONNECT").await;
        assert_eq!(to.destination, m::RECEIVER_ID);
        let (_, launch) = tv.expect("LAUNCH").await;
        assert_eq!(launch["appId"], m::DEFAULT_RECEIVER);
        assert_eq!(status(&mut events).await.state, PlayState::Loading);
        // The receiver app is up: we connect to it and load the link where the app had it.
        let app = json!({ "type": "RECEIVER_STATUS", "status": { "applications": [{ "appId": m::DEFAULT_RECEIVER, "sessionId": "S", "transportId": "T" }], "volume": { "level": 0.5, "muted": false } } });
        tv.say(m::RECEIVER_ID, m::NS_RECEIVER, app).await;
        let (to, _) = tv.expect("CONNECT").await;
        assert_eq!(to.destination, "T");
        let (_, load) = tv.expect("LOAD").await;
        assert_eq!(
            (load["media"]["contentId"].as_str(), load["currentTime"].as_f64()),
            (Some("https://media.example.com/film.mp4"), Some(30.0))
        );
        assert_eq!(status(&mut events).await.volume, Some(0.5));
        tv.media("PLAYING", 30.5, None).await;
        let playing = status(&mut events).await;
        assert_eq!((playing.state, playing.position, playing.duration), (PlayState::Playing, 30.5, Some(600.0)));
        // The player's controls reach the media session.
        assert!(session.send(Command::Pause));
        let (_, pause) = tv.expect("PAUSE").await;
        assert_eq!(pause["mediaSessionId"], 7);
        assert!(session.send(Command::Seek(90.0)));
        let (_, seek) = tv.expect("SEEK").await;
        assert_eq!(seek["currentTime"], 90.0);
        // The TV answers a ping.
        tv.say(m::RECEIVER_ID, m::NS_HEARTBEAT, json!({ "type": "PING" })).await;
        tv.expect("PONG").await;
        // Dropping the session closes the app on the TV.
        drop(session);
        let (_, stop) = tv.expect("STOP").await;
        assert_eq!(stop["sessionId"], "S");
    }

    #[tokio::test]
    async fn a_file_the_tv_cant_play_is_said_and_the_end_is_heard() {
        let (_session, mut tv, mut events) = cast();
        tv.expect("CONNECT").await;
        tv.expect("LAUNCH").await;
        let app = json!({ "type": "RECEIVER_STATUS", "status": { "applications": [{ "appId": m::DEFAULT_RECEIVER, "sessionId": "S", "transportId": "T" }] } });
        tv.say(m::RECEIVER_ID, m::NS_RECEIVER, app).await;
        tv.expect("CONNECT").await;
        tv.expect("LOAD").await;
        tv.say("T", m::NS_MEDIA, json!({ "type": "LOAD_FAILED", "requestId": 2 })).await;
        loop {
            match events.recv().await.unwrap() {
                Event::Failed(why) => break assert!(why.contains("couldn't play"), "{why}"),
                Event::Status(_) => continue,
                other => panic!("{other:?}"),
            }
        }

        let (_s, mut tv, mut events) = cast();
        tv.expect("CONNECT").await;
        tv.expect("LAUNCH").await;
        let app = json!({ "type": "RECEIVER_STATUS", "status": { "applications": [{ "appId": m::DEFAULT_RECEIVER, "sessionId": "S", "transportId": "T" }] } });
        tv.say(m::RECEIVER_ID, m::NS_RECEIVER, app).await;
        tv.expect("CONNECT").await;
        tv.expect("LOAD").await;
        tv.media("IDLE", 600.0, Some("FINISHED")).await;
        loop {
            match events.recv().await.unwrap() {
                Event::Ended(reason) => break assert_eq!(reason, "finished"),
                Event::Status(_) => continue,
                other => panic!("{other:?}"),
            }
        }
    }
}
