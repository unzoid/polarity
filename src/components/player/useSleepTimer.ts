import { useEffect, useState } from "react";
import type { MediaLike } from "./mpvMedia";
import {
  extendSleep,
  FADE_MS,
  sleepDone,
  sleepGain,
  sleepLeft,
  sleepWarns,
  startSleep,
  type SleepChoice,
  type SleepTimer,
} from "../../lib/playback/sleepTimer";

/**
 * The player's sleep timer (#270, lib/playback/sleepTimer.ts) for `media`. `asleep` turns on when it
 * runs out: the player then pauses (only its own playback, in a watch party too) and shows Resume.
 * Nothing carries over to the next playback: each player starts with it off.
 */
export function useSleepTimer(media: MediaLike | null) {
  const [choice, setChoice] = useState<SleepChoice>("off");
  const [timer, setTimer] = useState<SleepTimer | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const left = timer && media ? sleepLeft(timer, now, media.duration - media.currentTime, media.playbackRate) : null;
  const fading = left != null && left < FADE_MS + 1000;

  // A second at a time; four times a second while the sound fades, so it goes down smoothly.
  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), fading ? 250 : 1000);
    return () => window.clearInterval(t);
  }, [timer, fading]);

  const fallAsleep = () => {
    setTimer(null);
    setChoice("off");
    setAsleep(true);
  };
  useEffect(() => {
    if (timer && sleepDone(left)) fallAsleep();
  }, [timer, left]);
  // The episode's end is the video's own end: as it ends, not a tick later.
  useEffect(() => {
    if (!media || timer?.kind !== "episode") return;
    media.addEventListener("ended", fallAsleep);
    return () => media.removeEventListener("ended", fallAsleep);
  }, [media, timer]);

  return {
    choice,
    /** Ms until it ends; null while off, or before the episode's length is known. */
    left,
    /** How loud the player plays (0–1): down to silence over the last 30 s. */
    gain: sleepGain(left),
    /** The last minute: "+15 min" and Cancel are offered. */
    warning: sleepWarns(left),
    asleep,
    set(next: SleepChoice) {
      setChoice(next);
      setTimer(startSleep(next, Date.now()));
      setAsleep(false);
    },
    extend() {
      if (!timer) return;
      const t = Date.now();
      setTimer(extendSleep(timer, t, left));
      // The episode's end has become a time: the closest choice is a quarter of an hour.
      if (timer.kind === "episode") setChoice("15");
      setNow(t);
    },
    cancel() {
      setTimer(null);
      setChoice("off");
    },
    /** Back from the "Sleep timer ended" screen. */
    wake() {
      setAsleep(false);
    },
  };
}
