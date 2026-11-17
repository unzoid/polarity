//! Google Cast from the desktop app (#443): find the receivers on the network, play a link on one with
//! Google's Default Media Receiver (nothing to install on the TV), and control it.
//!
//!   * [`discovery`]: receivers by mDNS.
//!   * [`frame`]: the length-prefixed `CastMessage` protobuf, written by hand (no build step).
//!   * [`messages`]: the JSON on the connection, heartbeat, receiver and media channels.
//!   * [`session`]: one cast, from launching the receiver app to stopping it.
//!
//! The TV fetches the link itself, so only links it can reach play: http(s) on the web, needing no
//! request headers (src-tauri's cast.rs checks before a cast starts).

pub mod discovery;
pub mod frame;
pub mod messages;
pub mod session;

pub use discovery::Device;
pub use messages::Load;
pub use session::{Command, Event, PlayState, Session, Status};
