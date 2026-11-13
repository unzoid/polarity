//! Device-level picture and sound options, as mpv settings.

use crate::sampler::Sampling;

/// Device-level picture and sound options (Settings → Subtitles & Audio and
/// → Advanced). Presets, not raw values: `af` takes lavfi graphs, which can
/// read files, so the page never gets to write it directly.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tune {
    /// Fold surround down to stereo with the centre (dialogue) channel
    /// louder. Only sent for tracks with more than two channels.
    pub dialogue_boost: bool,
    /// Even out loud and quiet scenes ("night mode").
    pub volume_leveling: bool,
    /// Hardware decoding. Off is a troubleshooting switch for broken drivers.
    pub hwdec: bool,
    /// Smooth colour banding in gradients (dark scenes, anime skies).
    pub deband: bool,
    /// Read-ahead: "small", "normal" or "large".
    pub buffer: BufferSize,
    /// Crop black bars burnt into the picture (a 2.39:1 film inside a 16:9
    /// file), so it fills a wide screen. See [`crate::crop`].
    #[serde(default)]
    pub autocrop: bool,
    /// With autocrop: read keyframes ahead of the playhead so a change of
    /// bars lands on the cut (docs/autocrop.md §4).
    #[serde(default = "on")]
    pub lookahead: bool,
    /// With autocrop, where mpv is its own process (Windows, Linux): our
    /// detector reads a screenshot of every frame, besides cropdetect
    /// (docs/autocrop.md §2). Off: screenshots only around cropdetect's
    /// changes. macOS and iOS always read every frame, in memory.
    #[serde(default)]
    pub every_frame: bool,
}

fn on() -> bool {
    true
}

/// Phones, tablets and TV boxes (a Google TV dongle has 2 GB for everything): the demuxer cache
/// stays small whatever the Buffer setting ([`Tune::cache`]).
const SMALL_MEMORY: bool = cfg!(any(target_os = "android", target_os = "ios"));

/// Where libmpv in the app hands our detector each frame in memory (src-tauri's player/apple.rs).
const FRAMES_IN_MEMORY: bool = cfg!(any(target_os = "macos", target_os = "ios"));

/// mpv's launch arguments on iPhones and iPads, after the ones every system gets: the same cache
/// as on Android phones, Core Audio's output for apps (the audio session itself is set up in
/// src-tauri's ios/mpv_view.m), HTTPS checked against the system's certificates, as on Android,
/// and VideoToolbox's frames in 8-bit NV12. mpv draws with OpenGL ES there, which can only take
/// 8-bit frames from VideoToolbox: a 10-bit video (HEVC Main 10, HDR) left in VideoToolbox's
/// own 10-bit format couldn't be shown, and the picture was one blue colour. VideoToolbox
/// converts on the GPU; the colours (HDR included) are still mapped by mpv. VideoToolbox's frames are
/// copied back to memory before mpv draws them ([`Tune::ios_hwdec`]).
pub const IOS_ARGS: &[&str] = &[
    "--demuxer-max-bytes=64MiB",
    "--demuxer-max-back-bytes=16MiB",
    "--ao=audiounit",
    "--tls-verify=yes",
    "--hwdec-image-format=nv12",
    "--hwdec=videotoolbox-copy",
];

#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BufferSize {
    Small,
    Normal,
    Large,
}

/// What mpv's launch arguments (`Mpv::ensure` in src-tauri) amount to.
impl Default for Tune {
    fn default() -> Self {
        Self {
            dialogue_boost: false,
            volume_leveling: false,
            hwdec: true,
            deband: false,
            buffer: BufferSize::Normal,
            autocrop: false,
            lookahead: true,
            every_frame: false,
        }
    }
}

impl Tune {
    pub fn audio_filters(&self) -> String {
        let mut chain: Vec<&str> = Vec::new();
        if self.dialogue_boost {
            // The well-known mpv downmix: centre at full level, the rest at 30%.
            chain.push("lavfi=[pan=stereo|FL<FC+0.30*FL+0.30*BL+0.30*SL|FR<FC+0.30*FR+0.30*BR+0.30*SR]");
        }
        if self.volume_leveling {
            chain.push("lavfi=[dynaudnorm=f=150:g=15:p=0.9]");
        }
        chain.join(",")
    }

