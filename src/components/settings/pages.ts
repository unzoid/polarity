import { PAGE_IDS, PAGE_LABELS, type PageId } from "../../lib/settings";
import {
  Adjustments,
  Bell,
  Captions,
  Clock,
  Controls,
  Desktop,
  DownloadCircle,
  Episodes,
  Fire,
  Gamepad,
  Globe,
  Grid,
  Home,
  Info,
  PaintBrush,
  Play,
  PlayCircle,
  Profile,
  Puzzle,
  Services,
  Settings as Cog,
  SkipForward,
  Sources,
  Store,
  Trailer,
  Tv,
  Volume,
  type Icon,
} from "../icons";

const ICONS: Record<PageId, Icon> = {
  account: Profile,
  playback: Play,
  sources: Sources,
  subtitles: Captions,
  appearance: Desktop,
  browsing: Grid,
  anime: Fire,
  notifications: Bell,
  controls: Controls,
  controller: Gamepad,
  marketplace: Store,
  addons: Puzzle,
  services: Services,
  advanced: Cog,
  about: Info,
};

export type SettingsPage = { id: PageId; label: string; icon: Icon };

/** Every settings page with its sidebar label and icon, in order. */
export const PAGES: SettingsPage[] = PAGE_IDS.map((id) => ({ id, label: PAGE_LABELS[id], icon: ICONS[id] }));

/** The icon beside each section in a long page's list of sections (lib/settings/pages.ts PAGE_SECTIONS), by its id. */
export const SECTION_ICONS: Record<string, Icon> = {
  autoplay: PlayCircle,
  skipping: SkipForward,
  resuming: Clock,
  downloads: DownloadCircle,
  player: Tv,
  controls: Adjustments,
  languages: Globe,
  style: PaintBrush,
  sound: Volume,
  general: Cog,
  pages: Home,
  cards: Grid,
  language: Globe,
  browsing: Episodes,
  episodes: Trailer,
};
