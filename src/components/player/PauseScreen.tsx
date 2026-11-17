import { useEffect, useMemo, useState } from "react";
import { PAUSE_SCREEN_AFTER_MS, pauseDetails, pauseScreenAllowed, type PauseDetails, type PauseScreenState } from "../../lib/playback/pauseScreen";
import { usePrefs } from "../../lib/settings/prefs";
import type { Meta } from "../../lib/types";
import { Img } from "../Img";
import { LogoOrName } from "../title/Card";

/** The player's pause screen: Settings → Playback's switch and the title's details joined to what the player is doing. */
export function PlayerPauseScreen({ state, meta, videoId }: { state: Omit<PauseScreenState, "enabled" | "details">; meta: Meta | undefined; videoId: string }) {
  const { pauseDetails: enabled } = usePrefs();
  const details = useMemo(() => pauseDetails(meta, videoId), [meta, videoId]);
  return <PauseScreen allowed={pauseScreenAllowed({ ...state, enabled, details: !!details })} details={details} />;
}

/**
 * Paused and left alone (lib/playback/pauseScreen.ts decides when that is): the frame dims and shows the title's
 * logo or name, the episode, the overview and the main cast. It takes no input of its own: a click, tap or key
 * goes to the player under it and does what it always does, and the player taking `allowed` back removes it at
 * once. It fades in (not with reduced motion) and never fades out.
 */
export function PauseScreen({ allowed, details, after = PAUSE_SCREEN_AFTER_MS }: { allowed: boolean; details: PauseDetails | undefined; after?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!allowed) return setShown(false);
    const t = window.setTimeout(() => setShown(true), after);
    return () => window.clearTimeout(t);
  }, [allowed, after]);
  if (!allowed || !shown || !details) return null;
  return (
    <div className="pause-screen" role="region" aria-label="Paused">
      <div className="pause-screen-body">
        <LogoOrName
          logo={details.logo}
          logos={details.logos}
          alt={details.name}
          logoClass="pause-screen-logo"
          name={<p className="pause-screen-name t-title1">{details.name}</p>}
        />
        {details.episode && (
          <p className="pause-screen-episode t-headline">
            <span className="pause-screen-code">{details.episode.code}</span> {details.episode.title}
          </p>
        )}
        {details.overview && <p className="pause-screen-overview t-body">{details.overview}</p>}
        {details.cast.length > 0 && (
          <ul className="pause-screen-cast" aria-label="Cast">
            {details.cast.map((p, i) => (
              <li key={`${p.name}-${i}`} className="pause-screen-person">
                <span className="pause-screen-photo">
                  {p.photo ? <Img src={p.photo} alt="" /> : <span aria-hidden>{initials(p.name)}</span>}
                </span>
                <span className="pause-screen-person-name">{p.name}</span>
                {p.character && <span className="pause-screen-character">{p.character}</span>}
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
