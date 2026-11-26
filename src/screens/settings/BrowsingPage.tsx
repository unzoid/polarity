import { useState } from "react";
import { Dropdown } from "../../components/Dropdown";
import { FamilyPickerTray, MoreDots } from "../../components/settings/FamilyTray";
import { useSettings, useUpdateSettings } from "../../lib/net";
import { usePrefs } from "../../lib/settings";
import { clearRecentSearches } from "../../lib/catalog";
import { Card, PickRow, RowText, SectionList, type SectionProps, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { LimitFromProfile } from "../../components/profileLock/LimitFromProfile";
import { useLimitFromProfile } from "../../lib/catalog";
import { HiddenTitlesCard } from "../../components/settings/HiddenTitlesCard";
import { useFormFactor } from "../../lib/ui";

/** Its sections (PAGE_SECTIONS.browsing): General, Home & Title Pages, Cards & Episodes. */
export function BrowsingPage({ section, openSection }: SectionProps) {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  const fromProfile = useLimitFromProfile();
  const phone = useFormFactor().form === "phone";
  const [startPageOpen, setStartPageOpen] = useState(false);
  if (!data) return null;
  const startPageVal = data.startPage === "anime" && !prefs.animeEnabled ? "home" : (data.startPage ?? "home");
  const startPageOptions = [
    { value: "home" as const, label: "Home" },
    { value: "movies" as const, label: "Movies" },
    { value: "series" as const, label: "Shows" },
    ...(prefs.animeEnabled ? [{ value: "anime" as const, label: "Anime" }] : []),
    { value: "library" as const, label: "Library" },
  ];
  switch (section) {
    case "general":
      return (
        <>
          <Card>
            {/* Anime is offered only while the Anime section is on. */}
            {phone ? (
              <>
                <button
                  type="button"
                  className="settings-row settings-row-button ft-choice-row"
                  data-setting="startPage"
                  aria-haspopup="dialog"
                  aria-expanded={startPageOpen}
                  onClick={() => setStartPageOpen(true)}
                >
                  <RowText title="Open the app on" />
                  <span className="ft-choice-right">
                    <span className="ft-choice-value">{startPageOptions.find((o) => o.value === startPageVal)?.label ?? "Home"}</span>
                    <MoreDots size={16} className="ft-choice-dots" />
                  </span>
                </button>
                <FamilyPickerTray
                  open={startPageOpen}
                  onClose={() => setStartPageOpen(false)}
                  title="Open the app on"
                  value={startPageVal}
                  options={startPageOptions}
                  onPick={(v) => update.mutate({ startPage: v })}
                />
              </>
            ) : (
              <PickRow setting="startPage" title="Open the app on">
                <Dropdown
                  label="Open the app on"
                  value={startPageVal}
                  onChange={(v) => update.mutate({ startPage: v })}
                  options={startPageOptions}
                />
              </PickRow>
            )}
            <SettingRow id="language" caption={data.tmdbKey ? undefined : "Needs a TMDB key (Services → Artwork and episode info)"} />
          </Card>
          <Card title="Family">
            {/* A restricted profile's limit is its own, set in its edit sheet behind a PIN. */}
            {fromProfile ? <LimitFromProfile /> : <SettingRow id="viewingLimit" />}
        {!fromProfile && prefs.viewingLimit > 0 && <SettingRow id="viewingHideUnrated" />}
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
            <SettingRow id="hideWatched" />
          </Card>
          <HiddenTitlesCard />
          <Card title="Title Pages">
            <SettingRow id="trailerAutoplay" />
            {(data.trailerAutoplay ?? true) && <SettingRow id="trailerSound" />}
          </Card>
          <Card title="Calendar">
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
          <Card title="Spoilers">
            <SettingRow id="hideEpisodeThumbs" />
            <SettingRow id="hideEpisodeDescriptions" />
          </Card>
        </>
      );
    default:
      return <SectionList page="browsing" openSection={openSection} />;
  }
}
