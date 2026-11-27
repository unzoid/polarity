//! System-browser WebAuthn passkey handoff for desktop builds.
//!
//! Embedded webviews on desktop (notably macOS WKWebView) block `navigator.credentials`
//! or run on custom schemes (`tauri://localhost`) that WebAuthn cannot bind to a real RP ID.
//! Instead of sending any session token to the browser, the desktop app starts a Supabase
//! WebAuthn challenge locally, hands only the public WebAuthn options to a ceremony page on
//! the configured relying-party origin (`http://localhost:1420/passkey.html` in dev,
//! `https://getpolar.app/passkey/` in prod), and waits for the signed WebAuthn credential
//! to return on an ephemeral `127.0.0.1` loopback callback.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::commands::{CmdError, Result};

/// How long the loopback listener waits for the user to finish in their browser.
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(180);
/// Per-connection read cap so a stray or stalled socket cannot block the listener.
const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// Maximum HTTP request bytes read from the loopback callback.
const MAX_REQUEST_BYTES: usize = 64 * 1024;

type ActiveHandoff = (u64, oneshot::Sender<()>);

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static ACTIVE: OnceLock<Mutex<Option<ActiveHandoff>>> = OnceLock::new();

fn active_slot() -> &'static Mutex<Option<ActiveHandoff>> {
    ACTIVE.get_or_init(|| Mutex::new(None))
}

struct ActiveGuard(u64);

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = active_slot().lock() {
            if guard.as_ref().is_some_and(|(id, _)| *id == self.0) {
                guard.take();
            }
        }
    }
}

/// Opens the passkey ceremony page in the system browser and waits for the loopback callback.
/// Returns the serialized WebAuthn credential JSON string (as returned by `credential.toJSON()`).
#[tauri::command]
pub async fn passkey_handoff(
    app: tauri::AppHandle,
    base_url: String,
    mode: String,
    options_json: String,
) -> Result<String> {
    use tauri_plugin_opener::OpenerExt;

    validate_base_url(&base_url)?;
    validate_mode(&mode)?;
    let options: serde_json::Value =
        serde_json::from_str(&options_json).map_err(|_| CmdError::Unsupported("invalid passkey options".into()))?;
    if !options.is_object() {
        return Err(CmdError::Unsupported("passkey options must be a JSON object".into()));
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| CmdError::Other(format!("failed to start passkey callback listener: {e}")))?;
    let port = listener.local_addr().map_err(|e| CmdError::Other(format!("failed to read callback port: {e}")))?.port();

    let state = random_state();
    let callback = format!("http://127.0.0.1:{port}/callback");
    let payload = json!({
        "mode": mode,
        "options": options,
        "callback": callback,
        "state": state,
    });
    let encoded = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
    let launch_url = format!("{base_url}#{encoded}");

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let mut slot = active_slot().lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, prev)) = slot.replace((id, cancel_tx)) {
            let _ = prev.send(());
        }
    }
    let _guard = ActiveGuard(id);

    app.opener()
        .open_url(launch_url, None::<&str>)
        .map_err(|e| CmdError::Other(format!("could not open system browser: {e}")))?;

    let result = run_callback_server(listener, &state, cancel_rx, HANDOFF_TIMEOUT).await;

    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    result
}

/// Cancels any in-flight passkey handoff listener (e.g. when the user navigates away or skips).
#[tauri::command]
pub fn passkey_handoff_cancel() {
    if let Ok(mut slot) = active_slot().lock() {
        if let Some((_, tx)) = slot.take() {
            let _ = tx.send(());
        }
    }
}

fn validate_mode(mode: &str) -> Result<()> {
    match mode {
        "register" | "authenticate" => Ok(()),
        _ => Err(CmdError::Unsupported("invalid passkey mode".into())),
    }
}

fn validate_base_url(url: &str) -> Result<()> {
    if url.is_empty() || url.contains('#') || url.bytes().any(|b| b.is_ascii_control() || b == b' ') {
        return Err(CmdError::Unsupported("invalid passkey handoff URL".into()));
    }
    if let Some(rest) = url.strip_prefix("https://") {
        let host = rest.split('/').next().unwrap_or("");
        if !host.is_empty() && !host.contains('@') {
            return Ok(());
        }
    }
    if let Some(rest) = url.strip_prefix("http://") {
        let authority = rest.split('/').next().unwrap_or("");
        if authority == "localhost"
            || authority
                .strip_prefix("localhost:")
                .is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        {
            return Ok(());
        }
    }
    Err(CmdError::Unsupported("passkey handoff URL must use https:// or http://localhost".into()))
}

