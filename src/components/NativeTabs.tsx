import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { nativeTabsAvailable, onNativeTab, setNativeTabs, type NativeTabsState } from "../lib/platform";
import { useRouter } from "../lib/router";
import { nativeTabsState, tabRoute, type NavLink } from "../lib/navTabs";
import { useSettingsOverlay } from "../lib/settings";
import { dismissDepth, onDismissDepth } from "../lib/ui";
import { warnFailed } from "../lib/errors";
import { useSettings } from "../lib/net";
import { resolveScheme, useSystemPrefersLight } from "../lib/theme";

/**
 * On iOS the sections are iOS's own tab bar (lib/platform/nativeTabs.ts), kept in step with the router both ways:
 * a tab picked there opens its section (picking the current one again goes back to its top, as on iOS), and Back,
 * deep links and watch parties move the bar with them. `links` are the sections alone, at most five on an iPhone
 * (lib/navTabs.ts): Search and the Calendar stay buttons in the top bar. The web-drawn tabs hide (shell.css).
 * Elsewhere nothing.
 */
export function useNativeTabs(links: NavLink[]) {
  const { stack, tab } = useRouter();
  const settingsOpen = useSettingsOverlay().open;
  const layers = useSyncExternalStore(onDismissDepth, dismissDepth);
  // Drawn in the app's scheme: on a light page iOS's dark bar stood out (it would follow the system's otherwise).
  const { data: settings } = useSettings();
  const scheme = resolveScheme(settings?.colorScheme, useSystemPrefersLight());
  const state = { ...nativeTabsState(links, stack, settingsOpen || layers > 0), scheme };
  const key = JSON.stringify(state);

  const latest = useRef({ links, tab });
  latest.current = { links, tab };

  useEffect(() => {
    if (!nativeTabsAvailable) return;
    const root = document.documentElement;
    root.dataset.nativeTabs = "true";
    let unlisten: (() => void) | undefined;
    let gone = false;
    void onNativeTab((id) => {
      const route = tabRoute(latest.current.links, id);
      if (route) latest.current.tab(route);
    }).then((u) => (gone ? u() : (unlisten = u)));
    // Leaving this shell takes the bar away with it.
    return () => {
      gone = true;
      unlisten?.();
      delete root.dataset.nativeTabs;
      setNativeTabs({ tabs: [], selected: null, hidden: true }).catch(warnFailed("native tab bar"));
    };
  }, []);

  useEffect(() => {
    if (nativeTabsAvailable) setNativeTabs(JSON.parse(key) as NativeTabsState).catch(warnFailed("native tab bar"));
  }, [key]);

  useHeldSafeArea(nativeTabsAvailable && (settingsOpen || layers > 0));
}

/** How long the bar takes to come back, and a little to spare, before the bottom safe area is let go again. */
const BAR_BACK_MS = 700;

/**
 * While a sheet covers the screen, iOS's tab bar hides, and with it goes the part of the bottom safe area it took:
 * the pages and the sheet would lay themselves out again mid-motion, a bump as the sheet rises and another as it
 * goes. The bottom safe area is held where it was until the bar is back.
 */
function useHeldSafeArea(covered: boolean) {
  useLayoutEffect(() => {
    if (!covered) return;
    const root = document.documentElement;
    if (!root.style.getPropertyValue("--safe-bottom")) {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)";
      document.body.append(probe);
      root.style.setProperty("--safe-bottom", getComputedStyle(probe).paddingBottom);
      probe.remove();
    }
    clearTimeout(letGo);
    return () => {
      letGo = window.setTimeout(() => root.style.removeProperty("--safe-bottom"), BAR_BACK_MS);
    };
  }, [covered]);
}
let letGo = 0;
