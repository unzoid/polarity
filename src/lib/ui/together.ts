import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How far past the window's top and bottom a picture still counts as on screen: the browser loads those too. */
const NEAR = 200;

/**
 * The pictures inside `root` that are on screen (or about to be) and still loading. Ones off to the side of a
 * shelf or far down the page are lazy and don't load until they're scrolled to, so nothing waits for them.
 */
export function pendingImages(root: Element): HTMLImageElement[] {
  const out: HTMLImageElement[] = [];
  for (const img of root.querySelectorAll("img")) {
    if (img.complete) continue;
    const r = img.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.bottom < -NEAR || r.top > window.innerHeight + NEAR || r.right < 0 || r.left > window.innerWidth) continue;
    out.push(img);
  }
  return out;
}

/**
 * Resolves once every picture on screen inside `root` has loaded or failed, or `cap` ms have passed, whichever is
 * first; at once when none is loading. `load` and `error` don't bubble, so they're heard on the way down.
 */
export function imagesSettled(root: Element, cap: number): Promise<void> {
  return new Promise((resolve) => {
    if (!pendingImages(root).length) return resolve();
    const done = () => {
      root.removeEventListener("load", check, true);
      root.removeEventListener("error", check, true);
      window.clearTimeout(timer);
      resolve();
    };
    const check = () => {
      // The picture that just settled still reads as loading inside its own event.
      queueMicrotask(() => !pendingImages(root).length && done());
    };
    const timer = window.setTimeout(done, cap);
    root.addEventListener("load", check, true);
    root.addEventListener("error", check, true);
  });
}

/**
 * Resolves once nothing inside `root` is marked `data-placing` (a picture still being put on its subject,
 * DetailArt.tsx), or `cap` ms have passed; at once when nothing is.
 */
export function placingSettled(root: Element, cap: number): Promise<void> {
  return new Promise((resolve) => {
    if (!root.querySelector("[data-placing]")) return resolve();
    const done = () => {
      watch.disconnect();
      window.clearTimeout(timer);
      resolve();
    };
    const watch = new MutationObserver(() => !root.querySelector("[data-placing]") && done());
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-placing"] });
    const timer = window.setTimeout(done, cap);
  });
}

/** How long a page waits for its pictures before it shows anyway, once its data is in. */
const PAGE_CAP = 1600;

/**
 * A whole page that comes in at once (a title's page on a phone): `ready` stays false, and the page shows its
 * placeholders, until its data is in (`dataIn`) and every picture on screen in it has loaded and been placed on
 * its subject (DetailArt.tsx), or PAGE_CAP after the data (CAP_EMPTY without it) at the latest. Then it's true
 * for good, and everything shows together. A page whose data and pictures are already there is ready from its
 * first frame (`state` "at-once", set before anything is drawn), with no placeholder and no fade.
 */
export function usePageTogether<T extends HTMLElement = HTMLDivElement>(dataIn: boolean) {
  const [state, setState] = useState<"pending" | "ready" | "at-once">("pending");
  const el = useRef<T | null>(null);
  const ref = useCallback((node: T | null) => {
    el.current = node;
  }, []);

  const ready = state !== "pending";
  useLayoutEffect(() => {
    const node = el.current;
    if (ready || !node) return;
    if (dataIn && !pendingImages(node).length && !node.querySelector("[data-placing]")) return setState("at-once");
    let live = true;
    const finish = () => live && setState("ready");
    const cap = window.setTimeout(finish, dataIn ? PAGE_CAP : CAP_EMPTY);
    // A frame for what the data brought (the logo, the episodes' stills) to be in the page before it's judged.
    const frame = dataIn
      ? requestAnimationFrame(() => void Promise.all([imagesSettled(node, PAGE_CAP), placingSettled(node, PAGE_CAP)]).then(finish))
      : 0;
    return () => {
      live = false;
      window.clearTimeout(cap);
      cancelAnimationFrame(frame);
    };
  }, [dataIn, ready]);

  return { ref, ready, state };
}

/** Once pictures are there, how long the group waits for the slowest of them. */
const CAP = 1400;
/** With no picture yet (the list itself is still loading), how long before the group stops holding anything back. */
const CAP_EMPTY = 4000;

/**
 * Props for an element whose pictures come in together (a shelf, a grid, a set of tiles): `data-together` is
 * `pending` until every picture on screen inside it has loaded or failed, then `ready`, for good. While pending,
 * base.css keeps its pictures, and anything marked `.together-wait`, unseen; ready, they fade in as one, instead of
 * each popping in as its own file arrives. A slow picture doesn't hold the rest for longer than CAP; it fades in
 * on its own when it comes. Pictures added later (scrolled to, another page of results) fade in as they load.
 */
export function useTogether<T extends HTMLElement = HTMLDivElement>() {
  const [ready, setReady] = useState(false);
  const el = useRef<T | null>(null);
  const ref = useCallback((node: T | null) => {
    el.current = node;
  }, []);

  useEffect(() => {
    const node = el.current;
    if (!node || ready) return;
    let frame = 0;
    let cap = 0;
    // Nothing is decided, and no clock runs, while the group is off screen: it's judged when it's come to.
    let visible = typeof IntersectionObserver === "undefined";
    let waiting: "nothing" | "list" | "pictures" = "nothing";
    const finish = () => setReady(true);
    const wait = (what: "list" | "pictures") => {
      if (waiting === what || waiting === "pictures") return;
      waiting = what;
      window.clearTimeout(cap);
      cap = window.setTimeout(finish, what === "list" ? CAP_EMPTY : CAP);
    };
    const check = () => {
      frame = 0;
      if (!visible) return;
      const has = !!node.querySelector("img");
      wait(has ? "pictures" : "list");
      if (has && !pendingImages(node).length) finish();
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    node.addEventListener("load", soon, true);
    node.addEventListener("error", soon, true);
    const mo = new MutationObserver(soon);
    mo.observe(node, { childList: true, subtree: true });
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (!entries.some((e) => e.isIntersecting)) return;
              visible = true;
              soon();
            },
            { rootMargin: `${NEAR}px` },
          );
    io?.observe(node);
    soon();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(cap);
      node.removeEventListener("load", soon, true);
      node.removeEventListener("error", soon, true);
      mo.disconnect();
      io?.disconnect();
    };
  }, [ready]);

  return { ref, "data-together": ready ? ("ready" as const) : ("pending" as const) };
}
