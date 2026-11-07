//! Autocrop's lookahead (docs/autocrop.md §4): a decoder running ahead of
//! the playhead reads keyframes only, and [`Schedule`] turns what it
//! measures into bar changes due at a pts. The engine hands each one to
//! [`CropTracker::cut`](crate::crop::CropTracker::cut) on the frame with
//! that pts, so a change lands on the cut itself, where a jump can't be
//! seen. A change between keyframes is known to fall after the keyframe
//! before: within that window the first frame whose own reading shows the
//! new bars is the cut ([`Schedule::found`]), unless a second reader has
//! already found that frame by reading frames in the window
//! ([`CutSearch`]). What was read also goes into a [`Timeline`]: the bars of
//! each frame by pts, which the engine shows after a seek or a frame step.

use std::collections::VecDeque;

use crate::bars::Measured;
use crate::crop::Rect;

/// How far ahead of the playhead the lookahead reads, in seconds: inside
/// mpv's 90 s cache (`--cache-secs`), so the desktop can read from it.
pub const AHEAD_SECS: f64 = 60.0;

/// How far apart (seconds) a frame's `time-pos` and a keyframe's pts from
/// the lookahead may be and still be the same frame (a frame at 60 fps
/// lasts 16.7 ms).
pub const PTS_SLACK: f64 = 0.005;

/// How far apart (pixels) two readings of the same bar edge may be, as
/// [`crop`](crate::crop)'s `EDGE_SLACK`.
const EDGE_SLACK: i64 = 4;

/// From the frame with this pts on, these bars (top and bottom, left and
/// right, in video pixels); `None` on an axis: no change there. `after`:
/// the keyframe before, which still had the old bars, so the cut is on a
/// frame after it, up to `pts` (`None`: not known, after a seek; `pts`
/// itself: `pts` is the cut, found between keyframes by [`CutSearch`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Change {
    pub pts: f64,
    pub bars: [Option<i64>; 2],
    pub after: Option<f64>,
}

impl Change {
    /// The cut was found between keyframes, exactly ([`CutSearch`]).
    pub fn exact(&self) -> bool {
        self.after == Some(self.pts)
    }
}

/// Frames whose bars the lookahead read, by pts: what the engine shows on
/// the frame on screen after a seek or a frame step, either way, instead of
/// waiting for readings of the frames before it. Between two keyframes the
/// lookahead read one after the other, every frame has their bars when they
/// agree, or, when they don't, the old bars up to the cut [`CutSearch`]
/// found and the new ones from it on. Kept for the whole load, seeks and
/// all; newer readings win.
#[derive(Debug, Default, Clone)]
pub struct Timeline {
    spans: Vec<Span>,
}

/// Frames with pts from `from` to `to`, both included, have `bars`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Span {
    from: f64,
    to: f64,
    bars: (i64, i64),
}

/// Spans kept, at most (two hours of keyframes 2 s apart, all different).
const SPANS: usize = 8192;

impl Timeline {
    /// Frames with pts from `from` to `to` (both included; the same for one
    /// frame) have `bars` (top and bottom, left and right).
    pub fn insert(&mut self, from: f64, to: f64, bars: (i64, i64)) {
        if let Some(last) = self.spans.last_mut() {
            if last.bars == bars && from <= last.to + PTS_SLACK && to >= last.from - PTS_SLACK {
                (last.from, last.to) = (last.from.min(from), last.to.max(to));
                return;
            }
        }
        if self.spans.len() == SPANS {
            self.spans.remove(0);
        }
        self.spans.push(Span { from, to, bars });
    }

    /// The bars of the frame with `pts`, if they were read.
    pub fn bars_at(&self, pts: f64) -> Option<(i64, i64)> {
        self.spans.iter().rev().find(|s| pts >= s.from - PTS_SLACK && pts <= s.to + PTS_SLACK).map(|s| s.bars)
    }
}

/// Where between two keyframes with different bars the bars change, found
/// by reading frames in between (a second reader seeking frame-exactly),
/// halving the window each time: some 8 readings for a window of 10 s at
/// 24 fps. A frame with neither the old nor the new bars (a shot with no
/// keyframe of its own, often right after a short one) splits the window:
/// this search goes on up to that frame, and another from it on
/// ([`read`](Self::read) hands that one back). An unclear reading ends it
/// without a cut, leaving that window to the live readings. A black frame
/// counts as the new bars: on black, a crop can't be seen.
///
/// Between keyframes that agree, [`check`](Self::check) reads one frame,
/// [`CHECK_AFTER`] past the first: encoders skip the keyframe on a cut that
/// comes less than that after the last one (x264's `min-keyint`, right
/// after a short shot), so a shot with other bars there has none of its
/// own. Other bars on it start a search each side.
#[derive(Debug, Clone, PartialEq)]
pub struct CutSearch {
    /// The last frame read with the old bars, and the first with the new.
    pub old: (f64, (i64, i64)),
    pub new: (f64, (i64, i64)),
    /// The frames it started from: keyframes, or a frame a search split at.
    pub from: f64,
    pub to: f64,
    /// Asked-for times that landed on `old`'s or `new`'s frame: no other
    /// frame from `old` up to `floor`, or from `ceil` up to `new`.
    floor: f64,
    ceil: f64,
    reads: u32,
    failed: bool,
    /// Only checking a window between keyframes that agree.
    checking: bool,
}

/// Readings one [`CutSearch`] takes at most.
const SEARCH_READS: u32 = 16;

/// Where [`CutSearch::check`] reads, after the first keyframe, in seconds.
pub const CHECK_AFTER: f64 = 1.0;

