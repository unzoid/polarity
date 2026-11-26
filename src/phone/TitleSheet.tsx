import "../styles/detail.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Entry } from "../lib/router";
import { CLOSE_MS, CLOSE_TAU, easeOutSamples, lerp, lerpRect, OPEN_MS, OPEN_OMEGA, play, ramp, reduced, samples, type Rect } from "./motion";
import { liveOrigin, type Origin } from "./origin";
import { AnimeBody, TitleBody } from "./TitleBody";

/** The sheet's top corners, and the page under it stepping back (Netflix's Home recedes as the card grows). */
const TOP_RADIUS = 12;
const RECEDE = 0.92;
/** How dark the page behind gets: enough to set the sheet apart, not so much that it stops being seen stepping back. */
const DIM = 0.8;

/**
 * A run of titles in one sheet (a title, and those opened from its More Like This): the top one shows, the ones
 * under it keep their place for Back. It grows out of the poster that opened it and goes back into it
 * (motion.ts, measured off Netflix's), or slides up and down when there's no poster to go to. Pulled down by
 * its picture (or by its page at the top), it follows the finger and closes past a point, as Netflix's does.
 */
export function TitleSheet({
  entries,
  leaving,
  playing = false,
  origin,
  z,
  onGone,
  onClose,
  onBack,
}: {
  entries: Entry[];
  leaving: boolean;
  playing?: boolean;
  origin?: Origin;
  z: number;
  onGone: () => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  /** Where the sheet is drawn now, when a finger has moved it (the close starts from there). */
  const dragged = useRef<Rect | null>(null);
  const running = useRef<Animation[]>([]);
  const top = entries[entries.length - 1];

  const stop = () => {
    running.current.forEach((a) => a.cancel());
    running.current = [];
  };
  const track = (...list: (Animation | undefined)[]) => {
    for (const a of list) if (a) running.current.push(a);
  };
  const rest = (): Rect => {
    const el = sheet.current!;
    return { x: 0, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  };

  // Opening.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const S = rest();
    const stage = document.querySelector<HTMLElement>(".ph-stage");
    const from = origin;
    if (reduced()) return;
    if (from) {
      const frames = samples(OPEN_OMEGA, OPEN_MS);
      const P: Rect = from;
      track(
        play(el, frames.map(({ offset, p }) => ({ offset, ...sheetFrame(lerpRect(P, S, p), S, lerp(from.radius, TOP_RADIUS, p), lerp(from.radius, 0, p)) })), OPEN_MS),
        play(content.current, frames.map(({ offset, t, p }) => ({ offset, opacity: ramp(t, 190, 380, 0, 1), transform: contentScale(lerpRect(P, S, p), S) })), OPEN_MS),
        play(surface.current, frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 250, 430, 1, 0) })), OPEN_MS),
        from.src
          ? play(
              ghost.current,
              frames.map(({ offset, t, p }) => ({ offset, opacity: ramp(t, 120, 240, 1, 0), filter: `blur(${ramp(t, 0, 170, 0, 16).toFixed(2)}px)`, transform: ghostFrame(lerpRect(P, S, p), S, from) })),
              OPEN_MS,
            )
          : undefined,
        play(scrim.current, frames.map(({ offset, p }) => ({ offset, opacity: Math.min(DIM, p * 1.3) })), OPEN_MS),
        play(stage, frames.map(({ offset, p }) => ({ offset, transform: `scale(${lerp(1, RECEDE, p)})` })), OPEN_MS, "recede"),
      );
    } else {
      const frames = samples(OPEN_OMEGA, OPEN_MS);
      track(
        play(el, frames.map(({ offset, p }) => ({ offset, transform: `translateY(${((1 - p) * 100).toFixed(3)}%)` })), OPEN_MS),
        play(scrim.current, frames.map(({ offset, p }) => ({ offset, opacity: p * DIM })), OPEN_MS),
        play(stage, frames.map(({ offset, p }) => ({ offset, transform: `scale(${lerp(1, RECEDE, p)})` })), OPEN_MS, "recede"),
      );
    }
    // Stepped back, the page gets its corners (phone.css); the close takes them off again.
    stage?.setAttribute("data-recede", "");
    // Done: the sheet as CSS draws it, nothing held by an animation.
    const all = running.current;
    void Promise.all(all.map((a) => a.finished))
      .then(() => {
        all.filter((a) => a.id !== "recede").forEach((a) => a.cancel());
        running.current = running.current.filter((a) => a.id === "recede");
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing: into the poster where it is now, or down off the screen.
  useLayoutEffect(() => {
    if (!leaving) return;
    const el = sheet.current;
    if (!el) return onGone();
    const S = rest();
    const from = dragged.current ?? S;
    dragged.current = null;
    stop();
    el.style.transform = "";
    if (scrim.current) scrim.current.style.opacity = "";
    const stage = document.querySelector<HTMLElement>(".ph-stage");
    // Home as it's drawn now (stepped back, or partly forward under a finger), to come forward from there.
    const drawn = stage ? getComputedStyle(stage).transform : "none";
    const stageAt = drawn && drawn !== "none" ? new DOMMatrix(drawn).a : 1;
    stage?.getAnimations().forEach((a) => a.cancel());
    if (stage) stage.style.transform = "";
    // Its corners ease off as it comes forward (phone.css), rather than squaring off once it's there; unless another
    // sheet still holds it back.
    if (stage && !document.querySelector(".ps-layer:not([data-leaving])")) stage.removeAttribute("data-recede");
    if (reduced()) return onGone();
    const to = liveOrigin(origin);
    // The poster holds still while the sheet goes into it: its page and its row stop where they are (a fling in
    // progress too), and a finger meanwhile scrolls nothing (phone.css catches it on the leaving layer).
    const frozen: HTMLElement[] = [];
    for (let n = to?.el?.parentElement; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) {
        n.style.overflow = "hidden";
        frozen.push(n);
      }
    }
    const thaw = () => frozen.forEach((n) => (n.style.overflow = ""));
    const frames = easeOutSamples(CLOSE_TAU, CLOSE_MS);
    const anims: (Animation | undefined)[] = [];
    if (to) {
      to.el!.style.visibility = "hidden";
      anims.push(
        play(el, frames.map(({ offset, p }) => ({ offset, ...sheetFrame(lerpRect(from, to, p), S, lerp(TOP_RADIUS, to.radius, p), lerp(0, to.radius, p)) })), CLOSE_MS),
        play(content.current, frames.map(({ offset, t, p }) => ({ offset, opacity: ramp(t, 0, 150, 1, 0), transform: contentScale(lerpRect(from, to, p), S) })), CLOSE_MS),
        play(surface.current, frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 0, 120, 0, 1) })), CLOSE_MS),
        to.src
          ? play(
              ghost.current,
              frames.map(({ offset, t, p }) => ({ offset, opacity: ramp(t, 40, 170, 0, 1), filter: `blur(${ramp(t, 120, 340, 16, 0).toFixed(2)}px)`, transform: ghostFrame(lerpRect(from, to, p), S, to) })),
              CLOSE_MS,
            )
          : undefined,
        play(scrim.current, frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 0, 200, DIM, 0) })), CLOSE_MS),
        play(stage, frames.map(({ offset, t }) => ({ offset, transform: `scale(${ramp(t, 0, 220, stageAt, 1)})` })), CLOSE_MS),
      );
    } else {
      const lift = from.y - S.y;
      anims.push(
        play(el, frames.map(({ offset, p }) => ({ offset, transform: `translateY(${lerp(lift, S.h + 40, p).toFixed(2)}px)` })), CLOSE_MS),
        play(scrim.current, frames.map(({ offset, p }) => ({ offset, opacity: DIM * (1 - p) })), CLOSE_MS),
        play(stage, frames.map(({ offset, p }) => ({ offset, transform: `scale(${lerp(stageAt, 1, p)})` })), CLOSE_MS),
      );
    }
    const list = anims.filter((a): a is Animation => !!a);
    void Promise.all(list.map((a) => a.finished))
      .catch(() => {})
      .then(() => {
        if (to?.el) to.el.style.visibility = "";
        thaw();
        stage?.getAnimations().forEach((a) => a.cancel());
        onGone();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // A title opened from another, or Back to it: the sheet goes black and the title fades in, as Netflix's does.
  const shownKey = useRef(top.key);
  useLayoutEffect(() => {
    if (shownKey.current === top.key) return;
    shownKey.current = top.key;
    const page = content.current?.querySelector<HTMLElement>(`[data-entry="${top.key}"]`);
    page?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: reduced() ? 1 : 380, easing: "ease-out" });
    page?.querySelector<HTMLElement>(".ps-scroll")?.scrollTo({ top: 0 });
  }, [top.key]);

  // Pulled down: from the picture anywhere, from the page when it's at its top.
  useEffect(() => {
    const el = sheet.current;
    if (!el || leaving) return;
    let y0 = 0;
    let x0 = 0;
    let dy = 0;
    /** The last two touch positions, for the speed the finger let go at. */
    let prev = { y: 0, t: 0 };
    let last = { y: 0, t: 0 };
    let state: "idle" | "maybe" | "drag" = "idle";
    const stage = document.querySelector<HTMLElement>(".ph-stage");
    let moveBound = false;
    const bindMove = () => {
      if (moveBound) return;
      moveBound = true;
      el.addEventListener("touchmove", onMove, { passive: false });
    };
    const unbindMove = () => {
      if (!moveBound) return;
      moveBound = false;
      el.removeEventListener("touchmove", onMove);
    };
    const onStart = (e: TouchEvent) => {
      state = "idle";
      unbindMove();
      if (e.touches.length !== 1 || !(e.target instanceof Element)) return;
      const page = e.target.closest<HTMLElement>(".ps-scroll");
      // The page scrolled down scrolls; only at its top (or on the picture) does a pull take the sheet.
      // Attach the non-passive touchmove only while a pull is possible so normal scrolling stays off the main thread.
      if (!e.target.closest(".ps-media") && page && page.scrollTop > 0) return;
      const t = e.touches[0];
      y0 = t.clientY;
      x0 = t.clientX;
      prev = last = { y: t.clientY, t: performance.now() };
      state = "maybe";
      bindMove();
    };
    const apply = () => {
      const s = 1 - 0.2 * Math.min(1, dy / 420);
      // Origin at the top left, as the open and close draw it: shrinking toward the middle of the screen.
      el.style.transform = `translate(${(((1 - s) * el.offsetWidth) / 2).toFixed(1)}px, ${(dy * 0.62).toFixed(1)}px) scale(${s.toFixed(4)})`;
      const away = Math.min(1, dy / 260);
      if (scrim.current) scrim.current.style.opacity = String(DIM * (1 - 0.85 * away));
      if (stage) stage.style.transform = `scale(${lerp(RECEDE, 1, away).toFixed(4)})`;
    };
    const onMove = (e: TouchEvent) => {
      if (state === "idle") return;
      const t = e.touches[0];
      if (state === "maybe") {
        const ddy = t.clientY - y0;
        const ddx = t.clientX - x0;
        // Sideways (a row, the tabs) or upward (scrolling the page): not a pull.
        if ((Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy)) || ddy < -6) {
          state = "idle";
          unbindMove();
          return;
        }
        if (ddy <= 8) return;
        state = "drag";
        stop();
        stage?.getAnimations().forEach((a) => a.cancel());
        y0 = t.clientY;
      }
      e.preventDefault();
      dy = Math.max(0, t.clientY - y0);
      prev = last;
      last = { y: t.clientY, t: performance.now() };
      apply();
    };
    const onEnd = () => {
      unbindMove();
      if (state !== "drag") {
        state = "idle";
        return;
      }
      state = "idle";
      const stale = performance.now() - last.t > 90;
      const v = stale ? 0 : (last.y - prev.y) / Math.max(1, last.t - prev.t);
      if (dy > 120 || (v > 0.55 && dy > 24)) {
        const r = el.getBoundingClientRect();
        dragged.current = { x: r.left, y: r.top, w: r.width, h: r.height };
        onClose();
        return;
      }
      // Not far enough: back up.
      const now = el.style.transform;
      el.style.transform = "";
      el.animate([{ transform: now }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      if (scrim.current) {
        const o = scrim.current.style.opacity;
        scrim.current.style.opacity = "";
        scrim.current.animate([{ opacity: o }, { opacity: DIM }], { duration: 320, easing: "ease-out" });
      }
      if (stage) {
        const from = stage.style.transform;
        stage.style.transform = "";
        stage.animate([{ transform: from }, { transform: `scale(${RECEDE})` }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards", id: "recede" });
      }
      dy = 0;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      unbindMove();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [leaving, onClose]);

  return (
    <div className="ps-layer" ref={layer} style={{ zIndex: z }} data-leaving={leaving || undefined}>
      {/* Leaving, the layer takes every touch, so nothing under it scrolls away from the poster it lands in. */}
      {leaving && <div className="ps-catch" aria-hidden />}
      <div className="ps-scrim" ref={scrim} onClick={onClose} aria-hidden />
      <div className="ps-sheet" inert={leaving || undefined} ref={sheet} role="dialog" aria-modal aria-label={(top.route.name === "detail" && top.route.preview?.name) || "Title"} data-anime={top.route.name === "anime-detail" || undefined}>
        <div className="ps-surface" ref={surface} aria-hidden />
        <div className="ps-content" ref={content}>
          {entries.map((e, i) => {
            const r = e.route;
            const isTop = e === top;
            const back = i > 0 ? onBack : undefined;
            const active = isTop && !leaving && !playing;
            return (
              <div key={e.key} className="ps-page" data-entry={e.key} data-top={isTop || undefined} inert={!isTop || undefined}>
                {r.name === "detail" && <TitleBody type={r.type} id={r.id} preview={r.preview} episode={r.episode} season={r.season} top={active} onClose={onClose} onBack={back} />}
                {r.name === "anime-detail" && <AnimeBody id={r.id} preview={r.preview} top={active} onClose={onClose} onBack={back} />}
              </div>
            );
          })}
        </div>
        {origin?.src && (
          <div className="ps-ghost" ref={ghost} aria-hidden style={{ width: origin.w, height: origin.h }}>
            <img src={origin.src} alt="" decoding="sync" />
          </div>
        )}
      </div>
    </div>
  );
}

/** The sheet's own transform and corners drawing it at `r` (it's laid out at `S`). */
function sheetFrame(r: Rect, S: Rect, top: number, bottom: number) {
  const sx = r.w / S.w;
  const sy = r.h / S.h;
  const h = (v: number) => `${(v / sx).toFixed(2)}px`;
  const v = (n: number) => `${(n / sy).toFixed(2)}px`;
  return {
    transform: `translate(${(r.x - S.x).toFixed(2)}px, ${(r.y - S.y).toFixed(2)}px) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`,
    borderRadius: `${h(top)} ${h(top)} ${h(bottom)} ${h(bottom)} / ${v(top)} ${v(top)} ${v(bottom)} ${v(bottom)}`,
  };
}

/** The content inside the scaled sheet at one uniform scale (the width's), its top at the sheet's top. */
function contentScale(r: Rect, S: Rect) {
  const sx = r.w / S.w;
  const sy = r.h / S.h;
  return `scale(1, ${(sx / sy).toFixed(5)})`;
}

/** The poster inside the scaled sheet: uniformly covering the sheet's box at `r`, centred, never squashed. */
function ghostFrame(r: Rect, S: Rect, p: Rect) {
  const sx = r.w / S.w;
  const sy = r.h / S.h;
  const g = Math.max(r.w / p.w, r.h / p.h);
  const tx = (r.w - p.w * g) / (2 * sx);
  const ty = (r.h - p.h * g) / (2 * sy);
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${(g / sx).toFixed(5)}, ${(g / sy).toFixed(5)})`;
}
