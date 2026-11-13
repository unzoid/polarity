//! The JSON Cast's channels carry: what we send, and what we read of the receiver's answers.

use serde_json::{json, Value};

pub const NS_CONNECTION: &str = "urn:x-cast:com.google.cast.tp.connection";
pub const NS_HEARTBEAT: &str = "urn:x-cast:com.google.cast.tp.heartbeat";
pub const NS_RECEIVER: &str = "urn:x-cast:com.google.cast.receiver";
pub const NS_MEDIA: &str = "urn:x-cast:com.google.cast.media";

/// Google's Default Media Receiver: on every Chromecast, nothing to install or register.
pub const DEFAULT_RECEIVER: &str = "CC1AD845";
/// The device itself, before an app runs.
pub const RECEIVER_ID: &str = "receiver-0";
/// Us.
pub const SENDER_ID: &str = "sender-polarity";

/// What to play.
#[derive(Debug, Clone, PartialEq)]
pub struct Load {
    pub url: String,
    pub title: String,
    /// The show, for an episode.
    pub subtitle: String,
    /// A poster or still the TV shows while it loads and when paused.
    pub image: Option<String>,
    /// Seconds in.
    pub start: f64,
}

pub fn connect() -> Value {
    json!({ "type": "CONNECT" })
}

pub fn close() -> Value {
    json!({ "type": "CLOSE" })
}

pub fn ping() -> Value {
    json!({ "type": "PING" })
}

pub fn pong() -> Value {
    json!({ "type": "PONG" })
}

pub fn launch(request: u64) -> Value {
    json!({ "type": "LAUNCH", "appId": DEFAULT_RECEIVER, "requestId": request })
}

pub fn receiver_status(request: u64) -> Value {
    json!({ "type": "GET_STATUS", "requestId": request })
}

/// 0–1.
pub fn set_volume(request: u64, level: f64) -> Value {
    json!({ "type": "SET_VOLUME", "volume": { "level": level.clamp(0.0, 1.0) }, "requestId": request })
}

pub fn set_muted(request: u64, muted: bool) -> Value {
    json!({ "type": "SET_VOLUME", "volume": { "muted": muted }, "requestId": request })
}

/// Close the app on the TV (it goes back to its own screen).
pub fn stop_app(request: u64, session: &str) -> Value {
    json!({ "type": "STOP", "sessionId": session, "requestId": request })
}

/// What a link most likely is, by its file extension; the receiver plays MP4 when it can't tell.
pub fn content_type(url: &str) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    let ext = path.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    match ext {
        "m3u8" => "application/x-mpegURL",
        "mpd" => "application/dash+xml",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "ts" => "video/mp2t",
        _ => "video/mp4",
    }
}

pub fn load(request: u64, l: &Load) -> Value {
    let images: Vec<Value> = l.image.iter().map(|url| json!({ "url": url })).collect();
    json!({
        "type": "LOAD",
        "requestId": request,
        "autoplay": true,
        "currentTime": l.start.max(0.0),
        "media": {
            "contentId": l.url,
            "contentUrl": l.url,
            "streamType": "BUFFERED",
            "contentType": content_type(&l.url),
            // GenericMediaMetadata.
            "metadata": { "metadataType": 0, "title": l.title, "subtitle": l.subtitle, "images": images },
        },
    })
}

/// PLAY, PAUSE or STOP for the loaded media.
pub fn media(request: u64, kind: &str, session: i64) -> Value {
    json!({ "type": kind, "mediaSessionId": session, "requestId": request })
}

pub fn seek(request: u64, session: i64, at: f64) -> Value {
    json!({ "type": "SEEK", "mediaSessionId": session, "currentTime": at.max(0.0), "requestId": request })
}

pub fn media_status(request: u64) -> Value {
    json!({ "type": "GET_STATUS", "requestId": request })
}

/// The Default Media Receiver running on the TV: where to send media messages.
#[derive(Debug, Clone, PartialEq)]
pub struct App {
    pub session: String,
    pub transport: String,
}

/// What plays on the TV.
#[derive(Debug, Clone, PartialEq)]
pub struct MediaState {
    pub session: i64,
    /// PLAYING, PAUSED, BUFFERING or IDLE.
    pub player: String,
    pub position: f64,
    pub duration: Option<f64>,
    /// With IDLE: FINISHED, CANCELLED, INTERRUPTED or ERROR.
    pub idle_reason: Option<String>,
}

/// One message from the TV, as far as we use it.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Ping,
    /// The device's status: our app if it runs, and its volume.
    Receiver { app: Option<App>, volume: Option<f64>, muted: Option<bool> },
    /// The media's status; None when nothing is loaded.
    Media(Option<MediaState>),
    /// The file wouldn't play.
    LoadFailed,
    /// Asked for something it couldn't do, with why.
    Refused(String),
    /// The other end closed this channel (the app was stopped on the TV, say).
    Closed,
    Other,
}

