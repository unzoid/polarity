//! Which reading of each frame goes to [`CropTracker`](crate::crop::CropTracker)
//! on the desktop, where our detector ([`crate::bars`]) needs a screenshot
//! of the frame and cropdetect reads every frame inside mpv
//! (docs/autocrop.md §2, "Our detector on the desktop").
//!
//! * [`Sampling::AroundChanges`] (Windows and Linux, the default):
//!   cropdetect's reading feeds each frame, and when it changes a
//!   screenshot is taken for our detector, then more while the bars keep
//!   moving or the tracker follows them, until our readings hold still.
//!   After the changed frame (cropdetect's, so a cut it shows lands on it)
//!   only our readings feed the tracker, so its crisp edges and follow
//!   mode work as on every frame.
//! * [`Sampling::EveryFrameAndCropdetect`] (Windows and Linux, the opt-in
//!   setting): a screenshot of each frame, one at a time, and cropdetect
//!   still reading each frame.
//! * [`Sampling::EveryFrame`] (macOS and iOS, where libmpv hands frames
//!   over in memory): a screenshot of each frame, one at a time, and no
//!   cropdetect.
//!
//! A screenshot is of the frame on screen and arrives a frame or two after
//! it was asked for, so a change it finds lands that much after its cut.
//! While the tracker follows bars the film animates, [`Sampler::lead`] says
//! where they stand on the frame the zoom lands on: cropdetect's reading of
//! it, where cropdetect runs; on macOS and iOS, the screenshots' movement
//! carried on to it ([`Sampler::predict`]).

use crate::bars::Measured;
use crate::crop::Rect;

/// How the desktop engine reads the bars.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sampling {
    AroundChanges,
    EveryFrameAndCropdetect,
    EveryFrame,
}

/// What to hand the tracker for this frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Feed {
    /// cropdetect's reading ([`CropTracker::update`](crate::crop::CropTracker::update)).
    Cropdetect(Option<Rect>),
    /// Our detector's ([`CropTracker::update_measured`](crate::crop::CropTracker::update_measured)).
    Measured(Option<Measured>),
    /// Nothing: a screenshot is on its way.
    Wait,
}

/// Our readings in a row that must agree, with the tracker not following,
/// before [`Sampling::AroundChanges`] goes back to cropdetect.
pub const STILL_SHOTS: usize = 3;
/// Frames without a screenshot after which [`Sampling::AroundChanges`] gives
/// up on it and goes back to cropdetect (a screenshot failed or is slow).
pub const SHOT_WAIT_FRAMES: usize = 12;
/// Edges within this many pixels count as the same.
const SLACK: i64 = 4;
/// The longest time between two screenshots whose movement
/// [`Sampler::predict`] carries on, and the furthest it carries it, in seconds.
const PREDICT_SPAN: f64 = 0.25;

#[derive(Debug, Clone)]
pub struct Sampler {
    sampling: Sampling,
    /// Taking screenshots now ([`Sampling::AroundChanges`]).
    active: bool,
    /// cropdetect's reading of the frame before.
    last_reading: Option<Rect>,
    /// A screenshot's reading not yet fed (`Some(None)`: a black frame).
    pending: Option<Option<Measured>>,
    /// The last reading of ours fed, and how many in a row agreed with it.
    last_measured: Option<Option<Rect>>,
    still: usize,
    /// Frames since the last screenshot's reading came.
    waited: usize,
    /// The last two screenshots with bars, by the pts of their frame, oldest
    /// first ([`Sampler::predict`]).
    timed: [Option<(f64, Rect)>; 2],
}

impl Sampler {
    pub fn new(sampling: Sampling) -> Self {
        Sampler {
            sampling,
            active: false,
            last_reading: None,
            pending: None,
            last_measured: None,
            still: 0,
            waited: 0,
            timed: [None; 2],
        }
    }

    pub fn sampling(&self) -> Sampling {
        self.sampling
    }

    /// Whether a screenshot should be on its way now (the engine keeps one
    /// at a time).
    pub fn wants_shot(&self) -> bool {
        self.sampling != Sampling::AroundChanges || self.active
    }