fn random_state() -> String {
    let mut bytes = [0u8; 16];
    let filled = {
        #[cfg(unix)]
        {
            use std::io::Read;
            std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).is_ok()
        }
        #[cfg(not(unix))]
        {
            false
        }
    };
    if !filled {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        let a = RandomState::new().build_hasher().finish().to_le_bytes();
        let b = RandomState::new().build_hasher().finish().to_le_bytes();
        bytes[..8].copy_from_slice(&a);
        bytes[8..].copy_from_slice(&b);
    }
    let mut hex = String::with_capacity(32);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{b:02x}");
    }
    hex
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hi = hex_val(bytes[i + 1])?;
            let lo = hex_val(bytes[i + 2])?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if percent_decode(k).as_deref() == Some(key) {
            return percent_decode(v);
        }
    }
    None
}

async fn run_callback_server(
    listener: TcpListener,
    expected_state: &str,
    mut cancel_rx: oneshot::Receiver<()>,
    timeout: Duration,
) -> Result<String> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let sleep = tokio::time::sleep_until(deadline);
        tokio::pin!(sleep);

        let accepted = tokio::select! {
            res = listener.accept() => res,
            _ = &mut cancel_rx => {
                return Err(CmdError::Other("passkey:cancelled".into()));
            }
            _ = &mut sleep => {
                return Err(CmdError::Other("passkey:timeout".into()));
            }
        };

        let (mut stream, _) = match accepted {
            Ok(pair) => pair,
            Err(_) => continue,
        };

        let Some(target) = read_request_target(&mut stream).await else {
            let _ = write_plain(&mut stream, "400 Bad Request", "Bad request").await;
            continue;
        };

        let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
        if path != "/callback" {
            let _ = write_plain(&mut stream, "404 Not Found", "Not found").await;
            continue;
        }

        let Some(state) = parse_query_param(query, "state") else {
            let _ = write_plain(&mut stream, "400 Bad Request", "Missing state").await;
            continue;
        };
        if !constant_time_eq(&state, expected_state) {
            let _ = write_plain(&mut stream, "400 Bad Request", "Invalid state").await;
            continue;
        }

        if let Some(err) = parse_query_param(query, "error") {
            let clean = err.trim().chars().take(240).collect::<String>();
            let (title, note) = if clean == "cancelled" {
                ("Passkey cancelled", "You can close this tab and return to Polarity.")
            } else {
                ("Couldn't finish passkey", "Return to Polarity to see details or try again.")
            };
            let _ = write_html(&mut stream, &completion_html(title, note)).await;
            let code = if clean.is_empty() { "cancelled".into() } else { clean };
            return Err(CmdError::Other(format!("passkey:{code}")));
        }

        let Some(payload) = parse_query_param(query, "payload") else {
            let _ = write_plain(&mut stream, "400 Bad Request", "Missing payload").await;
            continue;
        };
        let raw = URL_SAFE_NO_PAD.decode(payload.as_bytes()).or_else(|_| URL_SAFE.decode(payload.as_bytes()));
        let Ok(bytes) = raw else {
            let _ = write_plain(&mut stream, "400 Bad Request", "Invalid payload encoding").await;
            continue;
        };
        let Ok(json_str) = String::from_utf8(bytes) else {
            let _ = write_plain(&mut stream, "400 Bad Request", "Invalid UTF-8 payload").await;
            continue;
        };
        let valid = serde_json::from_str::<serde_json::Value>(&json_str).is_ok_and(|v| v.is_object());
        if !valid {
            let _ = write_plain(&mut stream, "400 Bad Request", "Invalid credential payload").await;
            continue;
        }

        let _ = write_html(&mut stream, &completion_html("All set", "You can close this tab and return to Polarity."))
            .await;
        return Ok(json_str);
    }
}

async fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 2048];
    tokio::time::timeout(READ_TIMEOUT, async {
        loop {
            let n = stream.read(&mut chunk).await.ok()?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() >= MAX_REQUEST_BYTES {
                break;
            }
        }
        Some(())
    })
    .await
    .ok()??;

    let text = std::str::from_utf8(&buf).ok()?;
    let first_line = text.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?;
    if method != "GET" {
        return None;
    }
    let target = parts.next()?;
    Some(target.to_string())
}

async fn write_plain(stream: &mut TcpStream, status: &str, body: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await
}

async fn write_html(stream: &mut TcpStream, body: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await
}

