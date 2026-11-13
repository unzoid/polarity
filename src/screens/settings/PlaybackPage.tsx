import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { keys, useSettings, useUpdateSettings } from "../../lib/net";
import { buildChannel, isDesktop } from "../../lib/platform";
import { usePrefs } from "../../lib/settings";
import { Card, PickRow, SectionList, type SectionProps, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

/** Its sections (PAGE_SECTIONS.playback): Autoplay, Skipping, Resuming, Player, On-Screen Controls. */
export function PlaybackPage({ section, openSection }: SectionProps) {
  const { data } = useSettings();
  const update = useUpdateSettings();
  // Desktop builds made with a Discord application only.
  const { data: discord } = useQuery({ queryKey: keys.discord, queryFn: api.discordAvailable, staleTime: Infinity });
  const { discordPresence } = usePrefs();
  if (!data) return null;
  const recapsOn = data.autoSkipRecaps ?? data.autoSkip;

  switch (section) {
    case "autoplay":
      return (
        <Card>
          <SettingRow id="autoPickSource" />
          <SettingRow id="autoplayNext" />
          {data.autoplayNext && <SettingRow id="autoplayCountdown" />}
          {data.autoplayNext && <SettingRow id="stillWatchingAfter" />}
          <SettingRow id="nextUpTiming" />
        </Card>
      );
    case "skipping":
      return (
        <Card footer="Timings come from the IntroDB community database, or from the file's own chapters.">
          <SettingRow id="autoSkip" />
          {/* Unset follows Skip intros, so it isn't a plain schema row. */}
          <ToggleRow
            setting="autoSkipRecaps"
            title="Skip recaps"
            caption="Jump past the “previously on” part on its own"
            checked={recapsOn}
            onChange={(v) => update.mutate({ autoSkipRecaps: v })}
          />
          {(data.autoSkip || recapsOn) && <SettingRow id="autoSkipDelay" />}
          <SettingRow id="preferFileChapters" />
        </Card>
      );
    case "resuming":
      return (
        <Card>
          <SettingRow id="resumePlayback" />
          {(data.resumePlayback ?? true) && <SettingRow id="resumeRewind" />}
          <SettingRow id="watchedThreshold" />
        </Card>
      );
    case "player":
      return (
        <Card>
          <SettingRow id="startFullscreen" />
          <SettingRow id="pauseOnMinimize" />
          {discord && <SettingRow id="discordPresence" />}
          {/* A dev build made without its own Discord application stays off Discord (#376). */}
          {discord === false && buildChannel === "dev" && isDesktop && (
            <PickRow
              setting="discordPresence"
              title="Show on Discord"
              caption="Not set up for dev builds: this build was made without the Polarity Dev Discord application, so it doesn't show on Discord."
            >
              {null}
            </PickRow>
          )}
          {/* The button goes with the presence: none while nothing shows. */}
          {discord && discordPresence !== "off" && <SettingRow id="discordJoin" />}
          {/* Turning it on or off starts the next video at normal speed. */}
          <ToggleRow
            setting="rememberSpeed"
            title="Remember playback speed"
            caption="Keep the speed you last chose for the next video, instead of going back to normal"
            checked={!!data.rememberSpeed}
            onChange={(v) => update.mutate({ rememberSpeed: v, playbackSpeed: 1 })}
          />
        </Card>
      );
    case "controls":
      return (
        <Card>
          <SettingRow id="timeDisplay" />
          <SettingRow id="showPlayingFormat" />
          <SettingRow id="loadingDetails" />
          <SettingRow id="seekStep" />
          <SettingRow id="controlsHideSecs" />
          <SettingRow id="pauseShowsControls" />
          <SettingRow id="holdSpeed" />
          <SettingRow id="clickAction" />
          <SettingRow id="wheelAction" />
        </Card>
      );
    default:
      return <SectionList page="playback" openSection={openSection} />;
  }
}
