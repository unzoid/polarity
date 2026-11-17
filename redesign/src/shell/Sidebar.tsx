import type { ComponentType, SVGProps } from "react";
import {
  CalendarDaysIcon,
  Cog6ToothIcon,
  FilmIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  RectangleStackIcon,
  SparklesIcon,
  TvIcon,
} from "@heroicons/react/24/outline";
import { rootTab, useRouter, type TabRoute } from "../../../src/lib/router";
import { usePrefs } from "../../../src/lib/settings";
import { useAccount } from "../../../src/lib/account";
import logo from "../../../assets/brand/polarity-colored.svg";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
export type Section = { route: TabRoute; label: string; icon: Icon };

const BROWSE: Section[] = [
  { route: { name: "home" }, label: "Home", icon: HomeIcon },
  { route: { name: "discover", type: "series" }, label: "Series", icon: TvIcon },
  { route: { name: "discover", type: "movie" }, label: "Movies", icon: FilmIcon },
  { route: { name: "anime" }, label: "Anime", icon: SparklesIcon },
];

const YOURS: Section[] = [
  { route: { name: "library" }, label: "Library", icon: RectangleStackIcon },
  { route: { name: "calendar" }, label: "Calendar", icon: CalendarDaysIcon },
];

export const sameSection = (a: TabRoute, b: TabRoute) =>
  a.name === b.name && (a.name !== "discover" || (b.name === "discover" && a.type === b.type));

/** The sections a profile sees: Anime only when it's switched on. */
export function useBrowseSections() {
  const { animeEnabled } = usePrefs();
  return animeEnabled ? BROWSE : BROWSE.filter((s) => s.route.name !== "anime");
}

/**
 * The desktop's one navigation: a quiet column, the way a library app lists its shelves. Browsing first, then what
 * is yours, then Settings and the profile at the foot. The page beside it never changes colour.
 */
export function Sidebar() {
  const { stack, tab } = useRouter();
  const current = rootTab(stack);
  const browse = useBrowseSections();
  const { profile } = useAccount();

  const item = (s: Section) => {
    const active = sameSection(current, s.route);
    return (
      <li key={s.label}>
        <button className="nav-item" aria-current={active ? "page" : undefined} onClick={() => tab(s.route)}>
          <s.icon className="nav-icon" aria-hidden />
          <span>{s.label}</span>
        </button>
      </li>
    );
  };

  const searching = current.name === "search";
  return (
    <nav className="sidebar" aria-label="Polarity">
      <div className="sidebar-brand" data-tauri-drag-region>
        <img src={logo} alt="Polarity" className="sidebar-logo" draggable={false} />
      </div>

      <button className="nav-search" aria-current={searching ? "page" : undefined} onClick={() => tab({ name: "search" })}>
        <MagnifyingGlassIcon className="nav-icon" aria-hidden />
        <span>Search</span>
        <kbd className="keycap">/</kbd>
      </button>

      <ul className="nav-group">{browse.map(item)}</ul>

      <p className="nav-label">Yours</p>
      <ul className="nav-group">{YOURS.map(item)}</ul>

      <div className="sidebar-foot">
        <button
          className="nav-item"
          aria-current={current.name === "settings" ? "page" : undefined}
          onClick={() => tab({ name: "settings" })}
        >
          <Cog6ToothIcon className="nav-icon" aria-hidden />
          <span>Settings</span>
        </button>
        <div className="nav-profile">
          <span className="nav-avatar" aria-hidden>
            {(profile?.name ?? "G").slice(0, 1).toUpperCase()}
          </span>
          <span className="nav-profile-name">{profile?.name ?? "Guest"}</span>
        </div>
      </div>
    </nav>
  );
}
