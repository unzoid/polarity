//! Device-level picture and sound options, as mpv settings.

use crate::sampler::Sampling;

/// Device-level picture and sound options (Settings → Subtitles & Audio and
/// → Advanced). Presets, not raw values: `af` takes lavfi graphs, which can
/// read files, so the page never gets to write it directly.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tune {
    /// Make speech clearer: surround tracks boost the centre channel on downmix;
    /// stereo (1–2 ch) tracks apply a clean vocal-presence EQ + limiter.
    pub dialogue_boost: bool,
    /// Even out loud and quiet scenes ("night mode").
    pub volume_leveling: bool,
    /// Dynamic range profile: Pure (bitstream/no DRC), Living Room, or Late Night.
    #[serde(default)]
    pub drc_profile: DrcProfile,
    /// Hardware decoding. Off is a troubleshooting switch for broken drivers.
    pub hwdec: bool,
    /// Smooth colour banding in gradients (dark scenes, anime skies): Off, Auto (CAMBI), or On.
    #[serde(default)]
    pub deband: DebandMode,
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
    /// Send Dolby and DTS audio to an AV receiver as it is (S/PDIF or HDMI
    /// passthrough). The receiver decodes it; mpv's volume and audio filters
    /// are bypassed automatically.
    #[serde(default)]
    pub passthrough: bool,
    /// How HDR video reaches the screen.
    #[serde(default)]
    pub hdr: HdrOutput,
    /// How bright subtitles are over HDR video shown in HDR.
    #[serde(default)]
    pub sub_hdr: SubtitleHdr,
    /// Match display refresh rate / cadence during full-screen playback (#515).
    #[serde(default)]
    pub frame_rate_match: FrameRateMatch,
    /// Channel count of the active audio track (0 = unknown/legacy surround assumption,
    /// 1–2 = mono/stereo, >2 = surround).
    #[serde(default)]
    pub audio_channels: u8,
    /// Whether playback is currently full-screen (frame-rate matching only runs in full-screen).
    #[serde(default)]
    pub fullscreen: bool,
}

/// Dynamic range compression profile: Pure preserves full cinema dynamics,
/// Living Room applies mild leveling only when volume leveling is on, and
/// Late Night engages full AC-3/E-AC-3 DRC plus anti-pumping loudness leveling.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DrcProfile {
    Pure,
    #[default]
    LivingRoom,
    LateNight,
}

/// Debanding mode. Accepts both legacy booleans (`false`/`true`) and strings (`"off"`/`"auto"`/`"on"`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum DebandMode {
    #[default]
    Off,
    Auto,
    On,
}

impl DebandMode {
    /// Initial mpv `deband` property value ("yes" or "no"). `Auto` starts at "no" and
    /// toggles dynamically when the CAMBI banding detector sees banding.
    pub fn mpv_deband(self) -> &'static str {
        match self {
            DebandMode::On => "yes",
            DebandMode::Off | DebandMode::Auto => "no",
        }
    }

    pub fn is_auto(self) -> bool {
        matches!(self, DebandMode::Auto)
    }
}

impl<'de> serde::Deserialize<'de> for DebandMode {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl serde::de::Visitor<'_> for Visitor {
            type Value = DebandMode;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a boolean or one of \"off\", \"auto\", \"on\"")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(if v { DebandMode::On } else { DebandMode::Off })
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                match v {
                    "off" => Ok(DebandMode::Off),
                    "auto" => Ok(DebandMode::Auto),
                    "on" => Ok(DebandMode::On),
                    other => Err(E::unknown_variant(other, &["off", "auto", "on"])),
                }
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

/// Display refresh rate / motion cadence matching during full-screen playback (#515).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrameRateMatch {
    #[default]
    Off,
    Seamless,
    Always,
}

/// Subtitle brightness over HDR video shown in HDR, where white text can be glaring: mpv's own choice, the
/// white of SDR video, or dimmer still.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubtitleHdr {
    #[default]
    Auto,
    Sdr,
    Dim,
}

impl SubtitleHdr {
    /// mpv's `sub-hdr-peak` for it: "auto", "sdr" (203 nits), or a peak in nits.
    pub fn peak(self) -> serde_json::Value {
        match self {
            SubtitleHdr::Auto => "auto".into(),
            SubtitleHdr::Sdr => "sdr".into(),
            SubtitleHdr::Dim => 100.into(),
        }
    }
}

/// How HDR video is shown: mpv's choice, as HDR on a screen that takes it,
/// or always tone-mapped to SDR (the picture looked washed out on a screen
/// whose HDR mode Windows had wrong).
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HdrOutput {
    #[default]
    Auto,
    Screen,
    Sdr,
}