impl CutSearch {
    pub fn new(old: (f64, (i64, i64)), new: (f64, (i64, i64))) -> Self {
        CutSearch {
            old,
            new,
            from: old.0,
            to: new.0,
            floor: old.0,
            ceil: new.0,
            reads: 0,
            failed: false,
            checking: false,
        }
    }

    /// Check the window between two keyframes with the same `bars` for a
    /// shot with other bars and no keyframe of its own.
    pub fn check(from: f64, to: f64, bars: (i64, i64)) -> Self {
        CutSearch { checking: true, ..CutSearch::new((from, bars), (to, bars)) }
    }

    /// The time whose frame to read next, with frames `frame` s long; `None`
    /// once done ([`cut`](Self::cut) says whether it found the cut).
    pub fn next(&self, frame: f64) -> Option<f64> {
        if self.checking {
            return (self.reads == 0 && self.to - self.from > CHECK_AFTER + frame).then_some(self.from + CHECK_AFTER);
        }
        if self.failed || self.reads >= SEARCH_READS || self.found(frame) {
            return None;
        }
        Some((self.floor + self.ceil) / 2.0)
    }

    /// The frame the reader landed on, asked for `at`: its pts and our
    /// detector's bars on it ([`Schedule::frame_bars`]; `Some(None)`: black,
    /// `None`: no clear reading). A frame with other bars splits the search:
    /// the part after it is returned, to search as well.
    pub fn read(&mut self, at: f64, pts: f64, bars: FrameBars) -> Option<CutSearch> {
        self.reads += 1;
        let same = |a: (i64, i64), b: (i64, i64)| (a.0 - b.0).abs() <= EDGE_SLACK && (a.1 - b.1).abs() <= EDGE_SLACK;
        if self.checking {
            // Other bars on the frame checked: a search each side of it; anything else, nothing to find.
            let inside = pts > self.old.0 + PTS_SLACK && pts < self.new.0 - PTS_SLACK;
            let Some(Some(other)) = bars.filter(|_| inside) else { return None };
            if same(other, self.old.1) {
                return None;
            }
            self.checking = false;
            let mut rest = CutSearch::new((pts, other), self.new);
            (rest.to, rest.floor) = (self.to, pts.max(at));
            (self.new, self.to, self.ceil) = ((pts, other), pts, pts.min(at));
            return Some(rest);
        }
        if pts <= self.old.0 + PTS_SLACK {
            self.floor = self.floor.max(at);
        } else if pts >= self.new.0 - PTS_SLACK {
            self.ceil = self.ceil.min(at);
        } else {
            match bars {
                Some(Some(b)) if same(b, self.old.1) => (self.old.0, self.floor) = (pts, pts.max(at)),
                Some(Some(b)) if same(b, self.new.1) => (self.new.0, self.ceil) = (pts, pts.min(at)),
                Some(None) => (self.new.0, self.ceil) = (pts, pts.min(at)),
                Some(Some(other)) => {
                    let mut rest = CutSearch::new((pts, other), self.new);
                    (rest.to, rest.floor) = (self.to, pts.max(at));
                    (self.new, self.to, self.ceil) = ((pts, other), pts, pts.min(at));
                    return Some(rest);
                }
                None => self.failed = true,
            }
        }
        None
    }

    /// The pts of the first frame with the new bars, once found.
    pub fn cut(&self, frame: f64) -> Option<f64> {
        (!self.failed && !self.checking && self.found(frame)).then_some(self.new.0)
    }

    /// No frame left unread between the old bars and the new.
    fn found(&self, frame: f64) -> bool {
        self.new.0 - self.old.0 <= frame * 1.5 || self.ceil - self.floor < frame * 0.5
    }
}

/// Our detector's reading of one frame as the timeline keeps it
/// ([`Schedule::frame_bars`]).
type FrameBars = Option<Option<(i64, i64)>>;

/// Bars a run of keyframes agrees on, per axis.
#[derive(Debug, Clone, Copy)]
struct Run {
    bars: i64,
    /// The pts of the run's first keyframe: where the bars appeared.
    from: f64,
    /// Believed: crisp on its first keyframe, or read again on a later one.
    confirmed: bool,
    /// The keyframe before `from` that read this axis.
    after: Option<f64>,
    /// No run came before it since the start or a seek.
    first: bool,
}

/// Bar changes ahead of the playhead, from keyframe readings fed in pts
/// order. A keyframe's bars on an axis count when they're even, at least
/// 1% a side (else none), and leave at least 40% of the frame; black
/// frames and uneven readings don't count either way. New bars are
/// scheduled on the keyframe they first show on, once believed: at once
/// when crisp on both sides, or when a later keyframe reads them again
/// (seconds of the same bars, far more than the live tracker waits for).
/// A change whose frame has already been shown is dropped, never applied
/// late: the live tracker handles those.
#[derive(Debug)]
pub struct Schedule {
    /// The `Mpv::loads` and frame size these readings belong to.
    load: u64,
    full: (i64, i64),
    runs: [Option<Run>; 2],
    /// The pts of the last keyframe that read each axis.
    seen: [Option<f64>; 2],
    /// The bars last scheduled per axis (`None`: none yet this load).
    last: [Option<i64>; 2],
    /// The reading [`found`](Self::found) was given for the frame before.
    live: Option<Option<Rect>>,
    /// Believed changes not yet due, by pts.
    due: VecDeque<Change>,
    /// The pts of the last keyframe read, and of the last frame shown.
    read: Option<f64>,
    shown: Option<f64>,
    /// Changes due on frames shown already, for [`rewind`](Self::rewind).
    past: Vec<Change>,
    /// The bars of each frame read, kept across seeks.
    timeline: Timeline,
    /// The last keyframe read since the start or a seek, and its bars
    /// ([`frame_bars`](Self::frame_bars)).
    last_key: Option<(f64, FrameBars)>,
    /// Windows between keyframes whose cut is still to be found.
    searches: VecDeque<CutSearch>,
    /// Frames the engine wants read before they're shown (paused: the
    /// frames a step either way would show).
    wanted: Vec<f64>,
}

