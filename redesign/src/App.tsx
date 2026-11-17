import { useEffect, useRef, useState } from "react";
import { useAccount } from "../../src/lib/account";
import { useSettings } from "../../src/lib/net";
import { getPrefs } from "../../src/lib/settings";
import { RouterProvider, useRouter, type Entry, type Route } from "../../src/lib/router";
import { useFormFactor } from "../../src/lib/ui";
import type { Settings } from "../../src/lib/types";
import { Sidebar } from "./shell/Sidebar";
import { PhoneTabs } from "./shell/PhoneTabs";
import { TitleBar } from "./shell/TitleBar";
import { Home } from "./screens/Home";
import { Title } from "./screens/Title";
import { NotYet } from "./screens/NotYet";
import { Welcome } from "./screens/Welcome";

/** What the account's state shows: nothing while it loads, the way in, or the app. */
export function App() {
  const { status, profile } = useAccount();
  const { data: settings, isFetched } = useSettings();
  switch (status) {
    case "loading":
      return <div className="app-blank" />;
    case "signed-out":
    case "onboarding":
    case "profiles":
      return <Welcome />;
    case "guest":
    case "ready":
      if (!isFetched) return <div className="app-blank" />;
      return (
        <RouterProvider key={profile?.id ?? "guest"} initial={[startRoute(settings?.startPage)]}>
          <Shell />
        </RouterProvider>
      );
  }
}

function startRoute(page: Settings["startPage"] | undefined): Route {
  switch (page) {
    case "library":
      return { name: "library" };
    case "movies":
      return { name: "discover", type: "movie" };
    case "series":
      return { name: "discover", type: "series" };
    case "anime":
      return getPrefs().animeEnabled ? { name: "anime" } : { name: "home" };
    default:
      return { name: "home" };
  }
}

/**
 * The sidebar and the page. Every page in the stack stays mounted, only the top one shown, so Back returns to a
 * page exactly where it was left.
 */
function Shell() {
  const { stack, tab, back } = useRouter();
  const phone = useFormFactor().form === "phone";
  const { data: settings } = useSettings();
  const [scrolled, setScrolled] = useState(false);

  // Settings → Browsing that the pages read from the root.
  useEffect(() => {
    document.documentElement.dataset.hideOverviews = String(!!settings?.hideEpisodeDescriptions);
  }, [settings?.hideEpisodeDescriptions]);
  // A page scrolled away from its top gets a filled title bar, so nothing runs under the window's buttons.
  // Scroll events don't bubble: one listener in the capture phase hears every page's.
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const page = el.querySelector<HTMLElement>(".page:not([hidden]) .scroll");
      setScrolled((page?.scrollTop ?? 0) > 8);
    };
    measure();
    el.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => el.removeEventListener("scroll", measure, { capture: true });
  }, [stack]);

  // "/" goes to Search from anywhere but a text field; Escape goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        tab({ name: "search" });
      } else if (e.key === "Escape") {
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, back]);

  return (
    <div className="app">
      {!phone && <Sidebar />}
      <main className="page-host" ref={host}>
        <TitleBar scrolled={scrolled} />
        {stack.map((entry, i) => (
          <Page key={entry.key} entry={entry} top={i === stack.length - 1} />
        ))}
      </main>
      {phone && <PhoneTabs />}
    </div>
  );
}

function Page({ entry, top }: { entry: Entry; top: boolean }) {
  return (
    <div className="page" hidden={!top} aria-hidden={!top}>
      <Screen route={entry.route} />
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "detail":
      return <Title type={route.type} id={route.id} preview={route.preview} episode={route.episode} />;
    default:
      return <NotYet route={route} />;
  }
}
