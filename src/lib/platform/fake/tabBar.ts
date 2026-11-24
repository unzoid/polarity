import { emit } from "@tauri-apps/api/event";
import type { NativeTabsState } from "../nativeTabs";

/**
 * A stand-in for iOS's own tab bar in the fake shell (fake.html with `?phone=1`, which emulates iOS): the floating
 * Liquid Glass capsule iOS 26 draws, built from what the app tells the native bar (components/NativeTabs.tsx). A tap
 * comes back as the native shell's `native://tab` event does. Its look approximates iOS's; the real bar is iOS's.
 * Like iOS, it counts as part of the bottom safe area, so the pages clear it.
 */

const HEIGHT = 62;
const GAP = 8;

/** Rough line drawings standing in for the SF Symbols the app names. */
const GLYPHS: Record<string, string> = {
  house: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
  magnifyingglass: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  sparkles: '<path d="M10 3.5 11.6 8.4 16.5 10 11.6 11.6 10 16.5 8.4 11.6 3.5 10 8.4 8.4z"/><path d="M17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  "person.crop.circle": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.2c1.3-2 3.2-3 5.5-3s4.2 1 5.5 3"/>',
  "books.vertical": '<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m16 5 3.5-.8L22 19l-3.5.8z"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 20h8"/>',
  film: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M16 3v18M4 8h4M4 16h4M16 8h4M16 16h4"/>',
};

const CSS = `
:root[data-fake-native-bar][data-phone-ui][data-native-tabs] {
  --ph-bar-bottom: calc(max(var(--safe-bottom), 12px) + ${HEIGHT + GAP + 4}px);
  --tabbar-h: calc(max(var(--safe-bottom), 12px) + ${HEIGHT + GAP + 4}px);
}
.fake-ios-tabbar {
  position: fixed; z-index: 2147483000; left: 50%; bottom: calc(max(env(safe-area-inset-bottom, 0px), 12px) + 2px);
  display: flex; gap: 0; height: ${HEIGHT}px; padding: 4px; border-radius: 999px;
  transform: translateX(-50%); transition: transform .32s cubic-bezier(.32,.72,0,1), opacity .2s;
  font: 600 10px/1.1 -apple-system, "SF Pro Text", system-ui, sans-serif; letter-spacing: .01em;
  background: rgb(30 30 32 / .42); color: rgb(255 255 255 / .92);
  -webkit-backdrop-filter: blur(14px) saturate(190%) brightness(1.05); backdrop-filter: blur(14px) saturate(190%) brightness(1.05);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .28), inset 0 -1px 0 rgb(255 255 255 / .06), inset 0 0 0 .5px rgb(255 255 255 / .18), 0 8px 28px rgb(0 0 0 / .35);
}
.fake-ios-tabbar[data-scheme="light"] {
  background: rgb(250 250 252 / .5); color: rgb(0 0 0 / .82);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .9), inset 0 0 0 .5px rgb(0 0 0 / .08), 0 8px 26px rgb(0 0 0 / .14);
}
.fake-ios-tabbar[data-hidden] { transform: translate(-50%, calc(100% + 40px)); opacity: 0; pointer-events: none; }
.fake-ios-tabbar button {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  width: 78px; border: 0; border-radius: 999px; background: none; color: inherit; font: inherit; cursor: pointer;
  transition: background-color .25s;
}
.fake-ios-tabbar button svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.fake-ios-tabbar button[aria-current] { color: var(--accent, #0a84ff); background: rgb(255 255 255 / .12); }
.fake-ios-tabbar[data-scheme="light"] button[aria-current] { background: rgb(0 0 0 / .06); }
.fake-ios-tabbar button[aria-current] svg { fill: currentColor; fill-opacity: .25; }
`;

let bar: HTMLElement | null = null;

export function showFakeTabBar(state: NativeTabsState) {
  const root = document.documentElement;
  if (!state.tabs.length) {
    bar?.remove();
    bar = null;
    delete root.dataset.fakeNativeBar;
    return;
  }
  if (!bar) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    bar = document.createElement("nav");
    bar.className = "fake-ios-tabbar";
    bar.setAttribute("aria-label", "Tab bar (iOS stand-in)");
    document.body.append(bar);
  }
  root.dataset.fakeNativeBar = "";
  bar.dataset.scheme = state.scheme ?? "dark";
  bar.toggleAttribute("data-hidden", state.hidden);
  bar.replaceChildren(
    ...state.tabs.map((t) => {
      const b = document.createElement("button");
      b.type = "button";
      if (t.id === state.selected) b.setAttribute("aria-current", "page");
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[t.icon] ?? '<rect x="5" y="5" width="14" height="14" rx="3"/>'}</svg>`;
      b.append(t.title);
      b.addEventListener("click", () => void emit("native://tab", t.id));
      return b;
    }),
  );
}