impl Schedule {
    /// A schedule for `load`, whose playback starts with `bars` removed
    /// (the pre-roll's [`opening_bars`](crate::crop::opening_bars)).
    pub fn new(load: u64, full: (i64, i64), bars: (i64, i64)) -> Self {
        Schedule {
            load,
            full,
            runs: [None; 2],
            seen: [None; 2],
            last: [Some(bars.0), Some(bars.1)],
            live: None,
            due: VecDeque::new(),
            read: None,
            shown: None,
            past: Vec::new(),
            timeline: Timeline::default(),
            last_key: None,
            searches: VecDeque::new(),
            wanted: Vec::new(),
        }
    }

    /// After a seek: forget what was read, keep the bars last scheduled
    /// (the tracker's state carries on), and read again from the new place.
    pub fn restart(&mut self) {
        (self.runs, self.seen, self.due, self.read, self.shown, self.live) =
            ([None; 2], [None; 2], VecDeque::new(), None, None, None);
        (self.past, self.last_key, self.searches) = (Vec::new(), None, VecDeque::new());
    }

    /// The playhead went back to `pts` (a step back, a short seek back):
    /// changes due after it are due again.
    pub fn rewind(&mut self, load: u64, pts: f64) {
        if load != self.load || self.shown.is_none_or(|s| pts >= s - PTS_SLACK) {
            return;
        }
        let again: Vec<Change> = self.past.iter().filter(|c| c.pts > pts + PTS_SLACK).copied().collect();
        self.past.retain(|c| c.pts <= pts + PTS_SLACK);
        for c in again.into_iter().rev() {
            let at = self.due.iter().position(|d| d.pts > c.pts + PTS_SLACK).unwrap_or(self.due.len());
            if !self.due.iter().any(|d| (d.pts - c.pts).abs() <= PTS_SLACK) {
                self.due.insert(at, c);
            }
        }
        self.shown = Some(pts);
    }

    /// The bars of the frame with `pts`, if the lookahead read them.
    pub fn bars_at(&self, load: u64, pts: f64) -> Option<(i64, i64)> {
        (load == self.load).then(|| self.timeline.bars_at(pts)).flatten()
    }

    /// Our detector's reading of a frame as bars both ways, as the timeline
    /// keeps them: even, at least 1% a side, crisp on both sides (a dark
    /// shot read as bars isn't believed from one reading), and leaving 40%
    /// of the frame. `Some(None)`: a black frame; `None`: not that clear.
    pub fn frame_bars(&self, measured: Option<Measured>) -> FrameBars {
        let Some(m) = measured else { return Some(None) };
        match self.readings(m) {
            [Some((v, cv)), Some((h, ch))] if (v == 0 || cv) && (h == 0 || ch) => Some(Some((v, h))),
            _ => None,
        }
    }

    /// Search the rest of a window a search split ([`CutSearch::read`]) next.
    pub fn push_search(&mut self, load: u64, search: CutSearch) {
        if load == self.load {
            self.searches.push_front(search);
        }
    }

    /// The next window between keyframes whose cut is to be found, taken
    /// off the list: read frames in it as [`CutSearch::next`] says and hand
    /// it back to [`searched`](Self::searched).
    pub fn take_search(&mut self, load: u64) -> Option<CutSearch> {
        (load == self.load).then(|| self.searches.pop_front()).flatten()
    }

    /// A search is done: with its cut found, the frames either side of it
    /// go into the timeline, and the change due on its keyframe is due on
    /// the cut instead, exactly ([`Change::exact`]: no window left for
    /// [`found`](Self::found)).
    pub fn searched(&mut self, load: u64, search: &CutSearch, frame: f64) {
        let Some(cut) = search.cut(frame).filter(|_| load == self.load) else { return };
        self.timeline.insert(search.from, search.old.0, search.old.1);
        self.timeline.insert(cut, search.to, search.new.1);
        let keyframe = self.due.iter().position(|c| (c.pts - search.to).abs() <= PTS_SLACK);
        let c = match keyframe.and_then(|at| self.due.remove(at)) {
            Some(mut c) => {
                (c.pts, c.after) = (cut, Some(cut));
                c
            }
            // Up to a frame the search split at: those bars weren't scheduled.
            None if self.shown.is_none_or(|s| cut > s + PTS_SLACK) => {
                let (old, new) = (search.old.1, search.new.1);
                let axis = |o: i64, n: i64| ((o - n).abs() > EDGE_SLACK).then_some(n);
                Change { pts: cut, bars: [axis(old.0, new.0), axis(old.1, new.1)], after: Some(cut) }
            }
            None => return,
        };
        let at = self.due.iter().position(|d| d.pts > cut).unwrap_or(self.due.len());
        self.due.insert(at, c);
    }

    /// Ask for the frames with these pts to be read before they're shown
    /// (replacing what was asked before); those already read are skipped.
    pub fn want(&mut self, load: u64, frames: &[f64]) {
        if load == self.load {
            self.wanted = frames.iter().copied().filter(|&p| self.timeline.bars_at(p).is_none()).collect();
        }
    }

    /// The next frame asked for, taken off the list.
    pub fn take_wanted(&mut self, load: u64) -> Option<f64> {
        (load == self.load && !self.wanted.is_empty()).then(|| self.wanted.remove(0))
    }

    /// A frame read on its own (asked for, or a frame step's): its bars go
    /// into the timeline when clear.
    pub fn frame(&mut self, load: u64, pts: f64, measured: Option<Measured>) {
        if let Some(Some(bars)) = self.frame_bars(measured).filter(|_| load == self.load) {
            self.timeline.insert(pts, pts, bars);
        }
    }

