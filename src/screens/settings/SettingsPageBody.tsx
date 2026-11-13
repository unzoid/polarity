import { MarketplacePage } from "../../components/Marketplace";
import type { PageId } from "../../lib/settings";
import type { SectionProps } from "../../components/settings/rows";
import { AboutPage } from "./AboutPage";
import { AccountPage } from "./AccountPage";
import { AddonsPage } from "./AddonsPage";
import { AdvancedPage } from "./AdvancedPage";
import { AnimePage } from "./AnimePage";
import { AppearancePage } from "./AppearancePage";
import { BrowsingPage } from "./BrowsingPage";
import { NotificationsPage } from "./NotificationsPage";
import { ControllerPage } from "./ControllerPage";
import { ControlsPage } from "./ControlsPage";
import { PlaybackPage } from "./PlaybackPage";
import { ServicesPage } from "./ServicesPage";
import { SourcesPage } from "./SourcesPage";
import { SubtitlesPage } from "./SubtitlesPage";

/**
 * One settings page's content, drawn inside the settings overlay. Options sit in cards; everything saves the
 * moment it changes, except typed values (keys, addresses), which save on their own button. A long page
 * (PAGE_SECTIONS) shows its list of sections, or the one section open.
 */
export function SettingsPageBody({ page, section, openSection }: { page: PageId } & SectionProps) {
  switch (page) {
    case "account":
      return <AccountPage />;
    case "playback":
      return <PlaybackPage section={section} openSection={openSection} />;
    case "sources":
      return <SourcesPage />;
    case "subtitles":
      return <SubtitlesPage section={section} openSection={openSection} />;
    case "appearance":
      return <AppearancePage />;
    case "browsing":
      return <BrowsingPage section={section} openSection={openSection} />;
    case "anime":
      return <AnimePage section={section} openSection={openSection} />;
    case "notifications":
      return <NotificationsPage />;
    case "advanced":
      return <AdvancedPage />;
    case "controls":
      return <ControlsPage />;
    case "controller":
      return <ControllerPage />;
    case "marketplace":
      return <MarketplacePage />;
    case "addons":
      return <AddonsPage />;
    case "services":
      return <ServicesPage />;
    case "about":
      return <AboutPage />;
  }
}
