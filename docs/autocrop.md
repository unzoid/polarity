# Autocrop: removing black bars without the viewer noticing

Status, 2026-11-06: built and tested in `crates/player`: the detector and the crisp-edge lock
(§2), the pre-roll's choice of opening bars (§3, `crop::opening_bars`, `CropTracker::open`),
animated bars (§5, `CropTracker::following`), every change a jump (§6, `crop::CropZoom`), the
bars of the frame on screen after a seek or a frame step (§4, `frames::Frames`). The desktop
engine (`src-tauri/src/player/autocrop.rs`) jumps for every change, and reads frames with our
detector (§2, "Our detector on the desktop"):
every frame on macOS, around cropdetect's changes on Windows and Linux, every frame there with a
setting; built and type-checked, untested with a real mpv (docs/unverified.md). The
pre-roll probe (§3) is wired in the desktop engine (`src-tauri/src/player/preroll.rs`) for
mpv as its own process (Windows), not yet for libmpv in the app (macOS); it type-checks here and is untested with a real mpv
(docs/unverified.md). The lookahead (§4) is wired there too, by range requests from a second
probe (way 2), untested with a real mpv and not yet measured.
The aim is crop changes the viewer doesn't notice: every frame shown with the crop worked out for
that frame, and every change a jump (#344: never eased).

**The setting (#330).** Autocrop is one of three crop modes (`src/lib/settings/cropMode.ts`):
Fit (no autocrop), Crop black bars (autocrop) and Fill window (autocrop, then mpv's `panscan`
covers the window: `crop::zoom_for` with `fill`). The player's crop button, its shortcut (Z),
TV's controller binding and Settings → Advanced → Crop share it; prefs from before #330 carry
over (autocrop on: Crop black bars, with Fill on too: Fill window). Without mpv the button skips
Crop black bars, and Fill window covers the window with the whole frame.

## 1. Before our detector (desktop)

mpv ran FFmpeg's `cropdetect` on every frame (`crop::CROPDETECT`, `reset=1`), and
`CropTracker` (`crates/player/src/crop.rs`) decided from those readings which bars to remove;
`src-tauri/src/player/autocrop.rs` turns that into `video-zoom`. What the viewer saw: the first
crop came a few frames into the film, and on a change of bars the crop followed a few frames
late (4 frames for a common shape, 12 for an odd one). Every change jumps (§6); a late one
lands frames after its cut, one seen on the frame it happens (back to full frame, picture in a
cropped bar) lands on it.
cropdetect still reads each frame on Windows and Linux; §2 says where our detector takes over.

## 2. Our own detector (`crates/player/src/bars.rs`)

FFmpeg's `cropdetect` is a GPL-only part, so the LGPL build (iOS, `plan-mobile.md` §7) has
none. `bars::detect` is an **independent implementation**, written from the idea and not from
`vf_cropdetect.c` (which a port would make GPL). Per frame:

- A line (row or column) is **bar** when at most 1% of 512 samples along it are lit (more than
  `limit` above `black`: 12 steps for SDR, 9 for HDR). Counting lit samples, not averaging,
  keeps a dark line with a few highlights (stars, a lamp) as picture.
- Bars run in from each edge; columns are judged over the picture's rows only, so a letterbox
  doesn't dilute them. A frame with no lit line (a fade) gives no reading.
- An edge is **crisp** when a line within 3 of the bar has at least 25% lit samples: the picture
  starts at once. Dark picture next to a bar comes up over many lines and isn't crisp.

`CropTracker::update_measured` takes crisp edges as leave to crop sooner: bars crisp on both
sides of an axis are cropped on their first frame when they leave a common shape (2.39:1,
1.85:1, 4:3, ...), after 2 frames otherwise. A wrong crop shows for one frame, since picture in
a cropped bar un-crops at once. Readings: luma (`Luma8`) or mpv's `screenshot-raw` (`Bgr0`).

**Measuring it against cropdetect.** `bun scripts/autocrop-compare.ts <film>` cuts shots from a
film without bars of its own (Sintel, Tears of Steel), frames each as full frame, 2.39:1, 1.85:1
or 4:3 at 1920x1080, so the truth is known, and runs both detectors through the same tracker
(`cargo run --release -p polar-player --example autocrop_compare`). Columns: time to first crop
per change of bars, bars never cropped, crop changes per minute, frames that cut picture off,
frames that leave bars on screen. A second table counts how each crop change would be shown (§6):
on the cut, following animated bars, caught late, correcting a misread (on the frame or late),
and changes into a misread. A third table gives, per shot, the frames that cut picture
off, and our detector also runs at its earlier limit (24) and at cropdetect's level (8) for comparison. Needs an ffmpeg built
with `cropdetect` (a GPL build) and a test film (Sintel from download.blender.org).

**First results** (16 shots of 8 s each, 2026-11-05). On Tears of Steel our detector does
better on every column: first crop 0 ms on average against 42, no frame cutting picture against
2, and 13 of 15 crop changes on the cut. On Sintel it crops sooner (500 ms against 792) and leaves
bars on fewer frames (40 against 115), but cuts picture on more (114 against 78), and as many
with crisp edges ignored, so the extra cut comes from the readings, not the crisp lock. Likely
cause, to be confirmed by the limit rows: cropdetect's `limit=0.09` is compared with
limited-range luma as decoded, so a line is picture from about 7 steps above black (16), while
our 24 steps over full-range luma is about 21 limited steps, so dim picture at the edge of
Sintel's dark shots reads as bar.

**Limit rows** (same clips, our detector at 16, 12 and 8). Lower is better on every column
of both films. On Sintel, picture is cut on 92, 89 and 86 frames, against 114 at 24 and 78 for
cropdetect; bars are left on 28, 16 and 12 frames (115 for cropdetect); the first crop comes
at 417, 375 and 333 ms on average (792); and 10 to 12 of 15 changes land on the cut (4).
On Tears of Steel, 12 and 8 are right on every frame. The limit is now **12** (HDR 9, in
cropdetect's ratio): nearly all the gain of 8, with some room for grain in the bars of real
releases, which the clean padding of these clips doesn't test.

The per-shot table also showed a fault in the measuring itself: on Sintel, shots without bars
of their own cut picture on 1, 2, 3, 4, 5, then 6 frames, one more with each shot, while cropdetect
cut none. The clip decoded to 3078 frames, not 16 × 192: written as rawvideo, ffmpeg keeps a
constant frame rate and repeated a frame at six joins, so our detector's frames fell behind the
truth and cropdetect's readings. The script now decodes every frame once (`-fps_mode
passthrough`), and `autocrop_compare` stops when the frame count or cropdetect's readings don't
match the clip. Our rows on Sintel above therefore counted too many frames cutting picture (at least those 21).

**Run again with every frame decoded once** (85017d7, 3072 frames per film, limit 12). Our
detector is ahead of cropdetect on every column of both films. Sintel: first crop 208 ms on
average against 792, picture cut on 52 frames against 78, bars left on 6 against 115, and 10 of
the changes on the cut against 4. Tears of Steel: right on every frame (first crop 0 ms, nothing
cut, no bars left) against 42 ms, 2 and 12 for cropdetect. What cuts picture on Sintel is two
shots (22 and 30 frames, cropdetect 42 and 35), dark scenes whose dim edges both detectors read
as bar. The limit 8 row is slightly better on Sintel (49 and 2); 12 stays, for the grain these
clips don't have.

### Our detector on the desktop

cropdetect runs inside mpv; our detector needs the frame's pixels, and gets them as a screenshot
of the frame on screen in mpv's own copy (`video`: the decoded frame at its size, unzoomed, without
subtitles). `polar_player::sampler` decides, frame by frame, which reading goes to the tracker:

- **macOS: every frame, in memory.** libmpv runs in the app, so `screenshot-raw video` hands
  the frame over as `bgr0` through a weak client of the player (`mac::Frames`,
  `polar_mpv_frame` in `src-tauri/src/macos/mpv_view.m`). cropdetect isn't run, so hardware
  decoding stays zero-copy (no copy-back, `Tune::hwdec_mode`). Each reading carries its frame's
  pts (`time-pos` the same before and after reading it), for following animated bars (§5).
- **Windows and Linux, by default: around changes.** cropdetect reads each frame. When its
  reading changes, a screenshot is taken (an uncompressed PNG, `--screenshot-png-compression=0`,
  read by `polar_player::png` and deleted), then more, one at a time, while our readings keep
  moving or the tracker follows animated bars (§5), until 3 in a row agree. Meanwhile only our
  readings feed the tracker, so crisp edges and follow mode work as on every frame. A screenshot
  that hasn't come within 12 frames gives way to cropdetect again.
- **Windows and Linux, opt-in: every frame.** Settings → Advanced, "Check every frame for black
  bars" (off by default, for powerful computers): a screenshot of every frame, one at a time,
  and cropdetect still reading each frame, with its copy-back from the GPU (#344): its reading
  comes on time, so animated bars are followed on their frame (§5).

A screenshot is of the frame on screen and arrives a frame or two after it was asked for, so a
change it finds lands that much after its cut (cropdetect's readings run a frame ahead). The
lookahead (§4) still puts known changes on the cut itself.

**What it costs.** Per frame, measured here (`cargo run --release -p polar-player --example
autocrop_cost`, one core of an i7-10710U), with a letterboxed picture:

| frame | PNG per frame | written per second at 24 fps | read PNG + detect | detect on `bgr0` (macOS) |
|---|---|---|---|---|
| 1920x1080 | 6.22 MB | 149 MB | 5.6 ms | 0.64 ms |
| 3840x2160 | 24.89 MB | 597 MB | 19.3 ms | 1.43 ms |

So every frame on Windows writes about 150 MB a second for 1080p and 600 MB for 4K (each file is
deleted at once, but the writes happen), and Polarity spends about an eighth of a core reading
1080p (half a core for 4K). Around changes, the default, writes only for the second or so after a
change. On macOS nothing is written and our side costs under 1.5 ms a frame. mpv's own share
(reading the frame back from the GPU, writing the PNG) and the screenshots per second it keeps
up with need the desktop build: the engine logs both every 10 s while screenshots are taken
(`autocrop: N screenshots/s, N MB/s written, N ms each reading them here`), to be filled in here
and in the setting's caption (docs/unverified.md).

## 3. Pre-roll: the crop is right on the first frame

While the stream buffers, a second, light player instance (the **probe**) opens the same link:

- `--aid=no --sid=no --ao=null --vo=null`, `--hr-seek=no` and `--vd-lavc-skipframe=nonkey`,
  so every seek lands on a keyframe and only keyframes are decoded; `--hwdec=no`, `--cache=no`
  and a small `--demuxer-max-bytes`. On the desktop it is a second mpv process driven over its
  own IPC socket, which can't carry `screenshot-raw`'s bytes: each keyframe is written with
  `screenshot-to-file` as a PNG at `--screenshot-png-compression=0` (stored, not compressed),
  read by `polar_player::png` and deleted. Where libmpv runs in the app (macOS, phones),
  `screenshot-raw` hands the frame over directly.
- It seeks to 8 points spread over the 3 minutes from where playback starts
  (`crop::opening_points`; from the beginning it skips the first 10 s, which are often logos
  on black) and measures one keyframe at each with our own detector (`bars::detect`, levels by
  the video's gamma), scaled from the screenshot's size to the video's pixels. Cost: about 8 keyframes and the container
  index, a few MB, read with range requests alongside the main buffering.
- The bars at least 5 of the 8 agree on (within 4 px, crisp on both sides, even) are the
  opening crop, the thinnest of them (`crop::opening_bars`); fades don't vote, and anything
  less clear starts uncropped, as today. `CropTracker::open` starts the load with them, as
  bars this file has shown: picture in them un-crops on its first frame. The main player loads paused with `video-zoom`
  already set, and starts when the probe is done or after a 1.5 s budget, whichever is first,
  so autocrop never delays the start by more than that. What came by then votes: with fewer
  than 8 readings, the same 5-in-8 share of them must agree.
- Films that change aspect (IMAX sequences) start with their dominant opening bars; §4 handles
  the changes.

## 4. Lookahead: a change lands on the frame it happens

Encoders put keyframes at scene cuts (x264/x265 `scenecut`), and bars almost always change at
a cut. A lookahead decoder runs ahead of the playhead decoding only keyframes at low cost, and
hands the tracker a **schedule**: from pts P on, these bars. The engine applies each entry when
the frame with pts P is displayed, so the crop changes on the cut itself, where a jump can't be
seen. Changes the lookahead can't see (bars that change between keyframes, live streams) are
left to the live detector of §1-2, as today.

**Where the lookahead reads from.** libmpv gives no API to read packets out of its demuxer
cache (`client.h`; `demuxer-cache-state` reports only ranges and sizes). Two ways:

1. **From mpv's own cache, no extra download.** `dump-cache <start> no <file>` writes the cached
   packets to a file and keeps appending what mpv reads from the network ("continuous dumping",
   `input.rst`). Polarity's cache already reads 90 s ahead (`--cache-secs=90`,
   `--demuxer-max-bytes=192MiB`), so the probe decodes keyframes from that file up to ~90 s
   ahead. Costs: disk writes at the film's bitrate (a 2 h 10 Mbps film: ~9 GB written to a
   temporary file, kept to a window by restarting the dump), and mpv's caveats: the dump works
   reliably only when the output format matches the input's (MKV to MKV, MP4 to MP4), and a seek
   outside the cache breaks it (restart the dump after each such seek). Started at load time,
   when the cache is nearly empty, since dumping a large cache at once freezes the player.
2. **Own range requests.** The probe of §3 keeps running, seeking keyframe to keyframe ahead of
   the playhead through the container's index (MKV Cues, MP4 `stss`). It downloads keyframes
   only: at one keyframe every 2-4 s of 150-500 KB each, roughly 0.3-2 Mbit/s, i.e. 3-15% on top
   of a 10-20 Mbit/s film (to be measured). It needs a seekable source with an index; HLS/DASH
   segments start with a keyframe, so there it fetches only the first part of each segment.

The plan is (1) on desktop, where disk and bandwidth are plentiful and nothing is fetched twice,
and (2) where (1) fails (format mismatch, no disk), with the measurements below deciding the
defaults per device class.

**What gets measured** (in the app, on a 10 Mbit/s MKV and an HLS stream, 10 minutes each):
extra bytes received (from mpv's `raw-input-rate` on both instances), probe CPU time (process
CPU against playback alone), on phones battery drain over 30 minutes against the same run
without lookahead (Android `BatteryManager`, iOS `UIDevice.batteryLevel`), and how many crop
changes landed on the cut frame. The lookahead gets its own setting (Settings → Advanced, under
Autocrop: "Look ahead for bar changes"), on by default where the measured cost is small, off by
default on phones on mobile data if it isn't.

**Landing on a frame.** The engine observes `time-pos` per displayed frame (as autocrop does
now) and sets `video-zoom` when the next frame's pts reaches P; readings already run a frame
ahead of the screen, so the change lands on the cut. To check on the desktop build: frame-exact
landing with `--video-sync=display-resample` and without.

**In code** (`crates/player/src/lookahead.rs`): `Schedule` takes the lookahead's keyframe
readings in pts order (`keyframe`). A keyframe's bars on an axis count when they are even, at
least 1% a side and leave 40% of the frame; black frames and uneven readings don't count. New
bars are scheduled on the keyframe they first show on, at once when crisp on both sides, or when
a later keyframe reads them again; and every later keyframe that reads the same bars is due
too, since a shot with no keyframe of its own may have come in between and changed them live.
Per displayed frame the engine calls `take(pts)` and hands a due change to `CropTracker::cut`
before that frame's reading, so `on_cut` is true and the zoom jumps. A change believed only
after its frame was shown is dropped, never applied late; an axis whose bars the frame before
already had is left alone; picture in the new bars still un-crops on the next reading.
`restart` after a seek; `wants_more` keeps the reading within `AHEAD_SECS` (60 s, inside mpv's
90 s cache).

**Cuts between keyframes.** Encoders don't put every cut on a keyframe: x264 and x265 skip one
less than `min-keyint` after the last keyframe (right after a short shot), and anime encodes
use long keyframe intervals. Each change then carries `after`, the keyframe before it that
still had the old bars: the cut is somewhere after it. On every frame in that window the engine
also calls `found(pts, cropdetect's reading)`, and the first frame whose own reading shows the
new bars where the frame before didn't is taken as the cut: the change is applied there
(`Why::Window`) and is no longer due on its keyframe. What the lookahead can't see is a shot
with no keyframe at all whose bars differ from both its neighbours; that is the live tracker's,
and its end is put right on the next keyframe.

**Finding the cut by reading frames** (`lookahead::CutSearch`). The live reading only finds such
a cut where cropdetect runs and reads it clearly, so on the desktop the lookahead also finds it
itself: a third mpv (`--hr-seek=yes`, every frame decoded) seeks exactly into the window between
the two keyframes and reads the frame there with our detector, halving the window each time,
until the last frame with the old bars and the first with the new are next to each other (about
8 readings for 10 s at 24 fps). The change is then due on that frame exactly
(`Change::exact`, logged as found between keyframes) and no longer waits for a live reading. A
frame with neither the old nor the new bars (a shot with no keyframe of its own) splits the
window into a search each side of it; an unclear reading ends the search without a cut (left to
the live reading as before); a black frame counts as the new bars, since a crop can't be seen on
black. Between keyframes that agree, one frame 1 s past the first is read (`CutSearch::check`):
encoders skip the keyframe on a cut less than `min-keyint` after the last one, right after a
short shot, so a shot with other bars is most likely there. Searches for cuts already shown are
skipped.

**The frame on screen** (`frames::Frames`, `lookahead::Timeline`). Everything the lookahead
reads also goes into a timeline of bars by pts, kept for the whole load: between two keyframes
read one after the other, their bars when they agree, or the old bars up to the cut found and
the new from it on; single frames read exactly; only bars crisp on both sides (a dark shot read
as bars isn't believed from one keyframe). The engine hands every `time-pos` to `Frames`, which
tells playing on from a jump:

- Playing on: the readings and the scheduled changes are of the next frame, as above.
- A frame step either way (paused): the frame on screen is the one the zoom lands on. It gets
  its bars from the timeline at once (`Why::Known`), and a screenshot of it (paused, so of that
  very frame) checks them, or decides them where nothing was read (`CropTracker::still`, judged
  as a file's first frame: crisp bars of a common shape, or picture in the bars shown). The
  frames one step either side are asked of the exact probe meanwhile (`Schedule::want`), so the
  next step finds them read. Stepping back, the changes after the frame are due again
  (`Schedule::rewind`).
- A seek (playing): the next frame's bars from the timeline. With the lookahead on and nothing
  read there yet, playback is held (paused) until a screenshot of the frame on screen is read,
  for at most 2 s, rather than play on with the wrong crop. Without the lookahead the live
  readings decide, as when playing.

**How much lands on the cut** (`lookahead::tests::with_the_lookahead_changes_land_on_their_cut`,
an invented episode of 120 shots played through the engine's default path, cropdetect on every
frame and a screenshot 2 frames late): with keyframes placed as x264 places them (keyint 250,
min-keyint 24, every eighth shot under a second, 14 of 119 cuts between keyframes) 91.6% of the
changes land on their cut frame with the lookahead, 52.1% without, and all of them (100%) once
the exact probe finds the cuts between keyframes (below); with only every other cut a keyframe,
88.2% against 52.1%, and 93.3% with the exact probe. `scripts/autocrop-keyframes.ts` encodes the same episode for real
(`make`), counts how many of any video's bar changes fall on a keyframe (`measure`), and scores
a playback from the player's log (`score`).

**Is it running?** The lookahead says in the log, and under its setting in Settings → Advanced,
whether it reads ahead in the video playing now or why it can't (`preroll::Lookahead`): the
second mpv didn't start, the source didn't open a second time (a link that allows one
connection), a live stream, a source that can't be sought by keyframe, or one that stopped
answering and kept failing when opened again three times (it is opened again after a dropped
connection, and waits at the file's end until a seek); on macOS, iOS and Android there's no
second player yet.

**In the desktop engine** (`src-tauri/src/player/preroll.rs`, `ahead`): way 2 first, as it
needs nothing of the main player's cache. Once a load has its opening bars, the autocrop loop
starts a second probe (same options as §3) that seeks to the keyframe at or before the
playhead, then steps `seek 0.1 relative+keyframes` (doubling the step while mpv lands on the
same keyframe), reads each keyframe with our detector and feeds `Schedule`. It waits while
`AHEAD_SECS` are read, starts again after a seek (the playhead moves back, jumps on, or passes
what was read), and stops with the next load, with autocrop or with its setting (Settings →
Advanced, "Look ahead for bar changes", on by default). The autocrop loop hands `take(pts of the
next frame)` (`container-fps`) to `CropTracker::cut` before that frame's reading. Live streams
(no duration) get no lookahead. Way 1 (the dump) and the measurements are still to do.

## 5. Animated bars: follow the picture

Some films move their own bars: the bars open or close over a few seconds within a shot. Hysteresis there would make the crop lag the image. The tracker enters
**follow mode** when 3 frames in a row have crisp edges that move the same way by a small step
(at most 3% of the frame per frame), and then shows each frame's crisp reading as it is: no
hold, no easing, and the 1% minimum zoom change (`zoom_changed`) is skipped so each step is
sent. It leaves follow mode when the edges hold still for 2 frames (shown where they came to rest,
then normal rules apply), or an edge stops being crisp (then it keeps the last bars until the
usual rules decide).

On the desktop the crisp readings are screenshots, which arrive a frame or two after their frame.
So while following, the bars shown are where they stand on the frame the zoom lands on
(`Sampler::lead`, `CropTracker::lead`), not where the newest screenshot saw them (#344):

- **Windows and Linux:** cropdetect's reading of that frame, which comes on time. The screenshots
  still say whether the edges are crisp, and so when following starts and ends. A cropdetect
  reading more than 4 frames' worth of the fastest step (3% of the frame) from the newest
  screenshot is taken for a misreading and left out.
- **macOS:** no cropdetect, so the movement of the last two screenshots is carried on to that
  frame (`Sampler::predict`), but only for edges moving outwards (the picture growing). Edges
  moving inwards stay where the last screenshot saw them, so the crop never cuts into the
  picture where a move stops: while bars close in, a few pixels of bar show for as many frames
  as the screenshots run late, and where opening bars stop, a few pixels of bar show for that
  long too, until the screenshots see them at rest. So on macOS the crop can be a frame or two
  off while bars move.

## 6. Every change is a jump

A change of crop always jumps to the new zoom, in every mode and for every reason; nothing is
eased (#344). An eased zoom showed frames with a crop that belonged to none of them, and while
paused (stepping frame by frame) it moved in steps of half a second. So the aim is that each
change lands on its frame, and where it can't, that it is one jump as soon as it is known:

- **On the frame it belongs to:** the lookahead's keyframe (`Why::Keyframe`), the cut found
  between keyframes, by the exact probe or by the first frame's own reading in the window
  (`Why::Window`), a reading of that very frame (cropdetect's, which runs a frame ahead of the
  screen) that changes the bars where the frame before had others (`Why::Cut`), the bars read
  for the frame on screen after a seek or a step (`Why::Known`), and, paused, that frame's own
  screenshot (`Why::Still`). Followed animated bars (§5) move frame by frame (`Why::Follow`).
- **Late, as one jump** (`Why::Late`): a change believed a few frames after its cut (the live
  tracker's hold for unclear bars), or brought by a screenshot, which arrives a frame or two
  after the frame it shows. With the lookahead on this is left for what it can't see (a shot
  with no keyframe whose bars differ from both neighbours) and the detector correcting itself;
  with it off, any change seen live can come this late (the setting's caption says so).

Each change is logged with its rule ("autocrop: bars 140/0 px from 12.375 s, on the cut: jump
(lookahead, keyframe)"). In code: `CropTracker::changed` says which rule changed the bars on the
newest frame, and `crop::CropZoom` sends the new zoom at once; without a change of bars, a drift
of the zoom under 1% (`zoom_changed`) isn't sent.

The rule that keeps misreads rare stays: the picture is never shrunk (bars cropped further) on a
dark or fading shot unless the bars are confirmed: crisp on both sides (§2), or held still for 2
frames at bars this file has shown, 4 at a common shape and 12 at any other; un-cropping is
always at once, on the frame the picture appears in a cropped bar (`CropTracker::revealed`).

## 7. Open

- Our detector on the desktop (§2): mpv's share of the cost and the screenshots per second it
  keeps up with, from the desktop build, into §2's table and the setting's caption.
- Lookahead defaults per device, after §4's measurements.