impl HdrOutput {
    /// mpv's `target-colorspace-hint` for it.
    pub fn colorspace_hint(self) -> &'static str {
        match self {
            HdrOutput::Auto => "auto",
            HdrOutput::Screen => "yes",
            HdrOutput::Sdr => "no",
        }
    }

    /// Dynamic HDR→SDR tone-mapping properties when tone-mapping to SDR (Netflix dynamic metadata
    /// / per-frame peak tracking), or mpv defaults when passing HDR through.
    pub fn tone_mapping_props(self) -> &'static [(&'static str, &'static str)] {
        match self {
            HdrOutput::Sdr => &[("hdr-compute-peak", "auto"), ("tone-mapping", "spline")],
            HdrOutput::Auto | HdrOutput::Screen => &[("hdr-compute-peak", "no"), ("tone-mapping", "auto")],
        }
    }
}

/// The formats passthrough hands to the receiver undecoded (`audio-spdif`).
pub const PASSTHROUGH_CODECS: &str = "ac3,eac3,dts,dts-hd,truehd";

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
            drc_profile: DrcProfile::LivingRoom,
            hwdec: true,
            deband: DebandMode::Off,
            buffer: BufferSize::Normal,
            autocrop: false,
            lookahead: true,
            every_frame: false,
            passthrough: false,
            hdr: HdrOutput::Auto,
            sub_hdr: SubtitleHdr::Auto,
            frame_rate_match: FrameRateMatch::Off,
            audio_channels: 0,
            fullscreen: false,
        }
    }
}

