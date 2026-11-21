import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useNavigation } from "../lib/router";
import { openSettings } from "../lib/settings";
import { IconBell, IconDownload, IconSettings } from "./icons";
import { notifications } from "./store";

/**
 * A tab's bar, pinned over its page: its name (or the profile, on My Polarity) on the left, Downloads and the
 * bell on the right, 52 pt under the status bar. At the top it's clear over the page; scrolled, it gets its
 * backing and the name eases down to 92% (Netflix's: 24.7 pt → 22.6 pt, measured), all from one value the
 * scroll sets (`--c`, 0–1) without rendering anything again.
 */
export function TabHeader({
  lead,
  children,
  scroller,
  actions = true,
  headRef,
}: {
  lead?: ReactNode;
  children: ReactNode;
  scroller: RefObject<HTMLElement | null>;
  actions?: boolean;
  headRef?: RefObject<HTMLElement | null>;
}) {
  const localHead = useRef<HTMLElement | null>(null);
  const head = headRef ?? localHead;
  useCollapse(scroller, head, 56, true);
  const { navigate } = useNavigation();
  return (
    <header className="ph-head" ref={head}>
      <div className="ph-head-bg" aria-hidden />
      <div className="ph-head-row">
        <div className="ph-head-title">
          {lead}
          {children}
        </div>
        {actions && (
          <div className="ph-head-actions">
            <button type="button" className="ph-icon-btn" aria-label="Downloads" onClick={() => navigate({ name: "library-collection", view: "downloads" })}>
              <IconDownload size={26} />
            </button>
            <button type="button" className="ph-icon-btn" aria-label="Notifications" onClick={() => notifications.set(true)}>
              <IconBell size={26} />
            </button>
            <button type="button" className="ph-icon-btn" aria-label="Settings" onClick={() => openSettings()}>
              <IconSettings size={26} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * `--c` on `target` (the header bar alone, never the whole `.ph-tab-page`): how far `scroller` has scrolled
 * through its first `span` px, 0 to 1, coalesced per animation frame. When `fadeChips` is true, also drives
 * `.ph-chips` opacity directly on that element so scrolling never recalculates styles across the page tree.
 */
export function useCollapse(scroller: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>, span: number, fadeChips = false) {
  useEffect(() => {
    const el = scroller.current;
    const out = target.current;
    if (!el || !out) return;
    let frame = 0;
    let last = -1;
    let chips: HTMLElement | null = null;
    const apply = () => {
      frame = 0;
      const c = Math.min(1, Math.max(0, el.scrollTop / span));
      if (c === last) return;
      last = c;
      out.style.setProperty("--c", c.toFixed(3));
      out.toggleAttribute("data-scrolled", c >= 1);
      if (fadeChips) {
        if (!chips || !chips.isConnected) chips = el.querySelector<HTMLElement>(".ph-chips");
        if (chips) chips.style.opacity = String(Math.max(0, Math.min(1, 1 - c * 1.6)).toFixed(3));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller, target, span, fadeChips]);
}
