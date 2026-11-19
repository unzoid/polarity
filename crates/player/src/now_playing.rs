//! What the system's Now Playing controls are told while a video plays (#461).
//!
//! iOS's lock screen and Android's media notification count the time on
//! themselves from a position, the moment it was read and a rate; they only
//! need hearing again when that count would go wrong: play or pause, a
//! speed or length change, the end, or a jump (a seek, a stall while
//! loading). [`Tracker`] follows mpv's observed properties and says when.

use serde::Serialize;
use serde_json::Value;

/// A count off by more than this (seconds) is told again: a seek, or a stall.
const JUMP_PLAYING: f64 = 1.5;
/// Paused, the position only moves by seeking.
const JUMP_PAUSED: f64 = 0.5;

/// Where playback is, as the system shows it.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Playback {
    pub playing: bool,
    /// Seconds.
    pub position: f64,
    /// Seconds; 0 while unknown (a live stream, before the file opens).
    pub duration: f64,
    /// The speed while playing, 0 while paused.
    pub rate: f64,
}

/// mpv's playback properties as they last changed, and what the system was told last.
#[derive(Debug)]
pub struct Tracker {
    paused: bool,
    ended: bool,
    seeking: bool,
    position: f64,
    duration: f64,
    speed: f64,
    /// What was told, and when (seconds, any clock that only goes forward).
    told: Option<(Playback, f64)>,
}

impl Default for Tracker {
    fn default() -> Self {
        Tracker::new()
    }
}

impl Tracker {
    /// Nothing known yet: a fresh mpv.
    pub const fn new() -> Self {
        Tracker { paused: false, ended: false, seeking: false, position: 0.0, duration: 0.0, speed: 1.0, told: None }
    }

    /// Playback as it is now.
    pub fn current(&self) -> Playback {
        let playing = !self.paused && !self.ended;
        Playback {
            playing,
            position: self.position,
            duration: self.duration,
            rate: if playing { self.speed } else { 0.0 },
        }
    }

    /// `name` changed to `data` at `now`: `Some` when the system should be told.
    pub fn observe(&mut self, name: &str, data: &Value, now: f64) -> Option<Playback> {
        match name {
            "pause" => self.paused = data.as_bool()?,
            "eof-reached" => self.ended = data.as_bool().unwrap_or(false),
            "seeking" => self.seeking = data.as_bool().unwrap_or(false),
            "duration" => self.duration = data.as_f64().filter(|d| d.is_finite() && *d > 0.0).unwrap_or(0.0),
            "speed" => self.speed = data.as_f64().filter(|s| s.is_finite() && *s > 0.0)?,
            // Null between files: the next file's first time follows.
            "time-pos" => self.position = data.as_f64().filter(|t| t.is_finite())?.max(0.0),
            _ => return None,
        }
        self.due(now)
    }

    /// Whether what the system counts has drifted from now: `Some` (and noted as told) when it has.
    fn due(&mut self, now: f64) -> Option<Playback> {
        let next = self.current();
        let stale = match self.told {
            None => true,
            Some((told, at)) => {
                let counted = told.position + (now - at).max(0.0) * told.rate;
                let off = (self.position - counted).abs();
                let jump = if next.playing { JUMP_PLAYING } else { JUMP_PAUSED };
                told.playing != next.playing
                    || told.rate != next.rate
                    || told.duration != next.duration
                    // Mid-seek the position is still the old one: the landing tells.
                    || (!self.seeking && off > jump)
            }
        };
        stale.then(|| {
            self.told = Some((next, now));
            next
        })
    }

    /// Tell the system everything again next time (it was shown afresh).
    pub fn forget(&mut self) {
        self.told = None;
    }