    /// The pts of the last keyframe read, if any since the start or a seek.
    pub fn read_to(&self) -> Option<f64> {
        self.read
    }

    /// Whether the lookahead should read further, with the playhead at `playhead`.
    pub fn wants_more(&self, playhead: f64) -> bool {
        self.read.is_none_or(|r| r < playhead + AHEAD_SECS)
    }

    /// The changes believed so far and not yet due.
    pub fn pending(&self) -> impl Iterator<Item = &Change> {
        self.due.iter()
    }

    /// Feed the keyframe at `pts` as our own detector measured it, scaled
    /// to the video's pixels (`None`: a black frame). Keyframes come in pts
    /// order; one at or before the last read is ignored.
    pub fn keyframe(&mut self, load: u64, pts: f64, measured: Option<Measured>) {
        if load != self.load || self.read.is_some_and(|r| pts <= r + PTS_SLACK) {
            return;
        }
        self.read = Some(pts);
        let bars = self.frame_bars(measured);
        if let Some(Some(b)) = bars {
            self.timeline.insert(pts, pts, b);
        }
        if let (Some((last, Some(Some(old)))), Some(Some(new))) = (self.last_key, bars) {
            if (old.0 - new.0).abs() <= EDGE_SLACK && (old.1 - new.1).abs() <= EDGE_SLACK {
                self.timeline.insert(last, pts, new);
                self.searches.push_back(CutSearch::check(last, pts, new));
            } else {
                self.searches.push_back(CutSearch::new((last, old), (pts, new)));
            }
        }
        self.last_key = Some((pts, bars));
        let Some(m) = measured else { return };
        let readings = self.readings(m);
        for (axis, reading) in readings.into_iter().enumerate() {
            let Some((bars, crisp)) = reading else { continue };
            let after = self.seen[axis].replace(pts);
            match &mut self.runs[axis] {
                Some(run) if (run.bars - bars).abs() <= EDGE_SLACK => {
                    let (from, bars, first) = (run.from, run.bars.min(bars), run.first);
                    if !run.confirmed {
                        run.confirmed = true;
                        let earlier = run.after;
                        self.schedule(axis, from, bars, earlier, first);
                    }
                    // The same bars again: due here too, in case a shot
                    // with no keyframe came in between and live changed them.
                    self.schedule(axis, pts, bars, after, false);
                }
                run => {
                    let first = run.is_none();
                    *run = Some(Run { bars, from: pts, confirmed: crisp, after, first });
                    if crisp {
                        self.schedule(axis, pts, bars, after, first);
                    }
                }
            }
        }
    }

    /// The change to apply on the frame with `pts`, about to be shown, if
    /// one is due on it. Changes due on frames already shown are dropped.
    pub fn take(&mut self, load: u64, pts: f64) -> Option<Change> {
        if load != self.load {
            return None;
        }
        let shown = self.shown.replace(pts);
        let mut now = None;
        while let Some(c) = self.due.front().copied().filter(|c| c.pts <= pts + PTS_SLACK) {
            if shown.is_none_or(|s| c.pts > s + PTS_SLACK) {
                now = Some(c);
            }
            self.due.pop_front();
            self.past.push(c);
        }
        if self.past.len() > SPANS {
            self.past.drain(..self.past.len() - SPANS);
        }
        now
    }

    /// After [`take`](Self::take), for every frame: the next change, if
    /// this frame lies between the keyframe before it and its own, and
    /// `live`, this frame's own reading (cropdetect's, of this very frame),
    /// shows its bars where the frame before didn't. That frame is the cut;
    /// the change is applied there and no longer due on its keyframe.
    pub fn found(&mut self, load: u64, pts: f64, live: Option<Rect>) -> Option<Change> {
        let before = self.live.replace(live).flatten();
        let c = *self.due.front().filter(|_| load == self.load)?;
        let after = c.after?;
        if pts <= after + PTS_SLACK || pts >= c.pts - PTS_SLACK {
            return None;
        }
        let shows = |r: Option<Rect>| {
            let Some(r) = r else { return false };
            let reading = self.readings(Measured { rect: r, crisp: [false; 4] });
            (0..2).all(|axis| {
                c.bars[axis].is_none_or(|b| reading[axis].is_some_and(|(live, _)| (live - b).abs() <= EDGE_SLACK))
            })
        };
        let c = (shows(live) && !shows(before)).then(|| self.due.pop_front()).flatten()?;
        self.past.push(c);
        Some(c)
    }

    /// Per axis: the keyframe's bars and whether they're crisp on both
    /// sides, or `None` where they don't count.
    fn readings(&self, m: Measured) -> [Option<(i64, bool)>; 2] {
        let (fw, fh) = self.full;
        let r = m.rect;
        if r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > fw || r.y + r.h > fh {
            return [None; 2];
        }
        let axis = |axis: usize| {
            let dim = if axis == 0 { fh } else { fw };
            let (a, b) = if axis == 0 { (r.y, fh - r.y - r.h) } else { (r.x, fw - r.x - r.w) };
            if a.max(b) * 100 < dim {
                return Some((0, true)); // picture to the edges
            }
            let even = ((dim as f64 * 0.02).round() as i64).max(EDGE_SLACK);
            ((a - b).abs() <= even && a.min(b) * 100 >= dim)
                .then_some((a.min(b), m.crisp[2 * axis] && m.crisp[2 * axis + 1]))
        };
        let both = [axis(0), axis(1)];
        let (v, h) = (both[0].map_or(0, |b| b.0), both[1].map_or(0, |b| b.0));
        if (fw - 2 * h) * (fh - 2 * v) * 10 < fw * fh * 4 {
            return [None; 2];
        }
        both
    }

