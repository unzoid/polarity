import { createElement, lazy, type ComponentProps, type ComponentType } from "react";

/**
 * `React.lazy` for a named export, so a screen loads its own chunk the first
 * time it's drawn (inside a `<Suspense>`). `preload()` fetches the chunk ahead
 * of time and caches the resolved component so rendering it once loaded never
 * suspends on `React.lazy`'s initial microtask or trips React 19's 300ms
 * Suspense fallback throttle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): ComponentType<ComponentProps<M[K]>> & { preload: () => Promise<M> } {
  let loading: Promise<M> | undefined;
  let resolved: M[K] | undefined;
  const preload = () =>
    (loading ??= load().then(
      (m) => {
        resolved = m[name];
        return m;
      },
      (err) => {
        loading = undefined;
        throw err;
      },
    ));
  const Lazy = lazy(() => preload().then((m) => ({ default: m[name] })));
  function LazyNamed(props: ComponentProps<M[K]>) {
    if (resolved) return createElement(resolved, props);
    return createElement(Lazy, props);
  }
  LazyNamed.displayName = `Lazy(${String(name)})`;
  return Object.assign(LazyNamed, { preload });
}

/**
 * Whether background chunk preloading should run. Local app bundles (Tauri / localhost)
 * serve chunks off disk so `navigator.connection.downlink` heuristics (WebView2/Edge
 * often reports ~1.3 Mbps) never apply; on remote web hosts we skip save-data or slow
 * cellular links.
 */
export function canPreloadChunks(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol === "tauri:" || hostname === "tauri.localhost" || hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return true;
  return !(c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g");
}

/** Runs `fn` once the page has nothing else to do (or after `timeout` ms). */
export function whenIdle(fn: () => void, timeout = 3000) {
  // Safari (the macOS and iOS web views) has no requestIdleCallback.
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1000);
  return () => window.clearTimeout(id);
}
