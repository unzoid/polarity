import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { usePrefs } from "../../lib/settings";
import { useFormFactor } from "../../lib/ui";

/**
 * A title page on a big screen with Settings → Appearance → Show page background off draws its art and the hero
 * over it as one dark block (`.detail-top.scheme-dark`, detail.css), in either scheme: white type over the darkened
 * art, and the page's own colour below it. Light mode used to wash the art toward the near-white page under dark
 * type, which read as fog. A phone keeps its own layout; with the page background on, the art sits behind the page.
 */
export function useDarkHero(): boolean {
  const phone = useFormFactor().form === "phone";
  return !phone && !usePrefs().pageBackdrop;
}

let shown = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * While `on` (a dark hero on the page on top) and the hero box `top` is still under the navbar, the navbar is drawn
 * dark too. It turns light only once the hero's bottom edge has passed the middle of the bar, over the page itself,
 * rather than as soon as the page starts to scroll (which flipped it over the dark art).
 */
export function useShowDarkHero(on: boolean, top: RefObject<HTMLElement | null>) {
  const [under, setUnder] = useState(true);
  useEffect(() => {
    const el = top.current;
    if (!on || !el || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | undefined;
    const watch = () => {
      io?.disconnect();
      const bar = document.querySelector<HTMLElement>(".navbar")?.offsetHeight || 76;
      // The window's top half-bar: the hero is "under" while any of it is in that band.
      io = new IntersectionObserver(([e]) => setUnder(e.isIntersecting), { rootMargin: `0px 0px ${-(window.innerHeight - bar / 2)}px 0px` });
      io.observe(el);
    };
    watch();
    window.addEventListener("resize", watch);
    return () => {
      io?.disconnect();
      window.removeEventListener("resize", watch);
    };
  }, [on, top]);
  const active = on && under;
  useEffect(() => {
    if (!active) return;
    shown++;
    emit();
    return () => {
      shown--;
      emit();
    };
  }, [active]);
}

/** A dark hero is under the navbar (`useShowDarkHero`). */
export function useUnderDarkHero(): boolean {
  return useSyncExternalStore(subscribe, () => shown > 0, () => false);
}
