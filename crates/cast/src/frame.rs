//! Cast's wire format: each message is a `CastMessage` protobuf behind its length (4 bytes, big-endian).
//! Only the string payloads the media and receiver channels use are written; a binary one is read past.
//!
//! ```text
//! message CastMessage {
//!   ProtocolVersion protocol_version = 1;  // CASTV2_1_0 = 0
//!   string source_id = 2;
//!   string destination_id = 3;
//!   string namespace = 4;
//!   PayloadType payload_type = 5;          // STRING = 0, BINARY = 1
//!   string payload_utf8 = 6;
//!   bytes payload_binary = 7;
//! }
//! ```

/// The most a frame may be: Cast's own limit (64 KiB).
pub const MAX_FRAME: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CastMessage {
    pub source: String,
    pub destination: String,
    pub namespace: String,
    /// JSON; empty for a binary message.
    pub payload: String,
}

fn varint(out: &mut Vec<u8>, mut n: u64) {
    while n >= 0x80 {
        out.push((n as u8) | 0x80);
        n >>= 7;
    }
    out.push(n as u8);
}

fn text(out: &mut Vec<u8>, field: u8, s: &str) {
    out.push(field << 3 | 2);
    varint(out, s.len() as u64);
    out.extend_from_slice(s.as_bytes());
}

impl CastMessage {
    /// The message as a frame: its length, then the protobuf.
    pub fn encode(&self) -> Vec<u8> {
        let mut body = Vec::with_capacity(self.payload.len() + 96);
        body.extend_from_slice(&[1 << 3, 0]); // protocol_version: CASTV2_1_0
        text(&mut body, 2, &self.source);
        text(&mut body, 3, &self.destination);
        text(&mut body, 4, &self.namespace);
        body.extend_from_slice(&[5 << 3, 0]); // payload_type: STRING
        text(&mut body, 6, &self.payload);
        let mut frame = (body.len() as u32).to_be_bytes().to_vec();
        frame.extend(body);
        frame
    }

    /// A frame's protobuf (without its length), or why it isn't one.
    pub fn decode(mut b: &[u8]) -> Result<Self, String> {
        let mut m = CastMessage::default();
        fn read_varint(b: &mut &[u8]) -> Result<u64, String> {
            let mut n = 0u64;
            for shift in (0..64).step_by(7) {
                let (&byte, rest) = b.split_first().ok_or("cut short")?;
                *b = rest;
                n |= u64::from(byte & 0x7f) << shift;
                if byte < 0x80 {
                    return Ok(n);
                }
            }
            Err("varint too long".into())
        }
        while !b.is_empty() {
            let tag = read_varint(&mut b)?;
            let (field, wire) = (tag >> 3, tag & 7);
            match wire {
                0 => {
                    read_varint(&mut b)?;
                }
                1 | 5 => {
                    let n = if wire == 1 { 8 } else { 4 };
                    if b.len() < n {
                        return Err("cut short".into());
                    }
                    b = &b[n..];
                }
                2 => {
                    let len = read_varint(&mut b)? as usize;
                    if b.len() < len {
                        return Err("cut short".into());
                    }
                    let (value, rest) = b.split_at(len);
                    b = rest;
                    let s = || String::from_utf8(value.to_vec()).map_err(|_| "not UTF-8".to_string());
                    match field {
                        2 => m.source = s()?,
                        3 => m.destination = s()?,
                        4 => m.namespace = s()?,
                        6 => m.payload = s()?,
                        _ => {}
                    }
                }
                _ => return Err(format!("wire type {wire}")),
            }
        }
        Ok(m)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_comes_back_as_it_went() {
        let m = CastMessage {
            source: "sender-0".into(),
            destination: "receiver-0".into(),
            namespace: "urn:x-cast:com.google.cast.tp.connection".into(),
            payload: format!(r#"{{"type":"CONNECT","x":"{}"}}"#, "é".repeat(100)),
        };
        let frame = m.encode();
        let len = u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize;
        assert_eq!(len, frame.len() - 4);
        assert_eq!(CastMessage::decode(&frame[4..]).unwrap(), m);
    }

    #[test]
    fn known_bytes_from_a_receiver() {
        // protocol 0, source "a", destination "b", namespace "n", payload_type 0, payload "{}", and a binary 7 read past.
        let bytes =
            [0x08, 0x00, 0x12, 1, b'a', 0x1a, 1, b'b', 0x22, 1, b'n', 0x28, 0x00, 0x32, 2, b'{', b'}', 0x3a, 1, 0xff];
        let m = CastMessage::decode(&bytes).unwrap();
        assert_eq!(
            (m.source.as_str(), m.destination.as_str(), m.namespace.as_str(), m.payload.as_str()),
            ("a", "b", "n", "{}")
        );
    }

    #[test]
    fn broken_frames_are_refused_not_trusted() {
        assert!(CastMessage::decode(&[0x32, 10, b'{']).is_err());
        assert!(CastMessage::decode(&[0xff; 12]).is_err());
        assert!(CastMessage::decode(&[0x33]).is_err());
    }
}
