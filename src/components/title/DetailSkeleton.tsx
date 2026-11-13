import { Skeleton } from "../ui/Skeleton";

/**
 * A phone's title page in outline while it loads (usePageTogether): the art, the title treatment, the facts, Play,
 * the round buttons and the synopsis, each where the page will put it (detail.css), so the page then comes in
 * over it in one go, every part at once, rather than piece by piece as each arrives.
 */
export function DetailSkeleton() {
  return (
    <div className="detail-skeleton" aria-hidden>
      <Skeleton className="detail-skeleton-art" />
      <div className="detail-skeleton-hero">
        <Skeleton className="detail-skeleton-logo" />
        <Skeleton shape="line" width="55%" />
        <Skeleton className="detail-skeleton-play" />
        <div className="detail-skeleton-buttons">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="detail-skeleton-button" />
          ))}
        </div>
        <div className="detail-skeleton-text">
          <Skeleton shape="line" width="100%" />
          <Skeleton shape="line" width="92%" />
          <Skeleton shape="line" width="64%" />
        </div>
      </div>
    </div>
  );
}
