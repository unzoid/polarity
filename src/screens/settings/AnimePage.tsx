import { ToggleChip } from "../../components/ui/Chip";
import { useEffect, useState } from "react";
import { ANIME_SHELVES, preferredGroups, setShelfVisible, useShelfVisible } from "../../lib/anime";
import { setPrefs, usePrefs } from "../../lib/settings";
import { Card, FormRow, SectionList, type SectionProps } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

/**
 * The Anime section's own preferences (kept in prefs, and follow the profile). Its switch sits above its
 * sections (PAGE_SECTIONS.anime): Language, Shelves & Cards, Episodes & Sources. With it off, there's only the switch.
 */
export function AnimePage({ section, openSection }: SectionProps) {
  const prefs = usePrefs();
  const shelfVisible = useShelfVisible();
  const [groups, setGroups] = useState(prefs.animePreferredGroups);
  useEffect(() => setGroups(prefs.animePreferredGroups), [prefs.animePreferredGroups]);
  // Saved tidy: one ", " between groups, so the box shows what's in effect.
  const tidyGroups = (g: string) => preferredGroups(g).join(", ");
  const toggle = (
    <Card footer={prefs.animeEnabled ? undefined : "Your watch history and saved titles stay as they are."}>
      <SettingRow id="animeEnabled" />
    </Card>
  );
  if (!prefs.animeEnabled) return toggle;
  switch (section) {
    case "language":
      return (
        <Card>
          <SettingRow id="animeTitles" />
          <SettingRow id="animeVoices" />
          <SettingRow id="animeAudioLanguage" />
          <SettingRow id="animeSubtitleLanguage" />
        </Card>
      );
    case "browsing":
      return (
        <>
          <Card title="Shelves">
            <div className="settings-row settings-chip-row">
              <div className="srcf-tags" role="group" aria-label="Shelves on the Anime page">
                {ANIME_SHELVES.map((s) => {
                  const on = shelfVisible(s.id);
                  return <ToggleChip key={s.id} on={on} label={s.label} onToggle={() => setShelfVisible(s.id, !on)} />;
                })}
              </div>
            </div>
          </Card>
          <Card title="Cards">
            <SettingRow id="animeCardTitles" />
            <SettingRow id="animeCardPeek" />
            <SettingRow id="animeCardScores" />
            <SettingRow id="animeScoreFormat" />
            <SettingRow id="animeCardCountdown" />
          </Card>
          <Card title="Schedule">
            <SettingRow id="animeScheduleAll" />
          </Card>
        </>
      );
    case "episodes":
      return (
        <>
          <Card title="Episodes">
            <SettingRow id="animeSkipFiller" />
            <SettingRow id="animeHideRecaps" />
            <SettingRow id="animeNo4k" />
            <SettingRow id="animeSpoilerTags" />
          </Card>
          <Card title="Also in This Franchise">
            <SettingRow id="animeReadOn" />
            <SettingRow id="animeHideUnplayable" />
          </Card>
          <Card
            title="Preferred Release Groups"
            footer="Separate with commas. Earlier groups rank higher in Best Match."
          >
            <FormRow
              title="Preferred release groups"
              trayHint="Separate with commas. Earlier groups rank higher in Best Match."
              emptyValue="None"
              placeholder="Group A, Group B"
              aria-label="Preferred release groups"
              value={groups}
              onChange={setGroups}
              saved={prefs.animePreferredGroups}
              tidy={tidyGroups}
              onSubmit={(g) => {
                setPrefs({ animePreferredGroups: g });
                setGroups(g);
              }}
            />
          </Card>
        </>
      );
    default:
      return (
        <>
          {toggle}
          <SectionList page="anime" openSection={openSection} />
        </>
      );
  }
}
