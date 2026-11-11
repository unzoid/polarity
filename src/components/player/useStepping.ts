import { useCallback, useEffect, useRef, useState } from "react";

/** A step that keeps the player buffering this long shows the spinner after all (a step back to a far keyframe). */
export const STEP_SLOW_MS = 500;
/** The seek a step makes may report its end a moment after the step has landed. */
const STEP_TAIL_MS = 300;

/**
 * Frame stepping's state for the screen (#346). `stepping`: paused on a stepped frame, so the frame number shows
 * (in the clock, or on its own once the controls have hidden) until playback resumes or `leave` (a seek).
 * `spinner`: whether the play button shows buffering. Each step seeks, and the player reports buffering for every
 * seek: during a step (`begin` .. `end`) that only counts once it has lasted STEP_SLOW_MS, so holding `,` or `.`
 * keeps the icon steady.
 */
export function useStepping(paused: boolean, buffering: boolean) {
  const [stepping, setStepping] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [slow, setSlow] = useState(false);
  const tail = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!paused) setStepping(false);
  }, [paused]);
  useEffect(() => {
    setSlow(false);
    if (!buffering) return;
    const t = window.setTimeout(() => setSlow(true), STEP_SLOW_MS);
    return () => window.clearTimeout(t);
  }, [buffering]);
  useEffect(() => () => window.clearTimeout(tail.current), []);
  const begin = useCallback(() => {
    window.clearTimeout(tail.current);
    setStepping(true);
    setQuiet(true);
  }, []);
  const end = useCallback(() => {
    window.clearTimeout(tail.current);
    tail.current = window.setTimeout(() => setQuiet(false), STEP_TAIL_MS);
  }, []);
  const leave = useCallback(() => setStepping(false), []);
  return { stepping, begin, end, leave, spinner: buffering && (!quiet || slow) };
}
