//! Which bars each frame on screen gets (docs/autocrop.md §4, "The frame on
//! screen"): the desktop engine hands every new `time-pos` to [`Frames`],
//! which tells playing on from a jump (a seek, a frame step either way, the
//! first frame after a pause) and feeds [`CropTracker`] accordingly.
//!
//! * Playing on: the readings and the lookahead's changes are of the next
//!   frame, as mpv filters a frame ahead of the screen, so the zoom sent now
//!   lands with it ([`Sampler`] and [`Schedule::take`] as before).
//! * A jump: the readings before say nothing about the frame now. Paused
//!   (a step), the frame on screen is the one the zoom lands on; playing
//!   (a seek), the next. Its bars come from the lookahead's [`Timeline`]
//!   when it read them ([`CropTracker::show`]); paused, a screenshot of the
//!   frame on screen checks them, or decides them where nothing was read
//!   ([`CropTracker::still`]). Playing with the lookahead on and nothing
//!   read for that frame, playback is held (paused) until its screenshot
//!   is read, rather than show it with the wrong crop.
//!
//! [`Timeline`]: crate::lookahead::Timeline

use crate::bars::Measured;
use crate::crop::{CropTracker, Rect, Why};
use crate::lookahead::{Schedule, PTS_SLACK};
use crate::sampler::{Feed, Sampler, Sampling};

/// The longest gap between two `time-pos` while playing that is still
/// playing on (frames the engine didn't see, a slow tick), in seconds.
const PLAYING_GAP: f64 = 0.5;

/// What the engine should do for the frame just handed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ask {
    Nothing,
    /// Take a screenshot of the frame on screen (paused, so it's that very
    /// frame) and hand its reading to [`Frames::shot`] with this pts.
    Still(u64),
    /// The same, with playback paused until the reading is in
    /// ([`Frames::shot`] says when to play on).
    Hold(u64),
}

#[derive(Debug)]
pub struct Frames {
    pub tracker: CropTracker,
    pub sampler: Sampler,
    /// The pts of the last frame handed in.
    last: Option<f64>,
    /// The screenshot asked for the frame on screen: its number and the
    /// frame's pts, and whether playback is held for it.
    still: Option<(u64, f64)>,
    holding: bool,
    shots: u64,
}

impl Frames {
    pub fn new(sampling: Sampling) -> Self {
        Frames {
            tracker: CropTracker::default(),
            sampler: Sampler::new(sampling),
            last: None,
            still: None,
            holding: false,
            shots: 0,
        }
    }

    /// A new load: nothing before it counts (its tracker is opened apart).
    pub fn reset(&mut self) {
        self.sampler.reset();
        (self.last, self.still, self.holding) = (None, None, false);
    }

    /// Whether playback is held for a screenshot.
    pub fn holding(&self) -> bool {
        self.holding
    }

