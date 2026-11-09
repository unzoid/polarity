import { useEffect, useRef, useState, type RefObject } from "react";
import { nativeButtonsAvailable, onNativeButton, setNativeButtons, type NativeButton } from "../lib/platform";
import { warnFailed } from "../lib/errors";

export type NativeButtonSpec = Omit<NativeButton, "rect" | "label" | "prominent"> & {
  /** The web app's button, where iOS's is drawn. */
  el: RefObject<HTMLElement | null>;
  label?: string;
  prominent?: boolean;
  onPress: () => void;
};

type Owner = { specs: NativeButtonSpec[]; active: boolean };

/** Long enough for a page to slide or fade into place: until then the web app's own buttons show. */
const SETTLE_MS = 400;

/** The one set of buttons iOS draws (one screen uses them at a time): the last mounted. */
let owner: Owner | null = null;
/** Whether iOS's buttons show now, as last sent. */
let visible = false;
let listening = false;
let frame = 0;

/** Sends where the buttons are now, once a frame at most: one screen's buttons handing over to the next is one change. */
function schedule() {
  if (!frame) frame = requestAnimationFrame(sync);
}

function sync() {
  frame = 0;
  const o = owner;
  const items: NativeButton[] = [];
  for (const s of o?.active ? o.specs : []) {
    const r = s.el.current?.getBoundingClientRect();
    if (!r || r.width === 0) continue;
    items.push({ id: s.id, title: s.title, symbol: s.symbol, label: s.label ?? "", prominent: !!s.prominent, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
  }
  visible = items.length > 0;
  const clipTop = document.querySelector(".navbar")?.getBoundingClientRect().bottom ?? 0;
  setNativeButtons({ shown: visible, clip_top: clipTop, items }).catch(warnFailed("native buttons"));
}

/**
 * On iOS the system draws `buttons` (lib/platform/nativeButtons.ts), each at the place of its web button, while
 * `shown`, once the page has settled; a tap calls the button's `onPress`. Returns whether the system draws them, so
 * the web buttons hide but keep their place. A screen that remounts its buttons (the featured card, for each title)
 * hands them over without the web ones flashing. Elsewhere nothing, and false.
 */
export function useNativeButtons(buttons: NativeButtonSpec[], shown: boolean): boolean {
  // Taking over from buttons that show now (the same card's, remounted): no need to wait for the page to settle.
  const [settled, setSettled] = useState(() => shown && visible);
  const me = useRef<Owner>({ specs: buttons, active: false });
  me.current.specs = buttons;
  me.current.active = nativeButtonsAvailable && shown && settled;
  const key = JSON.stringify([me.current.active, buttons.map((b) => [b.id, b.title, b.symbol, b.label, b.prominent])]);

  useEffect(() => {
    if (!nativeButtonsAvailable) return;
    if (!shown) return setSettled(false);
    if (settled) return;
    const t = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [shown, settled]);

  useEffect(() => {
    if (!nativeButtonsAvailable) return;
    const o = me.current;
    owner = o;
    if (!listening) {
      listening = true;
      void onNativeButton((id) => owner?.specs.find((b) => b.id === id)?.onPress());
    }
    const ro = new ResizeObserver(schedule);
    for (const b of o.specs) if (b.el.current) ro.observe(b.el.current);
    // Once a scroll ends, again: iOS follows the scrolling itself, but WebKit may have redrawn the page's scroll view.
    const scroller = o.specs[0]?.el.current?.closest(".scroll");
    scroller?.addEventListener("scrollend", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      if (owner === o) owner = null;
      ro.disconnect();
      scroller?.removeEventListener("scrollend", schedule);
      window.removeEventListener("resize", schedule);
      schedule();
    };
  }, []);

  useEffect(() => {
    if (!nativeButtonsAvailable) return;
    schedule();
    // Again once what holds them has slid or faded into place.
    const later = [350, 700].map((ms) => window.setTimeout(schedule, ms));
    return () => later.forEach(clearTimeout);
  }, [key]);

  return me.current.active;
}