    /// Whether autocrop runs cropdetect inside mpv. Not on macOS and iOS, where
    /// libmpv hands our detector every frame (and the iOS build, being LGPL, has
    /// no cropdetect). With [`Tune::every_frame`] it runs too: its reading of
    /// each frame comes on time, so animated bars are followed on their frame.
    pub fn cropdetect(&self) -> bool {
        self.cropdetect_on(FRAMES_IN_MEMORY)
    }

    fn cropdetect_on(&self, frames_in_memory: bool) -> bool {
        self.autocrop && !frames_in_memory
    }

    /// Which frames our detector reads, with autocrop on ([`crate::sampler`]).
    pub fn sampling(&self) -> Sampling {
        if FRAMES_IN_MEMORY {
            Sampling::EveryFrame
        } else if self.every_frame {
            Sampling::EveryFrameAndCropdetect
        } else {
            Sampling::AroundChanges
        }
    }

    /// Hardware decoding. cropdetect needs the decoded frames in memory, so
    /// while it runs they're copied back from the GPU. Screenshots for our
    /// detector are taken from the GPU and need no copy-back.
    pub fn hwdec_mode(&self) -> &'static str {
        self.hwdec_with(self.cropdetect())
    }

    fn hwdec_with(&self, cropdetect: bool) -> &'static str {
        match (self.hwdec, cropdetect) {
            (false, _) => "no",
            (true, false) => "auto-safe",
            (true, true) => "auto-copy-safe",
        }
    }

    /// (seconds ahead, max bytes) for the demuxer cache.
    pub fn cache(&self) -> (u32, &'static str) {
        self.cache_with(SMALL_MEMORY)
    }

    /// [`Tune::cache`] on a desktop, or on a phone or TV box, where Normal is the 64 MiB mpv starts
    /// with there (`IOS_ARGS`, src-tauri's Android arguments) and Large stays well inside a 2 GB box.
    fn cache_with(&self, small_memory: bool) -> (u32, &'static str) {
        match (self.buffer, small_memory) {
            (BufferSize::Small, false) => (30, "64MiB"),
            (BufferSize::Normal, false) => (90, "192MiB"),
            (BufferSize::Large, false) => (300, "768MiB"),
            (BufferSize::Small, true) => (30, "32MiB"),
            (BufferSize::Normal, true) => (90, "64MiB"),
            (BufferSize::Large, true) => (300, "128MiB"),
        }
    }

    /// [`Tune::hwdec_mode`] for mpv on Android, whose `auto-safe` list leaves MediaCodec out:
    /// MediaCodec straight to the screen, or copied back to memory when frames must be read.
    /// Android's own rule, whatever the host it's compiled on (cropdetect runs there).
    pub fn android_hwdec(&self) -> &'static str {
        match self.hwdec_with(self.cropdetect_on(false)) {
            "auto-safe" => "mediacodec,mediacodec-copy",
            "auto-copy-safe" => "mediacodec-copy",
            other => other,
        }
    }

    /// [`Tune::hwdec_mode`] for mpv on iPhones and iPads: VideoToolbox decodes, and its frames are
    /// copied back to memory, never handed to OpenGL ES as they are. Drawn straight from VideoToolbox
    /// the picture had green and purple patches on an iPhone, and was right once mpv had fallen back
    /// to decoding in software (#416). No cropdetect there, so autocrop changes nothing.
    pub fn ios_hwdec(&self) -> &'static str {
        if self.hwdec {
            "videotoolbox-copy"
        } else {
            "no"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tune_builds_fixed_filters() {
        let t = Tune {
            dialogue_boost: true,
            volume_leveling: true,
            hwdec: true,
            deband: false,
            buffer: BufferSize::Large,
            autocrop: false,
            lookahead: true,
            every_frame: false,
        };
        assert!(t.audio_filters().starts_with("lavfi=[pan=stereo") && t.audio_filters().contains("dynaudnorm"));
        let off = Tune { dialogue_boost: false, volume_leveling: false, ..t };
        assert_eq!(off.audio_filters(), "");
        assert_eq!(t.cache_with(false), (300, "768MiB"));
    }

    #[test]
    fn cache_stays_small_on_phones_and_tv_boxes() {
        let at = |buffer| Tune { buffer, ..Tune::default() }.cache_with(true);
        assert_eq!(at(BufferSize::Normal), (90, "64MiB"));
        assert_eq!(at(BufferSize::Small), (30, "32MiB"));
        assert_eq!(at(BufferSize::Large), (300, "128MiB"));
        // Normal is what mpv starts with there.
        assert!(IOS_ARGS.contains(&"--demuxer-max-bytes=64MiB"));
    }

    #[test]
    fn lookahead_is_on_unless_sent_off() {
        let page = r#"{"dialogueBoost":false,"volumeLeveling":false,"hwdec":true,"deband":false,"buffer":"normal","autocrop":true}"#;
        assert!(serde_json::from_str::<Tune>(page).unwrap().lookahead);
        let off = page.replace('}', r#","lookahead":false}"#);
        assert!(!serde_json::from_str::<Tune>(&off).unwrap().lookahead);
        assert!(!serde_json::from_str::<Tune>(page).unwrap().every_frame);
    }

    #[test]
    fn every_frame_keeps_cropdetect_and_its_copy_back() {
        let on = Tune { autocrop: true, ..Tune::default() };
        let every = Tune { every_frame: true, ..on };
        assert!(!Tune { autocrop: false, ..on }.cropdetect());
        if FRAMES_IN_MEMORY {
            for t in [on, every] {
                assert!(!t.cropdetect());
                assert_eq!(t.sampling(), Sampling::EveryFrame);
                assert_eq!(t.hwdec_mode(), "auto-safe");
            }
        } else {
            for t in [on, every] {
                assert!(t.cropdetect());
                assert_eq!(t.hwdec_mode(), "auto-copy-safe");
            }
            assert_eq!(on.sampling(), Sampling::AroundChanges);
            assert_eq!(every.sampling(), Sampling::EveryFrameAndCropdetect);
        }
    }

    #[test]
    fn frames_in_memory_never_run_cropdetect() {
        let on = Tune { autocrop: true, ..Tune::default() };
        assert!(!on.cropdetect_on(true));
        assert_eq!(on.hwdec_with(on.cropdetect_on(true)), "auto-safe");
        assert!(on.cropdetect_on(false));
    }

    #[test]
    fn android_uses_mediacodec() {
        let on = Tune::default();
        assert_eq!(on.android_hwdec(), "mediacodec,mediacodec-copy");
        assert_eq!(Tune { autocrop: true, ..on }.android_hwdec(), "mediacodec-copy");
        assert_eq!(Tune { autocrop: true, every_frame: true, ..on }.android_hwdec(), "mediacodec-copy");
        assert_eq!(Tune { hwdec: false, ..on }.android_hwdec(), "no");
    }

    #[test]
    fn ios_asks_videotoolbox_for_frames_its_gl_can_show() {
        // iOS's OpenGL ES can't map VideoToolbox's 10-bit frames: the picture was one blue colour (#172).
        assert!(IOS_ARGS.contains(&"--hwdec-image-format=nv12"));
        assert!(IOS_ARGS.contains(&"--ao=audiounit"));
    }

    #[test]
    fn ios_copies_videotoolbox_frames_back() {
        // Drawn straight from VideoToolbox the picture was tinted (#416); at launch as when the setting changes.
        let on = Tune::default();
        assert_eq!(on.ios_hwdec(), "videotoolbox-copy");
        assert!(IOS_ARGS.contains(&format!("--hwdec={}", on.ios_hwdec()).as_str()));
        assert_eq!(Tune { autocrop: true, ..on }.ios_hwdec(), "videotoolbox-copy");
        assert_eq!(Tune { hwdec: false, ..on }.ios_hwdec(), "no");
    }
}
