//! A certificate bundle for TLS libraries that read one PEM file (mbedTLS in the Android
//! build of mpv) from a folder of certificate files such as Android 14+'s APEX Conscrypt
//! store (`/apex/com.android.conscrypt/cacerts`) or `/system/etc/security/cacerts`, where
//! each file holds one PEM block and a text dump.
//!
//! Expired root certificates are filtered out when their ASN.1 DER `notAfter` timestamp can
//! be parsed (Netflix BetterTLS #461): non-branching validators like mbedTLS can fail valid
//! cross-signed chains if an expired root appears in the bundle.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Android certificate directories in priority order: Android 14+ (API 34+) ships updated roots
/// in the Mainline Conscrypt APEX module; older releases use `/system/etc/security/cacerts`.
pub const ANDROID_CERT_DIRS: &[&str] = &["/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"];

/// Every valid PEM certificate block from the first directory in `dirs` that yields at least
/// one certificate. Falls back to subsequent directories when earlier ones don't exist or are empty.
pub fn pem_bundle_from_first(dirs: &[&Path]) -> std::io::Result<String> {
    let mut last_err = None;
    for dir in dirs {
        match pem_bundle(dir) {
            Ok(pem) if !pem.is_empty() => return Ok(pem),
            Ok(_) => {}
            Err(e) => last_err = Some(e),
        }
    }
    match last_err {
        Some(e) => Err(e),
        None => Ok(String::new()),
    }
}

/// Every non-expired PEM certificate block of the files in `dir`, in file name order, one per line group.
pub fn pem_bundle(dir: &Path) -> std::io::Result<String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    pem_bundle_at(dir, now)
}

/// [`pem_bundle`] evaluated against an explicit Unix timestamp (seconds), for deterministic tests.
pub fn pem_bundle_at(dir: &Path, now_unix: i64) -> std::io::Result<String> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    let mut files: Vec<_> = std::fs::read_dir(dir)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    files.sort();
    let mut out = String::new();
    for file in files {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let mut rest = text.as_str();
        while let Some(start) = rest.find(BEGIN) {
            let Some(len) = rest[start..].find(END) else { break };
            let end = start + len + END.len();
            let block = &rest[start..end];
            // Skip certificates whose X.509 `notAfter` is clearly in the past; fail open when DER cannot be parsed.
            let body = &block[BEGIN.len()..block.len() - END.len()];
            let expired = now_unix > 0 && cert_not_after_unix(body).is_some_and(|exp| exp < now_unix);
            if !expired {
                out.push_str(block);
                out.push('\n');
            }
            rest = &rest[end..];
        }
    }
    Ok(out)
}

/// Parse `TBSCertificate.validity.notAfter` from a Base64-encoded X.509 DER certificate.
/// Returns `None` if the bytes are not a well-formed DER certificate.
fn cert_not_after_unix(b64: &str) -> Option<i64> {
    let der = decode_base64(b64)?;
    // Certificate ::= SEQUENCE { tbsCertificate TBSCertificate, ... }
    let (cert_inner, _) = read_tlv(&der, 0x30)?;
    // TBSCertificate ::= SEQUENCE { [0] version OPTIONAL, serialNumber, signature, issuer, validity, ... }
    let (mut tbs, _) = read_tlv(cert_inner, 0x30)?;
    // Optional explicit [0] version tag (0xA0)
    if tbs.first() == Some(&0xA0) {
        let (_, rest) = read_any_tlv(tbs)?;
        tbs = rest;
    }
    // Skip serialNumber, signature AlgorithmIdentifier, issuer Name
    for _ in 0..3 {
        let (_, rest) = read_any_tlv(tbs)?;
        tbs = rest;
    }
    // Validity ::= SEQUENCE { notBefore Time, notAfter Time }
    let (validity, _) = read_tlv(tbs, 0x30)?;
    let (_, after_not_before) = read_any_tlv(validity)?;
    let (tag, not_after_bytes, _) = read_tag_tlv(after_not_before)?;
    parse_asn1_time(tag, not_after_bytes)
}

fn read_tag_tlv(input: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let &tag = input.first()?;
    let &len_byte = input.get(1)?;
    let (len, header_len) = if len_byte & 0x80 == 0 {
        (len_byte as usize, 2)
    } else {
        let count = (len_byte & 0x7F) as usize;
        if count == 0 || count > 4 || input.len() < 2 + count {
            return None;
        }
        let mut len = 0usize;
        for &b in &input[2..2 + count] {
            len = (len << 8) | (b as usize);
        }
        (len, 2 + count)
    };
    let end = header_len.checked_add(len)?;
    if end > input.len() {
        return None;
    }
    Some((tag, &input[header_len..end], &input[end..]))
}

fn read_tlv(input: &[u8], expected_tag: u8) -> Option<(&[u8], &[u8])> {
    let (tag, value, rest) = read_tag_tlv(input)?;
    (tag == expected_tag).then_some((value, rest))
}

fn read_any_tlv(input: &[u8]) -> Option<(&[u8], &[u8])> {
    let (_, value, rest) = read_tag_tlv(input)?;
    Some((value, rest))
}