    /// A screenshot's reading came (`None`: a black frame), of the frame
    /// with `pts` when that's known.
    pub fn measured(&mut self, pts: Option<f64>, measured: Option<Measured>) {
        self.pending = Some(measured);
        match (pts, measured) {
            (Some(pts), Some(m)) => self.timed = [self.timed[1], Some((pts, m.rect))],
            _ => self.timed = [None; 2],
        }
    }

    /// While the tracker follows animated bars: where they stand on the
    /// frame the zoom lands on, the next one at `next`. Where cropdetect
    /// runs, its reading of that frame (`live`); with screenshots only,
    /// [`Sampler::predict`].
    pub fn lead(&self, live: Option<Rect>, next: f64) -> Option<Rect> {
        match self.sampling {
            Sampling::EveryFrame => self.predict(next),
            _ => live,
        }
    }

    /// The last two screenshots' movement carried on to the frame at `next`,
    /// for edges moving outwards (the picture growing): a few pixels of bar
    /// shown if the move stops there. Edges moving inwards stay where the
    /// last screenshot saw them, rather than cut into the picture if the
    /// move stops: they show a few pixels of bar while they move.
    pub fn predict(&self, next: f64) -> Option<Rect> {
        let [Some((p0, a)), Some((p1, b))] = self.timed else { return None };
        let span = p1 - p0;
        let ahead = next - p1;
        if span <= f64::EPSILON || span > PREDICT_SPAN || !(0.0..=PREDICT_SPAN).contains(&ahead) {
            return None;
        }
        // Edges as [top, bottom, left, right], and the way each moves outwards.
        let edges = |r: Rect| [r.y, r.y + r.h, r.x, r.x + r.w];
        let out = [-1, 1, -1, 1];
        let (from, to) = (edges(a), edges(b));
        let mut at = to;
        for i in 0..4 {
            let step = (to[i] - from[i]) as f64 / span * ahead;
            if step * out[i] as f64 > 0.0 {
                at[i] = to[i] + step.round() as i64;
            }
        }
        let [top, bottom, left, right] = at;
        Some(Rect { x: left.max(0), y: top.max(0), w: right - left.max(0), h: bottom - top.max(0) })
    }

    /// Start afresh (a new file, a seek): the readings before say nothing.
    pub fn reset(&mut self) {
        *self = Sampler::new(self.sampling);
    }

    /// One displayed frame: cropdetect's reading of it (none with
    /// [`Sampling::EveryFrame`]) and whether the tracker follows animated
    /// bars. Says what the tracker gets.
    pub fn frame(&mut self, reading: Option<Rect>, following: bool) -> Feed {
        let changed = !same_rect(self.last_reading, reading);
        self.last_reading = reading;
        if let Some(m) = self.pending.take() {
            self.waited = 0;
            let rect = m.map(|m| m.rect);
            let agrees = self.last_measured.is_some_and(|last| same_rect(last, rect));
            self.still = if agrees && !following { self.still + 1 } else { 0 };
            self.last_measured = Some(rect);
            if self.sampling == Sampling::AroundChanges && self.still + 1 >= STILL_SHOTS {
                self.stop();
            }
            return Feed::Measured(m);
        }
        match self.sampling {
            Sampling::EveryFrame | Sampling::EveryFrameAndCropdetect => Feed::Wait,
            Sampling::AroundChanges if self.active => {
                self.waited += 1;
                if self.waited < SHOT_WAIT_FRAMES {
                    return Feed::Wait;
                }
                self.stop();
                Feed::Cropdetect(reading)
            }
            Sampling::AroundChanges if changed => {
                // cropdetect's reading is of this very frame, so a cut it
                // shows (picture back in a bar) lands here; ours of the
                // next frames, which come late, decide the rest.
                self.active = true;
                Feed::Cropdetect(reading)
            }
            Sampling::AroundChanges => Feed::Cropdetect(reading),
        }
    }

    fn stop(&mut self) {
        (self.active, self.last_measured, self.still, self.waited) = (false, None, 0, 0);
    }
}