    /// mpv stopped: start over.
    pub fn reset(&mut self) {
        *self = Tracker::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn playing(t: &mut Tracker) {
        t.observe("pause", &json!(false), 0.0);
        t.observe("duration", &json!(1200.0), 0.0);
        t.observe("time-pos", &json!(10.0), 0.0);
    }

    #[test]
    fn the_first_change_is_told() {
        let mut t = Tracker::default();
        let told = t.observe("pause", &json!(false), 0.0).unwrap();
        assert!(told.playing);
        assert_eq!(told.rate, 1.0);
    }

    #[test]
    fn time_going_on_as_counted_is_not_told() {
        let mut t = Tracker::default();
        playing(&mut t);
        for i in 0..20 {
            assert_eq!(t.observe("time-pos", &json!(11.0 + i as f64 * 0.25), i as f64 * 0.25), None);
        }
    }

    #[test]
    fn pause_play_and_speed_are_told() {
        let mut t = Tracker::default();
        playing(&mut t);
        t.observe("time-pos", &json!(10.0), 0.0);
        let paused = t.observe("pause", &json!(true), 1.0).unwrap();
        assert!(!paused.playing);
        assert_eq!(paused.rate, 0.0);
        assert!(t.observe("pause", &json!(false), 5.0).unwrap().playing);
        assert_eq!(t.observe("speed", &json!(1.5), 6.0).unwrap().rate, 1.5);
        assert_eq!(t.observe("speed", &json!(1.5), 7.0), None);
    }

    #[test]
    fn a_seek_is_told_where_it_lands() {
        let mut t = Tracker::default();
        playing(&mut t);
        t.observe("time-pos", &json!(10.0), 0.0);
        assert_eq!(t.observe("seeking", &json!(true), 1.0), None);
        assert_eq!(t.observe("time-pos", &json!(600.0), 1.1), None);
        let landed = t.observe("seeking", &json!(false), 1.2).unwrap();
        assert_eq!(landed.position, 600.0);
    }

    #[test]
    fn a_stall_while_loading_is_told_once_it_falls_behind() {
        let mut t = Tracker::default();
        playing(&mut t);
        t.observe("time-pos", &json!(10.0), 0.0);
        // Ten seconds on the clock, the picture stuck at 11 s.
        assert_eq!(t.observe("time-pos", &json!(11.0), 1.0), None);
        assert_eq!(t.observe("time-pos", &json!(11.0), 2.0), None);
        assert_eq!(t.observe("time-pos", &json!(11.0), 3.0).unwrap().position, 11.0);
    }

    #[test]
    fn a_seek_while_paused_is_told() {
        let mut t = Tracker::default();
        playing(&mut t);
        t.observe("pause", &json!(true), 1.0);
        t.observe("time-pos", &json!(10.0), 1.0);
        assert_eq!(t.observe("time-pos", &json!(10.2), 2.0), None);
        assert_eq!(t.observe("time-pos", &json!(40.0), 3.0).unwrap().position, 40.0);
    }

    #[test]
    fn the_end_stops_the_count() {
        let mut t = Tracker::default();
        playing(&mut t);
        let end = t.observe("eof-reached", &json!(true), 2.0).unwrap();
        assert!(!end.playing);
    }

    #[test]
    fn nonsense_values_change_nothing() {
        let mut t = Tracker::default();
        playing(&mut t);
        let before = t.current();
        assert_eq!(t.observe("time-pos", &Value::Null, 1.0), None);
        assert_eq!(t.observe("speed", &json!(0), 1.0), None);
        assert_eq!(t.observe("pause", &Value::Null, 1.0), None);
        assert_eq!(t.observe("volume", &json!(50), 1.0), None);
        assert_eq!(t.current(), before);
        // An unknown length is 0.
        assert_eq!(t.observe("duration", &Value::Null, 1.0).unwrap().duration, 0.0);
    }

    #[test]
    fn forget_tells_again() {
        let mut t = Tracker::default();
        playing(&mut t);
        t.forget();
        assert!(t.observe("time-pos", &json!(10.1), 0.1).is_some());
        t.reset();
        assert_eq!(t.current().position, 0.0);
    }
}
