import "../styles/detail.css";
import "./title-family.css";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { useLayoutEffect, useRef } from "react";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import type { Entry } from "../lib/router";
import { IconBack, IconClose } from "../phone/icons";
import { liveOrigin, type Origin } from "../phone/origin";
import { boxFrame, contentScale, easeOutSamples, ghostFrame, lerp, lerpRect, OPEN_MS, OPEN_OMEGA, play, ramp, reduced, samples, type Rect } from "./motion";
import { AnimeView, TitleView } from "./TitleView";

/** Snappy ease-out for closing the dialog back into its card slot on desktop. */
const DESK_CLOSE_MS = 380;
const DESK_CLOSE_TAU = 85;
const FALLBACK_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * A run of titles in one dialog (a title, and those opened from its More Like This): the top one shows, the ones under
 * it keep their place for Back. The whole dialog sheet (backdrop, logo, and body together) expands as one unified card
 * out of the poster that opened it and contracts back into it on close, or rises cleanly when opened without an origin.
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
  const layer = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const ghostImg = useRef<HTMLImageElement>(null);
  const running = useRef<Animation[]>([]);
  const restRect = useRef<Rect | null>(null);
  const restRadius = useRef<number>(28);
  const top = entries[entries.length - 1];
  const stage = () => document.querySelector<HTMLElement>(".dk-stage");

  const stop = () => {
    running.current.forEach((a) => a.cancel());
    running.current = [];
  };
  const track = (...list: (Animation | undefined)[]) => {
    for (const a of list) if (a) running.current.push(a);
  };

  // Opening: expand the entire dialog sheet (backdrop + content together) out of the clicked card.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const page = stage();
    page?.setAttribute("data-recede", "");
    const cleanupRecede = () => {
      const p = stage();
      if (p && !document.querySelector(".dk-layer:not([data-leaving])")) p.removeAttribute("data-recede");
    };
    const S = rectOf(el);
    const dlgRadius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 28;
    restRect.current = S;
    restRadius.current = dlgRadius;
    if (reduced()) return cleanupRecede;

    const from = origin && origin.w > 0 && origin.h > 0 && S.w > 0 && S.h > 0 ? origin : undefined;
    if (from) {
      const frames = samples(OPEN_OMEGA, OPEN_MS);
      const P: Rect = { x: from.x, y: from.y, w: from.w, h: from.h };
      track(
        play(
          el,
          frames.map(({ offset, p }) => {
            const rad = lerp(from.radius, dlgRadius, p);
            return { offset, ...boxFrame(lerpRect(P, S, p), S, rad, rad) };
          }),
          OPEN_MS,
        ),
        play(
          content.current,
          frames.map(({ offset, t, p }) => ({
            offset,
            opacity: ramp(t, 70, 220, 0, 1),
            transform: contentScale(lerpRect(P, S, p), S),
          })),
          OPEN_MS,
        ),
        play(
          buttons.current,
          frames.map(({ offset, t, p }) => ({
            offset,
            opacity: ramp(t, 160, 300, 0, 1),
            transform: contentScale(lerpRect(P, S, p), S),
          })),
          OPEN_MS,
        ),
        play(
          surface.current,
          frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 160, 300, 1, 0) })),
          OPEN_MS,
        ),
        from.src
          ? play(
              ghost.current,
              frames.map(({ offset, t, p }) => ({
                offset,
                opacity: ramp(t, 60, 200, 1, 0),
                filter: `blur(${ramp(t, 20, 160, 0, 10).toFixed(2)}px)`,
                transform: ghostFrame(lerpRect(P, S, p), S, P),
              })),
              OPEN_MS,
            )
          : undefined,
        play(
          scrim.current,
          frames.map(({ offset, p }) => ({ offset, opacity: Math.min(1, p * 1.25) })),
          OPEN_MS,
        ),
      );
    } else {
      track(
        scrim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: "ease-out", fill: "forwards" }),
        el.animate(
          [
            { opacity: 0, transform: "translateY(20px) scale(0.97)" },
            { opacity: 1, transform: "translateY(0px) scale(1)" },
          ],
          { duration: 340, easing: FALLBACK_EASE, fill: "forwards" },
        ),
      );
    }

    const all = running.current;
    void Promise.all(all.map((a) => a.finished))
      .then(() => {
        // Done: hand back cleanly to CSS so no lingering transform stacking context stays at rest.
        all.forEach((a) => a.cancel());
        running.current = [];
      })
      .catch(() => {});

    return () => {
      stop();
      cleanupRecede();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing: contract the unified dialog back into its card slot (surviving mid-open interruption).
  useLayoutEffect(() => {
    if (!leaving) return;
    const el = box.current;
    if (!el) return onGone();
    // Measure current on-screen rect before cancelling any in-flight open animation so mid-flight closes stay continuous.
    const currentRect = rectOf(el);
    const currentOpacity = parseFloat(getComputedStyle(scrim.current ?? el).opacity) || 1;
    stop();
    const S = restRect.current ?? rectOf(el);
    const dlgRadius = restRadius.current || parseFloat(getComputedStyle(el).borderTopLeftRadius) || 28;
    const fromRect = currentRect.w > 0 && currentRect.h > 0 ? currentRect : S;
    const page = stage();
    if (page && !document.querySelector(".dk-layer:not([data-leaving])")) page.removeAttribute("data-recede");
    if (reduced()) return onGone();

    const to = liveOrigin(origin);
    const anims: (Animation | undefined)[] = [];
    if (to && to.w > 0 && to.h > 0 && S.w > 0 && S.h > 0) {
      to.el!.style.visibility = "hidden";
      if (ghost.current) {
        ghost.current.style.width = `${to.w}px`;
        ghost.current.style.height = `${to.h}px`;
      }
      if (ghostImg.current) {
        if (to.src && ghostImg.current.src !== to.src) ghostImg.current.src = to.src;
        ghostImg.current.style.objectPosition = to.objectPosition ?? "";
      }
      const frames = easeOutSamples(DESK_CLOSE_TAU, DESK_CLOSE_MS);
      const startFrac = Math.min(1, Math.max(0, (fromRect.w - to.w) / Math.max(1, S.w - to.w)));
      const fromRadius = lerp(to.radius, dlgRadius, startFrac);
      const P: Rect = { x: to.x, y: to.y, w: to.w, h: to.h };
      anims.push(
        play(
          el,
          frames.map(({ offset, p }) => {
            const rad = lerp(fromRadius, to.radius, p);
            return { offset, ...boxFrame(lerpRect(fromRect, P, p), S, rad, rad) };
          }),
          DESK_CLOSE_MS,
        ),
        play(
          content.current,
          frames.map(({ offset, t, p }) => ({
            offset,
            opacity: ramp(t, 0, 120, 1, 0),
            transform: contentScale(lerpRect(fromRect, P, p), S),
          })),
          DESK_CLOSE_MS,
        ),
        play(
          buttons.current,
          frames.map(({ offset, t, p }) => ({
            offset,
            opacity: ramp(t, 0, 80, 1, 0),
            transform: contentScale(lerpRect(fromRect, P, p), S),
          })),
          DESK_CLOSE_MS,
        ),
        play(
          surface.current,
          frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 0, 110, 0, 1) })),
          DESK_CLOSE_MS,
        ),
        to.src
          ? play(
              ghost.current,
              frames.map(({ offset, t, p }) => ({
                offset,
                opacity: ramp(t, 30, 150, 0, 1),
                filter: `blur(${ramp(t, 80, 260, 10, 0).toFixed(2)}px)`,
                transform: ghostFrame(lerpRect(fromRect, P, p), S, P),
              })),
              DESK_CLOSE_MS,
            )
          : undefined,
        play(
          scrim.current,
          frames.map(({ offset, t }) => ({ offset, opacity: ramp(t, 0, 240, currentOpacity, 0) })),
          DESK_CLOSE_MS,
        ),
      );
    } else {
      anims.push(
        el.animate(
          [
            { opacity: 1, transform: "translateY(0px) scale(1)" },
            { opacity: 0, transform: "translateY(24px) scale(0.97)" },
          ],
          { duration: 240, easing: "ease-in", fill: "forwards" },
        ),
        scrim.current?.animate([{ opacity: currentOpacity }, { opacity: 0 }], { duration: 240, easing: "ease-out", fill: "forwards" }),
      );
    }

    const list = anims.filter((a): a is Animation => !!a);
    void Promise.all(list.map((a) => a.finished))
      .catch(() => {})
      .then(() => {
        if (to?.el) {
          // The card is back in its row: its own logo, shade and progress fade in over the art the dialog left.
          const overlays = [
            ...to.el.querySelectorAll<HTMLElement>(".dk-cw-shade, .dk-cw-brand, .dk-cw-foot, .dk-lc-shade, .dk-lc-body, .dk-bb-shade, .dk-bb-body, .dk-progress"),
          ];
          to.el.style.visibility = "";
          for (const o of overlays) {
            const isShade = /-shade\b|dk-progress/.test(o.className);
            o.animate(isShade ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], {
              duration: 240,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            });
          }
        }
        onGone();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // A title opened from another, or Back to it: the page goes and the next arrives out of a blur, at its top.
  const shownKey = useRef(top.key);
  useLayoutEffect(() => {
    if (shownKey.current === top.key) return;
    shownKey.current = top.key;
    const pageEl = content.current?.querySelector<HTMLElement>(`[data-entry="${top.key}"]`);
    pageEl?.animate(
      [
        { opacity: 0, filter: "blur(10px)", transform: "translateY(12px)" },
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" },
      ],
      { duration: reduced() ? 1 : 420, easing: FALLBACK_EASE },
    );
    content.current?.scrollTo({ top: 0 });
  }, [top.key]);

  const name = (top.route.name === "detail" && top.route.preview?.name) || "Title";
  const stacked = entries.length > 1;
  const close = (
    <DialogClose className="dk-round" aria-label="Close">
      <IconClose size={20} stroke={2.2} />
    </DialogClose>
  );
  return (
    <div className="dk-layer" ref={layer} style={{ zIndex: z }} data-leaving={leaving || undefined}>
      {leaving && <div className="dk-catch" aria-hidden />}
      <div className="dk-scrim" ref={scrim} onClick={onClose} aria-hidden />
      <Dialog open={!suspended} modal={false} closeOnOutsidePress={false} onOpenChange={(open) => !open && !leaving && !suspended && onClose()}>
        <DialogContent inline keepMounted className="dk-dlg-frame" initialFocus="content">
          <DialogTitle className="dk-sr">{name}</DialogTitle>
          <div className="dk-dlg" ref={box} inert={leaving || undefined} data-anime={top.route.name === "anime-detail" || undefined} data-stack={stacked || undefined}>
            <div className="dk-dlg-surface" ref={surface} aria-hidden />
            <div className="dk-dlg-content" ref={content}>
              {entries.map((e) => {
                const r = e.route;
                const isTop = e === top;
                return (
                  <div key={e.key} className="dk-dlg-page" data-entry={e.key} data-top={isTop || undefined} inert={!isTop || undefined}>
                    <ErrorBoundary where={r.name === "anime-detail" ? "anime title" : "title"} action={{ label: "Close", onClick: onClose }}>
                      {r.name === "detail" && <TitleView type={r.type} id={r.id} preview={r.preview} episode={r.episode} season={r.season} top={isTop && !leaving} />}
                      {r.name === "anime-detail" && <AnimeView id={r.id} preview={r.preview} top={isTop && !leaving} />}
                    </ErrorBoundary>
                  </div>
                );
              })}
            </div>
            {/* Family's header: Close at the top left; deeper in, Back there and Close at the other end. */}
            <div className="dk-dlg-buttons scheme-dark" ref={buttons}>
              {stacked ? (
                <>
                  <button type="button" className="dk-round" aria-label="Back" onClick={onBack}>
                    <IconBack size={20} stroke={2.2} />
                  </button>
                  <span className="dk-flex" />
                  {close}
                </>
              ) : (
                close
              )}
            </div>
            {origin && (
              <div className="dk-dlg-ghost" ref={ghost} aria-hidden style={{ width: origin.w, height: origin.h }}>
                <img
                  ref={ghostImg}
                  src={origin.src}
                  alt=""
                  decoding="sync"
                  style={origin.objectPosition ? { objectPosition: origin.objectPosition } : undefined}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
