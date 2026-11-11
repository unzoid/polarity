import { useSyncExternalStore } from "react";
import type { PageId } from "./pages";

/** The settings overlay: open from anywhere, on a given page, or with none where it was left. */
type State = { open: boolean; page: PageId | null };

let state: State = { open: false, page: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSettings(page?: string) {
  state = { open: true, page: (page as PageId) ?? null };
  emit();
}

export function closeSettings() {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export const isSettingsOpen = () => state.open;

export function useSettingsOverlay() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
