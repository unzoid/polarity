import { ORIGINAL_LANGUAGE, PREFERRED_LANGUAGES, languageName } from "./languages";

/**
 * What TV's Captions and Speed menus offer for a YouTube video (#434, components/player), which a remote can't reach in YouTube's own
 * player. Only what the IFrame Player API documents: captions on in a language through the player
 * parameters (`cc_load_policy`, `cc_lang_pref`, so the embed loads again), speed through
 * `setPlaybackRate` among the video's own `getAvailablePlaybackRates`.
 */

/** The Captions menu's row for no captions asked for. */
export const CAPTIONS_OFF = "off";

/** What a remote can't change in YouTube's player, said under the Captions menu. */
export const CAPTIONS_NOTE =
  "Captions come in the language you pick where the video has it; otherwise YouTube's player picks one. YouTube doesn't let an app see which languages a video has or change its audio and caption style, so those stay in its own settings, which a remote can't reach. Picking reloads YouTube's player where it is.";
/** In a party everyone plays at 1x (the party's sync moves the rate itself). */
export const SPEED_PARTY_NOTE = "A watch party plays at 1x for everyone.";
export const SPEED_ONE_NOTE = "YouTube's player only plays this video at normal speed.";

/** Off, then the subtitle language from Settings, then the usual list. */
export function captionChoices(preferred?: string): { id: string; label: string }[] {
  const first = preferred && preferred !== ORIGINAL_LANGUAGE ? [preferred] : [];
  const codes = [...new Set([...first, ...PREFERRED_LANGUAGES])];
  return [{ id: CAPTIONS_OFF, label: "Off" }, ...codes.map((c) => ({ id: c, label: languageName(c) ?? c }))];
}

/** The speeds to offer: the video's own once YouTube's player says them, else `fallback` (the player rounds to one it has). */
export function speedChoices(available: readonly number[], fallback: readonly number[]): readonly number[] {
  return available.length ? available : fallback;
}
