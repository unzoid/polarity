import { Dropdown } from "../../components/Dropdown";
import { useSettings, useUpdateSettings } from "../../lib/net";
import { usePrefs } from "../../lib/settings";
import { clearRecentSearches } from "../../lib/catalog";
import { Card, PickRow, SectionList, type SectionProps, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

/** Its sections (PAGE_SECTIONS.browsing): General, Home & Title Pages, Cards & Episodes. */
export function BrowsingPage({ section, openSection }: SectionProps) {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  if (!data) return null;
  switch (section) {
    case "general":
      return (
        <>
          <Card>
            {/* Anime is offered only while the Anime section is on. */}
            <PickRow setting="startPage" title="Open the app on">
              <Dropdown
                label="Open the app on"
                value={data.startPage === "anime" && !prefs.animeEnabled ? "home" : (data.startPage ?? "home")}
                onChange={(v) => update.mutate({ startPage: v })}
                options={[
                  { value: "home", label: "Home" },
                  { value: "movies", label: "Movies" },
                  { value: "series", label: "Shows" },
                  ...(prefs.animeEnabled ? [{ value: "anime" as const, label: "Anime" }] : []),
                  { value: "library", label: "Library" },
                ]}
              />
            </PickRow>
            <SettingRow id="language" caption={data.tmdbKey ? undefined : "Needs a TMDB key (Services → Artwork and episode info)"} />
          </Card>
          <Card title="Family">
            <SettingRow id="matureContent" />
          </Card>
          <Card title="Search">
            <SettingRow id="searchSuggestions" />
            <SettingRow id="saveRecentSearches" onChanged={(v) => !v && clearRecentSearches()} />
          </Card>
        </>
      );
    case "pages":
      return (
        <>
          <Card title="Home">
            <SettingRow id="heroAutoplay" />
            <SettingRow id="showContinueWatching" />
          </Card>
          <Card title="Title Pages">
            <SettingRow id="trailerAutoplay" />
            {(data.trailerAutoplay ?? true) && <SettingRow id="trailerSound" />}
          </Card>
          <Card title="Calendar" footer="Like Stremio's calendar: built from the shows in your library and the ones you're watching.">
            <SettingRow id="showCalendar" />
          </Card>
        </>
      );
    case "cards":
      return (
        <>
          <Card title="Cards">
            <SettingRow id="showCardTitles" />
            {/* Details sit under the title, so they're off (and greyed) while titles are. */}
            <ToggleRow
              setting="showCardDetails"
              title="Show details"
              caption="Add the type, genre and year under the name"
              checked={data.showCardTitles && data.showCardDetails}
              disabled={!data.showCardTitles}
              onChange={(v) => update.mutate({ showCardDetails: v })}
            />
            <SettingRow id="showCardRatings" />
            {(data.showCardRatings ?? false) && <SettingRow id="cardRatingPosition" />}
            <SettingRow id="ratingColors" />
          </Card>
          <Card title="Episodes">
            <SettingRow id="episodeLayout" />
          </Card>
          <Card title="Spoilers" footer="Episodes you've finished show as normal.">
            <SettingRow id="hideEpisodeThumbs" />
            <SettingRow id="hideEpisodeDescriptions" />
          </Card>
        </>
      );
    default:
      return <SectionList page="browsing" openSection={openSection} />;
  }
}