/// Parse ASN.1 UTCTime (`0x17`, `YYMMDDHHMMSSZ`) or GeneralizedTime (`0x18`, `YYYYMMDDHHMMSSZ`).
fn parse_asn1_time(tag: u8, bytes: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(bytes).ok()?;
    let digits = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (year, rest_start) = match tag {
        // RFC 5280 §4.1.2.5.1: UTCTime 00..49 -> 2000..2049, 50..99 -> 1950..1999.
        0x17 if s.len() >= 13 && s.ends_with('Z') => {
            let yy = digits(0..2)?;
            (if yy >= 50 { 1900 + yy } else { 2000 + yy }, 2)
        }
        0x18 if s.len() >= 15 && s.ends_with('Z') => (digits(0..4)?, 4),
        _ => return None,
    };
    let month = digits(rest_start..rest_start + 2)?;
    let day = digits(rest_start + 2..rest_start + 4)?;
    let hour = digits(rest_start + 4..rest_start + 6)?;
    let min = digits(rest_start + 6..rest_start + 8)?;
    let sec = digits(rest_start + 8..rest_start + 10)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || min > 59 || sec > 60 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3600 + min * 60 + sec)
}

/// Howard Hinnant's civil-to-days algorithm (days since 1970-01-01).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u8;
    for b in input.bytes() {
        if b.is_ascii_whitespace() || b == b'=' {
            continue;
        }
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(body: &str) -> String {
        format!("-----BEGIN CERTIFICATE-----\n{body}\n-----END CERTIFICATE-----")
    }

    fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
        let mut out = vec![tag];
        if content.len() < 128 {
            out.push(content.len() as u8);
        } else {
            let len_bytes = (content.len() as u32).to_be_bytes();
            let first_nz = len_bytes.iter().position(|&b| b != 0).unwrap_or(3);
            let count = 4 - first_nz;
            out.push(0x80 | count as u8);
            out.extend_from_slice(&len_bytes[first_nz..]);
        }
        out.extend_from_slice(content);
        out
    }

    fn encode_base64(bytes: &[u8]) -> String {
        const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = *chunk.get(1).unwrap_or(&0) as u32;
            let b2 = *chunk.get(2).unwrap_or(&0) as u32;
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(TABLE[((n >> 18) & 63) as usize] as char);
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
            out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
            out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
        }
        out
    }

    /// Build a minimal valid DER X.509 Certificate with the given `notAfter` UTCTime string.
    fn synthetic_cert_pem(not_after_utc: &str) -> String {
        let mut tbs = Vec::new();
        tbs.extend_from_slice(&tlv(0xA0, &tlv(0x02, &[2]))); // v3
        tbs.extend_from_slice(&tlv(0x02, &[1])); // serial
        tbs.extend_from_slice(&tlv(0x30, &[])); // signature alg
        tbs.extend_from_slice(&tlv(0x30, &[])); // issuer
        let mut validity = Vec::new();
        validity.extend_from_slice(&tlv(0x17, b"200101000000Z"));
        validity.extend_from_slice(&tlv(0x17, not_after_utc.as_bytes()));
        tbs.extend_from_slice(&tlv(0x30, &validity));
        let cert = tlv(0x30, &tlv(0x30, &tbs));
        block(&encode_base64(&cert))
    }

    #[test]
    fn keeps_only_certificate_blocks_in_file_order() {
        let dir = std::env::temp_dir().join(format!("polar-certs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("b.0"), format!("{}\nCertificate:\n    Data: text dump\n", block("BBB"))).unwrap();
        std::fs::write(dir.join("a.0"), format!("{}\n{}\n", block("AAA"), block("CCC"))).unwrap();
        std::fs::write(dir.join("c.0"), "no certificate here").unwrap();
        std::fs::write(dir.join("d.0"), "-----BEGIN CERTIFICATE-----\ncut off").unwrap();
        let pem = pem_bundle(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(pem.unwrap(), format!("{}\n{}\n{}\n", block("AAA"), block("CCC"), block("BBB")));
    }

    #[test]
    fn filters_expired_roots_and_prefers_first_non_empty_dir() {
        let base = std::env::temp_dir().join(format!("polar-certs-apex-{}", std::process::id()));
        let apex = base.join("apex");
        let legacy = base.join("legacy");
        let missing = base.join("missing");
        std::fs::create_dir_all(&apex).unwrap();
        std::fs::create_dir_all(&legacy).unwrap();

        let expired = synthetic_cert_pem("210930140115Z"); // 2021-09-30 (DST Root CA X3)
        let valid = synthetic_cert_pem("350604110438Z"); // 2035-06-04 (ISRG Root X1)
        std::fs::write(apex.join("01-expired.0"), &expired).unwrap();
        std::fs::write(apex.join("02-valid.0"), &valid).unwrap();
        std::fs::write(legacy.join("01-legacy.0"), block("LEGACY")).unwrap();

        // At 2026-01-01, the expired root is stripped and the valid root is kept.
        let now_2026 = days_from_civil(2026, 1, 1) * 86_400;
        let filtered = pem_bundle_at(&apex, now_2026).unwrap();
        assert!(!filtered.contains(&expired));
        assert!(filtered.contains(&valid));

        // First non-empty directory wins; missing directories fall through.
        let from_apex = pem_bundle_from_first(&[&missing, &apex, &legacy]).unwrap();
        assert!(from_apex.contains(&valid) && !from_apex.contains("LEGACY"));
        let from_legacy = pem_bundle_from_first(&[&missing, &legacy]).unwrap();
        assert!(from_legacy.contains("LEGACY"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_folder_is_an_error() {
        assert!(pem_bundle(Path::new("/nonexistent/polar-certs")).is_err());
    }
}
