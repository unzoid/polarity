//! Pictures named by metadata (title logos, backdrops), fetched for the app to
//! measure (#354). The web view reads a picture's pixels only when its host sends
//! CORS headers; many image hosts don't, and a logo that can't be measured is
//! drawn as it is, dark on a dark page. This fetch isn't subject to CORS.
//!
//! Only public `https` addresses, also after redirects; only pictures, at most
//! [`PICTURE_MAX`] bytes; no cookies or credentials are sent.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use reqwest::{redirect, Url};

use crate::client::read_capped;

/// Largest picture read: a logo or backdrop at full size is a few MB at most.
pub const PICTURE_MAX: usize = 8 << 20;

const MAX_REDIRECTS: usize = 5;

#[derive(Clone)]
pub struct Pictures {
    http: reqwest::Client,
    /// Lets loopback addresses through, for tests against a local server.
    local: bool,
}

impl Default for Pictures {
    fn default() -> Self {
        Self::build(false)
    }
}

impl Pictures {
    fn build(local: bool) -> Self {
        let policy = redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if allowed(attempt.url(), local) {
                attempt.follow()
            } else {
                attempt.error("redirected to an address that isn't public")
            }
        });
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .redirect(policy)
            .user_agent(concat!("polarity/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self { http, local }
    }

    /// The picture's bytes, or why it couldn't be had (never with the URL, which may name the title).
    pub async fn fetch(&self, url: &str) -> Result<Vec<u8>, String> {
        let url = Url::parse(url).map_err(|_| "not a link".to_owned())?;
        if !allowed(&url, self.local) {
            return Err("not a public https address".into());
        }
        let res = self.http.get(url).send().await.map_err(|e| reason(&e))?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let declared = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if declared.starts_with("text/") || declared.contains("json") {
            return Err(format!("not a picture ({declared})"));
        }
        let body = read_capped(res, PICTURE_MAX).await.map_err(|e| e.to_string())?;
        if !declared.starts_with("image/") && !looks_like_picture(&body) {
            return Err("not a picture".into());
        }
        Ok(body)
    }
}

fn reason(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timed out".into()
    } else if e.is_redirect() {
        "refused redirect".into()
    } else if e.is_connect() {
        "couldn't connect".into()
    } else {
        "network error".into()
    }
}

/// A public `https` address: not a name or IP of this machine or the local network.
/// `local` lets `http://127.0.0.1` through, for tests.
pub fn allowed(url: &Url, local: bool) -> bool {
    if local && url.scheme() == "http" && url.host_str() == Some("127.0.0.1") {
        return true;
    }
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    url.host_str().is_some_and(|host| public_name(host.trim_start_matches('[').trim_end_matches(']')))
}

fn public_name(name: &str) -> bool {
    let name = name.trim_end_matches('.').to_ascii_lowercase();
    if let Ok(ip) = name.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(ip) => public_v4(ip),
            IpAddr::V6(ip) => public_v6(ip),
        };
    }
    const LOCAL: [&str; 6] = ["localhost", "local", "lan", "home", "internal", "home.arpa"];
    name.contains('.') && !LOCAL.iter().any(|l| name == *l || name.ends_with(&format!(".{l}")))
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..128).contains(&b)))
}

fn public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return public_v4(v4);
    }
    let first = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80)
}

