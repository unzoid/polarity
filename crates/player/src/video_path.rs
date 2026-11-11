//! One log line saying how mpv decodes and draws the video now (#416): the decoder (hardware or
//! software), the frames' format and colours as decoded, and what mpv converts them to for the
//! screen. A wrong picture (a colour cast, washed-out blacks) is then readable in the app's log
//! from the device it happened on. Only formats and colour names: nothing about the file.

use serde_json::Value;

/// The properties [`describe`] reads, in its order.
pub const PROPERTIES: [&str; 3] = ["hwdec-current", "video-params", "video-out-params"];

const FIELDS: [&str; 6] = ["pixelformat", "hw-pixelformat", "colormatrix", "colorlevels", "primaries", "gamma"];

fn params(v: &Value) -> String {
    let parts: Vec<String> = FIELDS
        .iter()
        .filter_map(|f| {
            v.get(*f).and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| format!("{f}={}", short(s)))
        })
        .collect();
    if parts.is_empty() {
        "-".into()
    } else {
        parts.join(" ")
    }
}

/// mpv's names are short words; anything else is cut, so the line stays one line.
fn short(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || "-_.".contains(*c)).take(24).collect()
}

/// "decoder videotoolbox; decoded pixelformat=nv12 hw-pixelformat=videotoolbox ...; drawn ...", from
/// the values of [`PROPERTIES`] (a property mpv couldn't give is `Null`).
pub fn describe(hwdec: &Value, decoded: &Value, drawn: &Value) -> String {
    let decoder = match hwdec.as_str() {
        Some("no") | Some("") | None => "software".to_owned(),
        Some(h) => short(h),
    };
    format!("decoder {decoder}; decoded {}; drawn {}", params(decoded), params(drawn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hardware_frames_name_both_formats_and_their_colours() {
        let decoded = json!({
            "pixelformat": "nv12", "hw-pixelformat": "videotoolbox", "w": 1920, "h": 1080,
            "colormatrix": "bt.709", "colorlevels": "limited", "primaries": "bt.709", "gamma": "bt.1886",
        });
        let drawn = json!({ "pixelformat": "nv12", "colormatrix": "bt.709", "colorlevels": "limited" });
        assert_eq!(
            describe(&json!("videotoolbox"), &decoded, &drawn),
            "decoder videotoolbox; decoded pixelformat=nv12 hw-pixelformat=videotoolbox colormatrix=bt.709 \
             colorlevels=limited primaries=bt.709 gamma=bt.1886; drawn pixelformat=nv12 colormatrix=bt.709 colorlevels=limited"
        );
    }

    #[test]
    fn software_and_missing_values_still_make_one_line() {
        assert_eq!(describe(&json!("no"), &Value::Null, &json!({})), "decoder software; decoded -; drawn -");
        assert_eq!(
            describe(&Value::Null, &json!({ "pixelformat": "yuv420p10\n x" }), &Value::Null),
            "decoder software; decoded pixelformat=yuv420p10x; drawn -"
        );
    }
}
