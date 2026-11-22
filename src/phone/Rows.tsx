import { memo, useState, type ReactNode } from "react";
import { cardMenu } from "../components/CardMenu";
import { Img } from "../components/Img";
import { useIntent } from "../components/PosterCard";
import { useEntryShown } from "../lib/anime";
import { useNavigation } from "../lib/router";
import type { MetaPreview, Progress } from "../lib/types";
import { cardArtUrl } from "../lib/ui";
import { IconChevronRight } from "./icons";

/**
 * A poster in a row or grid, 110 × 154 pt with 4 pt corners: the title's art and nothing else (Netflix shows no
 * caption under its posters). A tap opens the title's sheet out of it (`data-origin`); a long press, its menu.
 */
export const Poster = memo(function Poster({ item: stored, entry, progress }: { item: MetaPreview; entry?: Progress; progress?: number }) {
  const { item, opens } = useEntryShown(stored, entry?.videoId);
  const { navigate } = useNavigation();
  const intent = useIntent(opens === item.id ? item : { ...item, id: opens });
  const [failed, setFailed] = useState(false);
  const art = cardArtUrl(item.poster, "poster");
  return (
    <button
      type="button"
      className="ph-poster scheme-dark"
      data-origin="4"
      aria-label={item.name}
      onClick={() => navigate({ name: "detail", type: item.type, id: opens, preview: opens === item.id ? item : undefined })}
      {...intent}
      {...cardMenu(stored, entry)}
    >
      {!failed && (art || item.background) ? (
        <Img
          src={art ?? cardArtUrl(item.background, "landscape")}
          fallbacks={art && item.background ? [cardArtUrl(item.background, "landscape")] : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onFail={() => setFailed(true)}
        />
      ) : (
        <span className="ph-poster-name">{item.name}</span>
      )}
      {progress != null && (
        <span className="ph-progress" aria-hidden>
          <i style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
        </span>
      )}
    </button>
  );
});

/**
 * A row: its name over a strip of posters that scrolls sideways; while loading, grey posters in their place. A row
 * that opens in full says so with a chevron after its name (and how many it holds, when given).
 */
export function Row({
  title,
  items,
  onMore,
  count,
  children,
}: {
  title: ReactNode;
  items?: readonly MetaPreview[];
  onMore?: () => void;
  count?: number;
  children?: ReactNode;
}) {
  if (items && !items.length && !children) return null;
  const head = (
    <>
      <span className="ph-row-name">{title}</span>
      {count !== undefined && <span className="ph-row-count">{count}</span>}
      {onMore && <IconChevronRight size={17} stroke={2.6} className="ph-row-chev" />}
    </>
  );
  return (
    <section className="ph-row">
      <h2 className="ph-row-title">
        {onMore ? (
          <button type="button" className="ph-row-more" onClick={onMore}>
            {head}
          </button>
        ) : (
          head
        )}
      </h2>
      <div className="ph-strip">
        {children ?? (items ? items.map((item) => <Poster key={`${item.type}:${item.id}`} item={item} />) : <PosterSkeletons />)}
      </div>
    </section>
  );
}

export function PosterSkeletons({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="ph-poster ph-skeleton" aria-hidden />
      ))}
    </>
  );
}