/// PNG, JPEG, GIF, WebP, AVIF or SVG, by their first bytes, for hosts that don't say.
fn looks_like_picture(body: &[u8]) -> bool {
    let starts = |m: &[u8]| body.starts_with(m);
    starts(b"\x89PNG")
        || starts(b"\xff\xd8\xff")
        || starts(b"GIF8")
        || (starts(b"RIFF") && body.get(8..12) == Some(b"WEBP"))
        || body.get(4..8) == Some(b"ftyp")
        || String::from_utf8_lossy(&body[..body.len().min(256)]).contains("<svg")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn ok(url: &str) -> bool {
        allowed(&Url::parse(url).unwrap(), false)
    }

    #[test]
    fn only_public_https_addresses_are_fetched() {
        assert!(ok("https://media.example.com/logo.png"));
        assert!(ok("https://93.184.216.34/logo.png"));
        for refused in [
            "http://media.example.com/logo.png",
            "file:///etc/hosts",
            "https://user:pass@media.example.com/logo.png",
            "https://localhost/logo.png",
            "https://nas.local/logo.png",
            "https://router.home.arpa/logo.png",
            "https://printer/logo.png",
            "https://127.0.0.1/logo.png",
            "https://10.0.0.2/logo.png",
            "https://192.168.1.1/logo.png",
            "https://172.16.0.1/logo.png",
            "https://169.254.169.254/latest",
            "https://100.100.1.1/logo.png",
            "https://0.0.0.0/logo.png",
            "https://[::1]/logo.png",
            "https://[fd00::1]/logo.png",
            "https://[fe80::1]/logo.png",
            "https://[::ffff:192.168.1.1]/logo.png",
        ] {
            assert!(!ok(refused), "{refused}");
        }
    }

    #[test]
    fn pictures_are_known_by_their_first_bytes() {
        assert!(looks_like_picture(b"\x89PNG\r\n\x1a\n...."));
        assert!(looks_like_picture(b"\xff\xd8\xff\xe0...."));
        assert!(looks_like_picture(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(looks_like_picture(b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"));
        assert!(!looks_like_picture(b"<!doctype html><html>"));
        assert!(!looks_like_picture(b""));
    }

    /// Answers each connection with the next of `answers` (head, body), then closes.
    fn serve(answers: Vec<(String, Vec<u8>)>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for (head, body) in answers {
                let (mut s, _) = listener.accept().unwrap();
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf);
                let _ = s.write_all(
                    format!("{head}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes(),
                );
                let _ = s.write_all(&body);
            }
        });
        base
    }

    fn run<T>(f: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-not-really-";

    #[test]
    fn a_picture_without_cors_headers_is_read() {
        let base = serve(vec![("HTTP/1.1 200 OK\r\nContent-Type: image/png".into(), PNG.to_vec())]);
        assert_eq!(run(Pictures::build(true).fetch(&format!("{base}/logo.png"))).unwrap(), PNG);
    }

    #[test]
    fn a_picture_sent_as_octet_stream_is_known_by_its_bytes() {
        let base = serve(vec![
            ("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream".into(), PNG.to_vec()),
            ("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream".into(), b"MZ\x90\0".to_vec()),
        ]);
        let pictures = Pictures::build(true);
        assert!(run(pictures.fetch(&format!("{base}/a"))).is_ok());
        assert_eq!(run(pictures.fetch(&format!("{base}/b"))).unwrap_err(), "not a picture");
    }

    #[test]
    fn pages_errors_and_oversized_answers_are_refused() {
        let base = serve(vec![
            ("HTTP/1.1 200 OK\r\nContent-Type: text/html".into(), b"<html>".to_vec()),
            ("HTTP/1.1 404 Not Found\r\nContent-Type: image/png".into(), Vec::new()),
            ("HTTP/1.1 200 OK\r\nContent-Type: image/png".into(), vec![0; PICTURE_MAX + 1]),
        ]);
        let pictures = Pictures::build(true);
        assert!(run(pictures.fetch(&format!("{base}/a"))).unwrap_err().starts_with("not a picture"));
        assert_eq!(run(pictures.fetch(&format!("{base}/b"))).unwrap_err(), "HTTP 404");
        assert!(run(pictures.fetch(&format!("{base}/c"))).is_err());
    }

    #[test]
    fn a_redirect_to_the_local_network_is_refused() {
        let base = serve(vec![("HTTP/1.1 302 Found\r\nLocation: https://192.168.1.1/logo.png".into(), Vec::new())]);
        assert_eq!(run(Pictures::build(true).fetch(&format!("{base}/logo.png"))).unwrap_err(), "refused redirect");
    }
}