fn same_rect(a: Option<Rect>, b: Option<Rect>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => {
            (a.x - b.x).abs() <= SLACK
                && (a.y - b.y).abs() <= SLACK
                && (a.x + a.w - b.x - b.w).abs() <= SLACK
                && (a.y + a.h - b.y - b.h).abs() <= SLACK
        }
        (None, None) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(bars: i64) -> Rect {
        Rect { w: 1920, h: 1080 - 2 * bars, x: 0, y: bars }
    }

    fn ours(bars: i64) -> Measured {
        Measured { rect: rect(bars), crisp: [true, true, false, false] }
    }

    /// A sampler past a file's first frame (a change from no reading, so
    /// read by our detector too) and back on cropdetect.
    fn settled() -> Sampler {
        let mut s = Sampler::new(Sampling::AroundChanges);
        assert_eq!(s.frame(Some(rect(0)), false), Feed::Cropdetect(Some(rect(0))));
        for _ in 0..STILL_SHOTS {
            s.measured(None, Some(ours(0)));
            assert_eq!(s.frame(Some(rect(0)), false), Feed::Measured(Some(ours(0))));
        }
        assert!(!s.wants_shot());
        s
    }

    #[test]
    fn cropdetect_feeds_until_its_reading_changes() {
        let mut s = settled();
        assert_eq!(s.frame(Some(rect(0)), false), Feed::Cropdetect(Some(rect(0))));
        assert!(!s.wants_shot());
        // Within the slack: no change.
        assert_eq!(s.frame(Some(rect(2)), false), Feed::Cropdetect(Some(rect(2))));
        assert!(!s.wants_shot());
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Cropdetect(Some(rect(140))), "the changed frame itself");
        assert!(s.wants_shot());
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait, "then ours");
    }

    #[test]
    fn our_readings_feed_until_they_hold_still() {
        let mut s = settled();
        s.frame(Some(rect(140)), false);
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait);
        s.measured(None, Some(ours(138)));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Measured(Some(ours(138))));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait, "cropdetect waits while ours are taken");
        s.measured(None, Some(ours(138)));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Measured(Some(ours(138))));
        assert!(s.wants_shot());
        s.measured(None, Some(ours(138)));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Measured(Some(ours(138))));
        assert!(!s.wants_shot(), "{STILL_SHOTS} agreeing readings: back to cropdetect");
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Cropdetect(Some(rect(140))));
    }

    #[test]
    fn moving_or_followed_bars_keep_the_screenshots_coming() {
        let mut s = settled();
        s.frame(Some(rect(100)), false);
        for (i, bars) in [100, 104, 110, 116, 122, 128].into_iter().enumerate() {
            s.measured(None, Some(ours(bars)));
            assert_eq!(s.frame(Some(rect(bars)), false), Feed::Measured(Some(ours(bars))));
            assert!(s.wants_shot(), "moving, reading {i}");
        }
        for _ in 0..5 {
            s.measured(None, Some(ours(128)));
            s.frame(Some(rect(128)), true);
            assert!(s.wants_shot(), "the tracker still follows");
        }
    }

    #[test]
    fn a_screenshot_that_never_comes_gives_way_to_cropdetect() {
        let mut s = settled();
        s.frame(Some(rect(140)), false);
        for _ in 1..SHOT_WAIT_FRAMES {
            assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait);
        }
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Cropdetect(Some(rect(140))));
        assert!(!s.wants_shot());
    }

    #[test]
    fn every_frame_feeds_only_our_readings() {
        let mut s = Sampler::new(Sampling::EveryFrame);
        assert!(s.wants_shot());
        assert_eq!(s.frame(None, false), Feed::Wait);
        s.measured(None, None);
        assert_eq!(s.frame(None, false), Feed::Measured(None), "a black frame");
        for _ in 0..10 {
            s.measured(None, Some(ours(140)));
            assert_eq!(s.frame(None, false), Feed::Measured(Some(ours(140))));
            assert!(s.wants_shot());
        }
        assert_eq!(s.frame(None, false), Feed::Wait);
    }

    #[test]
    fn predict_carries_opening_edges_on_and_holds_closing_ones() {
        const F: f64 = 1.0 / 24.0;
        let mut s = Sampler::new(Sampling::EveryFrame);
        s.measured(Some(0.0), Some(ours(100)));
        assert_eq!(s.predict(3.0 * F), None, "one reading has no movement");
        s.measured(Some(F), Some(ours(96)));
        // Opening by 4 px a frame: 3 frames on, 12 px thinner, both sides.
        assert_eq!(s.predict(4.0 * F), Some(rect(84)));
        // Closing: held where the last screenshot saw them.
        s.measured(Some(2.0 * F), Some(ours(100)));
        assert_eq!(s.predict(5.0 * F), Some(rect(100)));
        // Opening at the top only, closing at the bottom.
        s.measured(Some(3.0 * F), Some(Measured { rect: Rect { y: 90, h: 1080 - 200, ..rect(0) }, crisp: [true; 4] }));
        assert_eq!(s.predict(4.0 * F), Some(Rect { y: 80, h: 1080 - 190, ..rect(0) }));
        // Never past the frame's edge.
        let mut s = Sampler::new(Sampling::EveryFrame);
        s.measured(Some(0.0), Some(ours(8)));
        s.measured(Some(F), Some(ours(4)));
        assert_eq!(s.predict(4.0 * F).map(|r| (r.y, r.x)), Some((0, 0)));
    }

    #[test]
    fn predict_needs_two_timed_readings_close_together() {
        const F: f64 = 1.0 / 24.0;
        let mut s = Sampler::new(Sampling::EveryFrame);
        s.measured(Some(0.0), Some(ours(100)));
        s.measured(None, Some(ours(96)));
        s.measured(Some(2.0 * F), Some(ours(92)));
        assert_eq!(s.predict(3.0 * F), None, "a reading without its pts breaks the pair");
        s.measured(Some(3.0 * F), Some(ours(88)));
        s.measured(Some(4.0 * F), None);
        s.measured(Some(5.0 * F), Some(ours(80)));
        assert_eq!(s.predict(6.0 * F), None, "so does a black frame");
        s.measured(Some(5.0 * F + PREDICT_SPAN + F), Some(ours(60)));
        assert_eq!(s.predict(7.0 * F + PREDICT_SPAN), None, "too far apart");
        s.measured(Some(8.0 * F + PREDICT_SPAN), Some(ours(56)));
        assert_eq!(s.predict(9.0 * F + 2.0 * PREDICT_SPAN), None, "too far ahead");
        s.reset();
        assert_eq!(s.predict(0.0), None);
    }

    #[test]
    fn lead_is_cropdetects_reading_where_it_runs() {
        const F: f64 = 1.0 / 24.0;
        for sampling in [Sampling::AroundChanges, Sampling::EveryFrameAndCropdetect] {
            let mut s = Sampler::new(sampling);
            s.measured(Some(0.0), Some(ours(100)));
            s.measured(Some(F), Some(ours(96)));
            assert_eq!(s.lead(Some(rect(90)), 2.0 * F), Some(rect(90)));
            assert_eq!(s.lead(None, 2.0 * F), None);
        }
        let mut s = Sampler::new(Sampling::EveryFrame);
        s.measured(Some(0.0), Some(ours(100)));
        s.measured(Some(F), Some(ours(96)));
        assert_eq!(s.lead(None, 2.0 * F), Some(rect(92)));
        assert!(s.wants_shot() && Sampler::new(Sampling::EveryFrameAndCropdetect).wants_shot());
    }

    #[test]
    fn reset_forgets_the_readings_before() {
        let mut s = settled();
        s.frame(Some(rect(140)), false);
        s.measured(None, Some(ours(140)));
        s.reset();
        assert!(!s.wants_shot());
        assert_eq!(
            s.frame(Some(rect(140)), false),
            Feed::Cropdetect(Some(rect(140))),
            "the first reading after a reset is a change from none"
        );
        assert_eq!(s.sampling(), Sampling::AroundChanges);
    }
}
