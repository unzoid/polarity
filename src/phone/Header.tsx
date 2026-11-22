import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
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
export function TabHeader({ lead, children, scroller, actions = true, tint }: { lead?: ReactNode; children: ReactNode; scroller: RefObject<HTMLElement | null>; actions?: boolean; tint?: CSSProperties }) {
  const head = useRef<HTMLElement>(null);
  // On the tab's page, not just the bar: the chips under it fade with the same value (phone.css).
  const page = useRef<HTMLElement | null>(null);
  useEffect(() => {
    page.current = head.current?.parentElement ?? null;
  });
  useCollapse(scroller, page, 56);
  const { navigate } = useNavigation();
  return (
    <header className="ph-head" ref={head}>
      <div className="ph-head-bg" style={tint} aria-hidden />
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

/** `--c` on `target`: how far `scroller` has scrolled through its first `span` px, 0 to 1, a frame at a time. */
export function useCollapse(scroller: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>, span: number) {
  useEffect(() => {
    const el = scroller.current;
    const out = target.current;
    if (!el || !out) return;
    let frame = 0;
    let last = -1;
    const apply = () => {
      frame = 0;
      const c = Math.min(1, Math.max(0, el.scrollTop / span));
      if (c === last) return;
      last = c;
      out.style.setProperty("--c", c.toFixed(3));
      out.toggleAttribute("data-scrolled", c >= 1);
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
  }, [scroller, target, span]);
}