pub fn parse(namespace: &str, payload: &str) -> Incoming {
    let Ok(v) = serde_json::from_str::<Value>(payload) else { return Incoming::Other };
    let kind = v["type"].as_str().unwrap_or("");
    match (namespace, kind) {
        (NS_HEARTBEAT, "PING") => Incoming::Ping,
        (NS_CONNECTION, "CLOSE") => Incoming::Closed,
        (NS_RECEIVER, "RECEIVER_STATUS") => {
            let status = &v["status"];
            let app = status["applications"].as_array().and_then(|apps| {
                apps.iter().find(|a| a["appId"] == DEFAULT_RECEIVER).and_then(|a| {
                    Some(App { session: a["sessionId"].as_str()?.to_owned(), transport: a["transportId"].as_str()?.to_owned() })
                })
            });
            Incoming::Receiver { app, volume: status["volume"]["level"].as_f64(), muted: status["volume"]["muted"].as_bool() }
        }
        (NS_RECEIVER, "LAUNCH_ERROR" | "INVALID_REQUEST") | (NS_MEDIA, "INVALID_REQUEST" | "INVALID_PLAYER_STATE") => {
            Incoming::Refused(v["reason"].as_str().unwrap_or(kind).to_owned())
        }
        (NS_MEDIA, "MEDIA_STATUS") => {
            let s = v["status"].as_array().and_then(|a| a.first());
            Incoming::Media(s.and_then(|s| {
                Some(MediaState {
                    session: s["mediaSessionId"].as_i64()?,
                    player: s["playerState"].as_str().unwrap_or("IDLE").to_owned(),
                    position: s["currentTime"].as_f64().unwrap_or(0.0),
                    duration: s["media"]["duration"].as_f64().filter(|d| *d > 0.0),
                    idle_reason: s["idleReason"].as_str().map(str::to_owned),
                })
            }))
        }
        (NS_MEDIA, "LOAD_FAILED" | "LOAD_CANCELLED") => Incoming::LoadFailed,
        _ => Incoming::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_names_the_link_its_kind_and_where_to_start() {
        let l = Load {
            url: "https://media.example.com/film.mkv?token=TOKEN".into(),
            title: "A Film".into(),
            subtitle: String::new(),
            image: Some("https://image.example.com/p.jpg".into()),
            start: 754.5,
        };
        let v = load(7, &l);
        assert_eq!(v["media"]["contentType"], "video/x-matroska");
        assert_eq!(v["currentTime"], 754.5);
        assert_eq!(v["media"]["metadata"]["images"][0]["url"], "https://image.example.com/p.jpg");
        assert_eq!(content_type("https://media.example.com/a/index.m3u8"), "application/x-mpegURL");
        assert_eq!(content_type("https://media.example.com/stream"), "video/mp4");
    }

    #[test]
    fn the_running_app_and_what_plays_are_read() {
        let status = r#"{"type":"RECEIVER_STATUS","status":{"applications":[{"appId":"CC1AD845","sessionId":"S","transportId":"T"}],"volume":{"level":0.4,"muted":false}}}"#;
        assert_eq!(
            parse(NS_RECEIVER, status),
            Incoming::Receiver { app: Some(App { session: "S".into(), transport: "T".into() }), volume: Some(0.4), muted: Some(false) }
        );
        let backdrop = r#"{"type":"RECEIVER_STATUS","status":{"applications":[{"appId":"E8C28D3C"}]}}"#;
        assert!(matches!(parse(NS_RECEIVER, backdrop), Incoming::Receiver { app: None, .. }));
        let media = r#"{"type":"MEDIA_STATUS","status":[{"mediaSessionId":1,"playerState":"PLAYING","currentTime":12.5,"media":{"duration":3600}}]}"#;
        assert_eq!(
            parse(NS_MEDIA, media),
            Incoming::Media(Some(MediaState { session: 1, player: "PLAYING".into(), position: 12.5, duration: Some(3600.0), idle_reason: None }))
        );
        assert_eq!(parse(NS_MEDIA, r#"{"type":"MEDIA_STATUS","status":[]}"#), Incoming::Media(None));
        assert_eq!(parse(NS_MEDIA, r#"{"type":"LOAD_FAILED"}"#), Incoming::LoadFailed);
        assert_eq!(parse(NS_HEARTBEAT, r#"{"type":"PING"}"#), Incoming::Ping);
        assert_eq!(parse(NS_MEDIA, "not json"), Incoming::Other);
    }
}