    /// Every believed keyframe's bars are scheduled, even bars scheduled
    /// before: the live tracker may have changed them in between (a shot
    /// with no keyframe), and [`CropTracker::cut`](crate::crop::CropTracker::cut)
    /// leaves bars already shown alone. Only those of the first run since
    /// the start or a seek are skipped when they're the bars last scheduled.
    fn schedule(&mut self, axis: usize, pts: f64, bars: i64, after: Option<f64>, first: bool) {
        if first && self.last[axis].is_some_and(|l| (l - bars).abs() <= EDGE_SLACK) {
            return;
        }
        self.last[axis] = Some(bars);
        let at = self.due.iter().position(|c| c.pts > pts - PTS_SLACK).unwrap_or(self.due.len());
        match self.due.get_mut(at).filter(|c| (c.pts - pts).abs() <= PTS_SLACK) {
            Some(c) => {
                c.bars[axis] = Some(bars);
                // Both axes changed here: the cut is after both keyframes before.
                c.after = c.after.zip(after).map(|(a, b)| a.max(b));
            }
            None => {
                let mut c = Change { pts, bars: [None; 2], after };
                c.bars[axis] = Some(bars);
                self.due.insert(at, c);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crop::{CropTracker, Rect, Why};

    const HD: (i64, i64) = (1920, 1080);

    /// A keyframe with `v` px bars top and bottom, crisp or not.
    fn bars(v: i64, crisp: bool) -> Option<Measured> {
        Some(Measured { rect: Rect { w: 1920, h: 1080 - 2 * v, x: 0, y: v }, crisp: [crisp, crisp, false, false] })
    }

    #[test]
    fn crisp_new_bars_are_due_on_their_keyframe() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 2.0, bars(0, false));
        s.keyframe(1, 4.5, bars(140, true));
        // The sides read full frame again: due there too, as a re-read.
        let at = Change { pts: 4.5, bars: [Some(140), Some(0)], after: Some(2.0) };
        assert_eq!(s.pending().collect::<Vec<_>>(), [&at]);
        assert_eq!(s.take(1, 4.4583), None);
        assert_eq!(s.take(1, 4.5), Some(at));
        assert_eq!(s.take(1, 4.5417), None);
    }

    #[test]
    fn unclear_bars_wait_for_a_second_keyframe() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 4.5, bars(142, false));
        assert_eq!(s.pending().count(), 0);
        s.keyframe(1, 6.0, None); // a fade says nothing
        s.keyframe(1, 8.0, bars(140, false));
        assert_eq!(s.pending().next(), Some(&Change { pts: 4.5, bars: [Some(140), None], after: None }));
        // The same bars read again are due on their keyframes too: a shot
        // with no keyframe in between may have changed them live.
        s.keyframe(1, 10.0, bars(140, true));
        let due: Vec<_> = s.pending().map(|c| (c.pts, c.bars[0], c.after)).collect();
        assert_eq!(due, [(4.5, Some(140), None), (8.0, Some(140), Some(4.5)), (10.0, Some(140), Some(8.0))]);
    }

    #[test]
    fn known_bars_and_odd_readings_schedule_nothing() {
        let mut s = Schedule::new(1, HD, (140, 0));
        s.keyframe(1, 1.0, bars(140, true));
        // Uneven: a dark shot lit at the bottom.
        let uneven = Measured { rect: Rect { w: 1920, h: 700, x: 0, y: 300 }, crisp: [true; 4] };
        s.keyframe(1, 2.0, Some(uneven));
        s.keyframe(1, 3.0, Some(uneven));
        // Less than 40% of the frame left.
        s.keyframe(1, 4.0, bars(400, true));
        // Out of order.
        s.keyframe(1, 0.5, bars(0, true));
        // Another load.
        s.keyframe(2, 5.0, bars(0, true));
        // Only the sides, read full frame again.
        assert!(s.pending().all(|c| c.bars == [None, Some(0)]), "{:?}", s.pending().collect::<Vec<_>>());
    }

    #[test]
    fn back_to_full_frame_and_both_axes_on_one_cut() {
        let mut s = Schedule::new(1, HD, (140, 0));
        s.keyframe(1, 3.0, bars(0, false));
        let boxed = Measured { rect: Rect { w: 1440, h: 800, x: 240, y: 140 }, crisp: [true; 4] };
        s.keyframe(1, 7.0, Some(boxed));
        let due: Vec<_> = s.pending().copied().collect();
        assert_eq!(
            due,
            [
                Change { pts: 3.0, bars: [Some(0), None], after: None },
                Change { pts: 7.0, bars: [Some(140), Some(240)], after: Some(3.0) }
            ]
        );
    }

    #[test]
    fn a_change_already_past_is_dropped_not_applied_late() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.take(1, 4.0);
        s.take(1, 5.0);
        s.keyframe(1, 4.5, bars(140, false));
        s.keyframe(1, 8.0, bars(140, false)); // believed only now, after 4.5 was shown
        assert_eq!(s.pending().map(|c| c.pts).collect::<Vec<_>>(), [4.5, 8.0]);
        assert_eq!(s.take(1, 5.0417), None);
        assert_eq!(s.pending().map(|c| c.pts).collect::<Vec<_>>(), [8.0], "the re-read on 8.0 is still due");
    }

    #[test]
    fn a_seek_reads_again_from_the_new_place() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 30.0, bars(140, true));
        assert!(s.wants_more(0.0));
        s.keyframe(1, 61.0, bars(140, true));
        assert!(!s.wants_more(0.5));
        s.restart();
        assert_eq!((s.pending().count(), s.read_to()), (0, None));
        // Bars scheduled before the seek still count as the bars shown.
        s.keyframe(1, 20.0, bars(140, true));
        assert_eq!(s.pending().count(), 0);
        // A seek that lands on the keyframe of a change applies it there.
        s.keyframe(1, 25.0, bars(0, true));
        assert_eq!(s.take(1, 25.0), Some(Change { pts: 25.0, bars: [Some(0), Some(0)], after: Some(20.0) }));
    }

    #[test]
    fn a_change_between_keyframes_lands_where_the_live_reading_shows_it() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 0.0, bars(0, true));
        s.keyframe(1, 10.0, bars(140, true)); // the cut is somewhere after 0.0
        let scope = Some(Rect { w: 1920, h: 800, x: 0, y: 140 });
        let full = Some(Rect { w: 1920, h: 1080, x: 0, y: 0 });
        assert_eq!(s.take(1, 0.0), None);
        assert_eq!(s.found(1, 0.0, scope), None, "not after the keyframe before");
        assert_eq!(s.take(1, 3.0), None);
        assert_eq!(s.found(1, 3.0, full), None, "old bars still");
        assert_eq!(s.found(1, 3.0, None), None, "a black frame says nothing");
        let thicker = Some(Rect { w: 1920, h: 700, x: 0, y: 190 });
        assert_eq!(s.found(1, 3.0, thicker), None, "other bars");
        let at = Change { pts: 10.0, bars: [Some(140), Some(0)], after: Some(0.0) };
        assert_eq!(s.found(1, 3.0417, scope), Some(at));
        // Applied there: not again on its keyframe.
        assert_eq!(s.take(1, 10.0), None);
        // Unknown window (the first keyframe after a seek): only on its keyframe.
        s.restart();
        s.keyframe(1, 20.0, bars(0, true));
        assert_eq!(s.found(1, 19.0, full), None);
        assert_eq!(s.take(1, 20.0).map(|c| c.after), Some(None));
    }

    /// A reader seeking frame-exactly in a 24 fps video whose bars are `v`
    /// px top and bottom before `cut` (a frame number) and `w` from it on:
    /// asked for a time, it lands on the frame shown then (`floor`) or the
    /// first frame from it on.
    fn search(s: &mut CutSearch, cut: usize, (v, w): (i64, i64), floor: bool) -> usize {
        let f = 1.0 / 24.0;
        let mut reads = 0;
        while let Some(at) = s.next(f) {
            let n = if floor { (at / f + 1e-9).floor() } else { (at / f - 1e-9).ceil() } as usize;
            assert_eq!(s.read(at, n as f64 * f, Some(Some((if n < cut { v } else { w }, 0)))), None);
            reads += 1;
        }
        reads
    }

    #[test]
    fn a_search_finds_the_cut_between_keyframes() {
        let f = 1.0 / 24.0;
        for floor in [true, false] {
            for cut in [1, 2, 3, 100, 239, 240] {
                // Keyframes at frames 0 and 240 (10 s), full frame then 140 px bars.
                let mut s = CutSearch::new((0.0, (0, 0)), (240.0 * f, (140, 0)));
                let reads = search(&mut s, cut, (0, 140), floor);
                assert_eq!(s.cut(f).map(|c| (c / f).round() as usize), Some(cut), "cut {cut}, floor {floor}");
                assert!(reads <= 10, "{reads} readings for cut {cut}");
            }
        }
        // Next to each other: nothing to read.
        let s = CutSearch::new((1.0, (0, 0)), (1.0 + f, (140, 0)));
        assert_eq!((s.next(f), s.cut(f)), (None, Some(1.0 + f)));
        // An unclear reading in between: no cut.
        let mut s = CutSearch::new((0.0, (0, 0)), (10.0, (140, 0)));
        let at = s.next(f).unwrap();
        s.read(at, 5.0, None);
        assert_eq!((s.next(f), s.cut(f)), (None, None));
        // Other bars in between (a shot with no keyframe of its own): both cuts found, one search each side.
        let truth = |n: usize| match n {
            0..=59 => (0, 0),
            60..=129 => (100, 0),
            _ => (140, 0),
        };
        let mut queue = vec![CutSearch::new((0.0, truth(0)), (240.0 * f, truth(240)))];
        let mut cuts = Vec::new();
        while let Some(mut s) = queue.pop() {
            while let Some(at) = s.next(f) {
                let n = (at / f + 1e-9).floor() as usize;
                queue.extend(s.read(at, n as f64 * f, Some(Some(truth(n)))));
            }
            cuts.push(((s.cut(f).unwrap() / f).round() as usize, s.new.1));
        }
        cuts.sort();
        assert_eq!(cuts, [(60, (100, 0)), (130, (140, 0))]);
        // Keyframes that agree, with a shot of other bars right after the first: the check finds it, then both cuts.
        let truth = |n: usize| if (10..100).contains(&n) { (140, 0) } else { (0, 0) };
        let mut check = CutSearch::check(0.0, 240.0 * f, (0, 0));
        let at = check.next(f).unwrap();
        let n = (at / f + 1e-9).floor() as usize;
        let mut queue: Vec<CutSearch> = check.read(at, n as f64 * f, Some(Some(truth(n)))).into_iter().collect();
        queue.push(check);
        let mut cuts = Vec::new();
        while let Some(mut s) = queue.pop() {
            while let Some(at) = s.next(f) {
                let n = (at / f + 1e-9).floor() as usize;
                queue.extend(s.read(at, n as f64 * f, Some(Some(truth(n)))));
            }
            cuts.push(((s.cut(f).unwrap() / f).round() as usize, s.new.1));
        }
        cuts.sort();
        assert_eq!(cuts, [(10, (140, 0)), (100, (0, 0))]);
        // A black frame counts as the new bars: the cut is the first black frame.
        let mut s = CutSearch::new((0.0, (0, 0)), (240.0 * f, (140, 0)));
        while let Some(at) = s.next(f) {
            let n = (at / f + 1e-9).floor() as usize;
            let bars = match n {
                0..=99 => Some(Some((0, 0))),
                100..=110 => Some(None),
                _ => Some(Some((140, 0))),
            };
            s.read(at, n as f64 * f, bars);
        }
        assert_eq!(s.cut(f).map(|c| (c / f).round() as usize), Some(100));
    }

    #[test]
    fn a_cut_found_between_keyframes_is_due_exactly_and_in_the_timeline() {
        let f = 1.0 / 24.0;
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 0.0, bars(0, false));
        s.keyframe(1, 240.0 * f, bars(140, true));
        s.keyframe(1, 480.0 * f, bars(140, true));
        // Keyframes that agree: every frame between has their bars; between those that don't, nothing yet.
        assert_eq!(s.bars_at(1, 300.0 * f), Some((140, 0)));
        assert_eq!(s.bars_at(1, 0.0), Some((0, 0)));
        assert_eq!(s.bars_at(1, 100.0 * f), None);
        assert_eq!(s.bars_at(2, 300.0 * f), None, "another load");
        let mut search = s.take_search(1).unwrap();
        // Then a check of the window between the keyframes that agree: one frame, a second in.
        let mut check = s.take_search(1).unwrap();
        assert_eq!((check.next(f), s.take_search(1)), (Some(240.0 * f + CHECK_AFTER), None));
        assert_eq!(check.read(11.0, 11.0, Some(Some((140, 0)))), None);
        assert_eq!((check.next(f), check.cut(f)), (None, None), "the same bars: nothing to find");
        super::tests::search(&mut search, 100, (0, 140), true);
        s.searched(1, &search, f);
        assert_eq!(s.bars_at(1, 99.0 * f), Some((0, 0)));
        assert_eq!(s.bars_at(1, 100.0 * f), Some((140, 0)));
        assert_eq!(s.bars_at(1, 239.0 * f), Some((140, 0)));
        // Due on the cut itself, and the lookahead says it found it there.
        assert_eq!(s.take(1, 99.0 * f), None);
        let c = s.take(1, 100.0 * f).unwrap();
        assert!((c.pts - 100.0 * f).abs() < 1e-9 && c.exact() && c.bars[0] == Some(140), "{c:?}");
        assert_eq!(s.found(1, 100.0 * f, None), None);
        // A step back before it: due again.
        s.rewind(1, 99.0 * f);
        assert_eq!(s.take(1, 100.0 * f).map(|c| c.exact()), Some(true));
        // Frames read on their own (asked for while paused) go in when clear.
        s.want(1, &[1000.0 * f, 100.0 * f]);
        assert_eq!(s.take_wanted(1), Some(1000.0 * f), "one already read is skipped");
        assert_eq!(s.take_wanted(1), None);
        s.frame(1, 1000.0 * f, bars(140, true));
        s.frame(1, 1001.0 * f, bars(140, false));
        assert_eq!((s.bars_at(1, 1000.0 * f), s.bars_at(1, 1001.0 * f)), (Some((140, 0)), None));
    }

    /// Where an invented episode's keyframes are.
    #[derive(Clone, Copy)]
    enum Gop {
        /// As x264/x265 place them with a 250-frame keyint: on every cut,
        /// except one less than 24 frames (min-keyint) after the last
        /// keyframe, i.e. right after a short shot; at least every 250 frames.
        Encoder,
        /// Only on every other cut (and every 250 frames): about half the
        /// shots have no keyframe of their own.
        EveryOtherCut,
    }

    /// An invented episode at 24 fps: 120 shots, each full frame or
    /// letterboxed (2.40:1 or 2.20:1) unlike the one before, of 40 to 200
    /// frames, every eighth a short one of 8 to 20. Each frame's bars, which
    /// frames are keyframes, and the cuts.
    fn episode(gop: Gop) -> (Vec<i64>, Vec<bool>, Vec<usize>) {
        let mut seed = 7u32;
        let mut rnd = |n: u32| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (seed >> 16) % n
        };
        let (mut frames, mut cuts, mut bars) = (Vec::new(), Vec::new(), 0);
        for shot in 0..120 {
            if shot > 0 {
                cuts.push(frames.len());
                bars = [0, 140, 100].into_iter().filter(|&b| b != bars).nth(rnd(2) as usize).unwrap();
            }
            let len = if shot % 8 == 7 { 8 + rnd(13) } else { 40 + rnd(161) } as usize;
            frames.extend(std::iter::repeat_n(bars, len));
        }
        let mut key = vec![false; frames.len()];
        let mut last = 0;
        for (i, k) in key.iter_mut().enumerate() {
            let cut = cuts.iter().position(|&c| c == i);
            let on_cut = match gop {
                Gop::Encoder => cut.is_some() && i - last >= 24,
                Gop::EveryOtherCut => cut.is_some_and(|n| n % 2 == 1),
            };
            if i == 0 || on_cut || i - last >= 250 {
                (*k, last) = (true, i);
            }
        }
        (frames, key, cuts)
    }

    /// Play an [`episode`] through the desktop engine's default path
    /// (cropdetect on every frame; a screenshot for our detector when its
    /// reading changes, back 2 frames later), with the lookahead or without.
    /// The share of the cuts whose bars change on the cut frame and jump
    /// there. `exact`: the exact probe finds the cuts between keyframes.
    fn landed_on_cut(gop: Gop, lookahead: bool, exact: bool) -> f64 {
        use crate::sampler::{Feed, Sampler, Sampling};
        let (frames, key, cuts) = episode(gop);
        let f = 1.0 / 24.0;
        let rect = |b: i64| Rect { w: 1920, h: 1080 - 2 * b, x: 0, y: b };
        let ours = |b: i64| Some(Measured { rect: rect(b), crisp: [b > 0, b > 0, false, false] });
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        let mut sampler = Sampler::new(Sampling::AroundChanges);
        let mut read = 0; // keyframes read by the lookahead so far
        let mut shot: Option<(usize, i64)> = None; // a screenshot's arrival frame and bars
        let mut on_cut = Vec::new();
        for (i, &b) in frames.iter().enumerate() {
            let pts = i as f64 * f;
            while lookahead && read < frames.len() && (read as f64 * f) < pts + AHEAD_SECS {
                if key[read] {
                    s.keyframe(1, read as f64 * f, bars(frames[read], frames[read] > 0));
                }
                read += 1;
            }
            while let Some(mut search) = s.take_search(1).filter(|_| exact) {
                while let Some(at) = search.next(f) {
                    let n = (at / f + 1e-9).floor() as usize;
                    if let Some(rest) = search.read(at, n as f64 * f, s.frame_bars(bars(frames[n], frames[n] > 0))) {
                        s.push_search(1, rest);
                    }
                }
                s.searched(1, &search, f);
            }
            let live = Some(rect(b));
            let due = s.take(1, pts).map(|c| (c, Why::Keyframe));
            if let Some((c, why)) = due.or(s.found(1, pts, live).map(|c| (c, Why::Window))) {
                t.cut(1, HD, c.bars, why);
            }
            if let Some((_, bars)) = shot.filter(|(at, _)| *at == i) {
                sampler.measured(ours(bars));
                shot = None;
            }
            match sampler.frame(live, t.following()) {
                Feed::Cropdetect(r) => t.update(1, HD, HD, r),
                Feed::Measured(m) => t.update_late(1, HD, HD, m),
                Feed::Wait => t.update(1, HD, HD, None),
            }
            if sampler.wants_shot() && shot.is_none() {
                shot = Some((i + 2, b));
            }
            if cuts.contains(&i) {
                on_cut.push(t.bars(1).0 == b && t.on_cut());
            }
        }
        on_cut.iter().filter(|&&l| l).count() as f64 / on_cut.len() as f64
    }

    #[test]
    fn with_the_lookahead_changes_land_on_their_cut() {
        let (_, key, cuts) = episode(Gop::Encoder);
        let off_keyframes = cuts.iter().filter(|&&c| !key[c]).count();
        assert!(off_keyframes * 10 >= cuts.len(), "a tenth or more of the cuts aren't keyframes: {off_keyframes}");
        let (on, off) = (landed_on_cut(Gop::Encoder, true, false), landed_on_cut(Gop::Encoder, false, false));
        assert!(on >= 0.9, "with the lookahead: {on}");
        assert!(off < on - 0.3, "without: {off}, with: {on}");
        // Shots with no keyframe whose bars differ from both neighbours are
        // left to the live detector: fewer land, but still far more than without.
        let (on, off) =
            (landed_on_cut(Gop::EveryOtherCut, true, false), landed_on_cut(Gop::EveryOtherCut, false, false));
        assert!(on >= 0.85 && off < on - 0.3, "every other cut a keyframe: {on} with, {off} without");
        // The exact probe finding cuts between keyframes.
        let exact = (landed_on_cut(Gop::Encoder, true, true), landed_on_cut(Gop::EveryOtherCut, true, true));
        assert!(exact.0 >= 0.99 && exact.1 >= 0.9, "{exact:?}");
    }

    /// Feed a frame to the tracker the way the engine does: the change due
    /// on it first, then its live reading. The bars and whether the zoom jumps.
    fn frame(t: &mut CropTracker, s: &mut Schedule, pts: f64, live: Option<Measured>) -> ((i64, i64), bool) {
        if let Some(c) = s.take(1, pts) {
            t.cut(1, HD, c.bars, Why::Keyframe);
        }
        t.update_measured(1, HD, HD, live);
        (t.bars(1), t.on_cut())
    }

    #[test]
    fn the_tracker_jumps_on_the_cut_frame() {
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        // An odd shape in a dark shot: live alone waits 12 frames.
        let odd = |crisp| bars(170, crisp);
        s.keyframe(1, 4.0, odd(false));
        s.keyframe(1, 6.0, odd(false));
        let f = 1.0 / 24.0;
        assert_eq!(frame(&mut t, &mut s, 4.0 - f, bars(0, false)), ((0, 0), false));
        assert_eq!(frame(&mut t, &mut s, 4.0, odd(false)), ((170, 0), true));
        assert_eq!(frame(&mut t, &mut s, 4.0 + f, odd(false)), ((170, 0), false));
        // A black frame on the cut keeps the jump.
        s.keyframe(1, 9.0, bars(0, true));
        frame(&mut t, &mut s, 9.0 - f, odd(false));
        assert_eq!(frame(&mut t, &mut s, 9.0, None), ((0, 0), true));
    }

    #[test]
    fn picture_in_scheduled_bars_still_uncrops_at_once() {
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 4.0, bars(140, true));
        assert_eq!(frame(&mut t, &mut s, 4.0, bars(0, false)), ((0, 0), true));
    }

    #[test]
    fn bars_already_on_the_frame_before_were_no_cut() {
        // The bars changed between keyframes: live saw them first, so the
        // keyframe isn't where they changed and nothing jumps there.
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 4.0, bars(170, false));
        s.keyframe(1, 6.0, bars(170, false));
        let f = 1.0 / 24.0;
        frame(&mut t, &mut s, 4.0 - 2.0 * f, bars(170, false));
        frame(&mut t, &mut s, 4.0 - f, bars(170, false));
        assert_eq!(frame(&mut t, &mut s, 4.0, bars(170, false)), ((0, 0), false));
    }
}
