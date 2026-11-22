import "../styles/detail.css";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { useLayoutEffect, useRef } from "react";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import type { Entry } from "../lib/router";
import { IconBack, IconClose } from "../phone/icons";
import { liveOrigin, type Origin } from "../phone/origin";
import { boxFrame, contentScale, easeOutSamples, ghostFrame, lerp, lerpRect, OPEN_MS, OPEN_OMEGA, play, ramp, reduced, samples, type Rect } from "./motion";
import { AnimeView, TitleView } from "./TitleView";

/** The dialog's corners, and how far the page behind steps back while it blurs (Polarity's: it's seen receding). */
const RADIUS = 12;
const RECEDE = 0.97;
/**
 * Measured off a 120 fps recording of Netflix's iPad app: the box reaches its size about 230 ms after the tap (the
 * spring), the poster in it blurring and going dark on the way; the box holds black, then the title fades in from
 * about 380 ms to 680 ms. Closing is quicker: the content goes at once and the poster sharpens as it lands.
 */
const OPEN_ALL = 720;
const CLOSE_ALL = 460;
const CLOSE_TIME = 95;

/**
 * A run of titles in one dialog (a title, and those opened from its More Like This): the top one shows, the ones under
 * it keep their place for Back. It grows out of the poster that opened it on the spring measured off Netflix's app and
 * goes back into it, or rises and falls when there's no poster to go to. The page behind steps back while it's up.
 */
