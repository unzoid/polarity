import { useEffect, useState } from "react";
import { dismissRating, lastReleased, ratingDismissed, shouldAskRating, type RatingAskState, type RatingService } from "../../lib/playback/ratingPrompt";
import { usePrefs } from "../../lib/settings/prefs";
import { simklRatings, useSimklLink, useSimklTitle } from "../../lib/simkl";
import { traktRatings, useTraktLink, useTraktRating } from "../../lib/trakt";
import type { ContentType, Meta } from "../../lib/types";
import { Check, Close } from "../icons";
import { IconButton } from "../ui/Button";

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** How long "Rated 8 of 10" stays after a rating is sent. */
export const RATED_SHOWN_MS = 2500;

/**
 * After a film or a show's last released episode (lib/playback/ratingPrompt.ts decides): rate it on the profile's
 * linked Trakt and Simkl through their own hooks, the same rating a title page's star sets. Nothing shows with
 * no service linked.
 */
export function PlayerRatingPrompt({
  state,
  meta,
  type,
  metaId,
  videoId,
}: {
  state: Omit<RatingAskState, "enabled" | "type" | "lastReleased" | "dismissed" | "services">;
  meta: Meta | undefined;
  type: ContentType;
  metaId: string;
  videoId: string;
}) {
  const { askRating } = usePrefs();
  const item = { id: metaId, type };
  const trakt = useTraktRating(item);
  const simkl = useSimklTitle(item);
  const { space: traktSpace } = useTraktLink();
  const { space: simklSpace } = useSimklLink();
  const services: (RatingService & { name: string; rate?: (n: number) => void })[] = [
    { name: "Trakt", linked: !!trakt, known: !!trakt && traktRatings(traktSpace) !== undefined, rating: trakt?.rating ?? null, rate: trakt?.rate },
    { name: "Simkl", linked: !!simkl, known: !!simkl && simklRatings(simklSpace) !== undefined, rating: simkl?.rating ?? null, rate: simkl?.rate },
  ];
  const [dismissed, setDismissed] = useState(() => ratingDismissed(metaId));
  useEffect(() => setDismissed(ratingDismissed(metaId)), [metaId]);
  const ask = shouldAskRating({ ...state, enabled: askRating, type, lastReleased: type === "movie" || lastReleased(meta, videoId), dismissed, services });
  const linked = services.filter((s) => s.linked);
  return (
    <RatingPrompt
      shown={ask}
      title={meta?.name ?? ""}
      services={linked.map((s) => s.name)}
      onRate={(n) => linked.forEach((s) => s.rate?.(n))}
      onDismiss={() => {
        dismissRating(metaId);
        setDismissed(true);
      }}
    />
  );
}

/**
 * The card itself: "Rate <title>", 1 to 10 and a dismiss, in the corner Up Next uses (the two never show together).
 * It blocks nothing and takes no focus; once rated it says so and leaves.
 */
export function RatingPrompt({
  shown,
  title,
  services,
  onRate,
  onDismiss,
}: {
  shown: boolean;
  title: string;
  /** The services the rating goes to ("Trakt", "Simkl"). */
  services: string[];
  onRate: (rating: number) => void;
  onDismiss: () => void;
}) {
  const [rated, setRated] = useState<number | null>(null);
  useEffect(() => {
    if (rated === null) return;
    const t = window.setTimeout(() => setRated(null), RATED_SHOWN_MS);
    return () => window.clearTimeout(t);
  }, [rated]);
  if (!(shown || rated !== null) || !title) return null;
  const to = services.join(" and ");
  return (
    <section className="rating-prompt" aria-label={`Rate ${title}`}>
      {rated !== null ? (
        <p className="rating-prompt-done t-callout" role="status">
          <Check size={16} aria-hidden /> Rated {rated} of 10 on {to}
        </p>
      ) : (
        <>
          <div className="rating-prompt-head">
            <div className="rating-prompt-text">
              <span className="rating-prompt-kicker">{`On ${to}`}</span>
              <h2 className="rating-prompt-title">Rate {title}</h2>
            </div>
            <IconButton variant="glass" className="rating-prompt-dismiss" onClick={onDismiss} label="Dismiss">
              <Close size={16} />
            </IconButton>
          </div>
          <div className="rating-prompt-scale" role="group" aria-label="1 to 10">
            {SCALE.map((n) => (
              <button
                key={n}
                className="rating-prompt-score pressable tabular"
                aria-label={`${n} of 10`}
                onClick={() => {
                  onRate(n);
                  setRated(n);
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
