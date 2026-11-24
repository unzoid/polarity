import "../styles/detail.css";
import "./title-family.css";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { useLayoutEffect, useRef } from "react";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import type { Entry } from "../lib/router";
import { IconBack, IconClose } from "../phone/icons";
import { liveOrigin, type Origin } from "../phone/origin";
import { play, reduced, type Rect } from "./motion";
import { AnimeView, TitleView } from "./TitleView";

/**
 * Family's card-to-detail transition (benji.org/family-values, its wallet cards): the thing you clicked doesn't get
 * replaced by a new page, it travels. The poster's art flies to the card at the top of the title and becomes it, while
 * the page behind blurs away and the title's page fades in out of a blur around it. Closing is the same trip back:
 * the page blurs out, the card flies home into its poster, and the home page comes back into focus.
 */
const OPEN_FLY = 560;
const CLOSE_FLY = 420;
/** A soft start and a long settle, as Family's cards land. Closing starts quicker and lands firmly in the slot. */
const OPEN_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const CLOSE_EASE = "cubic-bezier(0.4, 0, 0.12, 1)";

/** A box and its corners: one radius for a poster, or top and bottom for the title's art (the dialog's top corners). */
type Box = Rect & { radius: number; bottom?: number };

/** The title's logo on the art, as fractions (%) of the art's box. */
type GhostLogo = { src: string; left: number; bottom: number; width: number; height: number };

/** How soft the two pictures go while one becomes the other: just enough that they never read as two pictures. */
const FLY_BLUR = 8;

/**
 * The art in flight: one rounded box carrying the poster (`a`) and the title's own art (`b`) over each other. Early
 * in the trip the one crossfades into the other, both a touch soft across the swap, so a portrait poster becoming a
 * wide backdrop reads as one picture changing; the box itself never blurs, and it lands sharp on exactly what's
 * under it. Lives in the dialog's layer.
 */
function flyArt(
  layer: HTMLElement,
  from: Box,
  to: Box,
  a: { src?: string; objectPosition?: string },
  b: { src?: string },
  opts: { ms: number; easing: string; bFrom: number; bTo: number; fadeAt: [number, number]; shade?: { page: string; from: number; to: number; at: [number, number]; logo?: GhostLogo } },
) {
  const L = layer.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "dk-fam-ghost";
  el.setAttribute("aria-hidden", "true");
  const img = (src: string | undefined, pos?: string) => {
    if (!src) return undefined;
    const i = document.createElement("img");
    i.alt = "";
    i.decoding = "sync";
    i.src = src;
    if (pos) i.style.objectPosition = pos;
    el.appendChild(i);
    return i;
  };
  const base = img(a.src, a.objectPosition);
  const top = img(b.src);
  // The art's fade into the page (the card's own shade) and the title's logo on it, carried by the art in flight so
  // they arrive with the picture, not after it lands; the logo is placed as a fraction of the art, so it grows with it.
  let shade: HTMLElement | undefined;
  let logo: HTMLImageElement | undefined;
  if (opts.shade) {
    shade = document.createElement("i");
    shade.className = "dk-fam-ghost-shade";
    shade.style.setProperty("--ghost-page", opts.shade.page);
    el.appendChild(shade);
    const l = opts.shade.logo;
    if (l) {
      logo = document.createElement("img");
      logo.className = "dk-fam-ghost-logo";
      logo.alt = "";
      logo.decoding = "sync";
      logo.src = l.src;
      Object.assign(logo.style, { left: `${l.left}%`, bottom: `${l.bottom}%`, width: `${l.width}%`, height: `${l.height}%` });
      el.appendChild(logo);
    }
  }
  layer.appendChild(el);
  const frame = (r: Box) => {
    const t = r.radius.toFixed(2);
    const b = (r.bottom ?? r.radius).toFixed(2);
    return {
      transform: `translate(${(r.x - L.left).toFixed(2)}px, ${(r.y - L.top).toFixed(2)}px)`,
      width: `${r.w.toFixed(2)}px`,
      height: `${r.h.toFixed(2)}px`,
      borderRadius: `${t}px ${t}px ${b}px ${b}px`,
    };
  };
  const anims = [el.animate([frame(from), frame(to)], { duration: opts.ms, easing: opts.easing, fill: "both" })];
  if (opts.shade) {
    const { from: s0, to: s1, at: [a0, a1] } = opts.shade;
    for (const node of [shade, logo])
      if (node)
        anims.push(
          node.animate(
            [
              { opacity: s0, offset: 0 },
              { opacity: s0, offset: a0 },
              { opacity: s1, offset: a1 },
              { opacity: s1, offset: 1 },
            ],
            { duration: opts.ms, easing: "ease-out", fill: "both" },
          ),
        );
  }
  if (top) {
    const [s, e] = opts.fadeAt;
    const arriving = opts.bTo > opts.bFrom;
    const soft = `blur(${FLY_BLUR}px)`;
    const sharp = "blur(0px)";
    // The picture arriving comes in out of a little softness; the one going goes a little soft as it's covered.
    // Only across the swap, early in the trip; both pictures are sharp for the rest of it.
    anims.push(
      top.animate(
        [
          { opacity: opts.bFrom, filter: arriving ? soft : sharp, offset: 0 },
          { opacity: opts.bFrom, filter: arriving ? soft : sharp, offset: s },
          { opacity: opts.bTo, filter: arriving ? `blur(${FLY_BLUR / 2}px)` : soft, offset: e },
          { opacity: opts.bTo, filter: sharp, offset: Math.min(1, e + 0.14) },
          { opacity: opts.bTo, filter: sharp, offset: 1 },
        ],
        { duration: opts.ms, easing: "ease-out", fill: "both" },
      ),
    );
    if (base)
      anims.push(
        base.animate(
          [
            { filter: arriving ? sharp : soft, offset: 0 },
            { filter: arriving ? sharp : soft, offset: s },
            { filter: arriving ? soft : `blur(${FLY_BLUR / 2}px)`, offset: e },
            { filter: arriving ? soft : sharp, offset: Math.min(1, e + 0.14) },
            { filter: arriving ? soft : sharp, offset: 1 },
          ],
          { duration: opts.ms, easing: "ease-out", fill: "both" },
        ),
      );
  }
  return { el, done: Promise.all(anims.map((x) => x.finished)).then(() => undefined), cancel: () => (anims.forEach((x) => x.cancel()), el.remove()) };
}