    /// The frame with `pts` is on screen (`time-pos` changed); `paused`
    /// says whether mpv is paused, `frame` how long a frame lasts, `live`
    /// is cropdetect's latest reading (with it on) and `ahead` the
    /// lookahead's schedule while it runs. `hold` allows holding playback
    /// (the lookahead is on). The tracker's bars are then the ones to show.
    #[allow(clippy::too_many_arguments)]
    pub fn frame(
        &mut self,
        load: u64,
        (full, display): ((i64, i64), (i64, i64)),
        pts: f64,
        paused: bool,
        frame: f64,
        live: Option<Rect>,
        mut ahead: Option<&mut Schedule>,
        hold: bool,
    ) -> Ask {
        let last = self.last.replace(pts);
        let playing_on =
            !paused && !self.holding && last.is_some_and(|l| pts > l + PTS_SLACK && pts - l <= PLAYING_GAP);
        if playing_on {
            self.still = None;
            // The reading is of the next frame (mpv filters one ahead): so is the change.
            let next = pts + frame;
            let due = ahead.as_deref_mut().and_then(|s| {
                let due = s.take(load, next).map(|c| (c, Why::Keyframe));
                due.or(s.found(load, next, live).map(|c| (c, Why::Window)))
            });
            if let Some((change, why)) = due {
                // Found exactly between keyframes by the lookahead ([`CutSearch`](crate::lookahead::CutSearch)).
                let why = if change.exact() { Why::Window } else { why };
                self.tracker.cut(load, full, change.bars, why);
            }
            match self.sampler.frame(live, self.tracker.following()) {
                Feed::Cropdetect(r) => self.tracker.update(load, full, display, r),
                // A screenshot's, of a frame already shown: a change it brings is late.
                Feed::Measured(m) => self.tracker.update_late(load, full, display, m),
                // No reading for this frame: a lookahead cut still lands on it.
                Feed::Wait => self.tracker.update(load, full, display, None),
            }
            // Animated bars: where they stand on the next frame, not where a late screenshot saw them.
            if self.tracker.following() {
                if let Some(at) = self.sampler.lead(live, next) {
                    self.tracker.lead(load, full, at);
                }
            }
            return Ask::Nothing;
        }
        if paused && last.is_some_and(|l| (l - pts).abs() <= PTS_SLACK) {
            // The same frame again.
            self.tracker.show(load, full, self.tracker.bars(load));
            return Ask::Nothing;
        }
        // A jump: paused, the zoom lands on the frame on screen; playing, on the next.
        self.sampler.reset();
        let at = if paused { pts } else { pts + frame };
        let known = ahead.as_deref_mut().and_then(|s| {
            s.rewind(load, at);
            if paused {
                // A step either way next: read those frames before they're shown.
                s.want(load, &[pts + frame, pts - frame]);
            }
            s.bars_at(load, at)
        });
        match known {
            Some(bars) => self.tracker.show(load, full, bars),
            None => self.tracker.show(load, full, self.tracker.bars(load)),
        }
        if paused {
            return self.ask(pts, false);
        }
        if known.is_none() && hold && ahead.is_some() {
            return self.ask(pts, true);
        }
        Ask::Nothing
    }

    /// A screenshot's reading came: of the frame on screen asked for by
    /// [`Ask::Still`] or [`Ask::Hold`] with `shot`, or (`shot` none) one the
    /// sampler wanted, of the frame with `pts` when that's known. True when
    /// held playback may go on.
    pub fn shot(
        &mut self,
        load: u64,
        (full, display): ((i64, i64), (i64, i64)),
        shot: Option<u64>,
        pts: Option<f64>,
        measured: Option<Measured>,
        ahead: Option<&mut Schedule>,
    ) -> bool {
        let Some(n) = shot else {
            self.sampler.measured(pts, measured);
            return false;
        };
        let Some((_, pts)) = self.still.filter(|(asked, _)| *asked == n) else { return false };
        self.still = None;
        if let Some(s) = ahead {
            s.frame(load, pts, measured);
        }
        self.tracker.still(load, full, display, measured);
        std::mem::take(&mut self.holding)
    }

    /// The screenshot never came: play on without it.
    pub fn give_up(&mut self) -> bool {
        self.still = None;
        std::mem::take(&mut self.holding)
    }

