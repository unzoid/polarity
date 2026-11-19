import { setPrefs, usePrefs } from "../../lib/settings";
import { Chips, Setting, Stepper } from "./SubtitleSettings";

const ON_OFF = [
  { value: 0, label: "Off" },
  { value: 1, label: "On" },
];

/**
 * The sound's options, shown in place of the audio list (the Audio column's cog), as the subtitle
 * settings are beside it. Each applies to the playing video straight away. The delay is this source's
 * (remembered with its tracks, lib/playback/trackMemory.ts); the two switches are this device's, as in
 * Settings → Subtitles & Audio.
 */
export function AudioSettings({ delay, onDelay }: { delay: number; onDelay: (seconds: number) => void }) {
  const { dialogueBoost, volumeLeveling } = usePrefs();
  return (
    <div className="sub-settings">
      <Setting
        label="Delay"
        caption={
          delay === 0
            ? "Fix sound that doesn't match the picture. Now in sync"
            : delay > 0
              ? "Sound plays later than before"
              : "Sound plays earlier than before"
        }
      >
        <Stepper
          value={delay}
          step={0.05}
          min={-10}
          max={10}
          format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}s`}
          onChange={onDelay}
          label="Audio delay"
        />
      </Setting>
      <Setting label="Boost dialogue" caption="Clearer voices on 5.1 and 7.1 sound">
        <Chips value={dialogueBoost ? 1 : 0} options={ON_OFF} onChange={(v) => setPrefs({ dialogueBoost: v === 1 })} />
      </Setting>
      <Setting label="Even out volume" caption="Quieter explosions, louder whispers">
        <Chips value={volumeLeveling ? 1 : 0} options={ON_OFF} onChange={(v) => setPrefs({ volumeLeveling: v === 1 })} />
      </Setting>
    </div>
  );
}