const noop = () => {};

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * A run of titles in one dialog (a title, and those opened from its More Like This): the top one shows, the ones under
 * it keep their place for Back. Its art arrives out of the poster that opened it and goes back into it, or the page
 * rises out of a blur when there's no poster to come from.
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
  const content = useRef<HTMLDivElement>(null);
  const running = useRef<{ cancel: () => void }[]>([]);
  const top = entries[entries.length - 1];
  const stage = () => document.querySelector<HTMLElement>(".dk-stage");
  /** The card at the top of the title showing (the outline's while it loads: the same place). */
  const heroOf = () => box.current?.querySelector<HTMLElement>(".dk-dlg-page[data-top] .dk-t-media") ?? null;
  const heroBox = (hero: HTMLElement): Box => {
    const cs = getComputedStyle(hero);
    return { ...rectOf(hero), radius: parseFloat(cs.borderTopLeftRadius) || 0, bottom: parseFloat(cs.borderBottomLeftRadius) || 0 };
  };
  const heroArt = (hero: HTMLElement) => {
    const img = hero.querySelector<HTMLImageElement>("img.dk-t-art");
    return img ? img.currentSrc || img.src : undefined;
  };
  /** The logo drawn on the card, if it has loaded: where it sits on the art, for the art in flight to carry. */
  const heroLogo = (hero: HTMLElement): GhostLogo | undefined => {
    const img = hero.querySelector<HTMLImageElement>("img.dk-t-logo");
    if (!img?.complete || !img.naturalWidth) return undefined;
    const H = hero.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    if (!H.width || !r.width) return undefined;
    return {
      src: img.currentSrc || img.src,
      left: ((r.left - H.left) / H.width) * 100,
      bottom: ((H.bottom - r.bottom) / H.height) * 100,
      width: (r.width / H.width) * 100,
      height: (r.height / H.height) * 100,
    };
  };
  const pageColor = () => (box.current ? getComputedStyle(box.current).getPropertyValue("--fam-page").trim() : "") || "#000";
  // `done` settles when the animation ends either way: one cancelled (closed mid-opening) is no error.
  const anim = (a: Animation | undefined) => (a ? { cancel: () => a.cancel(), done: a.finished.then(noop, noop) } : undefined);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const page = stage();
    page?.setAttribute("data-recede", "");
    const cleanupRecede = () => {
      const p = stage();
      if (p && !document.querySelector(".dk-layer:not([data-leaving])")) p.removeAttribute("data-recede");
    };
    if (reduced()) return cleanupRecede;

    const list: { cancel: () => void; done?: Promise<void> }[] = [];
    const hero = heroOf();
    const fromPoster = !!origin && !!hero && !!layer.current && !!(origin.src || heroArt(hero));
    // Where the card rests, measured before the page starts rising into place under it.
    const landing = fromPoster ? heroBox(hero!) : undefined;
    // The page: out of a blur, a little below where it settles; the card's art is still in flight above it.
    const pageIn = fromPoster
      ? [
          { offset: 0, opacity: 0, filter: "blur(6px)", transform: "translateY(10px)" },
          { offset: 0.12, opacity: 0, filter: "blur(6px)", transform: "translateY(10px)" },
          { offset: 1, opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" },
        ]
      : [
          { offset: 0, opacity: 0, filter: "blur(10px)", transform: "translateY(28px)" },
          { offset: 1, opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" },
        ];
    list.push(
      anim(play(scrim.current, [{ opacity: 0 }, { opacity: 1 }], 340))!,
      anim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fromPoster ? 280 : 360, easing: "ease-out" }))!,
      anim(content.current?.animate(pageIn, { duration: fromPoster ? 480 : 440, easing: OPEN_EASE }))!,
    );
    if (fromPoster) {
      el.setAttribute("data-flying", "");
      const flight = flyArt(
        layer.current!,
        { x: origin!.x, y: origin!.y, w: origin!.w, h: origin!.h, radius: origin!.radius },
        landing!,
        { src: origin!.src, objectPosition: origin!.objectPosition },
        { src: heroArt(hero!) },
        { ms: OPEN_FLY, easing: OPEN_EASE, bFrom: origin!.src ? 0 : 1, bTo: 1, fadeAt: [0.04, 0.34], shade: { page: pageColor(), from: 0, to: 1, at: [0.12, 0.5], logo: heroLogo(hero!) } },
      );
      list.push(flight);
      void flight.done
        .then(() => {
          // Landed: the real card shows under the art, which melts into it (its logo and shade arrive with it).
          el.removeAttribute("data-flying");
          const out = flight.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" });
          return out.finished;
        })
        .then(() => flight.el.remove())
        .catch(() => {});
    }
    const all = list.filter(Boolean);
    running.current = all;
    return () => {
      all.forEach((a) => a.cancel());
      el.removeAttribute("data-flying");
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
    el.removeAttribute("data-flying");
    const page = stage();
    if (page && !document.querySelector(".dk-layer:not([data-leaving])")) page.removeAttribute("data-recede");
    if (reduced()) return onGone();
    const to = liveOrigin(origin);
    const hero = heroOf();
    const dlg = el.getBoundingClientRect();
    const list: { cancel: () => void; done: Promise<void> }[] = [];
    let ghost: ReturnType<typeof flyArt> | undefined;
    if (to && hero && layer.current && (to.src || heroArt(hero))) {
      // From the card where it is now (scrolled up out of sight, from the top of the page), home into the poster.
      const H = heroBox(hero);
      const from = { ...H, y: Math.max(H.y, dlg.top + 8) };
      el.setAttribute("data-flying", "");
      to.el!.style.visibility = "hidden";
      ghost = flyArt(
        layer.current,
        from,
        { x: to.x, y: to.y, w: to.w, h: to.h, radius: to.radius },
        { src: to.src, objectPosition: to.objectPosition },
        { src: heroArt(hero) },
        { ms: CLOSE_FLY, easing: CLOSE_EASE, bFrom: 1, bTo: to.src ? 0 : 1, fadeAt: [0.08, 0.4], shade: { page: pageColor(), from: 1, to: 0, at: [0.04, 0.32], logo: heroLogo(hero) } },
      );
      list.push(ghost);
    }
    list.push(
      anim(content.current?.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(6px)" }], { duration: 150, easing: "ease-in", fill: "forwards" }))!,
      anim(
        el.animate(
          ghost
            ? [{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }]
            : [
                { opacity: 1, transform: "translateY(0px)" },
                { opacity: 0, transform: "translateY(36px)" },
              ],
          { duration: ghost ? 320 : 300, easing: "ease-out", fill: "forwards" },
        ),
      )!,
      anim(play(scrim.current, [{ opacity: 1 }, { opacity: 0 }], ghost ? CLOSE_FLY : 320))!,
    );
    const anims = list.filter(Boolean);
    void Promise.all(anims.map((a) => a.done))
      .catch(() => {})
      .then(() => {
        if (to?.el) {
          // The poster is back in its row: its own logo, shade and progress fade in over the art the card left.
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
        ghost?.el.remove();
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
      { duration: reduced() ? 1 : 420, easing: OPEN_EASE },
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
            {/* Family's header: Close at the top left; deeper in, Back there and Close at the other end. */}
            <div className="dk-dlg-buttons scheme-dark">
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
