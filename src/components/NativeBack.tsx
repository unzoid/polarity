import { useEffect, useRef, type RefObject } from "react";
import { nativeBackAvailable, onNativeBack, setNativeBack } from "../lib/platform";
import { warnFailed } from "../lib/errors";

type Holder = { el: RefObject<HTMLElement | null>; shown: boolean; history: string[]; onBack: (steps: number) => void };

/** Every Back that could be iOS's, in mount order: the last one showing is the one the button stands for. */
const holders: Holder[] = [];
let listening = false;
let swipe = false;

const top = () => holders.findLast((h) => h.shown);

/**
 * Where `el` comes to rest. The navbar's Back slides in by its left margin (shell.css `.navbar-back`, 0 when shown),
 * so mid-slide its box is short of its place: the system's button is put where it ends up, and slides there itself
 * (ios/back.m) on the same clock, rather than being put down part-way and jumping on later.
 */
function restingRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const margin = el.classList.contains("navbar-back") ? parseFloat(getComputedStyle(el).marginLeft) || 0 : 0;
  return { x: r.x - margin, y: r.y, width: r.width, height: r.height };
}

function sync() {
  const holder = top();
  const el = holder?.el.current;
  const rect = el && el.getBoundingClientRect().width > 0 ? restingRect(el) : null;
  setNativeBack({ shown: !!rect, rect, history: holder?.history ?? [], swipe }).catch(warnFailed("back button"));
}

/**
 * On iOS, whether a swipe in from the left edge is Back now (lib/platform/backSwipe.ts): while it isn't, iOS leaves
 * the edge to the page, so a row scrolled from there scrolls. Elsewhere nothing.
 */
export function useNativeSwipe(on: boolean) {
  useEffect(() => {
    if (!nativeBackAvailable || swipe === on) return;
    swipe = on;
    sync();
  }, [on]);
}

/**
 * On iOS a web app's Back is drawn by the system (lib/platform/nativeBack.ts) at the place of `button`, while `shown`:
 * a tap calls `onBack(1)`, a page picked from its long-press menu (`history`, nearest first) `onBack(steps)`. Returns
 * whether the system draws it, so the web button hides but keeps its place. Elsewhere nothing, and false.
 */
export function useNativeBack(button: RefObject<HTMLElement | null>, shown: boolean, history: string[], onBack: (steps: number) => void): boolean {
  const holder = useRef<Holder>({ el: button, shown: false, history: [], onBack });
  Object.assign(holder.current, { shown, history, onBack });
  const key = JSON.stringify([shown, history]);

  useEffect(() => {
    if (!nativeBackAvailable) return;
    const h = holder.current;
    holders.push(h);
    if (!listening) {
      listening = true;
      void onNativeBack((steps) => top()?.onBack(steps));
    }
    const ro = new ResizeObserver(sync);
    if (button.current) ro.observe(button.current);
    window.addEventListener("resize", sync);
    return () => {
      holders.splice(holders.indexOf(h), 1);
      ro.disconnect();
      window.removeEventListener("resize", sync);
      sync();
    };
  }, [button]);

  useEffect(() => {
    if (!nativeBackAvailable) return;
    sync();
    // Again once what holds the button has slid or faded into place.
    const later = [350, 700].map((ms) => window.setTimeout(sync, ms));
    return () => later.forEach(clearTimeout);
  }, [key]);

  return nativeBackAvailable && shown;
}