fn completion_html(title: &str, note: &str) -> String {
    format!(
        r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title} — Polarity</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: radial-gradient(75% 45% at 50% 0%, rgba(92, 84, 214, 0.24), transparent 70%), #0a0a0d;
    color: #f4f4f6;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  main {{ max-width: 360px; text-align: center; }}
  .mark {{ display: inline-block; height: 34px; margin-bottom: 20px; }}
  h1 {{ margin: 0 0 8px; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }}
  p {{ margin: 0; color: rgba(244, 244, 246, 0.62); }}
</style>
</head>
<body>
<main>
  <svg class="mark" viewBox="0 0 260 100" fill="none" aria-label="Polarity">
    <path d="M13.88 85.08V39.256H22.008V43.672C23.2453 41.9653 24.7813 40.6853 26.616 39.832C28.4933 38.936 30.52 38.488 32.696 38.488C35.768 38.488 38.392 39.2347 40.568 40.728C42.7867 42.2213 44.472 44.2267 45.624 46.744C46.8187 49.2187 47.416 51.9707 47.416 55C47.416 58.0293 46.8187 60.824 45.624 63.384C44.4293 65.944 42.7227 67.992 40.504 69.528C38.328 71.0213 35.7253 71.768 32.696 71.768C30.008 71.768 27.768 71.2133 25.976 70.104C24.2267 68.9947 22.9253 67.8427 22.072 66.648V85.08H13.88ZM30.52 64.6C32.2267 64.6 33.72 64.1733 35 63.32C36.28 62.424 37.2827 61.2507 38.008 59.8C38.7333 58.3493 39.096 56.7493 39.096 55C39.096 52.9947 38.6907 51.3093 37.88 49.944C37.112 48.536 36.0667 47.4693 34.744 46.744C33.464 46.0187 32.056 45.656 30.52 45.656C28.8987 45.656 27.448 46.0613 26.168 46.872C24.888 47.6827 23.864 48.8133 23.096 50.264C22.3707 51.672 22.008 53.2933 22.008 55.128C22.008 56.8773 22.3707 58.4773 23.096 59.928C23.8213 61.3787 24.824 62.5307 26.104 63.384C27.384 64.1947 28.856 64.6 30.52 64.6ZM94.7003 71V26.2H102.892V71H94.7003ZM120.428 71.768C118.551 71.768 116.802 71.384 115.18 70.616C113.559 69.848 112.236 68.76 111.212 67.352C110.231 65.9013 109.74 64.1947 109.74 62.232C109.74 59.8853 110.316 57.9653 111.468 56.472C112.62 54.9787 114.199 53.8693 116.204 53.144C118.252 52.4187 120.535 52.056 123.052 52.056H130.604C130.604 50.6053 130.37 49.3893 129.9 48.408C129.474 47.4267 128.812 46.68 127.916 46.168C127.063 45.6133 125.996 45.336 124.716 45.336C123.223 45.336 121.879 45.6773 120.684 46.36C119.532 47 118.828 48.088 118.572 49.624H110.38C110.594 47.32 111.383 45.336 112.748 43.672C114.114 42.008 115.863 40.728 117.996 39.832C120.13 38.936 122.412 38.488 124.844 38.488C127.831 38.488 130.348 39.0427 132.396 40.152C134.487 41.2613 136.087 42.84 137.196 44.888C138.306 46.8933 138.86 49.2827 138.86 52.056V61.72C138.946 62.6587 139.287 63.2987 139.884 63.64C140.482 63.9813 141.271 64.152 142.252 64.152V71C140.247 71 138.562 70.808 137.196 70.424C135.874 70.04 134.786 69.4853 133.932 68.76C133.079 67.992 132.354 67.032 131.756 65.88C130.775 67.544 129.239 68.952 127.148 70.104C125.1 71.2133 122.86 71.768 120.428 71.768ZM122.796 65.176C124.204 65.176 125.484 64.856 126.636 64.216C127.831 63.576 128.791 62.68 129.516 61.528C130.242 60.376 130.604 59.0533 130.604 57.56V57.304H123.564C122.626 57.304 121.73 57.4533 120.876 57.752C120.023 58.008 119.34 58.4347 118.828 59.032C118.316 59.5867 118.06 60.3547 118.06 61.336C118.06 62.6587 118.508 63.64 119.404 64.28C120.343 64.8773 121.474 65.176 122.796 65.176ZM148.2 71V39.256H156.328V43.992C157.438 42.2 158.846 40.8347 160.552 39.896C162.259 38.9573 164.158 38.488 166.248 38.488V47.064H164.072C161.47 47.064 159.528 47.6827 158.248 48.92C156.968 50.1573 156.328 52.2267 156.328 55.128V71H148.2ZM176.491 35.16C175.041 35.16 173.782 34.648 172.715 33.624C171.691 32.5573 171.179 31.2987 171.179 29.848C171.179 28.3547 171.691 27.096 172.715 26.072C173.782 25.048 175.041 24.536 176.491 24.536C177.985 24.536 179.243 25.048 180.267 26.072C181.291 27.096 181.803 28.3547 181.803 29.848C181.803 31.2987 181.291 32.5573 180.267 33.624C179.243 34.648 177.985 35.16 176.491 35.16ZM172.395 71V39.256H180.587V71H172.395ZM201.055 71C197.642 71 195.061 70.168 193.311 68.504C191.605 66.84 190.751 64.344 190.751 61.016V46.104H186.655V39.256H190.751V31.512H198.943V39.256H206.175V46.104H198.943V61.08C198.943 62.2747 199.263 63.0853 199.903 63.512C200.543 63.9387 201.375 64.152 202.399 64.152H206.175V71H201.055ZM215.957 85.08L222.933 69.528L210.069 39.256H219.221L227.413 60.888L235.797 39.256H244.437L224.597 85.08H215.957Z" fill="white"/>
    <path d="M71 28L65 44L49 50L65 56L71 72L77 56L93 50L77 44L71 28Z" fill="#A7ABFF"/>
  </svg>
  <h1>{title}</h1>
  <p>{note}</p>
</main>
<script>try {{ window.close(); }} catch (_e) {{}}</script>
</body>
</html>"##
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_handoff_urls() {
        assert!(validate_base_url("https://getpolar.app/passkey/").is_ok());
        assert!(validate_base_url("http://localhost:1420/passkey.html").is_ok());
        assert!(validate_base_url("http://localhost/passkey").is_ok());
        assert!(validate_base_url("http://example.com/passkey").is_err());
        assert!(validate_base_url("https://getpolar.app/passkey#already").is_err());
        assert!(validate_base_url("javascript:alert(1)").is_err());
        assert!(validate_base_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn percent_decodes_preserving_plus() {
        assert_eq!(percent_decode("abc%20def+g%3D").as_deref(), Some("abc def+g="));
        assert_eq!(percent_decode("%zz"), None);
    }

    #[tokio::test]
    async fn ignores_favicon_and_bad_state_then_returns_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (_tx, rx) = oneshot::channel();
        let state = "deadbeef01234567deadbeef01234567";

        let server =
            tokio::spawn(async move { run_callback_server(listener, state, rx, Duration::from_secs(5)).await });

        // 1. Stray favicon request should be ignored with 404
        {
            let mut s = TcpStream::connect(addr).await.unwrap();
            s.write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").await.unwrap();
            let mut resp = String::new();
            s.read_to_string(&mut resp).await.unwrap();
            assert!(resp.starts_with("HTTP/1.1 404"));
        }

        // 2. Wrong state should be rejected with 400 and keep waiting
        {
            let mut s = TcpStream::connect(addr).await.unwrap();
            s.write_all(b"GET /callback?state=wrong&payload=e30 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").await.unwrap();
            let mut resp = String::new();
            s.read_to_string(&mut resp).await.unwrap();
            assert!(resp.starts_with("HTTP/1.1 400"));
        }

        // 3. Valid callback completes with decoded JSON
        let cred = r#"{"id":"cred-1","rawId":"cred-1","type":"public-key"}"#;
        let encoded = URL_SAFE_NO_PAD.encode(cred.as_bytes());
        {
            let mut s = TcpStream::connect(addr).await.unwrap();
            let req = format!("GET /callback?state={state}&payload={encoded} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
            s.write_all(req.as_bytes()).await.unwrap();
            let mut resp = String::new();
            s.read_to_string(&mut resp).await.unwrap();
            assert!(resp.starts_with("HTTP/1.1 200"));
            assert!(resp.contains("All set"));
        }

        let got = server.await.unwrap().unwrap();
        assert_eq!(got, cred);
    }

    #[tokio::test]
    async fn returns_cancelled_on_error_callback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (_tx, rx) = oneshot::channel();
        let state = "0123456789abcdef0123456789abcdef";

        let server =
            tokio::spawn(async move { run_callback_server(listener, state, rx, Duration::from_secs(5)).await });

        let mut s = TcpStream::connect(addr).await.unwrap();
        let req = format!("GET /callback?state={state}&error=cancelled HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        s.write_all(req.as_bytes()).await.unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).await.unwrap();
        assert!(resp.starts_with("HTTP/1.1 200"));

        let err = server.await.unwrap().unwrap_err();
        assert_eq!(err.to_string(), "passkey:cancelled");
    }

    #[tokio::test]
    async fn cancels_cleanly_when_signalled() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (tx, rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            run_callback_server(listener, "0123456789abcdef0123456789abcdef", rx, Duration::from_secs(5)).await
        });
        let _ = tx.send(());
        let err = server.await.unwrap().unwrap_err();
        assert_eq!(err.to_string(), "passkey:cancelled");
    }
}