export function TitleDialog({
  entries,
  leaving,
  suspended = false,
  origin,
  z,
  onGone,
  onClose,
  onBack,
}: {
  entries: Entry[];
  leaving: boolean;
  suspended?: boolean;
  origin?: Origin;
  z: number;
  onGone: () => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const scrim = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const running = useRef<Animation[]>([]);
  const top = entries[entries.length - 1];
  const stage = () => document.querySelector<HTMLElement>(".dk-stage");
  const rest = (): Rect => {
    const r = box.current!.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const S = rest();
    const page = stage();
    page?.setAttribute("data-recede", "");
    const cleanupRecede = () => {
      const p = stage();
      if (p && !document.querySelector(".dk-layer:not([data-leaving])")) {
        p.getAnimations().forEach((a) => a.id === "recede" && a.cancel());
        p.removeAttribute("data-recede");
      }
    };
    if (reduced()) return cleanupRecede;
    const frames = samples(OPEN_OMEGA, OPEN_ALL, 48);
    const list: (Animation | undefined)[] = [];
    if (origin) {
      const P: Rect = origin;
      list.push(
        play(el, frames.map(({ offset, p }) => ({ offset, ...boxFrame(lerpRect(P, S, p), S, lerp(origin.radius, RADIUS, p), lerp(origin.radius, RADIUS, p)) })), OPEN_ALL),
        play(content.current, frames.map(({ offset, t, p }) => ({ offset, opacity: ramp(t, 380, 680, 0, 1), transform: contentScale(lerpRect(P, S, p), S) })), OPEN_ALL),
        play(surface.current, frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 380, 680, 1, 0) })), OPEN_ALL),
        origin.src
          ? play(
              ghost.current,
              frames.map(({ offset, t, p }) => ({
                offset,
                opacity: ramp(t, 150, 340, 1, 0),
                filter: `blur(${ramp(t, 0, 240, 0, 26).toFixed(2)}px) brightness(${ramp(t, 60, 320, 1, 0.25).toFixed(3)})`,
                transform: ghostFrame(lerpRect(P, S, p), S, origin),
              })),
              OPEN_ALL,
            )
          : undefined,
      );
    } else {
      list.push(
        play(el, frames.map(({ offset, p }) => ({ offset, transform: `translateY(${((1 - p) * 40).toFixed(2)}px)`, opacity: Math.min(1, p * 2) })), OPEN_MS),
      );
    }
    list.push(
      play(scrim.current, frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 0, 280, 0, 1) })), OPEN_ALL),
      play(page, frames.map(({ offset, p }) => ({ offset, transform: `scale(${lerp(1, RECEDE, p)})` })), OPEN_ALL, "recede"),
    );
    running.current = list.filter((a): a is Animation => !!a);
    const all = running.current;
    void Promise.all(all.map((a) => a.finished))
      .then(() => all.filter((a) => a.id !== "recede").forEach((a) => a.cancel()))
      .catch(() => {});
    return () => {
      all.forEach((a) => a.cancel());
      cleanupRecede();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!leaving) return;
    const el = box.current;
    if (!el) return onGone();
    running.current.forEach((a) => a.cancel());
    running.current = [];
    const S = rest();
    const page = stage();
    const drawn = page ? getComputedStyle(page).transform : "none";
    const pageAt = drawn && drawn !== "none" ? new DOMMatrix(drawn).a : 1;
    page?.getAnimations().forEach((a) => a.cancel());
    if (page && !document.querySelector(".dk-layer:not([data-leaving])")) page.removeAttribute("data-recede");
    if (reduced()) return onGone();
    const to = liveOrigin(origin);
    const frames = easeOutSamples(CLOSE_TIME, CLOSE_ALL, 48);
    const list: (Animation | undefined)[] = [];
    if (to) {
      to.el!.style.visibility = "hidden";
      if (ghost.current) {
        ghost.current.style.width = `${to.w}px`;
        ghost.current.style.height = `${to.h}px`;
        const gImg = ghost.current.querySelector("img");
        if (gImg) gImg.style.objectPosition = to.objectPosition ?? "";
      }
      list.push(
        play(el, frames.map(({ offset, p }) => ({ offset, ...boxFrame(lerpRect(S, to, p), S, lerp(RADIUS, to.radius, p), lerp(RADIUS, to.radius, p)) })), CLOSE_ALL),
        play(content.current, frames.map(({ offset, t, p }) => ({ offset, opacity: ramp(t, 0, 90, 1, 0), transform: contentScale(lerpRect(S, to, p), S) })), CLOSE_ALL),
        play(surface.current, frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 0, 90, 0, 1) })), CLOSE_ALL),
        to.src
          ? play(
              ghost.current,
              frames.map(({ offset, t, p }) => ({
                offset,
                opacity: ramp(t, 30, 140, 0, 1),
                filter: `blur(${ramp(t, 90, 300, 26, 0).toFixed(2)}px) brightness(${ramp(t, 40, 260, 0.25, 1).toFixed(3)})`,
                transform: ghostFrame(lerpRect(S, to, p), S, to),
              })),
              CLOSE_ALL,
            )
          : undefined,
        play(scrim.current, frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 0, 260, 1, 0) })), CLOSE_ALL),
        play(page, frames.map(({ offset, t }) => ({ offset, transform: `scale(${ramp(t, 0, 260, pageAt, 1)})` })), CLOSE_ALL),
      );
    } else {
      list.push(
        play(el, frames.map(({ offset, p }) => ({ offset, transform: `translateY(${lerp(0, 48, p).toFixed(2)}px)`, opacity: 1 - p })), 320),
        play(scrim.current, frames.map(({ offset, p }) => ({ offset, opacity: 1 - p })), 320),
        play(page, frames.map(({ offset, p }) => ({ offset, transform: `scale(${lerp(pageAt, 1, p)})` })), 320),
      );
    }
    const anims = list.filter((a): a is Animation => !!a);
    void Promise.all(anims.map((a) => a.finished))
      .catch(() => {})
      .then(() => {
        if (to?.el) {
          // Keep the card's artwork solid on swap (zero double-vision), and glide any overlaid logo/scrim/meta
          // cleanly into view instead of popping in on the final frame.
          const overlays = [
            ...to.el.querySelectorAll<HTMLElement>(".dk-cw-shade, .dk-cw-brand, .dk-cw-foot, .dk-lc-shade, .dk-lc-body, .dk-bb-shade, .dk-bb-body, .dk-progress"),
          ];
          to.el.style.visibility = "";
          for (const o of overlays) {
            const isShade =
              o.classList.contains("dk-cw-shade") ||
              o.classList.contains("dk-lc-shade") ||
              o.classList.contains("dk-bb-shade") ||
              o.classList.contains("dk-progress");
            o.animate(
              isShade
                ? [{ opacity: 0 }, { opacity: 1 }]
                : [{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }],
              { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
            );
          }
        }
        page?.getAnimations().forEach((a) => a.cancel());
        onGone();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // A title opened from another, or Back to it: the dialog goes dark and the title fades in at its top.
  const shownKey = useRef(top.key);
  useLayoutEffect(() => {
    if (shownKey.current === top.key) return;
    shownKey.current = top.key;
    const pageEl = content.current?.querySelector<HTMLElement>(`[data-entry="${top.key}"]`);
    pageEl?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: reduced() ? 1 : 380, easing: "ease-out" });
    content.current?.scrollTo({ top: 0 });
  }, [top.key]);

  const name = (top.route.name === "detail" && top.route.preview?.name) || "Title";
  return (
    <div className="dk-layer" style={{ zIndex: z }} data-leaving={leaving || undefined}>
      {leaving && <div className="dk-catch" aria-hidden />}
      <div className="dk-scrim" ref={scrim} onClick={onClose} aria-hidden />
      <Dialog open={!suspended} modal={false} closeOnOutsidePress={false} onOpenChange={(open) => !open && !leaving && !suspended && onClose()}>
        <DialogContent inline keepMounted className="dk-dlg-frame" initialFocus="content">
          <DialogTitle className="dk-sr">{name}</DialogTitle>
          <div className="dk-dlg" ref={box} inert={leaving || undefined} data-anime={top.route.name === "anime-detail" || undefined}>
            <div className="dk-dlg-surface" ref={surface} aria-hidden />
            <div className="dk-dlg-content" ref={content}>
              {entries.map((e) => {
                const r = e.route;
                const isTop = e === top;
                return (
                  <div key={e.key} className="dk-dlg-page" data-entry={e.key} data-top={isTop || undefined} inert={!isTop || undefined}>
                    <ErrorBoundary where={r.name === "anime-detail" ? "anime title" : "title"} action={{ label: "Close", onClick: onClose }}>
                      {r.name === "detail" && <TitleView type={r.type} id={r.id} preview={r.preview} episode={r.episode} top={isTop && !leaving} />}
                      {r.name === "anime-detail" && <AnimeView id={r.id} preview={r.preview} top={isTop && !leaving} />}
                    </ErrorBoundary>
                  </div>
                );
              })}
            </div>
            <div className="dk-dlg-buttons scheme-dark">
              {entries.length > 1 && (
                <button type="button" className="dk-round" aria-label="Back" onClick={onBack}>
                  <IconBack size={22} stroke={2.2} />
                </button>
              )}
              <span className="dk-flex" />
              <DialogClose className="dk-round" aria-label="Close">
                <IconClose size={24} stroke={1.8} />
              </DialogClose>
            </div>
            {origin?.src && (
              <div className="dk-dlg-ghost" ref={ghost} aria-hidden style={{ width: origin.w, height: origin.h }}>
                <img src={origin.src} alt="" decoding="sync" style={origin.objectPosition ? { objectPosition: origin.objectPosition } : undefined} />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
