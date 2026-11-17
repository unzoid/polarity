import { HomeIcon, MagnifyingGlassIcon, RectangleStackIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { rootTab, useRouter, type TabRoute } from "../../../src/lib/router";
import { usePrefs } from "../../../src/lib/settings";
import { sameSection, type Section } from "./Sidebar";

/** A phone's sections, at the bottom where a thumb reaches: Home, Anime when it's on, Library, Search. */
export function PhoneTabs() {
  const { stack, tab } = useRouter();
  const current = rootTab(stack);
  const { animeEnabled } = usePrefs();
  const tabs: Section[] = [
    { route: { name: "home" } as TabRoute, label: "Home", icon: HomeIcon },
    ...(animeEnabled ? [{ route: { name: "anime" } as TabRoute, label: "Anime", icon: SparklesIcon }] : []),
    { route: { name: "library" }, label: "Library", icon: RectangleStackIcon },
    { route: { name: "search" }, label: "Search", icon: MagnifyingGlassIcon },
  ];
  return (
    <nav className="phone-tabs" aria-label="Polarity">
      {tabs.map((t) => {
        const active = sameSection(current, t.route);
        return (
          <button key={t.label} className="phone-tab" aria-current={active ? "page" : undefined} onClick={() => tab(t.route)}>
            <t.icon aria-hidden />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
