import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatRemaining } from "../../lib/format";
import {
  PAUSE_SCREEN_AFTER_MS,
  PAUSE_SCREEN_EXIT_MS,
  pauseDetails,
  pauseScreenAllowed,
  type PauseDetails,
  type PauseScreenState,
} from "../../lib/playback/pauseScreen";
import { usePrefs } from "../../lib/settings/prefs";
import type { Meta } from "../../lib/types";
import { usePresence } from "../../lib/ui";
import { Img } from "../Img";
import { LogoOrName } from "../title/Card";
import type { MediaLike } from "./mpvMedia";
import { useMediaTime } from "./useMediaTime";

/** The player's pause screen: Settings → Playback's switch and the title's details joined to what the player is doing. */
export function PlayerPauseScreen({
  state,
  meta,
  videoId,
  media = null,
  unwatched = false,
}: {
  state: Omit<PauseScreenState, "enabled" | "details">;
  meta: Meta | undefined;
  videoId: string;
  media?: MediaLike | null;
  /** True when the playing episode has not been watched yet, so spoiler settings apply to its synopsis. */
  unwatched?: boolean;
}) {
  const { pauseDetails: enabled } = usePrefs();
  const details = useMemo(() => pauseDetails(meta, videoId), [meta, videoId]);
  const allowed = pauseScreenAllowed({ ...state, enabled, details: !!details });
  const remaining = useMediaTime(allowed ? media : null, (t) =>
    t.duration > 0 && Number.isFinite(t.duration) && t.current < t.duration ? formatRemaining(t.current, t.duration) : "",
  );
  return <PauseScreen allowed={allowed} details={details} remaining={remaining || undefined} unwatched={unwatched} />;
}

/**
 * Paused and left alone (lib/playback/pauseScreen.ts decides when that is): the frame dims and shows the title's
 * logo or name, the episode, a facts/remaining kicker, the overview and Apple TV+ "InSight"-style cast pills. It
 * takes no input of its own: a click, tap or key goes to the player under it and does what it always does, and
 * taking `allowed` back fades the layer out cleanly in 160ms.
 */
export function PauseScreen({
  allowed,
  details,
  remaining,
  unwatched = false,
  after = PAUSE_SCREEN_AFTER_MS,
}: {
  allowed: boolean;
  details: PauseDetails | undefined;
  remaining?: string;
  unwatched?: boolean;
  after?: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!allowed) return setShown(false);
    const t = window.setTimeout(() => setShown(true), after);
    return () => window.clearTimeout(t);
  }, [allowed, after]);

  const active = allowed && shown && details ? { details, remaining, unwatched } : null;
  const { shown: present, leaving } = usePresence(active, PAUSE_SCREEN_EXIT_MS);
  if (!present) return null;
  const { details: d, remaining: rem, unwatched: hideSpoiler } = present;
  const kicker = [d.facts, rem].filter(Boolean).join(" · ");

  return (
    <div
      className="pause-screen"
      role={leaving ? undefined : "region"}
      aria-label={leaving ? undefined : "Paused"}
      aria-hidden={leaving || undefined}
      data-leaving={leaving || undefined}
      data-unwatched={(!!d.episode && hideSpoiler) || undefined}
    >
      <div className="pause-screen-body">
        <LogoOrName
          logo={d.logo}
          logos={d.logos}
          alt={d.name}
          logoClass="pause-screen-logo"
          name={<p className="pause-screen-name t-title1">{d.name}</p>}
        />
        {d.episode && (
          <p className="pause-screen-episode t-headline">
            <span className="pause-screen-code">{d.episode.code}</span> {d.episode.title}
          </p>
        )}
        {kicker && <p className="pause-screen-kicker t-caption tabular">{kicker}</p>}
        {d.overview && <p className="pause-screen-overview t-body">{d.overview}</p>}
        {d.cast.length > 0 && (
          <ul className="pause-screen-cast" aria-label="Cast">
            {d.cast.map((p, i) => (
              <li key={`${p.name}-${i}`} className="pause-screen-person" style={{ "--i": i } as CSSProperties}>
                <span className="pause-screen-photo">
                  {p.photo ? <Img src={p.photo} alt="" /> : <span aria-hidden>{initials(p.name)}</span>}
                </span>
                <span className="pause-screen-person-text">
                  <span className="pause-screen-person-name">{p.name}</span>
                  {p.character && <span className="pause-screen-character">{p.character}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** "Ada Example" → "AE": where the photo would be when there is none. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
