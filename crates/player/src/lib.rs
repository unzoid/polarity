//! The player's rules, kept apart from the engines that play (mpv in
//! src-tauri's `player/`, the webview's `<video>`) so they build and are
//! tested on every platform:
//!
//!   * [`allow`]: the only mpv commands and properties the webview may use.
//!   * [`tune`]: device-level picture and sound options as mpv settings.
//!   * [`crop`]: which black bars to remove and the zoom that removes them.
//!   * [`bars`]: our own per-frame bar detector, for builds without `cropdetect`.
//!   * [`lookahead`]: bar changes read ahead of the playhead, due on their cut, and the bars of each frame by pts.
//!   * [`png`]: the uncompressed PNG screenshots autocrop's pre-roll probe reads.
//!   * [`frames`]: which bars the frame on screen gets: playing on, after a seek, stepping either way.
//!   * [`sampler`]: which frames our detector reads on the desktop, and which reading feeds the tracker.
//!   * [`headers`]: which of an add-on's request headers playback sends.
//!   * [`certs`]: one certificate bundle from a folder of certificates (Android's mpv).
//!   * [`turns`]: which player's load and stop count at the one mpv.
//!   * [`video_path`]: one log line on how mpv decodes and draws the video (#416).
//!   * [`shots`]: the file names of screenshots the viewer saves.

pub mod allow;
pub mod bars;
pub mod certs;
pub mod crop;
pub mod frames;
pub mod headers;
pub mod lookahead;
pub mod png;
pub mod sampler;
pub mod shots;
pub mod tune;
pub mod turns;
pub mod video_path;
