import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SUBTITLE_STYLE, SubtitleSettings, subtitleCueVars } from "../../components/player/SubtitleSettings";
import { api } from "../../lib/api";
import { keys, useSettings, useUpdateSettings } from "../../lib/net";
import { Card, SectionList, type SectionProps } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { isDesktop, isTvDevice, os } from "../../lib/platform";
import { usePrefs } from "../../lib/settings";

/** Its sections (PAGE_SECTIONS.subtitles): Languages, Subtitle Style, Sound. */
export function SubtitlesPage({ section, openSection }: SectionProps) {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const { secondSubtitles } = usePrefs();
  const { data: hasMpv } = useQuery({ queryKey: keys.mpv, queryFn: api.mpvAvailable, staleTime: Infinity });
  if (!data) return null;
  const style = data.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;

  switch (section) {
    case "languages":
      return (
        <Card>
          <SettingRow id="audioLanguage" />
          <SettingRow id="subtitleLanguage" />
          {!!data.subtitleLanguage && <SettingRow id="subtitleMode" />}
          <SettingRow id="preferSdh" />
          {/* mpv shows the second one; the built-in player shows one at a time. */}
          {hasMpv && <SettingRow id="secondSubtitles" />}
          {hasMpv && secondSubtitles && <SettingRow id="secondSubtitleLanguage" />}
        </Card>
      );
    case "style":
      return (
        <Card>
          <div className="settings-sub-sample" data-setting="subtitleStyle" style={subtitleCueVars(style)} aria-hidden>
            <span>This is how your subtitles will look.</span>
          </div>
          <div className="settings-card-pad">
            <SubtitleSettings
              style={style}
              onChange={(patch) => update.mutate({ subtitleStyle: { ...style, ...patch } })}
              canPosition
            />
          </div>
        </Card>
      );
    case "sound":
      return <SoundCard />;
    default:
      return <SectionList page="subtitles" openSection={openSection} />;
  }
}

/** mpv's audio options. They suit this device's speakers, so they stay on it. */
function SoundCard() {
  const { data: hasMpv } = useQuery({ queryKey: keys.mpv, queryFn: api.mpvAvailable, staleTime: Infinity });
  return (
    <Card
      footer={
        hasMpv === false
          ? "These need mpv, which plays most files. Install mpv to use them."
          : "Saved on this device, so headphones and a home cinema can each have their own."
      }
    >
      <SettingRow id="dialogueBoost" disabled={hasMpv === false} />
      <SettingRow id="volumeLeveling" disabled={hasMpv === false} />
      {/* Phones leave the volume to their own buttons (Player.tsx's systemVolume). */}
      {(isDesktop || isTvDevice) && <SettingRow id="maxVolume" disabled={hasMpv === false} />}
      {/* iPhones and iPads have no receiver output mpv can pass sound through to. */}
      {os !== "ios" && <SettingRow id="passthrough" disabled={hasMpv === false} />}
    </Card>
  );
}