impl Tune {
    /// mpv's `audio-spdif`: the formats sent to the receiver as they are, or none.
    pub fn spdif(&self) -> &'static str {
        if self.passthrough {
            PASSTHROUGH_CODECS
        } else {
            ""
        }
    }

    /// Native AC-3/E-AC-3 decoder DRC (`ad-lavc-o`), or empty when passthrough is active.
    pub fn drc_scale(&self) -> &'static str {
        if self.passthrough {
            return "";
        }
        match self.drc_profile {
            DrcProfile::Pure => "drc_scale=0",
            DrcProfile::LivingRoom => {
                if self.volume_leveling {
                    "drc_scale=0.5"
                } else {
                    "drc_scale=0"
                }
            }
            DrcProfile::LateNight => "drc_scale=1",
        }
    }

    /// Audio filter chain (`af`). Bypassed automatically when `passthrough` is on so
    /// encoded bitstreams reach the receiver untouched.
    pub fn audio_filters(&self) -> String {
        if self.passthrough {
            return String::new();
        }
        let mut chain: Vec<&str> = Vec::new();
        if self.dialogue_boost {
            if matches!(self.audio_channels, 1 | 2) {
                // Stereo / mono vocal-presence boost: roll off low rumble, lift 2.5 kHz speech band, soft-limit peaks.
                chain.push("lavfi=[highpass=f=100,equalizer=f=2500:t=q:w=1.2:g=4,alimiter=limit=0.95]");
            } else {
                // Surround downmix: centre (dialogue) at full level, rest attenuated.
                chain.push("lavfi=[pan=stereo|FL<FC+0.30*FL+0.30*BL+0.30*SL|FR<FC+0.30*FR+0.30*BR+0.30*SR]");
            }
        }
        let apply_drc = match self.drc_profile {
            DrcProfile::Pure => false,
            DrcProfile::LivingRoom => self.volume_leveling,
            DrcProfile::LateNight => true,
        };
        if apply_drc {
            // Anti-pumping loudness normalization: wider frame/Gaussian window, bounded max gain, coupled channels.
            chain.push("lavfi=[dynaudnorm=f=250:g=31:p=0.85:m=4:r=0.5:b=1]");
        }
        chain.join(",")
    }

    /// Desktop frame-rate / display-cadence properties (#515). Strictly active only during
    /// full-screen playback when passthrough is off (resampling audio breaks bitstream passthrough).
    pub fn frame_rate_props(&self) -> &'static [(&'static str, &'static str)] {
        if self.fullscreen && !self.passthrough && self.frame_rate_match != FrameRateMatch::Off {
            &[("video-sync", "display-resample"), ("interpolation", "yes"), ("tscale", "oversample")]
        } else {
            &[("video-sync", "audio"), ("interpolation", "no")]
        }
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
            deband: DebandMode::Off,
            buffer: BufferSize::Large,
            ..Tune::default()
        };
        assert!(
            t.audio_filters().starts_with("lavfi=[pan=stereo") && t.audio_filters().contains("dynaudnorm=f=250:g=31")
        );
        let off = Tune { dialogue_boost: false, volume_leveling: false, ..t };
        assert_eq!(off.audio_filters(), "");
        assert_eq!(t.cache_with(false), (300, "768MiB"));
    }

    #[test]
    fn stereo_dialogue_boost_and_passthrough_and_drc_profiles() {
        // Stereo track gets vocal-presence EQ + limiter instead of surround pan.
        let stereo = Tune { dialogue_boost: true, audio_channels: 2, ..Tune::default() };
        assert!(stereo.audio_filters().contains("equalizer=f=2500"));
        assert!(stereo.audio_filters().contains("alimiter"));
        assert!(!stereo.audio_filters().contains("pan=stereo"));

        // Surround track keeps center-boost pan.
        let surround = Tune { dialogue_boost: true, audio_channels: 6, ..Tune::default() };
        assert!(surround.audio_filters().starts_with("lavfi=[pan=stereo"));

        // Passthrough bypasses all software audio filters and DRC scale.
        let pt = Tune {
            dialogue_boost: true,
            volume_leveling: true,
            drc_profile: DrcProfile::LateNight,
            passthrough: true,
            ..Tune::default()
        };
        assert_eq!(pt.audio_filters(), "");
        assert_eq!(pt.drc_scale(), "");

        // DRC profiles: Pure bypasses dynaudnorm; LateNight engages full DRC + leveling.
        let pure = Tune { volume_leveling: true, drc_profile: DrcProfile::Pure, ..Tune::default() };
        assert_eq!(pure.audio_filters(), "");
        assert_eq!(pure.drc_scale(), "drc_scale=0");

        let night = Tune { drc_profile: DrcProfile::LateNight, ..Tune::default() };
        assert!(night.audio_filters().contains("dynaudnorm=f=250:g=31:p=0.85:m=4:r=0.5:b=1"));
        assert_eq!(night.drc_scale(), "drc_scale=1");
    }

    #[test]
    fn deband_mode_accepts_bool_and_strings() {
        let base = r#"{"dialogueBoost":false,"volumeLeveling":false,"hwdec":true,"buffer":"normal"}"#;
        let t_false = serde_json::from_str::<Tune>(&base.replace('}', r#","deband":false}"#)).unwrap();
        let t_true = serde_json::from_str::<Tune>(&base.replace('}', r#","deband":true}"#)).unwrap();
        let t_auto = serde_json::from_str::<Tune>(&base.replace('}', r#","deband":"auto"}"#)).unwrap();
        let t_on = serde_json::from_str::<Tune>(&base.replace('}', r#","deband":"on"}"#)).unwrap();
        assert_eq!(
            (t_false.deband, t_true.deband, t_auto.deband, t_on.deband),
            (DebandMode::Off, DebandMode::On, DebandMode::Auto, DebandMode::On)
        );
        assert_eq!(t_auto.deband.mpv_deband(), "no");
        assert_eq!(t_on.deband.mpv_deband(), "yes");
        assert!(t_auto.deband.is_auto());
    }

    #[test]
    fn hdr_tone_mapping_and_frame_rate_match_are_gated() {
        assert_eq!(HdrOutput::Sdr.tone_mapping_props(), &[("hdr-compute-peak", "auto"), ("tone-mapping", "spline")]);
        assert_eq!(HdrOutput::Auto.tone_mapping_props(), &[("hdr-compute-peak", "no"), ("tone-mapping", "auto")]);

        // Windowed or passthrough: never enable display-resample.
        let windowed = Tune { frame_rate_match: FrameRateMatch::Seamless, fullscreen: false, ..Tune::default() };
        assert_eq!(windowed.frame_rate_props(), &[("video-sync", "audio"), ("interpolation", "no")]);
        let pt_fs =
            Tune { frame_rate_match: FrameRateMatch::Always, fullscreen: true, passthrough: true, ..Tune::default() };
        assert_eq!(pt_fs.frame_rate_props(), &[("video-sync", "audio"), ("interpolation", "no")]);
        let fs = Tune { frame_rate_match: FrameRateMatch::Seamless, fullscreen: true, ..Tune::default() };
        assert_eq!(
            fs.frame_rate_props(),
            &[("video-sync", "display-resample"), ("interpolation", "yes"), ("tscale", "oversample")]
        );
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
    fn passthrough_and_hdr_are_presets() {
        // An older page sends neither: off, and mpv's own HDR choice.
        let page = r#"{"dialogueBoost":false,"volumeLeveling":false,"hwdec":true,"deband":false,"buffer":"normal"}"#;
        let t = serde_json::from_str::<Tune>(page).unwrap();
        assert_eq!((t.spdif(), t.hdr), ("", HdrOutput::Auto));
        let on = serde_json::from_str::<Tune>(&page.replace('}', r#","passthrough":true,"hdr":"sdr"}"#)).unwrap();
        assert_eq!(on.spdif(), PASSTHROUGH_CODECS);
        assert_eq!(on.hdr.colorspace_hint(), "no");
        assert_eq!(HdrOutput::Screen.colorspace_hint(), "yes");
        // Anything else is refused, never handed to mpv.
        assert!(serde_json::from_str::<Tune>(&page.replace('}', r#","hdr":"--script=x"}"#)).is_err());
    }

    #[test]
    fn subtitle_brightness_over_hdr_is_a_preset() {
        let page = r#"{"dialogueBoost":false,"volumeLeveling":false,"hwdec":true,"deband":false,"buffer":"normal"}"#;
        assert_eq!(serde_json::from_str::<Tune>(page).unwrap().sub_hdr.peak(), "auto");
        let dim = serde_json::from_str::<Tune>(&page.replace('}', r#","subHdr":"dim"}"#)).unwrap();
        assert_eq!(dim.sub_hdr.peak(), 100);
        assert_eq!(SubtitleHdr::Sdr.peak(), "sdr");
        assert!(serde_json::from_str::<Tune>(&page.replace('}', r#","subHdr":5000}"#)).is_err());
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