    fn ask(&mut self, pts: f64, hold: bool) -> Ask {
        self.shots += 1;
        self.still = Some((self.shots, pts));
        self.holding = hold;
        if hold {
            Ask::Hold(self.shots)
        } else {
            Ask::Still(self.shots)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crop::{zoom_for, CropZoom};
    use crate::lookahead::Schedule;

    const HD: (i64, i64) = (1920, 1080);
    const SIZES: ((i64, i64), (i64, i64)) = (HD, HD);
    const F: f64 = 1.0 / 24.0;

    fn rect(v: i64) -> Rect {
        Rect { w: 1920, h: 1080 - 2 * v, x: 0, y: v }
    }

    fn ours(v: i64) -> Option<Measured> {
        Some(Measured { rect: rect(v), crisp: [v > 0, v > 0, false, false] })
    }

    /// An invented 24 fps video: full frame up to frame `cut`, 140 px bars
    /// from it on; keyframes every 240 frames (10 s), so the cut at frame
    /// 100 falls between two.
    struct Video {
        cut: usize,
    }

    impl Video {
        fn bars(&self, n: usize) -> i64 {
            if n < self.cut {
                0
            } else {
                140
            }
        }

        /// The lookahead as the desktop engine runs it: every keyframe up
        /// to `to`, then every search, read frame-exactly.
        fn read_ahead(&self, s: &mut Schedule, to: usize) {
            for k in (0..=to).step_by(240) {
                s.keyframe(1, k as f64 * F, ours(self.bars(k)));
            }
            while let Some(mut search) = s.take_search(1) {
                while let Some(at) = search.next(F) {
                    let n = (at / F + 1e-9).floor() as usize;
                    if let Some(rest) = search.read(at, n as f64 * F, s.frame_bars(ours(self.bars(n)))) {
                        s.push_search(1, rest);
                    }
                }
                s.searched(1, &search, F);
            }
        }
    }

    /// Hand frame `n` to `f` (cropdetect reading the next frame), answering
    /// a screenshot asked for at once with the frame on screen's reading.
    fn show(f: &mut Frames, v: &Video, s: Option<&mut Schedule>, n: usize, paused: bool) -> (i64, Option<Why>, Ask) {
        let live = Some(rect(v.bars(n + usize::from(!paused))));
        let mut s = s;
        let ask = f.frame(1, SIZES, n as f64 * F, paused, F, live, s.as_deref_mut(), true);
        let mut why = f.tracker.changed();
        if let Ask::Still(shot) | Ask::Hold(shot) = ask {
            f.shot(1, SIZES, Some(shot), None, ours(v.bars(n)), s);
            why = f.tracker.changed().or(why);
        }
        (f.tracker.bars(1).0, why, ask)
    }

    fn opened(s: &mut Schedule, v: &Video) -> Frames {
        let mut f = Frames::new(Sampling::AroundChanges);
        f.tracker.open(1, HD, (0, 0));
        v.read_ahead(s, 480);
        f
    }

    /// Bars the film animates: `from` px up to frame 40, then 4 px a frame
    /// towards `to`, then `to`.
    fn animated(from: i64, to: i64, n: usize) -> i64 {
        let moved = 4 * n.saturating_sub(40) as i64;
        if to < from {
            (from - moved).max(to)
        } else {
            (from + moved).min(to)
        }
    }

    /// Play 120 frames of `bars` as the desktop engine does: screenshots
    /// read 2 frames after their frame (with their pts on macOS), and
    /// cropdetect's reading of the next frame where it runs. Per frame: the
    /// bars of the frame the zoom lands on, the bars shown, and following.
    fn play_animated(sampling: Sampling, bars: impl Fn(usize) -> i64) -> Vec<(i64, i64, bool)> {
        let mut f = Frames::new(sampling);
        f.tracker.open(1, HD, (bars(0), 0));
        let cropdetect = sampling != Sampling::EveryFrame;
        (0..120)
            .map(|n| {
                if n >= 2 {
                    let pts = (!cropdetect).then_some((n - 2) as f64 * F);
                    f.shot(1, SIZES, None, pts, ours(bars(n - 2)), None);
                }
                let live = cropdetect.then(|| rect(bars(n + 1)));
                assert_eq!(f.frame(1, SIZES, n as f64 * F, false, F, live, None, true), Ask::Nothing);
                (bars(n + 1), f.tracker.bars(1).0, f.tracker.following())
            })
            .collect()
    }

    #[test]
    fn animated_bars_are_followed_on_their_frame_where_cropdetect_runs() {
        for (from, to) in [(140, 40), (40, 140)] {
            let played = play_animated(Sampling::EveryFrameAndCropdetect, |n| animated(from, to, n));
            let first = played.iter().position(|p| p.2).expect("followed");
            assert!(first <= 46, "followed from frame {first}: {played:?}");
            for (n, &(want, shown, _)) in played.iter().enumerate().skip(first) {
                assert_eq!(shown, want, "frame {n} ({from} to {to}): {played:?}");
            }
        }
    }

    #[test]
    fn animated_bars_from_screenshots_only_never_cut_into_the_picture() {
        // Opening: carried on to the frame, exact while the pace holds; where
        // the move stops, a few pixels of bar for as many frames as the
        // screenshots run late, then at rest on them.
        let played = play_animated(Sampling::EveryFrame, |n| animated(140, 40, n));
        let first = played.iter().position(|p| p.2).expect("followed");
        assert!(first <= 46, "followed from frame {first}: {played:?}");
        for (n, &(want, shown, _)) in played.iter().enumerate().skip(first) {
            assert!(shown <= want && want - shown <= 12, "frame {n}: {played:?}");
            if n < 64 {
                assert_eq!(shown, want, "frame {n}: {played:?}");
            }
        }
        assert!(played[70..].iter().all(|&(want, shown, _)| shown == want), "{played:?}");
        // Closing: held where the screenshots saw them, a few pixels of bar
        // while they move, then at rest on the last.
        let played = play_animated(Sampling::EveryFrame, |n| animated(40, 140, n));
        let first = played.iter().position(|p| p.2).expect("followed");
        for (n, &(want, shown, _)) in played.iter().enumerate().skip(first) {
            assert!(shown <= want && want - shown <= 12, "frame {n}: {played:?}");
        }
        assert!(played[70..].iter().all(|&(want, shown, _)| shown == want), "{played:?}");
    }

    #[test]
    fn playing_a_change_between_keyframes_lands_on_its_frame() {
        let v = Video { cut: 100 };
        let mut s = Schedule::new(1, HD, (0, 0));
        let mut f = opened(&mut s, &v);
        // Frame n's zoom is sent while frame n-1 is on screen.
        let mut shown = Vec::new();
        for n in 0..200 {
            let (bars, why, _) = show(&mut f, &v, Some(&mut s), n, false);
            shown.push((n + 1, bars, why));
        }
        for &(n, bars, why) in &shown[1..] {
            assert_eq!(bars, v.bars(n), "frame {n}: {shown:?}");
            if n == 100 {
                assert_eq!(why, Some(Why::Window), "found between keyframes");
            }
        }
    }

    #[test]
    fn stepping_back_and_forth_across_a_change_shows_each_frames_own_crop() {
        let v = Video { cut: 100 };
        let mut s = Schedule::new(1, HD, (0, 0));
        let mut f = opened(&mut s, &v);
        for n in 0..=110 {
            show(&mut f, &v, Some(&mut s), n, false);
        }
        // Paused at 110, then steps back to 95 and forward to 105, frame by frame.
        let steps: Vec<usize> = (95..=109).rev().chain(96..=105).collect();
        for n in steps {
            let (bars, why, ask) = show(&mut f, &v, Some(&mut s), n, true);
            assert_eq!(bars, v.bars(n), "frame {n}");
            assert!(matches!(ask, Ask::Still(_)), "paused: the frame on screen is checked");
            if n == 99 || n == 100 {
                assert!(why == Some(Why::Known) || why.is_none(), "frame {n}: from the lookahead, {why:?}");
            }
        }
        // Playing on from there: the next frames keep their crop.
        for n in 106..=120 {
            assert_eq!(show(&mut f, &v, Some(&mut s), n, false).0, v.bars(n + 1), "frame {n}");
        }
    }

    #[test]
    fn stepping_without_the_lookahead_reads_the_frame_on_screen() {
        let v = Video { cut: 100 };
        let mut f = Frames::new(Sampling::AroundChanges);
        f.tracker.open(1, HD, (0, 0));
        for n in 0..=98 {
            show(&mut f, &v, None, n, false);
        }
        // Step onto the first frame with (crisp) bars: cropped on it, from its own reading.
        assert_eq!(show(&mut f, &v, None, 99, true).0, 0);
        assert_eq!(show(&mut f, &v, None, 100, true), (140, Some(Why::Still), Ask::Still(2)));
        // And back: the frame without bars is shown uncropped.
        assert_eq!(show(&mut f, &v, None, 99, true), (0, Some(Why::Still), Ask::Still(3)));
    }

    #[test]
    fn a_seek_shows_the_frame_with_its_own_crop_or_holds_it() {
        let v = Video { cut: 100 };
        let mut s = Schedule::new(1, HD, (0, 0));
        let mut f = opened(&mut s, &v);
        for n in 0..=10 {
            show(&mut f, &v, Some(&mut s), n, false);
        }
        // Into what the lookahead read: the next frame's bars at once, nothing held.
        let (bars, why, ask) = show(&mut f, &v, Some(&mut s), 300, false);
        assert_eq!((bars, why, ask), (140, Some(Why::Known), Ask::Nothing));
        // Back before the cut: uncropped at once.
        assert_eq!(show(&mut f, &v, Some(&mut s), 50, false), (0, Some(Why::Known), Ask::Nothing));
        // Past what it read (no keyframe of 2000's read yet): held until the frame's own reading is in.
        let ask = f.frame(1, SIZES, 2000.0 * F, false, F, Some(rect(140)), Some(&mut s), true);
        let Ask::Hold(shot) = ask else { panic!("{ask:?}") };
        assert!(f.holding());
        assert!(f.shot(1, SIZES, Some(shot), None, ours(140), Some(&mut s)), "play on once it's read");
        assert_eq!((f.tracker.bars(1).0, f.holding()), (140, false));
        // Without the lookahead nothing is held: the live readings decide, as when playing.
        let mut f = Frames::new(Sampling::AroundChanges);
        f.tracker.open(1, HD, (0, 0));
        show(&mut f, &v, None, 10, false);
        assert_eq!(show(&mut f, &v, None, 2000, false).2, Ask::Nothing);
        // A screenshot that never comes doesn't hold playback for ever.
        let mut s = Schedule::new(1, HD, (0, 0));
        let mut f = opened(&mut s, &v);
        show(&mut f, &v, Some(&mut s), 10, false);
        assert!(matches!(f.frame(1, SIZES, 2000.0 * F, false, F, None, Some(&mut s), true), Ask::Hold(_)));
        assert!(f.give_up() && !f.holding());
    }

    #[test]
    fn a_late_reading_is_one_jump() {
        // Without the lookahead, cropdetect's unclear reading of new bars is
        // believed 4 frames late: the zoom jumps there once, no glide.
        let v = Video { cut: 100 };
        let mut f = Frames::new(Sampling::AroundChanges);
        f.tracker.open(1, HD, (0, 0));
        let mut zoom = CropZoom::default();
        let window = (2000, 837);
        let mut sent = Vec::new();
        for n in 0..140 {
            // Not crisp to cropdetect; our screenshots aren't answered (the sampler gives up on them).
            let live = Some(rect(v.bars(n + 1)));
            f.frame(1, SIZES, n as f64 * F, false, F, live, None, false);
            let target = zoom_for(f.tracker.bars(1), HD, HD, window, false);
            if let Some(z) = zoom.next(1, window, target, f.tracker.changed().is_some()) {
                sent.push((n, z, f.tracker.changed()));
            }
        }
        assert_eq!(sent.len(), 2, "the first zoom and one jump: {sent:?}");
        assert!(sent[1].1 > 0.0 && sent[1].2.is_some(), "{sent:?}");
    }
}
