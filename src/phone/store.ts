import { useSyncExternalStore } from "react";

/** A value any part of the phone shell can open or close (the bell's sheet, Home's categories), and watch. */
function flag<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const use = () => useSyncExternalStore(subscribe, () => value);
  return { set, use, get: () => value };
}

/** The bell's Notifications sheet. */
export const notifications = flag(false);

/** Home's Categories list: open for these titles' kind ("all" from Home itself). */
export const categories = flag<"all" | "movie" | "series" | null>(null);
